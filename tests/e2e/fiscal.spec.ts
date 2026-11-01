import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { testCertificate } from "../helpers/fiscal-certificate";
test.use({ actionTimeout: 15000 });
test("Fiscal: estados, porte, regime, A1 com senha, preparação e arquivo XML no computador e celular", async ({
  page,
  browser,
}) => {
  test.setTimeout(180000);
  const stamp = Date.now(),
    email = `fiscal-browser-${stamp}@test.local`,
    password = randomUUID();
  const setup = await page.request.post("/api/setup", {
    headers: { origin: "http://localhost:3000" },
    data: {
      company: "Empresa fiscal automatizada",
      name: "Fiscal teste",
      branch: "Matriz fiscal teste",
      email,
      password,
    },
  });
  expect(setup.ok(), await setup.text()).toBe(true);
  await page.goto("/");
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar no sistema" }).click();
  await page
    .getByRole("button", { name: "Gestão fiscal", exact: true })
    .click();
  const me = await (await page.request.get("/api/me")).json(),
    branch = me.branches[0].id;
  const post = async (path: string, data: any) => {
    const r = await page.request.post("/api" + path, {
      headers: {
        origin: "http://localhost:3000",
        "x-csrf-token": me.csrf,
        "idempotency-key": randomUUID(),
      },
      data,
    });
    expect(r.ok(), await r.text()).toBe(true);
    return r.json();
  };
  await expect(page.getByLabel("Estado (UF)").locator("option")).toHaveCount(
    28,
  );
  await page.getByLabel("Estado (UF)").selectOption("CE");
  await page
    .getByLabel("Razão social", { exact: true })
    .fill("Emitente fictício navegador");
  await page.getByLabel("CNPJ", { exact: true }).fill("12.ABC.345/01DE-35");
  await page.getByLabel("Porte da empresa").selectOption("me");
  await page.getByLabel("Regime tributário").selectOption("presumed");
  await page
    .getByRole("button", { name: "Salvar dados fiscais", exact: true })
    .click();
  await expect(page.getByLabel("Regime tributário")).toHaveValue("presumed");
  const certificatePassword = randomUUID(),
    pfx = testCertificate(certificatePassword);
  await page.getByLabel("Arquivo do certificado A1").setInputFiles({
    name: "ficticio.pfx",
    mimeType: "application/x-pkcs12",
    buffer: pfx,
  });
  await page
    .getByLabel("Senha do certificado", { exact: true })
    .fill("senha incorreta");
  await page
    .getByRole("button", { name: "Guardar certificado", exact: true })
    .click();
  await expect(
    page.getByText(/Não foi possível abrir o certificado A1/),
  ).toBeVisible();
  await page
    .getByLabel("Senha do certificado", { exact: true })
    .fill(certificatePassword);
  await page
    .getByRole("button", { name: "Guardar certificado", exact: true })
    .click();
  await expect(
    page.getByText("Certificado guardado:", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Senha do certificado", { exact: true }),
  ).toHaveValue("");
  const overview = await (
    await page.request.get("/api/fiscal/overview?branch_id=" + branch)
  ).json();
  expect(overview.certificate.active).toBe(true);
  expect(overview.certificate.sealed).toBeUndefined();
  await page.screenshot({
    path: "test-results/fiscal-emitente-desktop.png",
    fullPage: true,
  });
  const product = (
    await post("/products", {
      name: "Mercadoria fiscal navegador",
      sku: "FISCAL-BROWSER",
      condition: "new",
      serialized: false,
      cost: 2,
      price: 10,
      warranty_days: 30,
    })
  ).id;
  await page
    .getByRole("tab", { name: "Classificação dos produtos", exact: true })
    .click();
  await page.getByLabel("Buscar nome ou SKU").fill("FISCAL-BROWSER");
  await page.getByRole("button", { name: "Buscar", exact: true }).click();
  await page.getByRole("button", { name: "Classificar", exact: true }).click();
  await page.getByLabel("NCM", { exact: true }).fill("12345678");
  await page.getByLabel("Unidade comercial", { exact: true }).fill("UN");
  await page
    .getByRole("button", { name: "Salvar classificação", exact: true })
    .click();
  await expect(page.getByRole("cell", { name: /12345678/ })).toBeVisible();
  await post("/movements", {
    product_id: product,
    branch_id: branch,
    type: "entry",
    quantity: 3,
    reason: "Estoque de teste fiscal",
  });
  const state = await (
      await page.request.get("/api/pos/state?branch_id=" + branch)
    ).json(),
    session = (
      await post("/pos/open", {
        register_id: state.register_id,
        opening_cents: 0,
      })
    ).id;
  await post("/pos/sales", {
    session_id: session,
    items: [{ product_id: product, quantity: 1 }],
    discount_cents: 0,
    expected_total_cents: 1000,
    payments: [{ method: "pix", amount_cents: 1000, reference: "PIX-TESTE" }],
  });
  await page
    .getByRole("tab", { name: "Vendas e serviços", exact: true })
    .click();
  await page.getByRole("button", { name: "Preparar", exact: true }).click();
  await expect(
    page.getByText("Preparação salva · não emitida", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Mercadoria fiscal navegador", { exact: true }),
  ).toBeVisible();
  const jsonEvent = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Exportar preparação (JSON)", exact: true })
    .click();
  expect((await jsonEvent).suggestedFilename()).toMatch(/\.json$/);
  const xml =
    '\ufeff<?xml version="1.0"?><arquivo>FICTÍCIO SEM VALIDADE</arquivo>';
  await page
    .getByLabel("Arquivo XML (até 64 KB)")
    .setInputFiles({
      name: "invalido.xml",
      mimeType: "text/xml",
      buffer: Buffer.from([60, 120, 62, 255, 60, 47, 120, 62]),
    });
  await page
    .getByLabel("Descrição do arquivo", { exact: true })
    .fill("Arquivo com codificação inválida");
  await page
    .getByRole("button", { name: "Guardar XML não verificado", exact: true })
    .click();
  await expect(
    page.getByText("Use um arquivo XML codificado em UTF-8.", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Arquivo XML (até 64 KB)").setInputFiles({
    name: "apoio.xml",
    mimeType: "text/xml",
    buffer: Buffer.from(xml),
  });
  await page
    .getByLabel("Descrição do arquivo", { exact: true })
    .fill("Apoio fictício da preparação");
  await page
    .getByRole("button", { name: "Guardar XML não verificado", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "apoio.xml · baixar XML", exact: true }),
  ).toBeVisible();
  const xmlEvent = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "apoio.xml · baixar XML", exact: true })
    .click();
  const download = await xmlEvent;
  expect(download.suggestedFilename()).toBe("apoio.xml");
  const stream = await download.createReadStream();
  let content = "";
  for await (const chunk of stream!) content += chunk.toString();
  expect(content).toBe(xml);
  await page
    .getByLabel("Motivo do arquivamento")
    .fill("Arquivamento de teste navegador");
  await page
    .getByRole("button", { name: "Arquivar preparação", exact: true })
    .click();
  await expect(
    page.getByText("Preparação arquivada", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("tab", { name: "Emitente e certificado", exact: true })
    .click();
  await page
    .getByLabel("Motivo da remoção do certificado")
    .fill("Fim do teste automatizado");
  await page
    .getByRole("button", { name: "Remover certificado", exact: true })
    .click();
  await expect(
    page.getByText("Nenhum certificado guardado.", { exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Abrir menu", exact: true })
    .click()
    .catch(() => {});
  await page
    .getByRole("button", { name: "Gestão fiscal", exact: true })
    .click();
  await expect
    .poll(() =>
      page
        .locator(".sidebar")
        .evaluate((e) => e.getBoundingClientRect().right <= 0),
    )
    .toBe(true);
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await page.screenshot({
    path: "test-results/fiscal-emitente-mobile.png",
    fullPage: true,
  });
  await post("/users", {
    name: "Caixa fiscal teste",
    email: `fiscal-cash-${stamp}@test.local`,
    password,
    role: "cashier",
    branch_ids: [branch],
  });
  const staff = await browser.newContext({ baseURL: "http://localhost:3000" });
  try {
    expect(
      (
        await staff.request.post("/api/login", {
          headers: { origin: "http://localhost:3000" },
          data: { email: `fiscal-cash-${stamp}@test.local`, password },
        })
      ).ok(),
    ).toBe(true);
    expect(
      (
        await staff.request.get("/api/fiscal/overview?branch_id=" + branch)
      ).status(),
    ).toBe(403);
  } finally {
    await staff.close();
  }
});

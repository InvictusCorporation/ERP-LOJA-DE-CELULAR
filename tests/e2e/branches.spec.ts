import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
test.use({ actionTimeout: 15000 });
test("Filiais: cadastro, transferência mista, repetição segura, impressão, resultados e situação", async ({
  page,
  browser,
}) => {
  test.setTimeout(180000);
  const stamp = Date.now(),
    email = `branches-browser-${stamp}@test.local`,
    password = "Branches-Browser-2026!";
  const setup = await page.request.post("/api/setup", {
    headers: { origin: "http://localhost:3000" },
    data: {
      company: "Empresa de filiais automatizada",
      name: "Gestor de filiais teste",
      branch: "Matriz navegador",
      email,
      password,
    },
  });
  expect(setup.ok(), await setup.text()).toBe(true);
  await page.goto("/");
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar no sistema" }).click();
  await expect(
    page.getByRole("button", { name: "Gestão de filiais", exact: true }),
  ).toBeVisible();
  const me = await (await page.request.get("/api/me")).json(),
    source = me.branches[0].id;
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
  const bulk = (
    await post("/products", {
      name: "Produto livre navegador",
      sku: "FIL-BULK",
      condition: "new",
      serialized: false,
      cost: 2,
      price: 10,
      warranty_days: 30,
    })
  ).id;
  const device = (
    await post("/products", {
      name: "Produto individual navegador",
      sku: "FIL-SERIAL",
      condition: "new",
      serialized: true,
      cost: 20,
      price: 50,
      warranty_days: 30,
    })
  ).id;
  await post("/movements", {
    product_id: bulk,
    branch_id: source,
    type: "entry",
    quantity: 20,
    reason: "Entrada para teste de filiais",
  });
  await post("/movements", {
    product_id: device,
    branch_id: source,
    type: "entry",
    quantity: 1,
    reason: "Entrada identificada de teste",
    device: {
      serial: "BR-NAV-001",
      imeis: [],
      provenance: "Procedência de teste",
      acquisition_cost: 20,
    },
  });
  await page
    .getByRole("button", { name: "Gestão de filiais", exact: true })
    .click();
  const panel = page.locator(".branches-panel");
  await page.getByRole("button", { name: "Nova filial", exact: true }).click();
  await page
    .getByLabel("Nome da filial", { exact: true })
    .fill("Filial do navegador");
  await page.getByLabel("Código da filial", { exact: true }).fill("NAV-02");
  await page.getByLabel("Cidade", { exact: true }).fill("Fortaleza");
  await page.getByLabel("UF", { exact: true }).fill("CE");
  await page
    .getByRole("button", { name: "Salvar filial", exact: true })
    .click();
  await expect(
    panel.getByRole("heading", { name: "Filial do navegador", exact: true }),
  ).toBeVisible();
  const branches = await (await page.request.get("/api/branches")).json(),
    dest = branches.items.find((x: any) => x.name === "Filial do navegador").id;
  expect(
    (await (await page.request.get(`/api/pos/state?branch_id=${dest}`)).json())
      .register_id,
  ).toBe(dest);
  await page
    .getByRole("button", { name: "Voltar às filiais", exact: true })
    .click();
  await page.getByRole("tab", { name: "Transferências", exact: true }).click();
  await page
    .getByRole("button", { name: "Nova transferência", exact: true })
    .click();
  await page
    .getByLabel("Filial de origem", { exact: true })
    .selectOption(source);
  await page
    .getByLabel("Filial de destino", { exact: true })
    .selectOption(dest);
  await page
    .getByLabel("Produto para adicionar", { exact: true })
    .selectOption(bulk);
  await page
    .getByRole("button", { name: "Adicionar produto", exact: true })
    .click();
  await page
    .getByLabel("Quantidade de Produto livre navegador", { exact: true })
    .fill("3");
  await page
    .getByLabel("Produto para adicionar", { exact: true })
    .selectOption(device);
  await page
    .getByRole("button", { name: "Adicionar produto", exact: true })
    .click();
  await page.getByLabel("Selecionar BR-NAV-001", { exact: true }).check();
  await page
    .getByLabel("Motivo da transferência", { exact: true })
    .fill("Redistribuição entre unidades para teste");
  await page
    .getByLabel("Conferi a saída na origem e o recebimento no destino.", {
      exact: true,
    })
    .check();
  await page
    .getByLabel("Buscar IMEI ou série de Produto individual navegador", {
      exact: true,
    })
    .press("Enter");
  await expect(
    page.getByRole("button", { name: "Concluir transferência", exact: true }),
  ).toBeEnabled();
  expect(
    (await (await page.request.get("/api/branch-transfers")).json()).total,
  ).toBe(0);
  let lost = false;
  await page.route("**/api/branch-transfers", async (route) => {
    if (route.request().method() === "POST" && !lost) {
      lost = true;
      const r = await route.fetch();
      expect(r.ok(), await r.text()).toBe(true);
      await route.abort("failed");
    } else await route.continue();
  });
  await page
    .getByRole("button", { name: "Concluir transferência", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Concluir transferência", exact: true }),
  ).toBeEnabled();
  expect(lost).toBe(true);
  await page.unroute("**/api/branch-transfers");
  await page
    .getByRole("button", { name: "Concluir transferência", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Imprimir transferência", exact: true }),
  ).toBeVisible();
  const transfers = await (
    await page.request.get("/api/branch-transfers")
  ).json();
  expect(transfers.total).toBe(1);
  const id = transfers.items[0].id;
  expect(
    (await (await page.request.get(`/api/branches/${dest}`)).json()).summary
      .stock_units,
  ).toBe(4);
  await expect(
    panel.getByRole("cell", { name: "BR-NAV-001", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Imprimir transferência", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Documento de transferência" }),
  ).toBeVisible();
  await page.emulateMedia({ media: "print" });
  const print = await page.locator(".branch-print").evaluate((el) => ({
    display: getComputedStyle(el).display,
    top: el.querySelector("article")!.getBoundingClientRect().top,
    header: getComputedStyle(el.querySelector(".no-print")!).display,
  }));
  expect(print.display).not.toBe("none");
  expect(print.top).toBeLessThan(30);
  expect(print.header).toBe("none");
  await page.screenshot({
    path: "test-results/filiais-transferencia-impressao.png",
    fullPage: true,
  });
  await page.emulateMedia({ media: "screen" });
  await page
    .getByRole("button", { name: "Fechar documento", exact: true })
    .click();
  await page
    .getByLabel("Motivo da correção", { exact: true })
    .fill("Retorno integral conferido em teste");
  await page
    .getByLabel("Conferi o retorno de toda a mercadoria para a origem.", {
      exact: true,
    })
    .check();
  await page
    .getByRole("button", { name: "Corrigir transferência", exact: true })
    .click();
  await expect(
    panel.getByRole("heading", { name: /TR-.*Corrigida/ }),
  ).toBeVisible();
  expect(
    (await (await page.request.get(`/api/branches/${dest}`)).json()).summary
      .stock_units,
  ).toBe(0);
  expect(
    (await (await page.request.get(`/api/branch-transfers/${id}`)).json())
      .reversal,
  ).toBeTruthy();
  await page
    .getByRole("button", { name: "Voltar às filiais", exact: true })
    .click();
  await page.getByRole("tab", { name: "Filiais", exact: true }).click();
  await panel
    .getByRole("row")
    .filter({ hasText: "Filial do navegador" })
    .getByRole("button", { name: "Abrir filial", exact: true })
    .click();
  await page
    .getByRole("tab", { name: "Estoque da unidade", exact: true })
    .click();
  await expect(
    panel.getByText("Nenhum produto com saldo disponível."),
  ).toBeVisible();
  await page
    .getByRole("tab", { name: "Resultados e comparativos", exact: true })
    .click();
  await expect(panel.locator(".report-cards")).toBeVisible();
  await page
    .getByLabel("Filiais do relatório", { exact: true })
    .selectOption("all");
  await page
    .getByRole("button", { name: "Aplicar filtros", exact: true })
    .click();
  await expect(
    panel.getByRole("cell", { name: "Matriz navegador", exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByRole("cell", { name: "Filial do navegador", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("tab", { name: "Cadastro da filial", exact: true })
    .click();
  await page
    .getByLabel("Motivo da alteração da filial", { exact: true })
    .fill("Encerramento de teste sem pendências");
  await page
    .getByRole("button", { name: "Inativar filial", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Reativar filial", exact: true }),
  ).toBeVisible();
  const forbidden = await page.request.post("/api/movements", {
    headers: {
      origin: "http://localhost:3000",
      "x-csrf-token": me.csrf,
      "idempotency-key": randomUUID(),
    },
    data: {
      product_id: bulk,
      branch_id: dest,
      type: "entry",
      quantity: 1,
      reason: "Operação em tela antiga de teste",
    },
  });
  expect(forbidden.status()).toBe(409);
  await page
    .getByRole("button", { name: "Voltar às filiais", exact: true })
    .click();
  await page
    .getByLabel("Situação da filial", { exact: true })
    .selectOption("inactive");
  await page
    .getByRole("button", { name: "Aplicar filtros", exact: true })
    .click();
  const row = panel.getByRole("row").filter({ hasText: "Filial do navegador" });
  await expect(row.getByText("Inativa", { exact: true })).toBeVisible();
  await page.screenshot({
    path: "test-results/filiais-desktop.png",
    fullPage: true,
  });
  await row.getByRole("button", { name: "Abrir filial", exact: true }).click();
  await page
    .getByRole("tab", { name: "Cadastro da filial", exact: true })
    .click();
  await page
    .getByLabel("Motivo da alteração da filial", { exact: true })
    .fill("Reabertura da unidade para teste");
  await page
    .getByRole("button", { name: "Reativar filial", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Inativar filial", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Fechar aviso" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(async () => {
      const b = await page.locator(".sidebar").boundingBox();
      return b ? Math.round(b.x + b.width) : 0;
    })
    .toBeLessThanOrEqual(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/filiais-mobile.png",
    fullPage: true,
  });
  await post("/users", {
    name: "Caixa filial teste",
    email: `branch-cash-${stamp}@test.local`,
    password,
    role: "cashier",
    branch_ids: [source],
  });
  const staff = await browser.newContext({ baseURL: "http://localhost:3000" });
  try {
    expect(
      (
        await staff.request.post("/api/login", {
          headers: { origin: "http://localhost:3000" },
          data: { email: `branch-cash-${stamp}@test.local`, password },
        })
      ).ok(),
    ).toBe(true);
    const view = await staff.newPage();
    await view.goto("/");
    await expect(
      view.getByRole("button", { name: "Frente de caixa", exact: true }),
    ).toBeVisible();
    await expect(
      view.getByRole("button", { name: "Gestão de filiais", exact: true }),
    ).toHaveCount(0);
    expect((await staff.request.get("/api/branches")).status()).toBe(403);
  } finally {
    await staff.close();
  }
});

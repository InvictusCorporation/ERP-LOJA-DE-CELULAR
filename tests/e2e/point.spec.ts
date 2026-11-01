import { test, expect } from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";
test.use({ actionTimeout: 15000 });
test("Ponto: preparação cadastral, vínculos existentes, resposta perdida, pacote e permissões", async ({
  page,
  browser,
}) => {
  test.setTimeout(180000);
  const stamp = Date.now(),
    email = `point-browser-${stamp}@test.local`,
    password = randomUUID();
  const setup = await page.request.post("/api/setup", {
    headers: { origin: "http://localhost:3000" },
    data: {
      company: "Empresa de ponto automatizada",
      name: "Gestor ponto navegador",
      branch: "Matriz ponto teste",
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
    .getByRole("button", { name: "Ponto e frequência", exact: true })
    .click();
  await expect(
    page.getByText("Integração não conectada", { exact: true }),
  ).toBeVisible();
  const me = await (await page.request.get("/api/me")).json(),
    branch = me.branches[0].id;
  const headers = {
    origin: "http://localhost:3000",
    "x-csrf-token": me.csrf,
    "idempotency-key": randomUUID(),
  };
  await page
    .getByLabel("Nome do sistema de ponto")
    .fill("Ponto existente — teste");
  await page
    .getByLabel("Endereço base da integração (HTTPS)")
    .fill("https://ponto.example/api");
  await page
    .getByLabel("Identificador da empresa no ponto")
    .fill("EMPRESA-NAVEGADOR");
  await page.getByLabel("Ambiente pretendido").selectOption("production");
  await page
    .getByRole("button", { name: "Salvar destino da integração", exact: true })
    .click();
  await expect(
    page.getByLabel("Identificador da empresa no ponto"),
  ).toHaveValue("EMPRESA-NAVEGADOR");
  await page
    .getByRole("tab", { name: "Vínculos das filiais", exact: true })
    .click();
  await page
    .getByLabel("Identificador no ponto · Matriz ponto teste")
    .fill("MATRIZ-NAVEGADOR");
  await page
    .getByRole("button", { name: "Salvar vínculo da filial", exact: true })
    .click();
  await expect(
    page.getByLabel("Identificador no ponto · Matriz ponto teste"),
  ).toHaveValue("MATRIZ-NAVEGADOR");
  await page
    .getByRole("tab", { name: "Vínculos dos funcionários", exact: true })
    .click();
  await expect(
    page.getByRole("cell", { name: /Gestor ponto navegador/ }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Abrir cadastro de funcionários",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Abrir cadastro", exact: true })
    .click();
  await page
    .getByLabel("Identificador no controle de ponto")
    .fill("GESTOR-NAVEGADOR");
  await page
    .getByLabel("Motivo da alteração")
    .fill("Preparação do vínculo de ponto navegador");
  await page
    .getByRole("button", { name: "Salvar funcionário", exact: true })
    .click();
  await expect(page.getByLabel("Motivo da alteração")).toHaveValue("");
  await page
    .getByRole("button", { name: "Ponto e frequência", exact: true })
    .click();
  await expect(
    page.getByText("Cadastros preparados para revisão", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/ponto-desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("tab", { name: "Pacotes preparados", exact: true })
    .click();
  let lost = false;
  const keys: string[] = [];
  await page.route("**/api/point/exports", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    keys.push(route.request().headers()["idempotency-key"]);
    if (!lost) {
      lost = true;
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      await route.abort("failed");
    } else await route.continue();
  });
  await page
    .getByRole("button", { name: "Preparar pacote cadastral", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Preparar pacote cadastral",
      exact: true,
    }),
  ).toBeEnabled();
  expect(
    (await (await page.request.get("/api/point/exports")).json()).total,
  ).toBe(1);
  await page
    .getByRole("button", { name: "Preparar pacote cadastral", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Baixar pacote", exact: true }),
  ).toHaveCount(1);
  expect(keys.length).toBe(2);
  expect(keys[0]).toBe(keys[1]);
  await page.unroute("**/api/point/exports");
  const exported = (await (await page.request.get("/api/point/exports")).json())
      .items[0],
    event = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Baixar pacote", exact: true })
    .click();
  const download = await event,
    stream = await download.createReadStream();
  let content = "";
  for await (const chunk of stream!) content += chunk.toString();
  expect(createHash("sha256").update(content).digest("hex")).toBe(
    exported.sha256,
  );
  const manifest = JSON.parse(content);
  expect(manifest.integration_status).toBe("not_connected");
  expect(manifest.readiness.local_mapping_complete).toBe(true);
  expect(manifest.scope_branch_ids).toEqual([branch]);
  expect(manifest.employees[0].external_employee_id).toBe("GESTOR-NAVEGADOR");
  expect(manifest.employees[0].email).toBeUndefined();
  expect(manifest.attendance).toBeNull();
  for (const path of ["/point/connect", "/point/sync"])
    expect(
      (await page.request.post("/api" + path, { headers, data: {} })).status(),
    ).toBe(409);
  expect(
    (await (await page.request.get("/api/point/overview")).json()).integration
      .last_sync_at,
  ).toBeNull();
  await page
    .getByRole("tab", { name: "Destino da integração", exact: true })
    .click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Abrir menu", exact: true }).click();
  await page
    .getByRole("button", { name: "Ponto e frequência", exact: true })
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
    path: "test-results/ponto-mobile.png",
    fullPage: true,
  });
  const created = await page.request.post("/api/users", {
    headers: { ...headers, "idempotency-key": randomUUID() },
    data: {
      name: "Administrador ponto navegador",
      email: `point-admin-${stamp}@test.local`,
      password,
      role: "administrator",
      branch_ids: [branch],
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const staff = await browser.newContext({ baseURL: "http://localhost:3000" });
  try {
    expect(
      (
        await staff.request.post("/api/login", {
          headers: { origin: "http://localhost:3000" },
          data: { email: `point-admin-${stamp}@test.local`, password },
        })
      ).ok(),
    ).toBe(true);
    const view = await staff.newPage();
    await view.goto("/");
    await view
      .getByRole("button", { name: "Ponto e frequência", exact: true })
      .click();
    await expect(view.getByLabel("Nome do sistema de ponto")).toBeDisabled();
    await expect(
      view.getByRole("button", {
        name: "Salvar destino da integração",
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      view.getByRole("tab", { name: "Pacotes preparados", exact: true }),
    ).toBeVisible();
  } finally {
    await staff.close();
  }
});

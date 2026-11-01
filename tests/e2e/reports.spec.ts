import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
test.use({ actionTimeout: 15000 });
test("Relatórios: indicadores reais, filtros aplicados, CSV, impressão e celular", async ({
  page,
}) => {
  test.setTimeout(180000);
  const email = `reports-browser-${Date.now()}@test.local`,
    password = "Reports-Browser-2026!";
  const setup = await page.request.post("/api/setup", {
    headers: { origin: "http://localhost:3000" },
    data: {
      company: "Empresa de relatórios automatizada",
      name: "Gestor de relatórios de teste",
      branch: "Matriz relatórios",
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
    page.getByRole("button", { name: "Relatórios gerenciais", exact: true }),
  ).toBeVisible();
  const me = await (await page.request.get("/api/me")).json(),
    branch = me.branches[0].id,
    today = new Date().toLocaleDateString("sv-SE", {
      timeZone: "America/Fortaleza",
    });
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
  const empty = (await post("/branches", { name: "Filial sem operação" })).id;
  const p = (
    await post("/products", {
      name: "=Produto livre de relatório",
      sku: "REPORT-BROWSER",
      condition: "new",
      serialized: false,
      cost: 5,
      price: 20,
      warranty_days: 30,
    })
  ).id;
  await post("/movements", {
    branch_id: branch,
    product_id: p,
    type: "entry",
    quantity: 10,
    reason: "Entrada teste de relatório",
  });
  const session = (
    await post("/pos/open", {
      register_id: (
        await (
          await page.request.get(`/api/pos/state?branch_id=${branch}`)
        ).json()
      ).register_id,
      opening_cents: 0,
    })
  ).id;
  await post("/pos/sales", {
    session_id: session,
    items: [{ product_id: p, quantity: 2 }],
    expected_total_cents: 4000,
    payments: [{ method: "cash", amount_cents: 4000 }],
  });
  await page.reload();
  await page
    .getByRole("button", { name: "Relatórios gerenciais", exact: true })
    .click();
  const panel = page.locator(".reports-panel");
  const yesterday = new Date(Date.parse(today) - 86400000)
    .toISOString()
    .slice(0, 10);
  await page.getByLabel("Filiais do relatório").selectOption("all");
  await page.getByLabel("Data inicial").fill(yesterday);
  await page.getByRole("button", { name: "Aplicar filtros" }).click();
  await expect(
    panel.getByText("Faturamento líquido", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    panel.locator(".report-cards").getByText("R$ 40,00", { exact: true }),
  ).toHaveCount(2);
  await expect(
    panel.locator(".report-cards").getByText("R$ 30,00", { exact: true }),
  ).toHaveCount(2);
  await page.getByLabel("Agrupar por mês").check();
  await expect(
    page.getByRole("heading", { name: "Faturamento mensal" }),
  ).toBeVisible();
  // Changing draft dates cannot relabel or export an old query as if already applied.
  await page.getByLabel("Data inicial").fill(today);
  await expect(panel.locator(".report-heading").first()).toContainText(
    yesterday,
  );
  await page.getByRole("button", { name: "Aplicar filtros" }).click();
  await expect(
    page.getByRole("button", { name: "Exportar CSV" }),
  ).toBeEnabled();
  await expect(panel.locator(".report-heading").first()).toContainText(
    today + " a " + today,
  );
  await page
    .getByRole("tab", { name: "Produtos vendidos", exact: true })
    .click();
  await expect(
    panel.getByRole("cell", {
      name: "=Produto livre de relatório",
      exact: true,
    }),
  ).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exportar CSV" }).click();
  const download = await downloadPromise;
  const csv = await readFile((await download.path())!, "utf8");
  expect(csv).toContain('"\'=Produto livre de relatório"');
  expect(csv).toContain('"40.00"');
  expect(csv).toContain('"30.00"');
  expect(csv).toContain('"Página";"1"');
  await page.getByRole("button", { name: "Imprimir", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Impressão do relatório" });
  await expect(dialog).toBeVisible();
  await page.emulateMedia({ media: "print" });
  const print = await page.locator(".report-print-backdrop").evaluate((el) => ({
    display: getComputedStyle(el).display,
    top: el.querySelector("article")!.getBoundingClientRect().top,
    buttons: Array.from(el.querySelectorAll(".no-print")).map(
      (x) => getComputedStyle(x).display,
    ),
  }));
  expect(print.display).not.toBe("none");
  expect(print.top).toBeLessThan(30);
  expect(print.buttons).toEqual(["none"]);
  await page.screenshot({
    path: "test-results/relatorios-impressao.png",
    fullPage: true,
  });
  await page.emulateMedia({ media: "screen" });
  await dialog.getByRole("button", { name: "Fechar", exact: true }).click();
  await page.getByLabel("Filiais do relatório").selectOption(empty);
  await page.getByRole("button", { name: "Aplicar filtros" }).click();
  await expect(
    panel.getByText("Nenhum registro encontrado para estes filtros."),
  ).toBeVisible();
  await page
    .getByRole("tab", { name: "Produtos parados", exact: true })
    .click();
  await expect(panel.getByText(/Posição atual em/)).toBeVisible();
  await expect(page.getByLabel("Data inicial")).toHaveCount(0);
  await page.getByRole("tab", { name: "Técnicos", exact: true }).click();
  await expect(panel.getByText(/não mede horas trabalhadas/)).toBeVisible();
  await page
    .getByRole("tab", { name: "Serviços realizados", exact: true })
    .click();
  await expect(
    panel.getByText("Nenhum registro encontrado para estes filtros."),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Inadimplência", exact: true }).click();
  await expect(
    panel.getByRole("heading", {
      name: "Consolidado de todas as filiais selecionadas",
    }),
  ).toBeVisible();
  await expect(
    panel.getByText(/Percentual = saldo nominal vencido/),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Vendedores", exact: true }).click();
  await expect(
    panel.getByText("Nenhum registro encontrado para estes filtros."),
  ).toBeVisible();
  await page.route("**/api/reports/sellers?**", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Falha temporária de teste" }),
    }),
  );
  await page.getByRole("button", { name: "Atualizar", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText(
    "Falha temporária de teste",
  );
  await expect(
    page.getByRole("button", { name: "Exportar CSV" }),
  ).toBeDisabled();
  await page.unroute("**/api/reports/sellers?**");
  await page.getByRole("button", { name: "Tentar novamente" }).click();
  await expect(
    panel.getByText("Nenhum registro encontrado para estes filtros."),
  ).toBeVisible();
  await page.getByLabel("Filiais do relatório").selectOption("all");
  await page.getByRole("button", { name: "Aplicar filtros" }).click();
  await expect(
    panel.getByRole("cell", {
      name: "Gestor de relatórios de teste",
      exact: true,
    }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/relatorios-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("tab", { name: "Visão consolidada", exact: true })
    .click();
  await expect(panel.locator(".report-cards")).toBeVisible();
  await expect
    .poll(async () =>
      page.evaluate(() => ({
        width: document.documentElement.scrollWidth,
        viewport: innerWidth,
        offenders: Array.from(document.querySelectorAll("body *"))
          .filter(
            (el) =>
              el.getBoundingClientRect().right > innerWidth + 2 &&
              getComputedStyle(el).position !== "fixed",
          )
          .map((el) => el.tagName + "." + el.className)
          .slice(0, 12),
      })),
    )
    .toMatchObject({ width: 390, viewport: 390 });
  await page.screenshot({
    path: "test-results/relatorios-mobile.png",
    fullPage: true,
  });
  // The largest allowed daily series must fit a narrow screen without widening the page.
  await page
    .getByLabel("Data inicial")
    .fill(
      new Date(Date.parse(today) - 365 * 86400000).toISOString().slice(0, 10),
    );
  await page.getByRole("button", { name: "Aplicar filtros" }).click();
  await page.getByLabel("Agrupar por mês").uncheck();
  await expect(panel.locator(".report-chart > div")).toHaveCount(366);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

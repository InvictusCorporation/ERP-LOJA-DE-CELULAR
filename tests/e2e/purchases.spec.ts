import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
test.use({ actionTimeout: 15000 });

test("Compras completas: fornecedor, pedido, entrega parcial, unidades, financeiro e correção", async ({
  page,
}) => {
  test.setTimeout(180000);
  await page.goto("/");
  await page
    .getByRole("button", { name: "Primeiro acesso? Criar empresa local" })
    .click();
  const email = `purchases-browser-${Date.now()}@test.local`,
    password = "Purchases-Browser-2026!";
  await page
    .getByLabel("Nome da empresa")
    .fill("Demonstração de compras automatizada");
  await page.getByLabel("Seu nome").fill("Gestor de compras de teste");
  await page.getByLabel("Nome da primeira filial").fill("Matriz compras");
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Criar empresa", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Bem-vindo de volta" }),
  ).toBeVisible();
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar no sistema" }).click();
  await expect(
    page.getByRole("button", { name: "Compras e fornecedores", exact: true }),
  ).toBeVisible();
  const me = await (await page.request.get("/api/me")).json(),
    branch = me.branches[0].id,
    day = new Date().toLocaleDateString("sv-SE", {
      timeZone: "America/Fortaleza",
    });
  const post = async (path: string, data: any) => {
    const r = await page.request.post("/api" + path, {
      data,
      headers: {
        origin: "http://localhost:3000",
        "x-csrf-token": me.csrf,
        "idempotency-key": randomUUID(),
      },
    });
    expect(r.ok(), await r.text()).toBe(true);
    return r.json();
  };
  const product = await post("/products", {
    name: "Produto compra navegador",
    sku: "PUR-BROWSER",
    condition: "new",
    serialized: false,
    cost: 2,
    price: 20,
    warranty_days: 90,
  });
  const device = await post("/products", {
    name: "Unidade compra navegador",
    sku: "PUR-SERIAL",
    condition: "new",
    serialized: true,
    cost: 90,
    price: 200,
    warranty_days: 90,
  });
  const bank = await post("/finance/accounts", {
    branch_id: branch,
    name: "Banco compras navegador",
    kind: "bank",
    opening_cents: 100000,
    opening_on: day,
  });
  const confirm = () =>
    page
      .getByRole("button", { name: "Confirmar registro", exact: true })
      .click();
  await page
    .getByRole("button", { name: "Compras e fornecedores", exact: true })
    .click();
  await page.getByRole("button", { name: "Fornecedores", exact: true }).click();
  await page
    .getByRole("button", { name: "Novo fornecedor", exact: true })
    .click();
  await page
    .getByLabel("Nome do fornecedor", { exact: true })
    .fill("Fornecedor compras navegador");
  await page
    .getByLabel("Contato do fornecedor")
    .fill("Contato comercial de teste");
  await page
    .getByLabel("Documento do fornecedor (opcional)")
    .fill("DOC-TESTE-E2E");
  await page
    .getByLabel("E-mail do fornecedor")
    .fill("fornecedor-compras@test.local");
  await confirm();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(
    page.getByText("Fornecedor compras navegador", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Pedidos e recebimentos", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Novo pedido de compra", exact: true })
    .click();
  await page
    .getByLabel("Fornecedor do pedido")
    .selectOption({ label: "Fornecedor compras navegador" });
  await page
    .getByRole("button", {
      name: "Produto compra navegador · PUR-BROWSER",
      exact: true,
    })
    .click();
  await page
    .getByLabel("Quantidade de compra de Produto compra navegador")
    .fill("5");
  await page
    .getByLabel("Custo unitário de Produto compra navegador (R$)")
    .fill("10.00");
  await page
    .getByRole("button", {
      name: "Unidade compra navegador · PUR-SERIAL",
      exact: true,
    })
    .click();
  await page
    .getByLabel("Custo unitário de Unidade compra navegador (R$)")
    .fill("100.00");
  await page
    .getByLabel("Observação do pedido")
    .fill("Pedido fictício exclusivo do teste de navegador");
  await page
    .getByRole("button", { name: "Salvar rascunho", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.getByText("Rascunho", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Editar rascunho", exact: true })
    .click();
  await page
    .getByLabel("Quantidade de compra de Produto compra navegador")
    .fill("6");
  await page
    .getByRole("button", { name: "Salvar rascunho", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page
    .getByRole("button", { name: "Confirmar pedido", exact: true })
    .click();
  await confirm();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(
    page.getByText("Aguardando entrega", { exact: true }),
  ).toBeVisible();
  const list = await (
      await page.request.get("/api/purchases/orders?branch_id=all")
    ).json(),
    order = list.items[0].id;
  let d = await (
    await page.request.get("/api/purchases/orders/" + order)
  ).json();
  expect(d.order.total_cents).toBe(16000);
  expect(d.receipts).toHaveLength(0);
  await page
    .getByRole("button", { name: "Documento do pedido", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Documento do pedido", exact: true }),
  ).toContainText("Fornecedor compras navegador");
  await page.emulateMedia({ media: "print" });
  expect(
    await page
      .locator(".credit-document p")
      .first()
      .evaluate((e) => getComputedStyle(e).fontSize),
  ).toBe("16px");
  expect(
    await page
      .locator(".credit-document")
      .evaluate((e) => e.getBoundingClientRect().top),
  ).toBeLessThan(30);
  await page.screenshot({
    path: "test-results/compras-pedido-impressao.png",
    fullPage: true,
  });
  await page.emulateMedia({ media: "screen" });
  await page
    .getByRole("button", { name: "Fechar documento de compra" })
    .click();
  await page
    .getByRole("button", { name: "Conferir recebimento", exact: true })
    .click();
  await page
    .getByLabel("Referência do documento ou entrega")
    .fill("E2E-COMPRA-PARCIAL");
  await page
    .getByLabel("Quantidade recebida de Produto compra navegador")
    .fill("2");
  let drop = true;
  const keys: string[] = [];
  await page.route("**/api/purchases/orders/*/receive", async (route) => {
    keys.push(route.request().headers()["idempotency-key"]);
    if (drop) {
      drop = false;
      const r = await route.fetch();
      expect(r.ok(), await r.text()).toBe(true);
      await route.abort("failed");
    } else await route.continue();
  });
  await confirm();
  await expect(page.locator(".toast.error")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Confirmar registro", exact: true }),
  ).toBeEnabled();
  await confirm();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
  await page.unroute("**/api/purchases/orders/*/receive");
  await expect(
    page.getByText("Recebido parcialmente", { exact: true }),
  ).toBeVisible();
  d = await (await page.request.get("/api/purchases/orders/" + order)).json();
  const first = d.receipts[0];
  expect(first.total_cents).toBe(2000);
  expect(d.receipts).toHaveLength(1);
  await page
    .getByRole("button", { name: "Conferir recebimento", exact: true })
    .click();
  await page
    .getByLabel("Referência do documento ou entrega")
    .fill("E2E-COMPRA-COMPLETA");
  await page
    .getByLabel("Quantidade recebida de Produto compra navegador")
    .fill("4");
  await page
    .getByLabel("Quantidade recebida de Unidade compra navegador")
    .fill("1");
  await page
    .getByLabel("Série de Unidade compra navegador unidade 1")
    .fill("SERIE-E2E-COMPRAS");
  await page
    .getByLabel("IMEIs de Unidade compra navegador unidade 1")
    .fill("490154203237518");
  await page
    .getByLabel("Procedência de Unidade compra navegador unidade 1")
    .fill("Documento de compra fictício E2E-COMPRA-COMPLETA");
  await confirm();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(
    page
      .locator(".purchase-order-heading")
      .getByText("Recebido", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("row")
    .filter({ hasText: "E2E-COMPRA-COMPLETA" })
    .getByRole("button", { name: "Conferir entrega", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Conferência do recebimento" }),
  ).toContainText("SERIE-E2E-COMPRAS");
  await expect(
    page.getByRole("dialog", { name: "Conferência do recebimento" }),
  ).toContainText("490154203237518");
  await page
    .getByRole("button", { name: "Fechar documento de compra" })
    .click();
  let title = await (
    await page.request.get("/api/finance/titles/" + first.title_id)
  ).json();
  const payment = await post(`/finance/titles/${first.title_id}/settle`, {
    version: title.title.version,
    account_id: bank.id,
    amount_cents: 2000,
    posted_on: day,
    reference: "PAGAMENTO-COMPRA-E2E",
  });
  await page
    .getByRole("row")
    .filter({ hasText: "E2E-COMPRA-PARCIAL" })
    .getByRole("button", { name: "Estornar recebimento", exact: true })
    .click();
  await page
    .getByLabel("Motivo da correção")
    .fill("Correção fictícia do primeiro recebimento");
  await confirm();
  await expect(page.locator(".toast.error")).toContainText(
    "Estorne as baixas financeiras",
  );
  await page
    .getByRole("button", { name: "Fechar formulário de compras" })
    .click();
  title = await (
    await page.request.get("/api/finance/titles/" + first.title_id)
  ).json();
  await post(`/finance/settlements/${payment.id}/reverse`, {
    version: title.title.version,
    posted_on: day,
    reason: "Pagamento de teste lançado indevidamente",
  });
  await page
    .getByRole("row")
    .filter({ hasText: "E2E-COMPRA-PARCIAL" })
    .getByRole("button", { name: "Estornar recebimento", exact: true })
    .click();
  await page
    .getByLabel("Motivo da correção")
    .fill("Correção documentada após estorno do pagamento");
  await confirm();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(
    page.getByText("Recebido parcialmente", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Cancelar saldo pendente", exact: true })
    .click();
  await page
    .getByLabel("Motivo da correção")
    .fill("Fornecedor não entregará o restante neste teste");
  await confirm();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(
    page
      .locator(".purchase-order-heading")
      .getByText("Saldo cancelado", { exact: true }),
  ).toBeVisible();
  const stock = await (
    await page.request.get(`/api/products?branch_id=${branch}`)
  ).json();
  expect(stock.items.find((p: any) => p.id === product.id).quantity).toBe(4);
  expect(stock.items.find((p: any) => p.id === device.id).quantity).toBe(1);
  const report = await (
    await page.request.get(
      `/api/finance/reports?branch_id=all&start=${day.slice(0, 7)}-01&end=${day}`,
    )
  ).json();
  expect(Number(report.outstanding.payable)).toBe(14000);
  expect(report.result.expenses).toBe(0);
  await page.screenshot({
    path: "test-results/compras-pedido-desktop.png",
    fullPage: true,
  });
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
    path: "test-results/compras-pedido-mobile.png",
    fullPage: true,
  });
});

import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
test("PDV completo: leitor, venda mista, falha de rede, devoluções, comprovante e conferência", async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.goto("/");
  await page
    .getByRole("button", { name: "Primeiro acesso? Criar empresa local" })
    .click();
  const email = `pos-browser-${Date.now()}@test.local`;
  await page
    .getByLabel("Nome da empresa")
    .fill("Demonstração PDV automatizada");
  await page.getByLabel("Seu nome").fill("Operador de teste PDV");
  await page.getByLabel("Nome da primeira filial").fill("Loja de testes PDV");
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page
    .getByLabel("Senha", { exact: true })
    .fill("PDV-Browser-Testing-2026!");
  await page
    .getByRole("button", { name: "Criar empresa", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Bem-vindo de volta" }),
  ).toBeVisible();
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page
    .getByLabel("Senha", { exact: true })
    .fill("PDV-Browser-Testing-2026!");
  await page.getByRole("button", { name: "Entrar no sistema" }).click();
  await expect(
    page.getByRole("heading", { name: "Visão geral", exact: true }),
  ).toBeVisible();
  const me = await (await page.request.get("/api/me")).json();
  const post = async (path: string, body: unknown) => {
    const res = await page.request.post(`/api${path}`, {
      data: body,
      headers: {
        origin: "http://localhost:3000",
        "x-csrf-token": me.csrf,
        "idempotency-key": randomUUID(),
      },
    });
    expect(res.ok(), await res.text()).toBe(true);
    return res.json();
  };
  const product = await post("/products", {
    name: "Cabo PDV verificado",
    sku: "PDV-E2E-CABO",
    barcode: "7891234567890",
    condition: "new",
    serialized: false,
    cost: 10,
    price: 25,
    warranty_days: 90,
  });
  await post("/movements", {
    product_id: product.id,
    branch_id: me.branches[0].id,
    type: "entry",
    quantity: 10,
    reason: "Entrada identificada para teste de PDV",
  });
  await page
    .getByRole("button", { name: "Frente de caixa", exact: true })
    .click();
  await page.getByRole("button", { name: "Abrir caixa", exact: true }).click();
  await page.getByLabel("Saldo inicial (R$)").fill("100.00");
  await page.getByRole("button", { name: "Confirmar operação" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  const scanner = page.getByRole("textbox", {
    name: "Buscar ou ler código de barras",
  });
  await scanner.fill("7891234567890");
  await scanner.press("Enter");
  await expect(
    page.getByLabel("Quantidade de Cabo PDV verificado"),
  ).toHaveValue("1");
  await scanner.fill("7891234567890");
  await scanner.press("Enter");
  await expect(
    page.getByLabel("Quantidade de Cabo PDV verificado"),
  ).toHaveValue("2");
  await page.getByLabel("Desconto (R$)", { exact: true }).fill("10.00");
  await page.screenshot({
    path: "test-results/pdv-carrinho-desktop.png",
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
    path: "test-results/pdv-carrinho-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "Receber e finalizar" }).click();
  await page.getByLabel("Valor 1 (R$)").fill("30.00");
  await page.getByRole("button", { name: "Dividir pagamento" }).click();
  await page.getByLabel("Forma 2", { exact: true }).selectOption("pix");
  await page.getByLabel("Valor 2 (R$)").fill("20.00");
  await page.getByLabel("Referência externa 2").fill("PIX-CONFERIDO-TESTE");
  let drop = true,
    saleId = "";
  const keys: string[] = [];
  await page.route("**/api/pos/sales", async (route) => {
    keys.push(route.request().headers()["idempotency-key"]);
    if (drop) {
      drop = false;
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      saleId = (await response.json()).id;
      await route.abort("failed");
    } else await route.continue();
  });
  await page
    .getByRole("button", { name: "Confirmar venda", exact: true })
    .click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Confirmar venda", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Confirmar venda", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Comprovante de venda", exact: true }),
  ).toBeVisible();
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
  await page.unroute("**/api/pos/sales");
  const stock = await (
    await page.request.get(
      `/api/products?branch_id=${me.branches[0].id}&q=PDV-E2E-CABO`,
    )
  ).json();
  expect(stock.items[0].quantity).toBe(8);
  const receipt = await (
    await page.request.get(`/api/pos/sales/${saleId}`)
  ).json();
  expect(receipt.sale.change_cents).toBe(1000);
  expect(receipt.sale.total_cents).toBe(4000);
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Baixar comprovante", exact: true })
    .click();
  await (await download).saveAs("test-results/comprovante-pdv.txt");
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".pos-receipt")).toHaveCSS("visibility", "visible");
  await expect(page.locator(".sidebar")).toHaveCSS("visibility", "hidden");
  await page.emulateMedia({ media: "screen" });
  await page.screenshot({
    path: "test-results/pdv-comprovante-desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Devolver itens", exact: true })
    .click();
  await page
    .getByLabel("Devolver Cabo PDV verificado", { exact: true })
    .fill("1");
  await page
    .getByRole("button", { name: "Distribuir conforme pagamentos originais" })
    .click();
  await page
    .getByLabel("Motivo da devolução ou cancelamento")
    .fill("Devolução parcial de teste");
  await page.getByRole("button", { name: "Confirmar operação" }).click();
  await expect(
    page.getByText("Devolução parcial", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Devolver itens", exact: true })
    .click();
  await page.getByLabel("Referência externa 2").fill("PIX-DEVOLUCAO-TESTE");
  await page
    .getByLabel("Motivo da devolução ou cancelamento")
    .fill("Devolução restante de teste");
  await page.getByRole("button", { name: "Confirmar operação" }).click();
  await expect(page.getByText("Devolvida", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Fechar janela do PDV", exact: true })
    .click();
  await scanner.fill("7891234567890");
  await scanner.press("Enter");
  await expect(
    page.getByLabel("Quantidade de Cabo PDV verificado"),
  ).toHaveValue("1");
  await page.getByRole("button", { name: "Receber e finalizar" }).click();
  await page
    .getByRole("button", { name: "Confirmar venda", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Cancelar venda", exact: true })
    .click();
  await page
    .getByLabel("Motivo da devolução ou cancelamento")
    .fill("Cancelamento integral de teste");
  await page.getByRole("button", { name: "Confirmar operação" }).click();
  await expect(page.getByText("Cancelada", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Fechar janela do PDV", exact: true })
    .click();
  await page.getByRole("button", { name: "Meu caixa", exact: true }).click();
  await page
    .getByRole("button", { name: "Registrar suprimento", exact: true })
    .click();
  await page.getByLabel("Valor da movimentação (R$)").fill("10.00");
  await page.getByLabel("Motivo", { exact: true }).fill("Suprimento de teste");
  await page.getByRole("button", { name: "Confirmar operação" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page
    .getByRole("button", { name: "Registrar sangria", exact: true })
    .click();
  await page.getByLabel("Valor da movimentação (R$)").fill("5.00");
  await page.getByLabel("Motivo", { exact: true }).fill("Sangria de teste");
  await page.getByRole("button", { name: "Confirmar operação" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page
    .getByRole("button", { name: "Conferir e fechar caixa", exact: true })
    .click();
  await page.getByLabel("Dinheiro contado (R$)").fill("104.00");
  await page
    .getByLabel("Observação da conferência")
    .fill("Diferença de um real apurada no teste");
  await page.getByRole("button", { name: "Confirmar operação" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.getByRole("button", { name: "Por operador", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Conferência das sessões" }),
  ).toBeVisible();
  await expect(page.getByText("R$ 104,00", { exact: true })).toBeVisible();
  await page.screenshot({
    path: "test-results/pdv-conferencia-desktop.png",
    fullPage: true,
  });
  await page.reload();
  await page
    .getByRole("button", { name: "Frente de caixa", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Abrir caixa", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Histórico", exact: true }).click();
  await expect(page.getByText("Devolvida", { exact: true })).toBeVisible();
  await expect(page.getByText("Cancelada", { exact: true })).toBeVisible();
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
    path: "test-results/pdv-mobile.png",
    fullPage: true,
  });
});

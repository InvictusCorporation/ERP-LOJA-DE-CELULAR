import { test, expect } from "@playwright/test";
test("cadastro, entrada, inventário, estoque mínimo e persistência após recarregar", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Primeiro acesso? Criar empresa local" })
    .click();
  const email = `browser-${Date.now()}@test.local`;
  await page.getByLabel("Nome da empresa").fill("Demonstração automatizada");
  await page.getByLabel("Seu nome").fill("Teste de interface");
  await page.getByLabel("Nome da primeira filial").fill("Loja de testes");
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByLabel("Senha", { exact: true }).fill("Browser-Testing-2026!");
  await page
    .getByRole("button", { name: "Criar empresa", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Bem-vindo de volta" }),
  ).toBeVisible();
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByLabel("Senha", { exact: true }).fill("Browser-Testing-2026!");
  await page.getByRole("button", { name: "Entrar no sistema" }).click();
  await expect(
    page.getByRole("heading", { name: "Visão geral", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Novo produto", exact: true }).click();
  await page.getByLabel("Nome do produto").fill("Cabo USB-C verificado");
  await page.getByLabel("SKU", { exact: true }).fill("E2E-CABO");
  await page.getByLabel("Preço de custo (R$)").fill("10");
  await page.getByLabel("Preço de venda (R$)").fill("25");
  await page.getByRole("button", { name: "Salvar e registrar" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.getByRole("button", { name: "Produtos", exact: true }).click();
  await expect(
    page.getByText("Cabo USB-C verificado", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Movimentar Cabo USB-C verificado",
      exact: true,
    })
    .click();
  await page.getByLabel("Quantidade", { exact: true }).fill("5");
  await page
    .getByLabel("Motivo da movimentação")
    .fill("Entrada de teste automatizado");
  let dropResponse = true;
  const operationKeys: string[] = [];
  await page.route("**/api/movements", async (route) => {
    operationKeys.push(route.request().headers()["idempotency-key"]);
    if (dropResponse) {
      dropResponse = false;
      const result = await route.fetch();
      expect(result.ok()).toBe(true);
      await route.abort("failed");
    } else await route.continue();
  });
  await page.getByRole("button", { name: "Salvar e registrar" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Salvar e registrar" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Salvar e registrar" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(operationKeys).toHaveLength(2);
  expect(operationKeys[0]).toBe(operationKeys[1]);
  await page.unroute("**/api/movements");
  await expect(
    page.getByRole("row").filter({ hasText: "E2E-CABO" }),
  ).toContainText("5 un.");
  await page.getByRole("button", { name: "Inventário", exact: true }).click();
  await page.getByRole("button", { name: "Conferir", exact: true }).click();
  await page.getByLabel("Quantidade contada").fill("3");
  await page
    .getByLabel("Justificativa da contagem")
    .fill("Contagem de teste automatizado");
  await page.getByRole("button", { name: "Salvar e registrar" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page
    .getByRole("button", { name: "Definir mínimo de Cabo USB-C verificado" })
    .click();
  await page.getByLabel("Quantidade mínima").fill("4");
  await page.getByRole("button", { name: "Salvar e registrar" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.getByText("Repor estoque", { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Produtos", exact: true }).click();
  await expect(
    page.getByText("Cabo USB-C verificado", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Repor estoque", { exact: true })).toBeVisible();
  await page.screenshot({
    path: "test-results/produtos-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("heading", { name: "Produtos", exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () => {
      const box = await page.locator(".sidebar").boundingBox();
      return box ? Math.round(box.x + box.width) : 0;
    })
    .toBeLessThanOrEqual(0);
  await page.getByRole("button", { name: "Abrir menu", exact: true }).click();
  await expect(page.locator(".sidebar")).toHaveClass("sidebar open");
  await page.getByRole("button", { name: "Produtos", exact: true }).click();
  await expect
    .poll(async () => {
      const box = await page.locator(".sidebar").boundingBox();
      return box ? Math.round(box.x + box.width) : 0;
    })
    .toBeLessThanOrEqual(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await expect(
    page.getByText("Cabo USB-C verificado", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/produtos-mobile.png",
    fullPage: true,
  });
});

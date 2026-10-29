import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
test("CRM completo: cliente, preferência, funil, lembrete e venda vinculada", async ({
  page,
}) => {
  test.setTimeout(150000);
  await page.goto("/");
  await page
    .getByRole("button", { name: "Primeiro acesso? Criar empresa local" })
    .click();
  const email = `crm-browser-${Date.now()}@test.local`;
  await page
    .getByLabel("Nome da empresa")
    .fill("Demonstração CRM automatizada");
  await page.getByLabel("Seu nome").fill("Gestor de teste");
  await page.getByLabel("Nome da primeira filial").fill("Matriz CRM");
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByLabel("Senha", { exact: true }).fill("Crm-Browser-2026!");
  await page
    .getByRole("button", { name: "Criar empresa", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Bem-vindo de volta" }),
  ).toBeVisible();
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByLabel("Senha", { exact: true }).fill("Crm-Browser-2026!");
  await page.getByRole("button", { name: "Entrar no sistema" }).click();
  await page
    .getByRole("button", { name: "CRM e clientes", exact: true })
    .click();
  await page.getByRole("button", { name: "Novo cliente", exact: true }).click();
  await page
    .getByLabel("Nome completo", { exact: true })
    .fill("Cliente CRM navegador");
  await page.getByLabel("Telefone", { exact: true }).fill("85999992222");
  await page
    .getByLabel("E-mail", { exact: true })
    .fill("cliente-browser@test.local");
  await page.getByLabel("Cidade", { exact: true }).fill("Fortaleza");
  await page.getByLabel("UF", { exact: true }).fill("CE");
  await page
    .getByRole("button", { name: "Salvar registro", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Cliente CRM navegador", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Preparar WhatsApp", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Preferência de contato", exact: true })
    .click();
  await page
    .getByLabel("Contato comercial", { exact: true })
    .selectOption("yes");
  await page
    .getByLabel("Evidência ou motivo")
    .fill("Cliente autorizou contato presencialmente neste teste");
  await page
    .getByRole("button", { name: "Salvar registro", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Preparar WhatsApp", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Preparar WhatsApp", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "Abrir WhatsApp" }),
  ).toHaveAttribute("href", "https://wa.me/5585999992222");
  await page.getByRole("button", { name: "Fechar janela do CRM" }).click();
  await page
    .getByRole("button", { name: "Registrar atendimento", exact: true })
    .click();
  await page
    .getByLabel("Resumo do atendimento")
    .fill("Cliente procura aparelho com maior capacidade.");
  await page
    .getByRole("button", { name: "Salvar registro", exact: true })
    .click();
  await expect(
    page.getByText("Cliente procura aparelho com maior capacidade.", {
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Nova oportunidade", exact: true })
    .click();
  await page.getByLabel("Título da oportunidade").fill("Troca de aparelho CRM");
  await page.getByLabel("Valor previsto (R$)").fill("1700.00");
  await page
    .getByRole("button", { name: "Salvar registro", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page
    .getByRole("button", { name: "Funil comercial", exact: true })
    .click();
  const opportunity = page
    .getByRole("row")
    .filter({ hasText: "Troca de aparelho CRM" });
  await expect(opportunity).toBeVisible();
  await opportunity
    .getByRole("button", { name: "Atualizar", exact: true })
    .click();
  await page.getByLabel("Etapa", { exact: true }).selectOption("proposal");
  await page
    .getByRole("button", { name: "Salvar registro", exact: true })
    .click();
  await expect(
    opportunity.getByText("Proposta", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/crm-funil-desktop.png",
    fullPage: true,
  });
  await opportunity
    .getByRole("button", { name: "Cliente CRM navegador", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Cliente CRM navegador", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Novo lembrete", exact: true })
    .click();
  await page.getByLabel("Assunto do lembrete").fill("Retornar proposta CRM");
  await page
    .getByLabel("Data e hora (Fortaleza, UTC−3)")
    .fill("2020-01-01T10:00");
  await page
    .getByRole("button", { name: "Salvar registro", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.getByRole("button", { name: "Lembretes", exact: true }).click();
  const task = page
    .getByRole("row")
    .filter({ hasText: "Retornar proposta CRM" });
  await expect(task.getByText("Atrasado", { exact: true })).toBeVisible();
  await task.getByRole("button", { name: "Atualizar", exact: true }).click();
  await page.getByLabel("Situação", { exact: true }).selectOption("done");
  await page
    .getByRole("button", { name: "Salvar registro", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.getByLabel("Filtrar situação").selectOption("done");
  await expect(task.getByText("Concluído", { exact: true })).toBeVisible();
  const me = await (await page.request.get("/api/me")).json();
  const post = async (path: string, body: unknown) => {
    const r = await page.request.post("/api" + path, {
      data: body,
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
    name: "Cabo CRM navegador",
    sku: "CRM-E2E-CABO",
    barcode: "7891234500999",
    condition: "new",
    serialized: false,
    cost: 10,
    price: 25,
    warranty_days: 90,
    warranty_terms: "Prazo cadastrado de teste",
  });
  await post("/movements", {
    branch_id: me.branches[0].id,
    product_id: product.id,
    type: "entry",
    quantity: 3,
    reason: "Entrada CRM de teste",
  });
  await page
    .getByRole("button", { name: "Frente de caixa", exact: true })
    .click();
  await page.getByRole("button", { name: "Abrir caixa", exact: true }).click();
  await page.getByLabel("Saldo inicial (R$)").fill("0");
  await page.getByRole("button", { name: "Confirmar operação" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  const scanner = page.getByRole("textbox", {
    name: "Buscar ou ler código de barras",
  });
  await scanner.fill("7891234500999");
  await scanner.press("Enter");
  await expect(page.getByLabel("Quantidade de Cabo CRM navegador")).toHaveValue(
    "1",
  );
  await page.getByRole("button", { name: "Receber e finalizar" }).click();
  await page.getByLabel("Cliente da venda (opcional)").fill("CRM navegador");
  await page
    .getByRole("button", {
      name: "Cliente CRM navegador · Telefone final 2222",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Confirmar venda", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Comprovante de venda", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Cliente: Cliente CRM navegador", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Fechar janela do PDV" }).click();
  await page
    .getByRole("button", { name: "CRM e clientes", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Abrir cliente", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Compras, aparelhos e garantias",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("cell").filter({ hasText: "Cabo CRM navegador" }),
  ).toBeVisible();
  await expect(page.getByText("Prazo vigente", { exact: true })).toBeVisible();
  await page.screenshot({
    path: "test-results/crm-cliente-desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Preferência de contato", exact: true })
    .click();
  await page
    .getByLabel("Contato comercial", { exact: true })
    .selectOption("no");
  await page
    .getByLabel("Evidência ou motivo")
    .fill("Revogação solicitada pelo cliente neste teste");
  await page
    .getByRole("button", { name: "Salvar registro", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Preparar WhatsApp", exact: true }),
  ).toBeDisabled();
  await page.reload();
  await page
    .getByRole("button", { name: "CRM e clientes", exact: true })
    .click();
  await expect(
    page.getByText("Cliente CRM navegador", { exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(async () => {
      const bounds = await page.locator(".sidebar").boundingBox();
      return bounds ? Math.round(bounds.x + bounds.width) : 0;
    })
    .toBeLessThanOrEqual(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/crm-clientes-mobile.png",
    fullPage: true,
  });
});

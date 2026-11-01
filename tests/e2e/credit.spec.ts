import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";

test("Crediário: análise, oferta, venda no caixa, contrato, antecipação e renegociação", async ({
  page,
}) => {
  test.setTimeout(180000);
  await page.goto("/");
  await page
    .getByRole("button", { name: "Primeiro acesso? Criar empresa local" })
    .click();
  const email = `credit-browser-${Date.now()}@test.local`,
    password = "Credit-Browser-2026!";
  await page
    .getByLabel("Nome da empresa")
    .fill("Crediário demonstrativo automatizado");
  await page.getByLabel("Seu nome").fill("Gestor de teste");
  await page.getByLabel("Nome da primeira filial").fill("Matriz crediário");
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
    page.getByRole("button", { name: "Crediário próprio", exact: true }),
  ).toBeVisible();
  const me = await (await page.request.get("/api/me")).json(),
    branch = me.branches[0].id;
  const post = async (path: string, data: any) => {
    const r = await page.request.post("/api" + path, {
      data,
      headers: {
        "x-csrf-token": me.csrf,
        "idempotency-key": randomUUID(),
        origin: "http://localhost:3000",
      },
    });
    expect(r.ok(), await r.text()).toBe(true);
    return r.json();
  };
  const customer = await post("/crm/customers", {
    name: "Cliente crédito navegador",
    phone: "85999993333",
    email: "cliente-credito@test.local",
    city: "Fortaleza",
    state: "CE",
  });
  const product = await post("/products", {
    name: "Produto crédito navegador",
    sku: "CRED-BROWSER",
    condition: "new",
    serialized: false,
    cost: 250,
    price: 500,
    warranty_days: 90,
  });
  await post("/movements", {
    branch_id: branch,
    product_id: product.id,
    type: "entry",
    quantity: 2,
    reason: "Entrada isolada de teste",
  });
  const bank = await post("/finance/accounts", {
    branch_id: branch,
    name: "Banco crediário navegador",
    kind: "bank",
    opening_cents: 0,
    opening_on: new Date().toLocaleDateString("sv-SE", {
      timeZone: "America/Fortaleza",
    }),
  });
  const confirm = () =>
    page
      .getByRole("button", { name: "Confirmar registro", exact: true })
      .click();
  await page
    .getByRole("button", { name: "Crediário próprio", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Configurar condições", exact: true })
    .click();
  await page.getByLabel("CNPJ do fornecedor").fill("11222333000181");
  await page
    .getByLabel("Endereço do fornecedor")
    .fill("Endereço demonstrativo, Fortaleza CE");
  await page.getByLabel("E-mail do fornecedor").fill("juridico@test.local");
  await page.getByLabel("Telefone do fornecedor").fill("85999990000");
  await page.getByLabel("Juros simples máximos ao mês (%)").fill("1.00");
  await page.getByLabel("Multa única de atraso (%)").fill("2.00");
  await page.getByLabel("Mora simples ao mês (%)").fill("1.00");
  await page.getByLabel("Validade da oferta (dias)").fill("2");
  await page
    .getByLabel("Termos comerciais revisados")
    .fill(
      "Termos fictícios exclusivos deste teste de interface; não representam revisão jurídica comercial.",
    );
  await page
    .getByLabel("Referência da revisão jurídica")
    .fill("REVISÃO FICTÍCIA E2E-001");
  await page.locator('input[name="enabled"]').check();
  await page.locator('input[name="reviewed"]').check();
  await confirm();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page
    .getByRole("button", { name: "Clientes e análise", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Analisar cliente", exact: true })
    .click();
  await page.getByLabel("Buscar cliente no CRM").fill("Cliente crédito");
  await page.getByRole("button", { name: /Cliente crédito navegador/ }).click();
  await page.getByLabel("CPF do comprador").fill("52998224725");
  await page
    .getByLabel("Endereço do comprador")
    .fill("Endereço demonstrativo do comprador, Fortaleza CE");
  await page.getByLabel("Limite de principal (R$)").fill("1000.00");
  await page
    .getByLabel("Avaliação da capacidade de pagamento")
    .fill("Avaliação manual fictícia para teste automatizado.");
  await page
    .getByLabel("Referência da consulta externa de crédito")
    .fill("CONSULTA FICTÍCIA E2E-001");
  await page.locator('input[name="enabled"]').check();
  await page.locator('input[name="capacity_checked"]').check();
  await confirm();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page
    .getByRole("button", { name: "Ofertas aprovadas", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Simular e aprovar oferta", exact: true })
    .click();
  await page.getByLabel("Buscar perfil de crédito").fill("Cliente crédito");
  await page.getByRole("button", { name: /Cliente crédito navegador/ }).click();
  await page.getByLabel("Preço da compra sem juros (R$)").fill("500.00");
  await page.getByLabel("Entrada (R$)").fill("50.00");
  await page
    .getByLabel("Juros simples ao mês (%)", { exact: true })
    .fill("1.00");
  await page
    .getByLabel("Avaliação desta operação")
    .fill("Operação fictícia compatível com a análise do teste.");
  await page
    .getByLabel("Referência da aprovação")
    .fill("APROVAÇÃO TESTE E2E-001");
  await page
    .getByRole("button", { name: "Simular condições", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Condições simuladas" }),
  ).toBeVisible();
  await confirm();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page
    .getByRole("button", { name: "Documento da oferta", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Documento da oferta", exact: true }),
  ).toContainText("52998224725");
  await page
    .getByRole("button", { name: "Fechar documento do crediário" })
    .click();
  await page
    .getByRole("button", { name: "Frente de caixa", exact: true })
    .click();
  await page.getByRole("button", { name: "Abrir caixa", exact: true }).click();
  await page.getByLabel("Saldo inicial (R$)").fill("0.00");
  await page
    .getByRole("button", { name: "Confirmar operação", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.getByRole("button", { name: /Produto crédito navegador/ }).click();
  await page
    .getByRole("button", { name: "Receber e finalizar", exact: true })
    .click();
  await page.getByLabel("Condição de venda").selectOption("credit");
  const offerSelect = page.getByLabel("Oferta aprovada", { exact: true });
  await expect(offerSelect.locator("option")).toHaveCount(2);
  await offerSelect.selectOption({ index: 1 });
  await page
    .getByLabel("Referência do aceite do contrato")
    .fill("Contrato físico fictício E2E-001");
  await page.locator('input[name="credit_terms"]').check();
  await page
    .getByRole("button", { name: "Confirmar venda", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Comprovante de venda" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Contrato do crediário", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Documento do contrato", exact: true }),
  ).toContainText("CET anual");
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
    path: "test-results/credit-contract-print.png",
    fullPage: true,
  });
  await page.emulateMedia({ media: "screen" });
  await page.screenshot({
    path: "test-results/credit-contract-desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Fechar documento do crediário" })
    .click();
  await page.getByRole("button", { name: "Fechar janela do PDV" }).click();
  const contracts = await (
    await page.request.get("/api/credit/contracts?branch_id=all")
  ).json();
  const contract = contracts.items[0].id;
  const sale = await (
    await page.request.get(`/api/credit/contracts/${contract}`)
  ).json();
  expect(
    sale.items.reduce((n: number, x: any) => n + x.principal_cents, 0),
  ).toBe(45000);
  await page
    .getByRole("button", { name: "Crediário próprio", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Abrir contrato", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Receber parcela", exact: true })
    .first()
    .click();
  await page.getByLabel("Conta do recebimento").selectOption(bank.id);
  await page.getByLabel("Valor recebido (R$)").fill("50.00");
  await page
    .getByLabel("Referência do recebimento")
    .fill("ANTECIPAÇÃO E2E-001");
  let drop = true;
  const keys: string[] = [];
  await page.route("**/api/credit/contracts/*/receive", async (route) => {
    keys.push(route.request().headers()["idempotency-key"]);
    if (drop) {
      drop = false;
      const r = await route.fetch();
      expect(r.ok(), await r.text()).toBe(true);
      await route.abort("failed");
    } else await route.continue();
  });
  await confirm();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Confirmar registro", exact: true }),
  ).toBeEnabled();
  await confirm();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
  await page.unroute("**/api/credit/contracts/*/receive");
  await page
    .getByRole("button", { name: "Renegociar principal aberto", exact: true })
    .click();
  await page.getByLabel("Quantidade de parcelas").fill("2");
  await page
    .getByLabel("Avaliação desta operação")
    .fill("Reavaliação fictícia para testar preservação de principal.");
  await page
    .getByLabel("Motivo da renegociação")
    .fill("Reorganização de prazos exclusiva do teste.");
  await page
    .getByLabel("Referência da aceitação do novo plano")
    .fill("NOVO PLANO FICTÍCIO E2E");
  await page.locator('input[name="accepted"]').check();
  await page
    .getByRole("button", { name: "Simular condições", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Condições simuladas" }),
  ).toBeVisible();
  await confirm();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  const d = await (
    await page.request.get(`/api/credit/contracts/${contract}`)
  ).json();
  expect(d.plan.revision).toBe(2);
  expect(d.plan.principal_cents).toBe(40000);
  const conf = await (
    await page.request.get("/api/finance/config?branch_id=all")
  ).json();
  expect(
    Number(conf.accounts.find((a: any) => a.id === bank.id).balance_cents),
  ).toBe(5000);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByText(/Revisão 2 · Valores calculados/)).toBeVisible();
  await expect
    .poll(async () => {
      const b = await page.locator(".sidebar").boundingBox();
      return b ? Math.round(b.x + b.width) : 0;
    })
    .toBeLessThanOrEqual(0);
  await page.screenshot({
    path: "test-results/credit-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

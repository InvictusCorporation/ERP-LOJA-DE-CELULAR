import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
test("Financeiro completo: títulos, baixa após falha de rede, conciliação, DRE e contas", async ({
  page,
}) => {
  test.setTimeout(150000);
  await page.goto("/");
  await page
    .getByRole("button", { name: "Primeiro acesso? Criar empresa local" })
    .click();
  const email = `finance-browser-${Date.now()}@test.local`;
  await page
    .getByLabel("Nome da empresa")
    .fill("Demonstração financeira automatizada");
  await page.getByLabel("Seu nome").fill("Gestor financeiro de teste");
  await page.getByLabel("Nome da primeira filial").fill("Matriz financeira");
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByLabel("Senha", { exact: true }).fill("Finance-Browser-2026!");
  await page
    .getByRole("button", { name: "Criar empresa", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Bem-vindo de volta" }),
  ).toBeVisible();
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByLabel("Senha", { exact: true }).fill("Finance-Browser-2026!");
  await page.getByRole("button", { name: "Entrar no sistema" }).click();
  await page
    .getByRole("button", { name: "Gestão financeira", exact: true })
    .click();
  const confirm = () =>
    page
      .getByRole("button", { name: "Confirmar registro", exact: true })
      .click();
  await page
    .getByRole("button", { name: "Contas e centros", exact: true })
    .click();
  await page.getByRole("button", { name: "Nova conta", exact: true }).click();
  await page
    .getByLabel("Nome da conta", { exact: true })
    .fill("Caixa financeiro teste");
  await page.getByLabel("Saldo inicial (R$)").fill("1000.00");
  await confirm();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.getByRole("button", { name: "Nova conta", exact: true }).click();
  await page
    .getByLabel("Nome da conta", { exact: true })
    .fill("Banco financeiro teste");
  await confirm();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.getByRole("button", { name: "Novo centro", exact: true }).click();
  await page.getByLabel("Nome do centro").fill("Estrutura da loja");
  await confirm();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page
    .getByRole("button", { name: "Contas a pagar", exact: true })
    .click();
  await page.getByRole("button", { name: "Novo título", exact: true }).click();
  await page.getByLabel("Descrição do título").fill("Aluguel financeiro teste");
  await page
    .getByLabel("Cliente / fornecedor / contraparte")
    .fill("Locador de teste");
  await page.getByLabel("Valor do título (R$)").fill("250.00");
  await page
    .getByLabel("Centro de custo", { exact: true })
    .selectOption({ label: "Estrutura da loja" });
  await confirm();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  const payable = page
    .getByRole("row")
    .filter({ hasText: "Aluguel financeiro teste" });
  await payable.getByRole("button", { name: "Abrir título" }).click();
  await page
    .getByRole("button", { name: "Registrar baixa", exact: true })
    .click();
  await page
    .getByLabel("Conta da baixa")
    .selectOption(
      (await page
        .getByLabel("Conta da baixa")
        .locator("option")
        .filter({ hasText: "Caixa financeiro teste" })
        .getAttribute("value"))!,
    );
  await page.getByLabel("Valor da baixa (R$)").fill("100.00");
  await page.getByLabel("Referência da baixa").fill("PAGAMENTO-FIN-001");
  let drop = true;
  const keys: string[] = [];
  await page.route("**/api/finance/titles/*/settle", async (route) => {
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
  await page.unroute("**/api/finance/titles/*/settle");
  await expect(payable.getByText("Parcial", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Contas a receber", exact: true })
    .click();
  await page.getByRole("button", { name: "Novo título", exact: true }).click();
  await page.getByLabel("Descrição do título").fill("Receita financeira teste");
  await page
    .getByLabel("Cliente / fornecedor / contraparte")
    .fill("Cliente financeiro");
  await page.getByLabel("Valor do título (R$)").fill("400.00");
  await confirm();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page
    .getByRole("row")
    .filter({ hasText: "Receita financeira teste" })
    .getByRole("button", { name: "Abrir título" })
    .click();
  await page
    .getByRole("button", { name: "Registrar baixa", exact: true })
    .click();
  const me = await (await page.request.get("/api/me")).json();
  const conf = await (
    await page.request.get("/api/finance/config?branch_id=all")
  ).json();
  const cash = conf.accounts.find(
      (a: any) => a.name === "Caixa financeiro teste",
    ),
    bank = conf.accounts.find((a: any) => a.name === "Banco financeiro teste");
  await page.getByLabel("Conta da baixa").selectOption(bank.id);
  await page.getByLabel("Referência da baixa").fill("RECEBIMENTO-FIN-001");
  await confirm();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page
    .getByRole("button", { name: "Movimentos e conciliação", exact: true })
    .click();
  const payment = page
    .getByRole("row")
    .filter({ hasText: "Aluguel financeiro teste" });
  await expect(payment).toHaveCount(1);
  await payment.getByRole("button", { name: "Conciliar", exact: true }).click();
  await page.getByLabel("Referência do extrato").fill("EXTRATO-FIN-001");
  await page
    .getByRole("checkbox", {
      name: "Conferi conta, valor e referência no extrato ou comprovante.",
    })
    .check();
  await confirm();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(payment.getByText("Conciliado", { exact: true })).toBeVisible();
  await payment.getByRole("button", { name: "Desfazer", exact: true }).click();
  await page
    .getByLabel("Motivo", { exact: true })
    .fill("Revisão de conciliação no teste");
  await confirm();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(payment.getByText("Pendente", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Contas e centros", exact: true })
    .click();
  await page.getByRole("button", { name: "Transferir", exact: true }).click();
  await page.getByLabel("Conta de origem").selectOption(bank.id);
  await page.getByLabel("Conta de destino").selectOption(cash.id);
  await page.getByLabel("Valor (R$)", { exact: true }).fill("50.00");
  await page
    .getByLabel("Justificativa", { exact: true })
    .fill("Transferência de teste");
  await confirm();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(
    page
      .getByRole("row")
      .filter({ hasText: "Caixa financeiro teste" })
      .getByText("R$ 950,00", { exact: true }),
  ).toBeVisible();
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
    name: "Produto financeiro navegador",
    sku: "FIN-E2E-PROD",
    condition: "new",
    serialized: false,
    cost: 20,
    price: 50,
    warranty_days: 90,
  });
  await post("/movements", {
    branch_id: me.branches[0].id,
    product_id: product.id,
    type: "entry",
    quantity: 2,
    reason: "Teste financeiro",
  });
  const state = await (
    await page.request.get(`/api/pos/state?branch_id=${me.branches[0].id}`)
  ).json();
  const session = await post("/pos/open", {
    register_id: state.register_id,
    opening_cents: 0,
  });
  await post("/pos/sales", {
    session_id: session.id,
    items: [{ product_id: product.id, quantity: 1 }],
    expected_total_cents: 5000,
    payments: [
      { method: "pix", amount_cents: 5000, reference: "PIX-FIN-TESTE" },
    ],
  });
  await page.getByRole("button", { name: "Atualizar financeiro" }).click();
  await page.getByRole("button", { name: "Classificar", exact: true }).click();
  const pos = page.getByRole("row").filter({ hasText: "Recebimento do PDV" });
  await expect(pos).toHaveCount(1);
  await pos.getByRole("button", { name: "Conciliar", exact: true }).click();
  await page.getByLabel("Conta do extrato").selectOption(bank.id);
  await page.getByLabel("Referência do extrato").fill("EXTRATO-PIX-FIN");
  await page
    .getByRole("checkbox", {
      name: "Conferi conta, valor e referência no extrato ou comprovante.",
    })
    .check();
  await confirm();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page
    .getByRole("button", { name: "Painel e resultados", exact: true })
    .click();
  const result = page
    .locator(".finance-metric")
    .filter({ hasText: "Resultado gerencial" });
  await expect(result.getByText("R$ 180,00", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Contas a pagar", exact: true })
    .click();
  await page.getByRole("button", { name: "Novo título", exact: true }).click();
  await page
    .getByLabel("Descrição do título")
    .fill("Compra patrimonial de estoque navegador");
  await page
    .getByLabel("Cliente / fornecedor / contraparte")
    .fill("Fornecedor de estoque teste");
  await page.getByLabel("Valor do título (R$)").fill("90.00");
  await page.getByLabel("Tratamento na DRE").selectOption("no");
  await confirm();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page
    .getByRole("button", { name: "Painel e resultados", exact: true })
    .click();
  await expect(result.getByText("R$ 180,00", { exact: true })).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Baixar relatório CSV" }).click();
  await (await download).saveAs("test-results/relatorio-financeiro.csv");
  const periodStart = await page
    .getByLabel("Período de", { exact: true })
    .inputValue();
  await page.getByLabel("Período de", { exact: true }).fill("");
  await expect(page.locator(".finance-metrics")).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Baixar relatório CSV" }),
  ).toBeDisabled();
  await page.getByLabel("Período de", { exact: true }).fill(periodStart);
  await expect(result.getByText("R$ 180,00", { exact: true })).toBeVisible();
  await page.screenshot({
    path: "test-results/financeiro-painel-desktop.png",
    fullPage: true,
  });
  await page.reload();
  await page
    .getByRole("button", { name: "Gestão financeira", exact: true })
    .click();
  await expect(
    page
      .locator(".finance-metric")
      .filter({ hasText: "Resultado gerencial" })
      .getByText("R$ 180,00", { exact: true }),
  ).toBeVisible();
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
    path: "test-results/financeiro-painel-mobile.png",
    fullPage: true,
  });
});

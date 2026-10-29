import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
test("Assistência completa: fotos, orçamento, aprovação, peças e entrega com garantia", async ({
  page,
}) => {
  test.setTimeout(120000);
  await page.goto("/");
  await page
    .getByRole("button", { name: "Primeiro acesso? Criar empresa local" })
    .click();
  const email = `repair-browser-${Date.now()}@test.local`;
  await page
    .getByLabel("Nome da empresa")
    .fill("Demonstração assistência automatizada");
  await page.getByLabel("Seu nome").fill("Responsável de teste");
  await page.getByLabel("Nome da primeira filial").fill("Oficina de testes");
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByLabel("Senha", { exact: true }).fill("Repair-Browser-2026!");
  await page
    .getByRole("button", { name: "Criar empresa", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Bem-vindo de volta" }),
  ).toBeVisible();
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByLabel("Senha", { exact: true }).fill("Repair-Browser-2026!");
  await page.getByRole("button", { name: "Entrar no sistema" }).click();
  await expect(
    page.getByRole("heading", { name: "Visão geral", exact: true }),
  ).toBeVisible();
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
  const part = await post("/products", {
    name: "Conector de carga teste",
    sku: "ASSIST-E2E-PART",
    condition: "new",
    serialized: false,
    cost: 20,
    price: 50,
    warranty_days: 90,
  });
  await post("/movements", {
    product_id: part.id,
    branch_id: me.branches[0].id,
    type: "entry",
    quantity: 3,
    reason: "Peças para teste da assistência",
  });
  await page
    .getByRole("button", { name: "Assistência técnica", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Nova ordem de serviço", exact: true })
    .click();
  await page
    .getByLabel("Nome do cliente", { exact: true })
    .fill("Cliente demonstração");
  await page.getByLabel("Telefone do cliente").fill("85999990000");
  await page.getByLabel("Marca do aparelho").fill("Marca de teste");
  await page.getByLabel("Modelo do aparelho").fill("Modelo demonstração");
  await page.getByLabel("IMEI do aparelho").fill("490154203237518");
  await page
    .getByLabel("Número de série", { exact: true })
    .fill("REPAIR-E2E-SERIAL");
  await page
    .getByLabel("Técnico responsável", { exact: true })
    .selectOption(me.user.id);
  await page
    .getByLabel("Defeito relatado pelo cliente")
    .fill("Não carrega a bateria");
  await page
    .getByLabel("Estado físico na entrada")
    .fill("Tela com riscos leves, carcaça íntegra");
  await page.getByLabel("Acessórios recebidos").fill("Capa de proteção");
  await page
    .getByRole("button", { name: "Salvar e registrar", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Marca de teste Modelo demonstração",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Fotos", exact: true }).click();
  const image = await sharp({
    create: { width: 100, height: 80, channels: 3, background: "#657c91" },
  })
    .png()
    .toBuffer();
  await page.getByLabel("Adicionar fotos do aparelho").setInputFiles({
    name: "equipamento-teste.png",
    mimeType: "image/png",
    buffer: image,
  });
  await expect(
    page.getByRole("img", { name: "equipamento-teste.png", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/assistencia-fotos-desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Registrar diagnóstico", exact: true })
    .click();
  await page
    .getByLabel("Diagnóstico técnico")
    .fill("Conector de carga danificado após teste de alimentação");
  await page
    .getByRole("button", { name: "Salvar e registrar", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page
    .getByRole("button", { name: "Preparar orçamento", exact: true })
    .click();
  await page.getByLabel("Mão de obra — preço (R$)").fill("80.00");
  await page.getByLabel("Mão de obra — custo estimado (R$)").fill("30.00");
  await page.getByLabel("Adicionar peça ao orçamento").selectOption(part.id);
  await page.getByLabel("Quantidade de Conector de carga teste").fill("2");
  await page
    .getByLabel("Condições da garantia")
    .fill("Garantia sobre o conector substituído");
  await page
    .getByRole("button", { name: "Salvar e registrar", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page
    .getByRole("button", { name: "Registrar resposta do cliente", exact: true })
    .click();
  await page.getByLabel("Canal da confirmação").selectOption("whatsapp");
  await page
    .getByLabel("Referência da confirmação")
    .fill("Cliente confirmou a proposta no atendimento de teste");
  await page
    .getByRole("button", { name: "Salvar e registrar", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page
    .getByRole("button", { name: "Peças e custos", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Utilizar peça", exact: true })
    .click();
  let drop = true;
  const keys: string[] = [];
  await page.route("**/api/repairs/*/parts", async (route) => {
    keys.push(route.request().headers()["idempotency-key"]);
    if (drop) {
      drop = false;
      const r = await route.fetch();
      expect(r.ok()).toBe(true);
      await route.abort("failed");
    } else await route.continue();
  });
  await page
    .getByRole("button", { name: "Salvar e registrar", exact: true })
    .click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Salvar e registrar", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Salvar e registrar", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
  await page.unroute("**/api/repairs/*/parts");
  const stock = await (
    await page.request.get(
      `/api/products?branch_id=${me.branches[0].id}&q=ASSIST-E2E-PART`,
    )
  ).json();
  expect(stock.items[0].quantity).toBe(2);
  await page.screenshot({
    path: "test-results/assistencia-pecas-desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Concluir reparo", exact: true })
    .click();
  await page
    .getByLabel("Serviço realizado e testes finais")
    .fill("Conector substituído; alimentação e carga conferidas");
  await page
    .getByRole("button", { name: "Salvar e registrar", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Registrar entrega", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Devolver peça", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Salvar e registrar", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Registrar entrega", exact: true }),
  ).not.toBeVisible();
  await page
    .getByRole("button", { name: "Utilizar peça", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Salvar e registrar", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page
    .getByRole("button", { name: "Concluir reparo", exact: true })
    .click();
  await page
    .getByLabel("Serviço realizado e testes finais")
    .fill("Conector reinstalado e carga testada novamente após conferência");
  await page
    .getByRole("button", { name: "Salvar e registrar", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page
    .getByRole("button", { name: "Registrar entrega", exact: true })
    .click();
  await page.getByLabel("Nome do recebedor").fill("Cliente demonstração");
  await page.getByRole("checkbox", { name: /Conferi o aparelho/ }).check();
  await page
    .getByRole("button", { name: "Salvar e registrar", exact: true })
    .click();
  const receipt = page.getByRole("dialog", {
    name: "Comprovante de entrega",
    exact: true,
  });
  await expect(receipt).toBeVisible();
  await expect(receipt.getByText("R$ 130,00", { exact: true })).toBeVisible();
  await expect(
    receipt.getByText("90 dias", { exact: false }).first(),
  ).toBeVisible();
  const download = page.waitForEvent("download");
  await receipt
    .getByRole("button", { name: "Baixar comprovante", exact: true })
    .click();
  await (
    await download
  ).saveAs("test-results/comprovante-entrega-assistencia.txt");
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".service-receipt")).toHaveCSS(
    "visibility",
    "visible",
  );
  await expect(page.locator(".sidebar")).toHaveCSS("visibility", "hidden");
  await page.emulateMedia({ media: "screen" });
  await page.screenshot({
    path: "test-results/assistencia-entrega-desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Fechar janela da assistência", exact: true })
    .click();
  await page.getByRole("button", { name: "Histórico", exact: true }).click();
  await expect(
    page.getByText("Equipamento entregue", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Voltar às ordens", exact: true })
    .click();
  await expect(
    page.getByRole("table").getByText("Entregue", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await page
    .getByRole("button", { name: "Assistência técnica", exact: true })
    .click();
  await expect(
    page.getByText("Cliente demonstração", { exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(async () => {
      const r = await page.locator(".sidebar").boundingBox();
      return r ? Math.round(r.x + r.width) : 0;
    })
    .toBeLessThanOrEqual(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/assistencia-mobile.png",
    fullPage: true,
  });
});

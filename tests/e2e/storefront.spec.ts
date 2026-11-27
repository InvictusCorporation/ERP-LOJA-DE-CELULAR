import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import sharp from "sharp";

test("Três telas da loja: catálogo visual, foto, reserva, IMEI, orçamento e celular", async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.goto("/");
  await page
    .getByRole("button", { name: "Primeiro acesso? Criar empresa local" })
    .click();
  const email = `visual-${Date.now()}@test.local`;
  await page
    .getByLabel("Nome da empresa")
    .fill("Demonstração visual automatizada");
  await page.getByLabel("Seu nome").fill("Operador visual");
  await page.getByLabel("Nome da primeira filial").fill("Loja visual");
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page
    .getByLabel("Senha", { exact: true })
    .fill("Visual-Browser-Testing-2026!");
  await page
    .getByRole("button", { name: "Criar empresa", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Bem-vindo de volta", exact: true }),
  ).toBeVisible();
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page
    .getByLabel("Senha", { exact: true })
    .fill("Visual-Browser-Testing-2026!");
  await page.getByRole("button", { name: "Entrar no sistema" }).click();
  await expect(
    page.getByRole("heading", { name: "Visão geral", exact: true }),
  ).toBeVisible();
  const me = await (await page.request.get("/api/me")).json();
  async function post(path: string, body: unknown) {
    const r = await page.request.post("/api" + path, {
      data: body,
      headers: {
        origin: new URL(process.env.E2E_BASE_URL || "http://localhost:3000")
          .origin,
        "x-csrf-token": me.csrf,
        "idempotency-key": randomUUID(),
      },
    });
    expect(r.ok(), await r.text()).toBe(true);
    return r.json();
  }
  const category = await post("/catalog", {
    kind: "category",
    name: "Categoria livre da loja",
  });
  const p = await post("/products", {
    name: "Aparelho visual",
    sku: "VISUAL-UI",
    category_id: category.id,
    condition: "refurbished",
    serialized: true,
    cost: 500,
    price: 1000,
    warranty_days: 90,
    image_data: "/catalog/phone-blue.svg",
  });
  await post("/movements", {
    product_id: p.id,
    branch_id: me.branches[0].id,
    type: "entry",
    quantity: 1,
    reason: "Teste da ficha visual",
    device: {
      imeis: ["490154203237518"],
      provenance: "Teste visual",
      acquisition_cost: 500,
    },
  });
  const extra = await post("/products", {
    name: "Produto fora da categoria",
    sku: "EXTRA-UI",
    condition: "new",
    serialized: false,
    cost: 1,
    price: 10,
    warranty_days: 90,
    image_data: "/catalog/charger.svg",
  });
  await post("/movements", {
    product_id: extra.id,
    branch_id: me.branches[0].id,
    type: "entry",
    quantity: 5,
    reason: "Teste categoria livre",
  });
  await page
    .getByRole("button", { name: "Aparelhos e IMEIs", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Produtos e estoque", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Aparelho visual", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Editar aparelho", exact: true })
    .click();
  await page.getByLabel("Bateria (%)").fill("91");
  await page.getByLabel("Estado de conservação").fill("Excelente");
  await page.getByLabel("Localização", { exact: true }).fill("Vitrine 01");
  await page.getByLabel("Reservar esta unidade").check();
  await page.getByRole("button", { name: "Salvar ficha", exact: true }).click();
  await expect(page.getByText("91%", { exact: true })).toBeVisible();
  await expect(page.getByText("Vitrine 01", { exact: true })).toBeVisible();
  await page.screenshot({
    path: "test-results/loja-estoque-desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Ver histórico", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Histórico da unidade" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Editar aparelho", exact: true })
    .click();
  await page.getByLabel("Reservar esta unidade").uncheck();
  await page.getByRole("button", { name: "Salvar ficha", exact: true }).click();
  await expect(page.getByText("Ficha do aparelho atualizada.")).toBeVisible();
  await page
    .getByRole("button", { name: "Produtos e estoque", exact: true })
    .click();
  const row = page.getByRole("row").filter({ hasText: "Aparelho visual" });
  await row.getByRole("button", { name: "Editar Aparelho visual" }).click();
  const photo = await sharp({
    create: { width: 100, height: 140, channels: 3, background: "#427394" },
  })
    .png()
    .toBuffer();
  await page.getByLabel("Foto do produto", { exact: true }).setInputFiles({
    name: "produto.png",
    mimeType: "image/png",
    buffer: photo,
  });
  await expect(page.locator("input[name=image_data]")).toHaveValue(
    /^data:image\/webp;base64,/,
  );
  await page
    .getByRole("button", { name: "Salvar e registrar", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page
    .getByRole("button", { name: "Frente de caixa", exact: true })
    .click();
  await page.getByRole("button", { name: "Abrir caixa", exact: true }).click();
  await page.getByLabel("Saldo inicial (R$)").fill("100");
  await page.getByRole("button", { name: "Confirmar operação" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page
    .getByRole("button", { name: "Categoria livre da loja", exact: true })
    .click();
  await expect(page.locator(".pos-product")).toHaveCount(1);
  await expect(page.locator(".pos-product")).toContainText("Aparelho visual");
  await page.getByRole("button", { name: "Todos", exact: true }).click();
  await expect(page.locator(".pos-product")).toHaveCount(2);
  const scan = page.getByRole("textbox", {
    name: "Buscar ou ler código de barras",
  });
  await scan.fill("490154203237518");
  await scan.press("Enter");
  await expect(page.locator(".pos-cart-line")).toHaveCount(1);
  await expect(page.locator(".pos-cart-line")).toContainText("490154203237518");
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Salvar orçamento", exact: true })
    .click();
  await (await download).saveAs("test-results/orcamento-visual.txt");
  await page.getByRole("button", { name: "Pix", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByLabel("Forma 1", { exact: true })).toHaveValue("pix");
  await page.getByRole("button", { name: "Fechar janela do PDV" }).click();
  await scan.fill("");
  await page.screenshot({
    path: "test-results/loja-pdv-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page
        .locator(".sidebar")
        .boundingBox()
        .then((b) => Math.round((b?.x || 0) + (b?.width || 0))),
    )
    .toBeLessThanOrEqual(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/loja-pdv-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "Visão geral", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Evolução das vendas" }),
  ).toBeVisible();
  await page.getByLabel("Período da evolução de vendas").selectOption("30");
  await expect(
    page.getByRole("img", {
      name: "Evolução das vendas líquidas nos últimos 30 dias",
    }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/loja-painel-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page
        .locator(".sidebar")
        .boundingBox()
        .then((b) => Math.round((b?.x || 0) + (b?.width || 0))),
    )
    .toBeLessThanOrEqual(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/loja-painel-mobile.png",
    fullPage: true,
  });
});

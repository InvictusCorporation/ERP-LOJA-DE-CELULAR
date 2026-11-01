import { test, expect } from "@playwright/test";

test("Catálogo: acessórios, leitor físico, câmera, permissão negada e aparelhos", async ({
  page,
}) => {
  test.setTimeout(120000);
  await page.goto("/");
  await page
    .getByRole("button", { name: "Primeiro acesso? Criar empresa local" })
    .click();
  const email = `catalog-scan-${Date.now()}@test.local`,
    password = "Catalog-Testing-2026!";
  await page
    .getByLabel("Nome da empresa")
    .fill("Catálogo de acessórios automatizado");
  await page.getByLabel("Seu nome").fill("Gestor de teste");
  await page.getByLabel("Nome da primeira filial").fill("Matriz acessórios");
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
  await page.getByRole("button", { name: "Produtos", exact: true }).click();
  const save = () =>
    page
      .getByRole("button", { name: "Salvar e registrar", exact: true })
      .click();
  for (const [i, name] of [
    "Capinha de silicone teste",
    "Película de proteção teste",
    "Produto livre sem tipo predefinido",
  ].entries()) {
    await page
      .getByRole("button", { name: "Novo produto", exact: true })
      .click();
    await expect(page.getByLabel("Controle de estoque do produto")).toHaveValue(
      "quantity",
    );
    await page.getByLabel("Nome do produto", { exact: true }).fill(name);
    await page.getByLabel("SKU", { exact: true }).fill(`SCAN-${i}`);
    await page.getByLabel("Preço de venda (R$)").fill("25");
    if (i === 0) {
      await page
        .getByRole("button", { name: "Usar leitor", exact: true })
        .click();
      await expect(
        page.getByLabel("Código de barras", { exact: true }),
      ).toBeFocused();
      await page.keyboard.type("7891234567890");
      await page.keyboard.press("Enter");
      await expect(page.getByRole("dialog")).toBeVisible();
      await expect(
        page.getByLabel("Código de barras", { exact: true }),
      ).toHaveValue("7891234567890");
    }
    if (i === 1) {
      // Independent EAN-13 fixture for 7891234567895, including its check digit.
      const columns =
        "10101101110010111001100100110110111101001110101010100111010100001000100100100011101001001110101";
      await page.evaluate((columns) => {
        const canvas = document.createElement("canvas");
        canvas.width = 640;
        canvas.height = 360;
        const ctx = canvas.getContext("2d")!;
        const draw = () => {
          ctx.fillStyle = "white";
          ctx.fillRect(0, 0, 640, 360);
          ctx.fillStyle = "black";
          [...columns].forEach((v, x) => {
            if (v === "1") ctx.fillRect(130 + x * 4, 60, 4, 240);
          });
        };
        draw();
        const timer = setInterval(draw, 100);
        Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
          configurable: true,
          value: async () => {
            const stream = canvas.captureStream(10);
            (window as any).__scanStream = stream;
            (window as any).__scanTimer = timer;
            return stream;
          },
        });
      }, columns);
      await page
        .getByRole("button", { name: "Escanear com câmera", exact: true })
        .click();
      await expect(
        page.getByLabel("Código de barras", { exact: true }),
      ).toHaveValue("7891234567895", { timeout: 20000 });
      await expect(
        page.getByRole("button", { name: "Fechar câmera", exact: true }),
      ).not.toBeVisible();
      expect(
        await page.evaluate(() =>
          (window as any).__scanStream
            .getTracks()
            .every((t: MediaStreamTrack) => t.readyState === "ended"),
        ),
      ).toBe(true);
      await page.evaluate(() => clearInterval((window as any).__scanTimer));
    }
    if (i === 2) {
      await page.evaluate(() =>
        Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
          configurable: true,
          value: async () => {
            throw new DOMException("Denied", "NotAllowedError");
          },
        }),
      );
      await page
        .getByRole("button", { name: "Escanear com câmera", exact: true })
        .click();
      await expect(
        page.getByText(/Acesso à câmera não permitido/),
      ).toBeVisible();
      await page
        .getByLabel("Código de barras", { exact: true })
        .fill("7891234567892");
    }
    if (i === 0) {
      await page.setViewportSize({ width: 390, height: 844 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: "test-results/catalogo-acessorios-mobile.png",
        fullPage: true,
      });
      await page.setViewportSize({ width: 1440, height: 1000 });
    }
    await save();
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await expect(page.getByText(name, { exact: true })).toBeVisible();
  }
  await page.getByRole("button", { name: "Novo produto", exact: true }).click();
  await page
    .getByLabel("Controle de estoque do produto")
    .selectOption("individual");
  await page
    .getByLabel("Nome do produto", { exact: true })
    .fill("Celular controle individual teste");
  await page.getByLabel("SKU", { exact: true }).fill("SCAN-PHONE");
  await save();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  const me = await (await page.request.get("/api/me")).json();
  const data = await (
    await page.request.get(`/api/products?branch_id=${me.branches[0].id}`)
  ).json();
  expect(data.items.filter((p: any) => !p.serialized)).toHaveLength(3);
  expect(data.items.find((p: any) => p.sku === "SCAN-PHONE").serialized).toBe(
    true,
  );
  expect(data.items.find((p: any) => p.sku === "SCAN-1").barcode).toBe(
    "7891234567895",
  );
  await page.screenshot({
    path: "test-results/catalogo-acessorios-desktop.png",
    fullPage: true,
  });
});

import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
test.use({ actionTimeout: 15000 });
test("Funcionários: permissões, resposta perdida, bloqueio, reativação, histórico e ponto", async ({
  page,
  browser,
}) => {
  test.setTimeout(180000);
  const stamp = Date.now(),
    email = `team-browser-${stamp}@test.local`,
    staffEmail = `staff-browser-${stamp}@test.local`,
    password = "Team-Browser-2026!";
  const setup = await page.request.post("/api/setup", {
    headers: { origin: "http://localhost:3000" },
    data: {
      company: "Empresa de equipe automatizada",
      name: "Gestor equipe navegador",
      branch: "Matriz equipe",
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
    page.getByRole("button", {
      name: "Funcionários e permissões",
      exact: true,
    }),
  ).toBeVisible();
  const me = await (await page.request.get("/api/me")).json(),
    branch = me.branches[0].id;
  const newBranch = await page.request.post("/api/branches", {
    headers: {
      origin: "http://localhost:3000",
      "x-csrf-token": me.csrf,
      "idempotency-key": randomUUID(),
    },
    data: { name: "Unidade equipe" },
  });
  expect(newBranch.ok(), await newBranch.text()).toBe(true);
  const other = (await newBranch.json()).id;
  await page.reload();
  await page
    .getByRole("button", { name: "Funcionários e permissões", exact: true })
    .click();
  const panel = page.locator(".employees-panel");
  await expect(
    panel.getByText("Gestor equipe navegador", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Novo funcionário", exact: true })
    .click();
  await page.getByLabel("Nome na empresa").fill("=Equipe teste");
  await page.getByLabel("E-mail da conta").fill(staffEmail);
  await page.getByLabel("Senha inicial").fill(password);
  await page.getByLabel("Matrícula", { exact: true }).fill("NAV-001");
  await page.getByLabel("Cargo", { exact: true }).fill("Atendimento");
  await page.getByLabel("Função", { exact: true }).fill("Atendimento e vendas");
  await page
    .getByLabel("Identificador no controle de ponto")
    .fill("PONTO-NAV-001");
  await page
    .getByRole("group", { name: "Filiais autorizadas do funcionário" })
    .getByLabel("Unidade equipe")
    .check();
  await page
    .getByLabel("Filial de trabalho", { exact: true })
    .selectOption(other);
  await page
    .getByLabel("Configurar Conceder descontos no PDV")
    .selectOption("allow");
  let lost = false;
  await page.route("**/api/employees", async (route) => {
    if (route.request().method() === "POST" && !lost) {
      lost = true;
      const r = await route.fetch();
      expect(r.ok(), await r.text()).toBe(true);
      await route.abort("failed");
    } else await route.continue();
  });
  await page
    .getByRole("button", { name: "Salvar funcionário", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Salvar funcionário", exact: true }),
  ).toBeEnabled();
  expect(lost).toBe(true);
  await page.unroute("**/api/employees");
  await page
    .getByRole("button", { name: "Salvar funcionário", exact: true })
    .click();
  await expect(
    panel.getByRole("heading", { name: "=Equipe teste", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("E-mail da conta")).toBeDisabled();
  const list = await (
      await page.request.get("/api/employees?branch_id=all")
    ).json(),
    created = list.items.filter((e: any) => e.email === staffEmail);
  expect(created).toHaveLength(1);
  const employee = created[0];
  expect(employee.home_branch_id).toBe(other);
  expect(employee.permissions).toContain("pos_discount");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exportar vínculo do ponto" }).click();
  const mapping = JSON.parse(
    await readFile((await (await downloadPromise).path())!, "utf8"),
  );
  expect(mapping.employee_id).toBe(employee.id);
  expect(mapping.user_id).toBe(employee.user_id);
  expect(mapping.external_employee_id).toBe("PONTO-NAV-001");
  expect(mapping.attendance).toBeNull();
  expect(mapping.integration_status).toBe("mapping_only");
  expect(mapping.email).toBeUndefined();
  const staff = await browser.newContext({ baseURL: "http://localhost:3000" });
  try {
    const login = () =>
      staff.request.post("/api/login", {
        headers: { origin: "http://localhost:3000" },
        data: { email: staffEmail, password },
      });
    expect((await login()).ok()).toBe(true);
    let identity = await (await staff.request.get("/api/me")).json();
    expect(identity.permissions).toContain("pos_discount");
    await page.getByLabel("Configurar Realizar vendas").selectOption("deny");
    await page
      .getByLabel("Motivo da alteração")
      .fill("Bloqueio de venda para teste");
    await page
      .getByRole("button", { name: "Salvar funcionário", exact: true })
      .click();
    await expect(page.getByLabel("Motivo da alteração")).toHaveValue("");
    expect((await staff.request.get("/api/me")).status()).toBe(401);
    expect((await login()).ok()).toBe(true);
    identity = await (await staff.request.get("/api/me")).json();
    expect(identity.permissions).not.toContain("pos_sell");
    expect(identity.permissions).not.toContain("pos_discount");
    expect(identity.permissions).not.toContain("credit_sell");
    const denied = await staff.request.post("/api/pos/sales", {
      headers: {
        origin: "http://localhost:3000",
        "x-csrf-token": identity.csrf,
        "idempotency-key": randomUUID(),
      },
      data: {},
    });
    expect(denied.status()).toBe(403);
    await page
      .getByLabel("Situação do acesso", { exact: true })
      .selectOption("inactive");
    await page
      .getByLabel("Motivo da alteração")
      .fill("Bloqueio temporário de teste");
    await page
      .getByRole("button", { name: "Salvar funcionário", exact: true })
      .click();
    await expect(page.getByLabel("Motivo da alteração")).toHaveValue("");
    expect((await staff.request.get("/api/me")).status()).toBe(401);
    expect((await login()).status()).toBe(401);
    await page.getByRole("tab", { name: "Histórico de operações" }).click();
    await expect(
      panel.getByRole("cell", {
        name: "Bloqueio temporário de teste",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      panel.getByRole("cell", {
        name: "Bloqueio de venda para teste",
        exact: true,
      }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Voltar à equipe" }).click();
    await page
      .getByLabel("Situação do funcionário", { exact: true })
      .selectOption("inactive");
    await page
      .getByRole("button", { name: "Aplicar filtros", exact: true })
      .click();
    const row = panel.getByRole("row").filter({ hasText: staffEmail });
    await expect(row).toBeVisible();
    await expect(row.getByText("Inativo", { exact: true })).toBeVisible();
    const csvPromise = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Exportar página", exact: true })
      .click();
    const csv = await readFile((await (await csvPromise).path())!, "utf8");
    expect(csv).toContain('"\'=Equipe teste"');
    expect(csv).not.toContain(password);
    expect(csv).toContain("Inativo");
    await page.screenshot({
      path: "test-results/funcionarios-desktop.png",
      fullPage: true,
    });
    await row
      .getByRole("button", { name: "Abrir cadastro", exact: true })
      .click();
    await page
      .getByLabel("Situação do acesso", { exact: true })
      .selectOption("active");
    await page.getByLabel("Configurar Realizar vendas").selectOption("default");
    await page
      .getByLabel("Motivo da alteração")
      .fill("Reativação de acesso para teste");
    await page
      .getByRole("button", { name: "Salvar funcionário", exact: true })
      .click();
    await expect(page.getByLabel("Motivo da alteração")).toHaveValue("");
    expect((await staff.request.get("/api/me")).status()).toBe(401);
    expect((await login()).ok()).toBe(true);
    await page.getByRole("button", { name: "Fechar aviso" }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(async () => {
        const box = await page.locator(".sidebar").boundingBox();
        return box ? Math.round(box.x + box.width) : 0;
      })
      .toBeLessThanOrEqual(0);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBe(390);
    const choice = await page
      .getByLabel("Configurar Realizar vendas")
      .boundingBox();
    expect(choice!.x).toBeGreaterThanOrEqual(0);
    expect(choice!.x + choice!.width).toBeLessThanOrEqual(390);
    await page.screenshot({
      path: "test-results/funcionarios-mobile.png",
      fullPage: true,
    });
    await page.getByRole("button", { name: "Voltar à equipe" }).click();
    await page
      .getByLabel("Situação do funcionário", { exact: true })
      .selectOption("all");
    await page
      .getByLabel("Buscar funcionário", { exact: true })
      .fill("Gestor equipe");
    await page
      .getByRole("button", { name: "Aplicar filtros", exact: true })
      .click();
    await panel
      .getByRole("row")
      .filter({ hasText: "Gestor equipe navegador" })
      .getByRole("button", { name: "Abrir cadastro", exact: true })
      .click();
    await expect(
      page.getByLabel("Perfil de acesso", { exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByLabel("Situação do acesso", { exact: true }),
    ).toBeDisabled();
  } finally {
    await staff.close();
  }
});

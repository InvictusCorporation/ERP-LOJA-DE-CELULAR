import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Database } from "../src/server/db";
import { createApp } from "../src/server/app";
import { EmployeesService } from "../src/server/employees";
import { effectivePermissions, roleRights } from "../src/shared/access";

test("permissões: padrões preservados, bloqueios transitivos e campos reservados", () => {
  for (const role of Object.keys(roleRights))
    assert.deepEqual(
      new Set(effectivePermissions(role)),
      new Set(roleRights[role]),
      role,
    );
  const reduced = effectivePermissions({
    role: "manager",
    permission_denials: ["cost", "pos_cash", "service_read"],
  });
  for (const p of [
    "catalog",
    "reports_read",
    "pos_sell",
    "pos_manage",
    "pos_refund",
    "credit_sell",
    "service_work",
    "service_cost",
    "service_approve",
  ])
    assert.ok(!reduced.includes(p), p);
  assert.ok(reduced.includes("finance_read"));
  assert.deepEqual(effectivePermissions("constructor"), []);
  assert.deepEqual(
    effectivePermissions({
      role: "viewer",
      permission_grants: ["__proto__", "toString"],
    }),
    ["read"],
  );
  assert.ok(
    !effectivePermissions({
      role: "cashier",
      permission_grants: ["users", "branches", "credit_settings", "unknown"],
    }).includes("users"),
  );
  assert.deepEqual(
    effectivePermissions({
      role: "owner",
      permission_denials: ["read", "users", "cost"],
    }),
    roleRights.owner,
  );
});
test("Funcionários: cadastro único, perfis, sessões, filiais, histórico e vínculo do ponto", async (t) => {
  const db = new Database();
  await db.open("memory://");
  const app = await createApp(db);
  await app.listen(0, "127.0.0.1");
  const base = await app.getUrl(),
    password = "Employees-Testing-2026!",
    clients: Record<string, any> = {},
    people: Record<string, any> = {};
  let a: any,
    b: any,
    branch: string,
    other: string,
    product: string,
    session: string;
  async function api(
    path: string,
    method = "GET",
    body?: any,
    who = "a",
    key = randomUUID(),
  ) {
    const c = clients[who];
    const r = await fetch(base + "/api" + path, {
      method,
      headers: {
        origin: "http://localhost:3000",
        "content-type": "application/json",
        "idempotency-key": key,
        ...(c ? { cookie: c.cookie, "x-csrf-token": c.csrf } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return {
      status: r.status,
      body: await r.json(),
      cookie: r.headers.get("set-cookie"),
    };
  }
  async function ok(
    path: string,
    method = "GET",
    body?: any,
    who = "a",
    key = randomUUID(),
  ) {
    const r = await api(path, method, body, who, key);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return r.body;
  }
  async function auth(who: string, tenant?: string, emailWho = who) {
    const r = await api(
      "/login",
      "POST",
      {
        email: `employees-${emailWho}@test.local`,
        password,
        ...(tenant ? { tenant_id: tenant } : {}),
      },
      "none",
    );
    assert.equal(r.status, 200, JSON.stringify(r.body));
    clients[who] = { cookie: r.cookie!.split(";")[0] };
    const me = await ok("/me", "GET", undefined, who);
    clients[who].csrf = me.csrf;
    return me;
  }
  const body = (who: string, role = who, extra: Record<string, any> = {}) => ({
    name: `Pessoa ${who}`,
    email: `employees-${who}@test.local`,
    password,
    role,
    branch_ids: [branch],
    ...extra,
  });
  const detail = (who: string) => ok("/employees/" + people[who].employee_id);
  async function updateBody(who: string, extra: Record<string, any> = {}) {
    const d = await detail(who),
      body: Record<string, any> = {};
    for (const key of [
      "name",
      "job_title",
      "job_function",
      "employee_code",
      "home_branch_id",
      "point_external_id",
      "role",
      "active",
      "branch_ids",
      "permission_grants",
      "permission_denials",
      "version",
    ])
      body[key] = d[key];
    body.home_branch_id ||= d.branch_ids[0];
    return { ...body, reason: "Alteração para cenário de teste", ...extra };
  }
  const change = async (
    who: string,
    extra: Record<string, any> = {},
    actor = "a",
  ) =>
    ok(
      "/employees/" + people[who].employee_id,
      "PUT",
      await updateBody(who, extra),
      actor,
    );
  try {
    await t.test(
      "reaproveita usuários e preserva os perfis existentes",
      async () => {
        for (const who of ["a", "b"])
          await ok(
            "/setup",
            "POST",
            {
              company: `Equipe ${who}`,
              name: `Gestor ${who}`,
              branch: "Matriz",
              email: `employees-${who}@test.local`,
              password,
            },
            "none",
          );
        a = await auth("a");
        b = await auth("b");
        branch = a.branches[0].id;
        other = (await ok("/branches", "POST", { name: "Filial equipe" })).id;
        a = await auth("a");
        const owner = (await ok("/employees")).items[0];
        people.a = { id: a.user.id, employee_id: owner.id };
        assert.equal(owner.name, "Gestor a");
        assert.equal(owner.user_id, a.user.id);
        const count = (
          await db.system<any>("SELECT count(*)::int AS n FROM users")
        )[0].n;
        assert.equal(count, 2);
        for (const role of [
          "administrator",
          "manager",
          "seller",
          "cashier",
          "technician",
          "financial",
          "stock",
          "viewer",
        ]) {
          people[role] = await ok("/employees", "POST", body(role));
          await auth(role);
        }
        const c = await ok("/employees/config");
        assert.equal(c.roles.financial, "Financeiro");
        assert.equal(c.can_create, true);
        assert.equal(
          (await ok("/users")).items.find(
            (x: any) => x.id === people.cashier.id,
          ).employee_id,
          people.cashier.employee_id,
        );
      },
    );
    await t.test(
      "cadastro idempotente, versão, unicidade e valores inválidos",
      async () => {
        const key = randomUUID(),
          request = body("idem", "stock");
        const first = await ok("/employees", "POST", request, "a", key);
        assert.deepEqual(
          await ok("/employees", "POST", request, "a", key),
          first,
        );
        people.idem = first;
        assert.equal(
          (
            await api(
              "/employees",
              "POST",
              { ...request, name: "Outro nome" },
              "a",
              key,
            )
          ).status,
          409,
        );
        assert.equal((await api("/employees", "POST", request)).status, 409);
        for (const extra of [
          { role: "owner" },
          { role: "root" },
          { permission_grants: ["users"] },
          { permission_denials: ["read"] },
          { permission_grants: ["root"] },
          { permission_grants: ["__proto__"] },
          { permission_denials: ["toString"] },
          { permission_grants: ["stock"], permission_denials: ["stock"] },
          { branch_ids: [branch, branch] },
          { home_branch_id: other },
        ])
          assert.equal(
            (await api("/employees", "POST", body("invalid", "stock", extra)))
              .status,
            400,
            JSON.stringify(extra),
          );
        assert.equal(
          (
            await api(
              "/employees",
              "POST",
              body("foreign", "stock", { branch_ids: [b.branches[0].id] }),
            )
          ).status,
          403,
        );
        const v = await updateBody("idem", { job_title: "Conferente" }),
          path = "/employees/" + first.employee_id;
        const results = await Promise.all([
          api(path, "PUT", v),
          api(path, "PUT", { ...v, job_title: "Outro cargo" }),
        ]);
        assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
        assert.equal((await detail("idem")).version, 2);
      },
    );
    await t.test(
      "cargo, função, filial e contrato de vínculo do ponto sem dados de jornada",
      async () => {
        await change("stock", {
          name: "Nome na empresa",
          job_title: "Conferente",
          job_function: "Recebimento e conferência",
          employee_code: "MAT-001",
          point_external_id: "PONTO-001",
          branch_ids: [branch, other],
          home_branch_id: other,
        });
        const p = await ok(`/employees/${people.stock.employee_id}/point`);
        assert.equal(p.employee_id, people.stock.employee_id);
        assert.equal(p.user_id, people.stock.id);
        assert.equal(p.home_branch_id, other);
        assert.equal(p.external_employee_id, "PONTO-001");
        assert.equal(p.attendance, null);
        assert.equal(p.integration_status, "mapping_only");
        assert.ok(!JSON.stringify(p).includes(password));
        assert.ok(!("email" in p));
        assert.equal(
          (
            await api(
              `/employees/${people.idem.employee_id}`,
              "PUT",
              await updateBody("idem", { employee_code: "MAT-001" }),
            )
          ).status,
          409,
        );
        assert.equal(
          (
            await api(
              `/employees/${people.idem.employee_id}`,
              "PUT",
              await updateBody("idem", { point_external_id: "PONTO-001" }),
            )
          ).status,
          409,
        );
        const [account] = await db.system<any>(
          "SELECT name FROM users WHERE id=$1",
          [people.stock.id],
        );
        assert.equal(account.name, "Pessoa stock");
        assert.equal((await auth("stock")).user.name, "Nome na empresa");
      },
    );
    await t.test(
      "proprietário e próprio acesso protegidos; administrador não eleva privilégios",
      async () => {
        assert.equal(
          (
            await api(
              `/employees/${people.a.employee_id}`,
              "PUT",
              await updateBody("a", { active: false }),
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await api(
              `/employees/${people.administrator.employee_id}`,
              "PUT",
              await updateBody("administrator", { role: "owner" }),
              "administrator",
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await api(
              `/employees/${people.manager.employee_id}`,
              "PUT",
              await updateBody("manager", { role: "administrator" }),
              "administrator",
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await api(
              "/employees",
              "POST",
              body("admin2", "administrator"),
              "administrator",
            )
          ).status,
          403,
        );
        await change("administrator", { permission_denials: ["finance_read"] });
        await auth("administrator");
        assert.equal(
          (
            await api(
              "/employees",
              "POST",
              body("finance2", "financial"),
              "administrator",
            )
          ).status,
          403,
        );
        await change("administrator", { permission_denials: [] });
        await auth("administrator");
        assert.equal(
          (
            await api(
              `/employees/${people.stock.employee_id}`,
              "GET",
              undefined,
              "administrator",
            )
          ).status,
          403,
        );
      },
    );
    await t.test(
      "permissões individuais valem na sessão e na operação do PDV",
      async () => {
        await change("cashier", { permission_grants: ["pos_discount"] });
        assert.equal(
          (await api("/me", "GET", undefined, "cashier")).status,
          401,
        );
        await auth("cashier");
        product = (
          await ok("/products", "POST", {
            name: "Produto equipe",
            sku: "TEAM-PRODUCT",
            condition: "new",
            serialized: false,
            cost: 4,
            price: 10,
            warranty_days: 30,
          })
        ).id;
        await ok("/movements", "POST", {
          branch_id: branch,
          product_id: product,
          type: "entry",
          quantity: 10,
          reason: "Entrada teste de equipe",
        });
        session = (
          await ok(
            "/pos/open",
            "POST",
            {
              register_id: (await ok(`/pos/state?branch_id=${branch}`))
                .register_id,
              opening_cents: 0,
            },
            "cashier",
          )
        ).id;
        await ok(
          "/pos/sales",
          "POST",
          {
            session_id: session,
            items: [{ product_id: product, quantity: 1 }],
            discount_cents: 100,
            expected_total_cents: 900,
            payments: [{ method: "cash", amount_cents: 900 }],
          },
          "cashier",
        );
        await change("cashier", { permission_grants: [] });
        await auth("cashier");
        assert.equal(
          (
            await api(
              "/pos/sales",
              "POST",
              {
                session_id: session,
                items: [{ product_id: product, quantity: 1 }],
                discount_cents: 100,
                expected_total_cents: 900,
                payments: [{ method: "cash", amount_cents: 900 }],
              },
              "cashier",
            )
          ).status,
          403,
        );
        await change("cashier", { permission_denials: ["pos_sell"] });
        const me = await auth("cashier");
        assert.ok(!me.permissions.includes("credit_sell"));
        assert.ok(me.permissions.includes("pos_cash"));
        assert.equal(
          (await api("/pos/sales", "POST", {}, "cashier")).status,
          403,
        );
      },
    );
    await t.test(
      "não retira acesso de caixa aberto e revoga sessões sem apagar histórico",
      async () => {
        assert.equal(
          (
            await api(
              `/employees/${people.cashier.employee_id}`,
              "PUT",
              await updateBody("cashier", { active: false }),
            )
          ).status,
          409,
        );
        assert.equal(
          (
            await api(
              `/employees/${people.cashier.employee_id}`,
              "PUT",
              await updateBody("cashier", { permission_denials: ["pos_cash"] }),
            )
          ).status,
          409,
        );
        await ok("/pos/close", "POST", {
          session_id: session,
          counted_cents: 900,
        });
        const before = await ok(
          `/employees/${people.cashier.employee_id}/history`,
        );
        assert.ok(
          before.items.some(
            (e: any) =>
              e.action === "pos.sale.created" || e.action.includes("sale"),
          ),
        );
        await change("cashier", { active: false });
        assert.equal(
          (await api("/me", "GET", undefined, "cashier")).status,
          401,
        );
        assert.equal(
          (
            await api(
              "/login",
              "POST",
              { email: "employees-cashier@test.local", password },
              "none",
            )
          ).status,
          401,
        );
        const inactive = await ok("/employees?status=inactive");
        assert.ok(
          inactive.items.some((e: any) => e.id === people.cashier.employee_id),
        );
        await change("cashier", { active: true, permission_denials: [] });
        assert.equal(
          (await api("/me", "GET", undefined, "cashier")).status,
          401,
        );
        await auth("cashier");
        assert.equal(
          (
            await db.system<any>(
              "SELECT count(*)::int AS n FROM pos_sales WHERE operator_id=$1",
              [people.cashier.id],
            )
          )[0].n,
          1,
        );
      },
    );
    await t.test(
      "custos, relatórios, documentos e elegibilidade usam o acesso efetivo",
      async () => {
        await change("manager", {
          permission_denials: [
            "cost",
            "service_work",
            "crm_manage",
            "credit_sell",
            "credit_read",
          ],
        });
        const me = await auth("manager");
        assert.ok(!me.permissions.includes("catalog"));
        assert.ok(!me.permissions.includes("reports_read"));
        const products = await ok(
          `/products?branch_id=${branch}`,
          "GET",
          undefined,
          "manager",
        );
        assert.ok(!("cost" in products.items[0]));
        assert.equal(
          (await api("/reports/overview", "GET", undefined, "manager")).status,
          403,
        );
        const technicians = await ok(
            `/repairs/technicians?branch_id=${branch}`,
          ),
          team = await ok(`/crm/team?branch_id=${branch}`);
        assert.ok(
          !technicians.items.some((x: any) => x.id === people.manager.id),
        );
        assert.ok(!team.items.some((x: any) => x.id === people.manager.id));
        assert.ok(team.items.some((x: any) => x.id === people.seller.id));
        await change("stock", {
          branch_ids: [branch],
          home_branch_id: branch,
          permission_grants: ["service_read", "service_work"],
        });
        await auth("stock");
        assert.ok(
          (await ok(`/repairs/technicians?branch_id=${branch}`)).items.some(
            (x: any) => x.id === people.stock.id,
          ),
        );
        const id = (
          await ok("/repairs", "POST", {
            branch_id: branch,
            customer: { name: "Cliente equipe teste", phone: "85999991122" },
            brand: "Marca",
            model: "Modelo",
            reported_fault: "Teste",
            physical_state: "Íntegro",
            technician_id: people.stock.id,
          })
        ).id;
        assert.equal(
          (
            await api(
              `/employees/${people.stock.employee_id}`,
              "PUT",
              await updateBody("stock", { active: false }),
            )
          ).status,
          409,
        );
        assert.equal(
          (
            await api(
              `/employees/${people.stock.employee_id}`,
              "PUT",
              await updateBody("stock", { permission_grants: [] }),
            )
          ).status,
          409,
        );
        const d = await ok(`/repairs/${id}`);
        await ok(`/repairs/${id}/info`, "POST", {
          version: d.order.version,
          technician_id: people.technician.id,
        });
        await change("stock", { active: false, permission_grants: [] });
      },
    );
    await t.test(
      "pendências de CRM exigem reatribuição antes de retirar a função",
      async () => {
        const customer = (
          await ok("/crm/customers", "POST", {
            name: "Cliente CRM equipe",
            phone: "85999991123",
            email: "",
            city: "",
            state: "",
            notes: "",
          })
        ).id;
        const task = (
          await ok("/crm/tasks", "POST", {
            customer_id: customer,
            branch_id: branch,
            title: "Retorno teste",
            owner_id: people.seller.id,
            due_at: new Date(Date.now() + 86400000).toISOString(),
          })
        ).id;
        assert.equal(
          (
            await api(
              `/employees/${people.seller.employee_id}`,
              "PUT",
              await updateBody("seller", { active: false }),
            )
          ).status,
          409,
        );
        await ok(`/crm/tasks/${task}`, "POST", {
          version: 1,
          status: "done",
          title: "Retorno teste",
          owner_id: people.seller.id,
          due_at: new Date(Date.now() + 86400000).toISOString(),
        });
        await change("seller", { active: false });
      },
    );
    await t.test(
      "empresa, filial e perfis não autorizados não expõem funcionários",
      async () => {
        for (const role of [
          "manager",
          "cashier",
          "technician",
          "financial",
          "viewer",
        ]) {
          for (const path of [
            "/employees",
            "/employees/config",
            `/employees/${people.cashier.employee_id}`,
            `/employees/${people.cashier.employee_id}/history`,
            `/employees/${people.cashier.employee_id}/point`,
          ])
            assert.equal(
              (await api(path, "GET", undefined, role)).status,
              403,
              path + ":" + role,
            );
        }
        assert.equal(
          (
            await api(
              `/employees/${people.cashier.employee_id}`,
              "GET",
              undefined,
              "b",
            )
          ).status,
          404,
        );
        assert.equal(
          (
            await api(
              `/employees/${people.cashier.employee_id}`,
              "PUT",
              await updateBody("cashier"),
              "b",
            )
          ).status,
          404,
        );
        assert.equal(
          (await api(`/employees?branch_id=${b.branches[0].id}`)).status,
          403,
        );
        assert.equal((await api("/employees?page=0")).status, 400);
        assert.equal((await api("/employees?status=wrong")).status, 400);
      },
    );
    await t.test(
      "conta compartilhada mantém identidade e sessão da outra empresa",
      async () => {
        await db.provision((tx) =>
          tx.query(
            "INSERT INTO memberships(id,tenant_id,user_id,role,branch_ids) VALUES($1,$2,$3,'viewer',$4::uuid[]) RETURNING id",
            [randomUUID(), b.tenant.id, people.idem.id, [b.branches[0].id]],
          ),
        );
        await auth("shared", b.tenant.id, "idem");
        await change("idem", { active: false, name: "Nome privado empresa A" });
        const me = await ok("/me", "GET", undefined, "shared");
        assert.equal(me.tenant.id, b.tenant.id);
        assert.equal(me.user.name, "Pessoa idem");
        assert.equal(
          (
            await db.system<any>("SELECT active FROM users WHERE id=$1", [
              people.idem.id,
            ])
          )[0].active,
          true,
        );
      },
    );
    await t.test(
      "histórico paginado e read-only respeita filial sem expor credenciais",
      async () => {
        for (let n = 0; n < 35; n++)
          await db.provision((tx) =>
            tx.query(
              "INSERT INTO audit_events(id,tenant_id,actor_id,branch_id,action,entity_id,details) VALUES($1,$2,$3,$4,'test.operation',$5,'{}') RETURNING id",
              [randomUUID(), a.tenant.id, people.cashier.id, branch, String(n)],
            ),
          );
        await db.provision((tx) =>
          tx.query(
            "INSERT INTO audit_events(id,tenant_id,actor_id,branch_id,action,entity_id,details) VALUES($1,$2,$3,$4,'private.other_branch','ref','{}') RETURNING id",
            [randomUUID(), a.tenant.id, people.cashier.id, other],
          ),
        );
        const path = `/employees/${people.cashier.employee_id}/history`,
          r = await ok(path, "GET", undefined, "administrator"),
          next = await ok(path + "?page=2", "GET", undefined, "administrator");
        assert.equal(r.items.length, 30);
        assert.ok(next.items.length > 0);
        assert.ok(
          !r.items.some((x: any) => next.items.some((y: any) => x.id === y.id)),
        );
        assert.ok(
          ![...r.items, ...next.items].some(
            (x: any) => x.action === "private.other_branch",
          ),
        );
        assert.ok(!JSON.stringify(r).includes(password));
        assert.ok(
          !JSON.stringify(await detail("cashier")).includes("password_hash"),
        );
        const count = (
          await db.system<any>("SELECT count(*)::int AS n FROM audit_events")
        )[0].n;
        await ok(path);
        await ok(`/employees/${people.cashier.employee_id}/point`);
        assert.equal(
          (
            await db.system<any>("SELECT count(*)::int AS n FROM audit_events")
          )[0].n,
          count,
        );
      },
    );
    await t.test(
      "RLS de escrita, colunas protegidas e autoridade revalidada na gravação",
      async () => {
        const [foreign] = await db.system<any>(
          "SELECT id FROM memberships WHERE tenant_id=$1 AND user_id=$2",
          [b.tenant.id, b.user.id],
        );
        assert.deepEqual(
          await db.transaction(a.tenant.id, (tx) =>
            tx.query(
              "UPDATE memberships SET job_title='forbidden' WHERE id=$1 RETURNING id",
              [foreign.id],
            ),
          ),
          [],
        );
        await assert.rejects(() =>
          db.transaction(a.tenant.id, (tx) =>
            tx.query(
              "UPDATE memberships SET user_id=$1 WHERE id=$2 RETURNING id",
              [b.user.id, people.cashier.employee_id],
            ),
          ),
        );
        await assert.rejects(() =>
          db.transaction(a.tenant.id, (tx) =>
            tx.query("UPDATE users SET active=false WHERE id=$1 RETURNING id", [
              people.cashier.id,
            ]),
          ),
        );
        const stale = {
          user_id: people.administrator.id,
          tenant_id: a.tenant.id,
          role: "administrator",
          branch_ids: [branch],
          name: "Admin",
          email: "unused",
          csrf: "unused",
        };
        await change("administrator", { role: "manager" });
        await assert.rejects(() =>
          new EmployeesService(db).save(
            stale,
            people.cashier.employee_id,
            { ...{} },
            randomUUID(),
          ),
        );
        await assert.rejects(() =>
          new EmployeesService(db).save(
            stale,
            people.cashier.employee_id,
            body("x"),
            randomUUID(),
          ),
        );
        const full = await updateBody("cashier");
        await assert.rejects(
          () =>
            new EmployeesService(db).save(
              stale,
              people.cashier.employee_id,
              full,
              randomUUID(),
            ),
          /permissão/,
        );
      },
    );
  } finally {
    await app.close();
    await db.close();
  }
});

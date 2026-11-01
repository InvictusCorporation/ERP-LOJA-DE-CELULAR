import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { Database } from "../src/server/db";
import { createApp } from "../src/server/app";
import { canonicalPointJson, pointEmployeeMapping } from "../src/shared/point";
import { effectivePermissions } from "../src/shared/access";
test("Contrato cadastral mantém versão do módulo 9 e JSON canônico ordena objetos", () => {
  const e = {
    id: "membership",
    user_id: "user",
    name: "Pessoa teste",
    employee_code: "001",
    point_external_id: "externo",
    job_title: "Cargo",
    job_function: "Função",
    home_branch_id: "branch",
    branch_ids: ["branch"],
    active: true,
    account_active: false,
    version: 4,
  };
  const mapping = pointEmployeeMapping(e, "tenant");
  assert.equal(mapping.active, false);
  assert.equal(mapping.employee_id, "membership");
  assert.equal(mapping.integration_status, "mapping_only");
  assert.equal(mapping.attendance, null);
  assert.equal(mapping.schema_version, 1);
  assert.equal(
    canonicalPointJson({ z: [{ c: 2, a: 1 }], a: "ç" }),
    canonicalPointJson({ a: "ç", z: [{ a: 1, c: 2 }] }),
  );
  assert.ok(
    !effectivePermissions({
      role: "viewer",
      permission_grants: ["point_read", "point_export", "point_settings"],
    }).includes("point_read"),
  );
  assert.ok(
    !effectivePermissions({
      role: "administrator",
      permission_denials: ["point_read"],
    }).includes("point_export"),
  );
});
test("Ponto: preparação por empresa, vínculos, pacotes imutáveis, permissões e conexão desativada", async (t) => {
  const db = new Database();
  await db.open("memory://");
  const app = await createApp(db);
  await app.listen(0, "127.0.0.1");
  const base = await app.getUrl(),
    password = randomUUID(),
    clients: Record<string, any> = {};
  let a: any,
    b: any,
    branch: string,
    destination: string,
    exportId: string,
    adminExport: string,
    adminId: string;
  async function api(
    path: string,
    method = "GET",
    body?: any,
    who = "a",
    key = randomUUID(),
  ) {
    const c = clients[who],
      r = await fetch(base + "/api" + path, {
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
  async function auth(who: string) {
    const r = await api(
      "/login",
      "POST",
      { email: `point-${who}@test.local`, password },
      "none",
    );
    assert.equal(r.status, 200);
    clients[who] = { cookie: r.cookie!.split(";")[0] };
    const me = await ok("/me", "GET", undefined, who);
    clients[who].csrf = me.csrf;
    return me;
  }
  const overview = (who = "a") => ok("/point/overview", "GET", undefined, who);
  async function edit(id: string, extra: Record<string, any>) {
    const e = await ok("/employees/" + id),
      body: Record<string, any> = {};
    for (const k of [
      "name",
      "job_title",
      "job_function",
      "employee_code",
      "point_external_id",
      "home_branch_id",
      "branch_ids",
      "role",
      "active",
      "permission_grants",
      "permission_denials",
      "version",
    ])
      body[k] = e[k];
    return ok("/employees/" + id, "PUT", {
      ...body,
      ...extra,
      reason: "Ajuste cadastral de teste de integração",
    });
  }
  try {
    await t.test(
      "reutiliza empresas e funcionários, inicia desconectado e mostra pendências",
      async () => {
        for (const who of ["a", "b"])
          await ok(
            "/setup",
            "POST",
            {
              company: "Ponto fictício " + who,
              name: "Gestor ponto teste " + who,
              branch: "Matriz",
              email: `point-${who}@test.local`,
              password,
            },
            "none",
          );
        a = await auth("a");
        b = await auth("b");
        branch = a.branches[0].id;
        const v = await overview();
        assert.equal(v.employee_total, 1);
        assert.equal(v.integration.status, "not_connected");
        assert.equal(v.integration.subscription_status, "not_verified");
        assert.equal(v.integration.attendance, null);
        assert.equal(v.integration.last_sync_at, null);
        assert.equal(v.local_mapping_complete, false);
        assert.equal(v.blocking.employees_without_mapping, 1);
        assert.equal((await ok("/employees")).total, 1);
      },
    );
    await t.test(
      "configuração HTTPS é versionada, idempotente e não aceita ativação ou credenciais",
      async () => {
        const body = {
            version: 0,
            provider_name: "Sistema de ponto teste",
            base_url: "https://ponto.example/api",
            external_tenant_id: "empresa-teste",
            environment: "production",
          },
          key = randomUUID();
        await ok("/point/settings", "POST", body, "a", key);
        await ok("/point/settings", "POST", body, "a", key);
        assert.equal((await overview()).settings.version, 1);
        assert.equal((await overview()).integration.can_sync, false);
        assert.equal((await api("/point/settings", "POST", body)).status, 409);
        for (const url of [
          "http://ponto.example",
          "https://user:password@ponto.example",
          "https://ponto.example/?token=test",
          "https://ponto.example/#secret",
        ])
          assert.equal(
            (
              await api("/point/settings", "POST", {
                ...body,
                version: 1,
                base_url: url,
              })
            ).status,
            400,
          );
        assert.equal(
          (
            await api("/point/settings", "POST", {
              ...body,
              version: 1,
              enabled: true,
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await api("/point/settings", "POST", {
              ...body,
              version: 1,
              api_key: "ficticia",
            })
          ).status,
          400,
        );
        assert.equal((await overview("b")).settings.version, 0);
      },
    );
    await t.test(
      "associa filiais sem duplicar identificadores e preserva versão ao limpar",
      async () => {
        destination = (
          await ok("/branches", "POST", { name: "Outra filial ponto teste" })
        ).id;
        const body = { version: 0, external_branch_id: "matriz-no-ponto" },
          key = randomUUID();
        await ok("/point/branches/" + branch, "POST", body, "a", key);
        await ok("/point/branches/" + branch, "POST", body, "a", key);
        assert.equal(
          (await api("/point/branches/" + branch, "POST", body)).status,
          409,
        );
        assert.equal(
          (await api("/point/branches/" + destination, "POST", body)).status,
          409,
        );
        await ok("/point/branches/" + destination, "POST", {
          version: 0,
          external_branch_id: "filial-no-ponto",
        });
        await ok("/point/branches/" + branch, "POST", {
          version: 1,
          external_branch_id: "",
        });
        await ok("/point/branches/" + branch, "POST", {
          version: 2,
          external_branch_id: "matriz-no-ponto",
        });
        assert.equal(
          (await api("/point/branches/" + b.branches[0].id, "POST", body))
            .status,
          403,
        );
      },
    );
    await t.test(
      "identificador de funcionário usa o cadastro existente e mantém contrato anterior",
      async () => {
        const employees = await ok("/employees"),
          owner = employees.items.find((e: any) => e.user_id === a.user.id);
        await edit(owner.id, { point_external_id: "gestor-no-ponto" });
        const mapping = await ok("/employees/" + owner.id + "/point");
        assert.equal(mapping.external_employee_id, "gestor-no-ponto");
        assert.equal(mapping.integration_status, "mapping_only");
        assert.equal((await overview()).local_mapping_complete, true);
        assert.equal((await ok("/employees")).total, 1);
      },
    );
    await t.test(
      "prepara um snapshot completo por chave e confere hash sem enviar dados",
      async () => {
        const key = randomUUID(),
          results = await Promise.all([
            ok("/point/exports", "POST", {}, "a", key),
            ok("/point/exports", "POST", {}, "a", key),
          ]);
        exportId = results[0].id;
        assert.equal(results[1].id, exportId);
        assert.equal((await ok("/point/exports")).total, 1);
        const e = await ok("/point/exports/" + exportId);
        assert.equal(e.content.readiness.local_mapping_complete, true);
        assert.equal(
          e.content.employees[0].external_employee_id,
          "gestor-no-ponto",
        );
        assert.equal(e.content.employees[0].email, undefined);
        assert.equal(e.content.employees[0].permission_grants, undefined);
        assert.equal(e.content.integration_status, "not_connected");
        assert.equal(e.content.attendance, null);
        assert.equal(e.content.provider_contract, "unverified");
        assert.equal(
          e.sha256,
          createHash("sha256")
            .update(canonicalPointJson(e.content))
            .digest("hex"),
        );
        await ok("/point/settings", "POST", {
          version: 1,
          provider_name: "Alterado após snapshot",
        });
        assert.equal(
          (await ok("/point/exports/" + exportId)).content.target.provider_name,
          "Sistema de ponto teste",
        );
        assert.equal((await overview()).local_mapping_complete, false);
      },
    );
    await t.test(
      "pacotes com pendências são identificados, sem inventar matrícula ou jornada",
      async () => {
        const prepared = await ok("/point/exports", "POST", {}),
          v = await ok("/point/exports/" + prepared.id);
        assert.equal(v.content.readiness.local_mapping_complete, false);
        assert.ok(
          v.content.readiness.blocking.configuration_fields.includes(
            "external_tenant_id",
          ),
        );
        assert.equal(v.content.attendance, null);
        for (const path of ["/point/connect", "/point/sync"])
          assert.equal((await api(path, "POST", {})).status, 409);
        assert.equal((await overview()).integration.last_sync_at, null);
      },
    );
    await t.test(
      "administrador consulta/exporta no próprio escopo e não configura",
      async () => {
        adminId = (
          await ok("/users", "POST", {
            name: "Administrador ponto teste",
            email: "point-admin@test.local",
            password,
            role: "administrator",
            branch_ids: [branch],
            point_external_id: "admin-ponto",
          })
        ).employee_id;
        await ok("/users", "POST", {
          name: "Equipe outra filial teste",
          email: "point-other@test.local",
          password,
          role: "viewer",
          branch_ids: [destination],
          point_external_id: "outro-ponto",
        });
        await auth("admin");
        const v = await overview("admin");
        assert.equal(v.branches.length, 1);
        assert.equal(v.employees.items.length, 1);
        assert.equal(v.employees.items[0].name, "Administrador ponto teste");
        assert.equal(
          (await api("/point/settings", "POST", { version: 2 }, "admin"))
            .status,
          403,
        );
        assert.equal(
          (
            await api(
              "/point/branches/" + branch,
              "POST",
              { version: 3, external_branch_id: "mudanca" },
              "admin",
            )
          ).status,
          403,
        );
        adminExport = (await ok("/point/exports", "POST", {}, "admin")).id;
        const e = await ok(
          "/point/exports/" + adminExport,
          "GET",
          undefined,
          "admin",
        );
        assert.deepEqual(e.branch_ids, [branch]);
        assert.equal(e.employee_count, 1);
        assert.equal(
          (await api("/point/exports/" + exportId, "GET", undefined, "admin"))
            .status,
          403,
        );
      },
    );
    await t.test(
      "remoção do escopo revoga acesso aos pacotes anteriores",
      async () => {
        await edit(adminId, {
          branch_ids: [destination],
          home_branch_id: destination,
        });
        await auth("admin");
        assert.equal(
          (
            await api(
              "/point/exports/" + adminExport,
              "GET",
              undefined,
              "admin",
            )
          ).status,
          403,
        );
        assert.ok(
          !(await ok("/point/exports", "GET", undefined, "admin")).items.some(
            (e: any) => e.id === adminExport,
          ),
        );
        assert.equal(
          (await api("/point/exports/" + exportId, "GET", undefined, "b"))
            .status,
          404,
        );
      },
    );
    await t.test(
      "consulta básica não recebe dados do ponto por concessão isolada",
      async () => {
        await ok("/users", "POST", {
          name: "Consulta ponto teste",
          email: "point-reader@test.local",
          password,
          role: "viewer",
          branch_ids: [branch],
          permission_grants: ["point_read", "point_export"],
        });
        await auth("reader");
        assert.equal(
          (await api("/point/overview", "GET", undefined, "reader")).status,
          403,
        );
        assert.equal(
          (await api("/point/exports", "POST", {}, "reader")).status,
          403,
        );
      },
    );
    await t.test(
      "cadastro antigo sem filial de trabalho continua visível como pendência",
      async () => {
        const owner = (await ok("/employees")).items.find(
          (e: any) => e.user_id === a.user.id,
        );
        await db.provision((tx) =>
          tx.query(
            "UPDATE memberships SET home_branch_id=NULL,version=version+1 WHERE id=$1 RETURNING id",
            [owner.id],
          ),
        );
        const v = await overview();
        assert.ok(v.employees.items.some((e: any) => e.id === owner.id));
        assert.equal(v.blocking.employees_without_home_branch, 1);
        assert.equal(v.local_mapping_complete, false);
        await edit(owner.id, { home_branch_id: branch });
        assert.equal(
          (await overview()).blocking.employees_without_home_branch,
          0,
        );
      },
    );
    await t.test(
      "cadastros inativos permanecem no pacote sem criar marcações",
      async () => {
        const reader = (await ok("/employees")).items.find(
          (e: any) => e.email === "point-reader@test.local",
        );
        await edit(reader.id, { active: false });
        const prepared = await ok("/point/exports", "POST", {}),
          e = await ok("/point/exports/" + prepared.id),
          person = e.content.employees.find(
            (p: any) => p.employee_id === reader.id,
          );
        assert.equal(person.active, false);
        assert.equal(person.attendance, null);
      },
    );
    await t.test(
      "RLS e privilégios preservam pacotes e impedem reatribuição de filial",
      async () => {
        assert.equal(
          (
            await db.transaction(b.tenant.id, (tx) =>
              tx.query("SELECT id FROM point_preparation_exports"),
            )
          ).length,
          0,
        );
        await assert.rejects(
          db.transaction(a.tenant.id, (tx) =>
            tx.query(
              "UPDATE point_preparation_exports SET employee_count=0 WHERE id=$1 RETURNING id",
              [exportId],
            ),
          ),
        );
        await assert.rejects(
          db.transaction(a.tenant.id, (tx) =>
            tx.query(
              "UPDATE point_branch_mappings SET branch_id=$1 RETURNING branch_id",
              [destination],
            ),
          ),
        );
        await assert.rejects(
          db.transaction(b.tenant.id, (tx) =>
            tx.query(
              "INSERT INTO point_settings(tenant_id,profile) VALUES($1,$2::jsonb) RETURNING tenant_id",
              [a.tenant.id, "{}"],
            ),
          ),
        );
      },
    );
    await t.test(
      "contagem de pendências cobre toda a empresa e limite não produz pacote truncado",
      async () => {
        const fixtures = Array.from({ length: 501 }, () => ({
          id: randomUUID(),
          user_id: randomUUID(),
        }));
        await db.provision(async (tx) => {
          await tx.query(
            "INSERT INTO users(id,email,name,password_hash) SELECT user_id,user_id::text||'@test.local','Volume fictício','not-a-login-password' FROM jsonb_to_recordset($1::jsonb) AS x(id uuid,user_id uuid) RETURNING id",
            [JSON.stringify(fixtures)],
          );
          await tx.query(
            "INSERT INTO memberships(id,tenant_id,user_id,role,branch_ids,employee_name,home_branch_id) SELECT id,$2,user_id,'viewer',ARRAY[$3::uuid],'Volume fictício',$3 FROM jsonb_to_recordset($1::jsonb) AS x(id uuid,user_id uuid) RETURNING id",
            [JSON.stringify(fixtures), a.tenant.id, branch],
          );
        });
        const before = (await ok("/point/exports")).total,
          v = await overview();
        assert.ok(v.employee_total > 500);
        assert.equal(v.blocking.employees_without_mapping, 502);
        assert.equal(v.blocking.over_export_limit, true);
        assert.equal(v.employees.items.length, 30);
        assert.equal((await api("/point/exports", "POST", {})).status, 422);
        assert.equal((await ok("/point/exports")).total, before);
      },
    );
  } finally {
    await app.close();
    await db.close();
  }
});

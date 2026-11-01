import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { Database } from "../src/server/db";
import { createApp } from "../src/server/app";
import { validCnpj } from "../src/shared/fiscal";
import { effectivePermissions } from "../src/shared/access";
import { openCertificate, sealCertificate } from "../src/server/fiscal-vault";
import { testCertificate } from "./helpers/fiscal-certificate";

test("CNPJ numérico e alfanumérico preservam letras e verificam os dois dígitos", () => {
  assert.ok(validCnpj("11.222.333/0001-81"));
  assert.ok(validCnpj("12.ABC.345/01DE-35"));
  for (const s of [
    "11.222.333/0001-82",
    "00000000000000",
    "12.ABC.345/01DE-36",
    "12_ABC34501DE35",
  ])
    assert.equal(validCnpj(s), false);
});
test("Cofre A1 autentica senha, cifra e vincula certificado à empresa e filial", () => {
  const password = randomUUID(),
    pfx = testCertificate(password),
    key = randomBytes(32),
    tenant = randomUUID(),
    branch = randomUUID();
  assert.throws(() =>
    sealCertificate(key, tenant, branch, pfx, "senha incorreta"),
  );
  const sealed = sealCertificate(key, tenant, branch, pfx, password);
  assert.ok(!JSON.stringify(sealed).includes(password));
  assert.deepEqual(openCertificate(key, tenant, branch, sealed), {
    pfx: pfx.toString("base64"),
    password,
  });
  assert.throws(() => openCertificate(key, randomUUID(), branch, sealed));
  assert.throws(() => openCertificate(randomBytes(32), tenant, branch, sealed));
  assert.throws(() =>
    openCertificate(key, tenant, branch, {
      ...sealed,
      tag: randomBytes(16).toString("base64"),
    }),
  );
});
test("Fiscal: dados reais, isolamento, preparação imutável e XML sem autorização fictícia", async (t) => {
  const db = new Database();
  await db.open("memory://");
  const app = await createApp(db);
  await app.listen(0, "127.0.0.1");
  const base = await app.getUrl();
  const clients: Record<string, any> = {},
    password = randomUUID();
  let a: any,
    b: any,
    branch: string,
    other: string,
    product: string,
    sale: string,
    draft: string;
  const oldKey = process.env.FISCAL_ENCRYPTION_KEY;
  process.env.FISCAL_ENCRYPTION_KEY = randomBytes(32).toString("hex");
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
      { email: `fiscal-${who}@test.local`, password },
      "none",
    );
    clients[who] = { cookie: r.cookie!.split(";")[0] };
    const me = await ok("/me", "GET", undefined, who);
    clients[who].csrf = me.csrf;
    return me;
  }
  const issuer = () => ok("/fiscal/overview?branch_id=" + branch);
  try {
    await t.test(
      "provisiona empresas separadas e origem comercial real",
      async () => {
        for (const who of ["a", "b"])
          await ok(
            "/setup",
            "POST",
            {
              company: "Fiscal teste " + who,
              name: "Fiscal teste",
              branch: "Matriz",
              email: `fiscal-${who}@test.local`,
              password,
            },
            "none",
          );
        a = await auth("a");
        b = await auth("b");
        branch = a.branches[0].id;
        other = b.branches[0].id;
        product = (
          await ok("/products", "POST", {
            name: "Produto fiscal teste",
            sku: "FISCAL-01",
            condition: "new",
            serialized: false,
            cost: 2,
            price: 10,
            warranty_days: 30,
          })
        ).id;
        await ok("/movements", "POST", {
          product_id: product,
          branch_id: branch,
          type: "entry",
          quantity: 10,
          reason: "Estoque fiscal teste",
        });
        const state = await ok("/pos/state?branch_id=" + branch),
          session = (
            await ok("/pos/open", "POST", {
              register_id: state.register_id,
              opening_cents: 0,
            })
          ).id;
        sale = (
          await ok("/pos/sales", "POST", {
            session_id: session,
            items: [{ product_id: product, quantity: 2 }],
            discount_cents: 0,
            expected_total_cents: 2000,
            payments: [
              { method: "pix", amount_cents: 2000, reference: "FISCAL-TESTE" },
            ],
          })
        ).id;
        assert.equal((await issuer()).integration.official_emission, false);
      },
    );
    await t.test(
      "salva estados, porte e regime com versão e CNPJ alfanumérico",
      async () => {
        assert.equal(
          (
            await api("/fiscal/issuers/" + branch, "POST", {
              version: 0,
              cnpj: "invalid",
            })
          ).status,
          400,
        );
        const body = {
          version: 0,
          legal_name: "Emitente fictício teste",
          cnpj: "12.ABC.345/01DE-35",
          state: "CE",
          size: "me",
          regime: "real",
          provider_name: "A definir",
        };
        const key = randomUUID();
        await ok("/fiscal/issuers/" + branch, "POST", body, "a", key);
        await ok("/fiscal/issuers/" + branch, "POST", body, "a", key);
        assert.equal((await issuer()).issuer.profile.cnpj, "12ABC34501DE35");
        assert.equal((await issuer()).issuer.profile.regime, "real");
        assert.equal(
          (
            await api("/fiscal/issuers/" + branch, "POST", {
              version: 1,
              size: "mei",
              regime: "real",
            })
          ).status,
          400,
        );
        assert.equal(
          (await api("/fiscal/issuers/" + branch, "POST", body)).status,
          409,
        );
        assert.equal(
          (
            await api("/fiscal/issuers/" + branch, "POST", {
              ...body,
              version: 1,
              state: "ZZ",
            })
          ).status,
          400,
        );
      },
    );
    await t.test(
      "classificação dos produtos é versionada e sem custos expostos",
      async () => {
        const body = {
          version: 0,
          ncm: "12345678",
          cfop: "5102",
          unit: "UN",
          origin: "0",
          icms_code: "102",
        };
        await ok("/fiscal/products/" + product, "POST", body);
        assert.equal(
          (await api("/fiscal/products/" + product, "POST", body)).status,
          409,
        );
        const p = (await ok("/fiscal/products?q=FISCAL-01")).items[0];
        assert.equal(p.profile.ncm, "12345678");
        assert.equal(p.cost_cents, undefined);
      },
    );
    await t.test(
      "preparação usa snapshots e bloqueia duplicação e modelos incompatíveis",
      async () => {
        const body = {
            branch_id: branch,
            source_id: sale,
            source_kind: "sale",
            model: "nfce",
          },
          key = randomUUID();
        assert.equal(
          (await api("/fiscal/drafts", "POST", { ...body, model: "nfse" }))
            .status,
          400,
        );
        const results = await Promise.all([
          ok("/fiscal/drafts", "POST", body, "a", key),
          ok("/fiscal/drafts", "POST", body, "a", key),
        ]);
        draft = results[0].id;
        assert.equal(draft, results[1].id);
        assert.equal(
          (await api("/fiscal/drafts", "POST", { ...body, model: "nfe" }))
            .status,
          409,
        );
        const detail = await ok("/fiscal/drafts/" + draft);
        assert.equal(detail.draft.snapshot.source.total_cents, 2000);
        assert.equal(
          detail.draft.snapshot.items[0].tax_profile.ncm,
          "12345678",
        );
        assert.equal(detail.draft.snapshot.items[0].unit_cost_cents, undefined);
        await ok("/fiscal/products/" + product, "POST", {
          version: 1,
          ncm: "87654321",
        });
        assert.equal(
          (await ok("/fiscal/drafts/" + draft)).draft.snapshot.items[0]
            .tax_profile.ncm,
          "12345678",
        );
        assert.equal(
          (await ok("/fiscal/sources?branch_id=" + branch)).total,
          0,
        );
      },
    );
    await t.test(
      "NFS-e prepara somente mão de obra entregue e respeita a filial da ordem",
      async () => {
        const customer = randomUUID(),
          order = randomUUID(),
          quote = randomUUID();
        // Isolated source fixture; the complete repair workflow is tested in repairs.test.ts.
        await db.provision(async (tx) => {
          await tx.query(
            "INSERT INTO customers(id,tenant_id,name,phone) VALUES($1,$2,'Cliente fiscal fictício','85999990000') RETURNING id",
            [customer, a.tenant.id],
          );
          await tx.query(
            "INSERT INTO repair_orders(id,tenant_id,branch_id,customer_id,code,customer_name,customer_phone,brand,model,reported_fault,physical_state,status,delivery_outcome,work_report,delivered_at,created_by) VALUES($1,$2,$3,$4,'OS-FISCAL-TESTE','Cliente fiscal fictício','85999990000','Teste','Teste','Teste fiscal','Teste','delivered','ready','Serviço fictício para teste',now(),$5) RETURNING id",
            [order, a.tenant.id, branch, customer, a.user.id],
          );
          await tx.query(
            "INSERT INTO repair_quotes(id,tenant_id,order_id,revision,labor_price_cents,labor_cost_cents,total_cents,warranty_days,warranty_terms,created_by) VALUES($1,$2,$3,1,1900,500,2900,30,'Teste',$4) RETURNING id",
            [quote, a.tenant.id, order, a.user.id],
          );
          await tx.query(
            "UPDATE repair_orders SET current_quote_id=$1 WHERE id=$2 RETURNING id",
            [quote, order],
          );
        });
        const sources = await ok("/fiscal/sources?branch_id=" + branch);
        assert.equal(
          sources.items.find((s: any) => s.id === order).total_cents,
          1900,
        );
        const another = (
          await ok("/branches", "POST", { name: "Outra filial fiscal teste" })
        ).id;
        a = await auth("a");
        assert.equal(
          (
            await api("/fiscal/drafts", "POST", {
              branch_id: another,
              source_id: order,
              source_kind: "repair",
              model: "nfse",
            })
          ).status,
          404,
        );
        const prepared = await ok("/fiscal/drafts", "POST", {
            branch_id: branch,
            source_id: order,
            source_kind: "repair",
            model: "nfse",
          }),
          detail = await ok("/fiscal/drafts/" + prepared.id);
        assert.equal(detail.draft.snapshot.items.length, 1);
        assert.equal(detail.draft.snapshot.items[0].net_cents, 1900);
        assert.equal(detail.draft.snapshot.source.labor_cost_cents, undefined);
        assert.ok(
          detail.draft.snapshot.limitations.some((s: string) =>
            s.includes("somente mão de obra"),
          ),
        );
      },
    );
    await t.test(
      "não emite nem cancela notas e arquiva somente preparação",
      async () => {
        for (const op of ["emit", "cancel", "query"])
          assert.equal(
            (await api(`/fiscal/drafts/${draft}/${op}`, "POST", {})).status,
            409,
          );
        await ok(`/fiscal/drafts/${draft}/archive`, "POST", {
          reason: "Arquivamento de teste",
        });
        assert.equal(
          (await ok("/fiscal/drafts?branch_id=" + branch + "&status=archived"))
            .total,
          1,
        );
        assert.equal((await ok("/pos/sales/" + sale)).sale.status, "completed");
      },
    );
    await t.test(
      "XML preserva conteúdo e hash sem executar entidades ou declarar autenticidade",
      async () => {
        const body = {
          branch_id: branch,
          draft_id: draft,
          filename: "teste.xml",
          content:
            '\ufeff<?xml version="1.0"?><exemplo>TESTE SEM VALIDADE · ç</exemplo>',
          description: "Arquivo fictício de teste",
        };
        const first = await ok("/fiscal/files", "POST", body);
        const file = await ok("/fiscal/files/" + first.id);
        assert.equal(file.content, body.content);
        assert.equal(file.verification, "unverified");
        assert.equal((await api("/fiscal/files", "POST", body)).status, 409);
        assert.equal(
          (
            await api("/fiscal/files", "POST", {
              ...body,
              content: '<!DOCTYPE x [<!ENTITY e SYSTEM "file:///secret">]><x/>',
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await api("/fiscal/files", "POST", {
              ...body,
              filename: "../teste.xml",
            })
          ).status,
          400,
        );
        assert.equal(
          (await api("/fiscal/files/" + first.id, "GET", undefined, "b"))
            .status,
          404,
        );
        assert.equal(
          (await api("/fiscal/files", "POST", { ...body, branch_id: other }))
            .status,
          403,
        );
      },
    );
    await t.test(
      "certificado A1 exige senha correta, nunca retorna segredos e remove sem perder versão",
      async () => {
        const pass = randomUUID(),
          pfx = testCertificate(pass).toString("base64"),
          body = { version: 0, filename: "ficticio.pfx", pfx, password: pass };
        assert.equal(
          (
            await api("/fiscal/certificates/" + branch, "POST", {
              ...body,
              password: "errada",
            })
          ).status,
          400,
        );
        await ok("/fiscal/certificates/" + branch, "POST", body);
        const view = await issuer();
        assert.ok(view.certificate.active);
        assert.equal(view.certificate.sealed, undefined);
        assert.equal(view.certificate.password, undefined);
        const [stored] = await db.transaction(a.tenant.id, (tx) =>
          tx.query(
            "SELECT sealed FROM fiscal_certificates WHERE branch_id=$1",
            [branch],
          ),
        );
        assert.ok(!JSON.stringify(stored).includes(pass));
        assert.equal(
          openCertificate(
            Buffer.from(process.env.FISCAL_ENCRYPTION_KEY!, "hex"),
            a.tenant.id,
            branch,
            stored.sealed,
          ).pfx,
          pfx,
        );
        await ok("/fiscal/certificates/" + branch + "/remove", "POST", {
          version: 1,
          reason: "Substituição de teste",
        });
        assert.equal((await issuer()).certificate.version, 2);
        const [removed] = await db.transaction(a.tenant.id, (tx) =>
          tx.query(
            "SELECT sealed FROM fiscal_certificates WHERE branch_id=$1",
            [branch],
          ),
        );
        assert.equal(removed.sealed, null);
        assert.equal(
          (
            await api("/fiscal/certificates/" + branch, "POST", {
              ...body,
              version: 1,
            })
          ).status,
          409,
        );
        await ok("/fiscal/certificates/" + branch, "POST", {
          ...body,
          version: 2,
        });
      },
    );
    await t.test(
      "papéis e filiais limitam leitura e protegem configurações e certificado",
      async () => {
        await ok("/users", "POST", {
          name: "Consulta fiscal teste",
          email: "fiscal-reader@test.local",
          password,
          role: "viewer",
          branch_ids: [branch],
          permission_grants: ["fiscal_read"],
        });
        await auth("reader");
        assert.equal(
          (
            await api(
              "/fiscal/overview?branch_id=" + branch,
              "GET",
              undefined,
              "reader",
            )
          ).status,
          200,
        );
        assert.equal(
          (
            await api(
              "/fiscal/issuers/" + branch,
              "POST",
              { version: 1 },
              "reader",
            )
          ).status,
          403,
        );
        assert.equal(
          (await api("/fiscal/certificates/" + branch, "POST", {}, "reader"))
            .status,
          403,
        );
        assert.equal(
          (await api("/fiscal/overview?branch_id=" + other)).status,
          403,
        );
        assert.equal(
          (await api("/fiscal/drafts/" + draft, "GET", undefined, "b")).status,
          404,
        );
        assert.ok(
          !effectivePermissions({
            role: "viewer",
            permission_grants: ["fiscal_settings"],
          }).includes("fiscal_settings"),
        );
      },
    );
    await t.test(
      "RLS e privilégios mantêm documentos e arquivos imutáveis",
      async () => {
        const rows = await db.transaction(b.tenant.id, (tx) =>
          tx.query("SELECT id FROM fiscal_drafts"),
        );
        assert.equal(rows.length, 0);
        await assert.rejects(
          db.transaction(a.tenant.id, (tx) =>
            tx.query(
              "UPDATE fiscal_drafts SET model='nfe' WHERE id=$1 RETURNING id",
              [draft],
            ),
          ),
        );
        await assert.rejects(
          db.transaction(a.tenant.id, (tx) =>
            tx.query("DELETE FROM fiscal_files RETURNING id"),
          ),
        );
      },
    );
  } finally {
    if (oldKey === undefined) delete process.env.FISCAL_ENCRYPTION_KEY;
    else process.env.FISCAL_ENCRYPTION_KEY = oldKey;
    await app.close();
    await db.close();
  }
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Database } from "../src/server/db";
import { createApp } from "../src/server/app";
test("CRM: clientes compartilhados, privacidade, funil, lembretes e histórico integrado", async (t) => {
  const db = new Database();
  await db.open("memory://");
  const app = await createApp(db);
  await app.listen(0, "127.0.0.1");
  const base = await app.getUrl();
  const clients: Record<string, any> = {};
  const password = "Crm-Testing-2026!";
  let a: any,
    b: any,
    m: any,
    cid: string,
    otherCustomer: string,
    branch2: string,
    opp: string,
    task: string,
    part: string,
    session: string,
    sale: string,
    order: string;
  async function api(
    path: string,
    method = "GET",
    body?: unknown,
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
    body?: unknown,
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
      { email: `crm-${who}@test.local`, password },
      "none",
    );
    assert.equal(r.status, 200);
    clients[who] = { cookie: r.cookie!.split(";")[0] };
    const me = await ok("/me", "GET", undefined, who);
    clients[who].csrf = me.csrf;
    return me;
  }
  const detail = () => ok(`/crm/customers/${cid}`);
  const hist = (kind: string, who = "a") =>
    ok(`/crm/customers/${cid}/history?kind=${kind}`, "GET", undefined, who);
  const profile = {
    name: "Cliente CRM teste",
    phone: "(85) 99999-1111",
    email: "cliente@test.local",
    city: "Fortaleza",
    state: "CE",
    notes: "Preferência de atendimento em horário comercial",
  };
  try {
    await t.test(
      "prepara empresas, filial adicional e acessos mínimos",
      async () => {
        for (const who of ["a", "b"])
          await ok(
            "/setup",
            "POST",
            {
              company: `CRM ${who}`,
              name: `Owner ${who}`,
              branch: "Matriz",
              email: `crm-${who}@test.local`,
              password,
            },
            "none",
          );
        a = await auth("a");
        b = await auth("b");
        branch2 = (await ok("/branches", "POST", { name: "Filial reservada" }))
          .id;
        for (const [who, role] of [
          ["cash", "cashier"],
          ["tech", "technician"],
          ["manager", "manager"],
        ])
          await ok("/users", "POST", {
            name: `Pessoa ${who}`,
            email: `crm-${who}@test.local`,
            password,
            role,
            branch_ids: [a.branches[0].id],
          });
        await auth("cash");
        await auth("tech");
        m = await auth("manager");
        a = await auth("a");
      },
    );
    await t.test(
      "cadastro idempotente, versão e validação sem permissão de contato implícita",
      async () => {
        const key = randomUUID();
        cid = (await ok("/crm/customers", "POST", profile, "a", key)).id;
        assert.equal(
          (await ok("/crm/customers", "POST", profile, "a", key)).id,
          cid,
        );
        const c = (await detail()).customer;
        assert.equal(c.phone, "85999991111");
        assert.equal(c.contact_permission, false);
        assert.equal(
          (
            await api("/crm/customers", "POST", {
              ...profile,
              contact_permission: true,
            })
          ).status,
          400,
        );
        const body = {
          ...profile,
          phone: c.phone,
          name: "Cliente CRM atualizado",
          version: c.version,
        };
        await ok(`/crm/customers/${cid}`, "POST", body);
        assert.equal(
          (await api(`/crm/customers/${cid}`, "POST", body)).status,
          409,
        );
        otherCustomer = (await ok("/crm/customers", "POST", profile, "b")).id;
      },
    );
    await t.test(
      "isola empresas, restringe técnicos e limita busca de caixa a dados mínimos",
      async () => {
        assert.equal(
          (await api(`/crm/customers/${cid}`, "GET", undefined, "b")).status,
          404,
        );
        assert.equal(
          (await api("/crm/customers", "GET", undefined, "tech")).status,
          403,
        );
        assert.equal(
          (await api("/crm/customers", "GET", undefined, "cash")).status,
          403,
        );
        assert.equal(
          (
            await api(
              `/crm/customers/${cid}/history?kind=sales`,
              "GET",
              undefined,
              "cash",
            )
          ).status,
          403,
        );
        const found = await ok(
          "/crm/lookup?q=atualizado",
          "GET",
          undefined,
          "cash",
        );
        assert.equal(found.items[0].id, cid);
        assert.deepEqual(Object.keys(found.items[0]).sort(), [
          "id",
          "name",
          "phone_suffix",
        ]);
        assert.equal(
          (await ok("/crm/lookup?q=C", "GET", undefined, "cash")).items.length,
          0,
        );
        assert.equal(
          (
            await api(
              `/crm/opportunities?branch_id=${branch2}`,
              "GET",
              undefined,
              "manager",
            )
          ).status,
          403,
        );
      },
    );
    await t.test(
      "contato exige preferência explícita e revogação bloqueia WhatsApp e prospecção",
      async () => {
        assert.equal((await api(`/crm/customers/${cid}/contact`)).status, 409);
        let c = (await detail()).customer;
        await ok(`/crm/customers/${cid}/consent`, "POST", {
          version: c.version,
          allowed: true,
          evidence: "Cliente autorizou presencialmente neste teste",
        });
        assert.equal(
          (await ok(`/crm/customers/${cid}/contact`)).url,
          "https://wa.me/5585999991111",
        );
        await ok(`/crm/customers/${cid}/interactions`, "POST", {
          branch_id: a.branches[0].id,
          channel: "whatsapp",
          text: "Retorno comercial registrado manualmente",
        });
        c = (await detail()).customer;
        await ok(`/crm/customers/${cid}/consent`, "POST", {
          version: c.version,
          allowed: false,
          evidence: "Cliente revogou a preferência",
        });
        assert.equal((await api(`/crm/customers/${cid}/contact`)).status, 409);
        assert.equal(
          (
            await api(`/crm/customers/${cid}/interactions`, "POST", {
              branch_id: a.branches[0].id,
              channel: "phone",
              text: "Contato não autorizado",
            })
          ).status,
          409,
        );
        const events = (await hist("events")).items;
        assert.equal(
          events.filter((r: any) => r.action === "contact_permission").length,
          2,
        );
      },
    );
    await t.test(
      "funil valida responsável, versão, motivo e reenvio",
      async () => {
        const body = {
          branch_id: a.branches[0].id,
          customer_id: cid,
          title: "Aparelho para cliente",
          value_cents: 150000,
          owner_id: a.user.id,
          expected_on: "2026-11-15",
        };
        const key = randomUUID();
        opp = (await ok("/crm/opportunities", "POST", body, "a", key)).id;
        assert.equal(
          (await ok("/crm/opportunities", "POST", body, "a", key)).id,
          opp,
        );
        assert.equal(
          (
            await api("/crm/opportunities", "POST", {
              ...body,
              customer_id: otherCustomer,
            })
          ).status,
          404,
        );
        assert.equal(
          (
            await api("/crm/opportunities", "POST", {
              ...body,
              owner_id: b.user.id,
            })
          ).status,
          400,
        );
        const update = {
          version: 1,
          title: body.title,
          value_cents: body.value_cents,
          owner_id: body.owner_id,
          expected_on: null,
          stage: "won",
          reason: "",
        };
        assert.equal(
          (await api(`/crm/opportunities/${opp}`, "POST", update)).status,
          400,
        );
        await ok(`/crm/opportunities/${opp}`, "POST", {
          ...update,
          stage: "proposal",
        });
        assert.equal(
          (
            await api(`/crm/opportunities/${opp}`, "POST", {
              ...update,
              reason: "Concluído",
            })
          ).status,
          409,
        );
        await ok(`/crm/opportunities/${opp}`, "POST", {
          ...update,
          version: 2,
          reason: "Cliente confirmou a compra",
        });
        const board = await ok(
          `/crm/opportunities?branch_id=${a.branches[0].id}`,
        );
        assert.equal(
          board.summary.find((r: any) => r.stage === "won").count,
          1,
        );
        assert.equal(
          (
            await api(`/crm/opportunities/${opp}`, "POST", {
              ...update,
              version: 3,
              stage: "new",
            })
          ).status,
          400,
        );
      },
    );
    await t.test(
      "lembretes preservam horário, detectam atraso e permitem conclusão auditada",
      async () => {
        const body = {
          branch_id: a.branches[0].id,
          customer_id: cid,
          title: "Conferir retorno do cliente",
          owner_id: a.user.id,
          due_at: "2020-01-01T10:00:00-03:00",
        };
        const key = randomUUID();
        task = (await ok("/crm/tasks", "POST", body, "a", key)).id;
        assert.equal((await ok("/crm/tasks", "POST", body, "a", key)).id, task);
        const board = await ok(
          `/crm/tasks?branch_id=${a.branches[0].id}&status=overdue`,
        );
        assert.equal(board.items[0].overdue, true);
        assert.equal(
          new Date(board.items[0].due_at).toISOString(),
          "2020-01-01T13:00:00.000Z",
        );
        const c = (await detail()).customer;
        assert.equal(
          (
            await api(`/crm/customers/${cid}/state`, "POST", {
              version: c.version,
              active: false,
              reason: "Tentativa com pendência",
            })
          ).status,
          409,
        );
        await ok(`/crm/tasks/${task}`, "POST", {
          version: 1,
          title: body.title,
          owner_id: body.owner_id,
          due_at: body.due_at,
          status: "done",
        });
        assert.equal(
          (await ok(`/crm/tasks?branch_id=${a.branches[0].id}&status=done`))
            .items[0].status,
          "done",
        );
      },
    );
    await t.test(
      "históricos ocultam atividades e serviços de filiais sem acesso",
      async () => {
        await ok(`/crm/customers/${cid}/interactions`, "POST", {
          branch_id: branch2,
          channel: "note",
          text: "Atividade reservada à outra filial",
        });
        order = (
          await ok("/repairs", "POST", {
            branch_id: branch2,
            customer_id: cid,
            brand: "Marca teste",
            model: "Modelo reservado",
            serial: "CRM-OTHER-BRANCH",
            reported_fault: "Falha de teste",
            physical_state: "Íntegro",
          })
        ).id;
        assert.equal((await hist("services", "manager")).items.length, 0);
        assert.equal(
          (await hist("events", "manager")).items.some(
            (r: any) => r.details.text === "Atividade reservada à outra filial",
          ),
          false,
        );
        assert.equal((await hist("services")).items[0].id, order);
      },
    );
    await t.test(
      "PDV vincula cliente, congela nome e calcula histórico líquido após devolução",
      async () => {
        part = (
          await ok("/products", "POST", {
            name: "Cabo CRM",
            sku: "CRM-CABO",
            condition: "new",
            serialized: false,
            cost: 10,
            price: 25,
            warranty_days: 90,
            warranty_terms: "Termos de teste",
          })
        ).id;
        await ok("/movements", "POST", {
          branch_id: a.branches[0].id,
          product_id: part,
          type: "entry",
          quantity: 5,
          reason: "Entrada para CRM",
        });
        const state = await ok(`/pos/state?branch_id=${a.branches[0].id}`);
        session = (
          await ok("/pos/open", "POST", {
            register_id: state.register_id,
            opening_cents: 0,
          })
        ).id;
        const body = {
          session_id: session,
          customer_id: cid,
          items: [{ product_id: part, quantity: 2 }],
          expected_total_cents: 5000,
          payments: [{ method: "cash", amount_cents: 5000 }],
        };
        assert.equal(
          (
            await api("/pos/sales", "POST", {
              ...body,
              customer_id: otherCustomer,
            })
          ).status,
          400,
        );
        const key = randomUUID();
        sale = (await ok("/pos/sales", "POST", body, "a", key)).id;
        assert.equal((await ok("/pos/sales", "POST", body, "a", key)).id, sale);
        const receipt = await ok(`/pos/sales/${sale}`);
        assert.equal(receipt.sale.customer_name, "Cliente CRM atualizado");
        await ok(`/pos/sales/${sale}/return`, "POST", {
          session_id: session,
          kind: "return",
          items: [{ sale_item_id: receipt.items[0].id, quantity: 1 }],
          payments: [{ method: "cash", amount_cents: 2500 }],
          reason: "Devolução de teste CRM",
        });
        const items = (await hist("sales")).items;
        assert.equal(items.length, 1);
        assert.equal(items[0].returned_quantity, 1);
        assert.equal(items[0].net_cents - items[0].refunded_cents, 2500);
        assert.equal(items[0].warranty_days, 90);
        assert.ok(items[0].warranty_expires_on);
        assert.equal("unit_cost_cents" in items[0], false);
        const c = (await detail()).customer;
        await ok(`/crm/customers/${cid}`, "POST", {
          ...profile,
          name: "Nome novo do cliente",
          version: c.version,
        });
        assert.equal(
          (await ok(`/pos/sales/${sale}`)).sale.customer_name,
          "Cliente CRM atualizado",
        );
      },
    );
    await t.test(
      "arquivamento mantém histórico e impede novas vendas, ordens e contatos",
      async () => {
        const c = (await detail()).customer;
        await ok(`/crm/customers/${cid}/state`, "POST", {
          version: c.version,
          active: false,
          reason: "Encerramento do relacionamento",
        });
        assert.equal((await hist("sales")).items.length, 1);
        assert.equal((await ok("/crm/lookup?q=Nome")).items.length, 0);
        assert.equal(
          (
            await api("/repairs", "POST", {
              branch_id: a.branches[0].id,
              customer_id: cid,
              brand: "Teste",
              model: "Novo teste",
              reported_fault: "Falha",
              physical_state: "Bom",
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await api("/pos/sales", "POST", {
              session_id: session,
              customer_id: cid,
              items: [{ product_id: part, quantity: 1 }],
              expected_total_cents: 2500,
              payments: [{ method: "cash", amount_cents: 2500 }],
            })
          ).status,
          400,
        );
        assert.equal((await api(`/crm/customers/${cid}/contact`)).status, 409);
        const v = (await detail()).customer.version;
        await ok(`/crm/customers/${cid}/state`, "POST", {
          version: v,
          active: true,
          reason: "Cliente retornou à loja",
        });
        assert.equal((await detail()).customer.active, true);
      },
    );
    await t.test(
      "paginação estável e eventos imutáveis na role da aplicação",
      async () => {
        for (let n = 0; n < 32; n++)
          await ok(`/crm/customers/${cid}/interactions`, "POST", {
            branch_id: a.branches[0].id,
            channel: "note",
            text: `Atividade paginada ${n}`,
          });
        const first = (await hist("events")).items,
          second = (
            await ok(`/crm/customers/${cid}/history?kind=events&page=2`)
          ).items;
        assert.equal(first.length, 30);
        assert.ok(second.length > 0);
        assert.equal(
          new Set([...first, ...second].map((r: any) => r.id)).size,
          first.length + second.length,
        );
        await assert.rejects(() =>
          db.transaction(a.tenant.id, (tx) =>
            tx.query("DELETE FROM crm_events WHERE customer_id=$1", [cid]),
          ),
        );
        assert.equal(
          (
            await db.transaction(b.tenant.id, (tx) =>
              tx.query("SELECT id FROM crm_tasks"),
            )
          ).length,
          0,
        );
      },
    );
  } finally {
    await app.close();
    await db.close();
  }
});

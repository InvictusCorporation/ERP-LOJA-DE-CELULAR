import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Database } from "../src/server/db";
import { createApp } from "../src/server/app";

test("Filiais: cadastro, operação isolada, transferências atômicas e encerramento", async (t) => {
  const db = new Database();
  await db.open("memory://");
  const app = await createApp(db);
  await app.listen(0, "127.0.0.1");
  const base = await app.getUrl(),
    password = "Branches-Testing-2026!",
    clients: Record<string, any> = {};
  let a: any,
    b: any,
    source: string,
    dest: string,
    third: string,
    empty: string,
    bulk: string,
    device: string,
    unit: string,
    transfer: string;
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
      { email: `branch-${who}@test.local`, password },
      "none",
    );
    assert.equal(r.status, 200, JSON.stringify(r.body));
    clients[who] = { cookie: r.cookie!.split(";")[0] };
    const me = await ok("/me", "GET", undefined, who);
    clients[who].csrf = me.csrf;
    return me;
  }
  const branch = async (name: string) =>
    (await ok("/branches", "POST", { name })).id;
  const detail = (id: string) => ok("/branches/" + id);
  async function profile(id: string, extra: Record<string, any> = {}) {
    const e = (await detail(id)).branch;
    return {
      name: e.name,
      code: e.code,
      phone: e.phone,
      email: e.email,
      address: e.address,
      city: e.city,
      state: e.state,
      notes: e.notes,
      version: e.version,
      reason: "Revisão cadastral de teste",
      ...extra,
    };
  }
  async function state(id: string, active: boolean) {
    return api(`/branches/${id}/state`, "POST", {
      version: (await detail(id)).branch.version,
      active,
      reason: "Mudança de situação em teste",
    });
  }
  const qty = async (p: string, at: string) =>
    Number(
      (await ok(`/products?branch_id=${at}&q=`)).items.find(
        (x: any) => x.id === p,
      )?.quantity || 0,
    );
  const move = (
    p: string,
    at: string,
    quantity: number,
    type = "entry",
    extra = {},
  ) =>
    ok("/movements", "POST", {
      product_id: p,
      branch_id: at,
      quantity,
      type,
      reason: "Movimento para teste de filiais",
      ...extra,
    });
  const body = (items: any[], src = source, dst = dest) => ({
    source_branch_id: src,
    destination_branch_id: dst,
    reason: "Redistribuição de estoque de teste",
    confirmed: true,
    items,
  });
  const reverse = (id: string) =>
    api(`/branch-transfers/${id}/reverse`, "POST", {
      reason: "Correção integral de teste",
      confirmed: true,
    });
  try {
    await t.test(
      "reaproveita unidades e cria filial com acesso dos proprietários e caixa independente",
      async () => {
        for (const who of ["a", "b"])
          await ok(
            "/setup",
            "POST",
            {
              company: `Filiais ${who}`,
              name: `Gestor ${who}`,
              branch: "Matriz",
              email: `branch-${who}@test.local`,
              password,
            },
            "none",
          );
        a = await auth("a");
        b = await auth("b");
        source = a.branches[0].id;
        dest = await branch("Destino");
        third = await branch("Terceira");
        empty = await branch("Unidade vazia");
        assert.equal((await ok("/me")).branches.length, 4);
        assert.equal(
          (await ok(`/pos/state?branch_id=${dest}`)).register_id,
          dest,
        );
        for (const [who, role, ids] of [
          ["manager", "manager", [source, dest, third, empty]],
          ["limited", "manager", [source]],
          ["stock", "stock", [source, dest]],
          ["cashier", "cashier", [source]],
        ]) {
          await ok("/users", "POST", {
            name: who,
            email: `branch-${who}@test.local`,
            password,
            role,
            branch_ids: ids,
          });
          await auth(who as string);
        }
        assert.equal((await ok("/branches")).total, 4);
        assert.equal(
          (await ok("/branches", "GET", undefined, "limited")).total,
          1,
        );
      },
    );
    await t.test(
      "cadastro idempotente, código único, versão e autoridade",
      async () => {
        const key = randomUUID(),
          payload = {
            name: "Filial cadastro",
            code: "cad-01",
            city: "Fortaleza",
            state: "CE",
          };
        const first = await ok("/branches", "POST", payload, "a", key);
        assert.deepEqual(
          await ok("/branches", "POST", payload, "a", key),
          first,
        );
        assert.equal((await detail(first.id)).branch.code, "CAD-01");
        assert.equal(
          (await api("/branches", "POST", { ...payload, name: "Outra" }))
            .status,
          409,
        );
        const p = await profile(first.id, { name: "Filial atualizada" });
        const rs = await Promise.all([
          api("/branches/" + first.id, "PUT", p),
          api("/branches/" + first.id, "PUT", { ...p, city: "Outra" }),
        ]);
        assert.deepEqual(rs.map((x) => x.status).sort(), [200, 409]);
        assert.equal(
          (await api("/branches", "POST", { name: "Inválida", state: "ce" }))
            .status,
          400,
        );
        assert.equal(
          (
            await api(
              "/branches",
              "POST",
              { name: "Sem autoridade" },
              "manager",
            )
          ).status,
          403,
        );
      },
    );
    await t.test(
      "prepara produtos livres e identificados sem duplicar unidades",
      async () => {
        bulk = (
          await ok("/products", "POST", {
            name: "Mercadoria por quantidade",
            sku: "BR-BULK",
            condition: "new",
            serialized: false,
            cost: 0.29,
            price: 10,
            warranty_days: 30,
          })
        ).id;
        device = (
          await ok("/products", "POST", {
            name: "Mercadoria identificada",
            sku: "BR-UNIT",
            condition: "new",
            serialized: true,
            cost: 10,
            price: 50,
            warranty_days: 30,
          })
        ).id;
        await move(bulk, source, 20);
        await move(device, source, 1, "entry", {
          device: {
            serial: "FILIAL-001",
            imeis: [],
            provenance: "Entrada de teste",
            acquisition_cost: 29.29,
          },
        });
        unit = (await ok(`/units?branch_id=${source}&product_id=${device}`))
          .items[0].id;
        const units = await ok(
          `/branch-transfers/units?branch_id=${source}&product_id=${device}&q=FILIAL`,
        );
        assert.equal(units.items[0].id, unit);
      },
    );
    await t.test(
      "transferência mista atômica, idempotência, custo e ausência de faturamento",
      async () => {
        const payload = body([
            { product_id: bulk, quantity: 4 },
            { product_id: device, quantity: 1, unit_ids: [unit] },
          ]),
          key = randomUUID();
        const first = await ok("/branch-transfers", "POST", payload, "a", key);
        transfer = first.id;
        assert.equal(
          (await ok("/branch-transfers", "POST", payload, "a", key)).id,
          transfer,
        );
        assert.equal(await qty(bulk, source), 16);
        assert.equal(await qty(bulk, dest), 4);
        assert.equal(await qty(device, source), 0);
        assert.equal(await qty(device, dest), 1);
        const d = await ok("/branch-transfers/" + transfer);
        assert.equal(d.items.length, 2);
        assert.equal(
          Number(d.items.find((x: any) => x.unit_id).unit_cost_cents),
          2929,
        );
        assert.equal(
          Number(d.items.find((x: any) => !x.unit_id).unit_cost_cents),
          29,
        );
        assert.equal(
          (await ok(`/units?branch_id=${dest}&product_id=${device}`)).items[0]
            .id,
          unit,
        );
        const [ledger] = await db.system<any>(
          "SELECT count(*)::int AS n,sum(quantity)::int AS net FROM stock_movements WHERE transfer_item_id IS NOT NULL",
        );
        assert.equal(ledger.n, 4);
        assert.equal(ledger.net, 0);
        assert.equal(
          (
            await db.system<any>(
              "SELECT count(*)::int AS n FROM finance_entries",
            )
          )[0].n,
          0,
        );
        const today = new Date().toLocaleDateString("sv-SE", {
          timeZone: "America/Fortaleza",
        });
        assert.equal(
          (
            await ok(
              `/reports/overview?start=${today}&end=${today}&branch_id=all`,
            )
          ).summary.turnover,
          0,
        );
      },
    );
    await t.test(
      "corrige somente pelo fluxo bilateral e exige saldo para toda a correção",
      async () => {
        const [m] = await db.system<any>(
          "SELECT id FROM stock_movements WHERE transfer_item_id IS NOT NULL LIMIT 1",
        );
        assert.equal(
          (
            await api(`/movements/${m.id}/reverse`, "POST", {
              reason: "Correção indevida",
            })
          ).status,
          409,
        );
        await move(bulk, dest, 2, "exit");
        const failed = await reverse(transfer);
        assert.equal(failed.status, 409);
        assert.equal(await qty(device, dest), 1);
        assert.equal(
          (await ok("/branch-transfers/" + transfer)).reversal,
          null,
        );
        await move(bulk, dest, 2);
        const done = await reverse(transfer);
        assert.equal(done.status, 200, JSON.stringify(done.body));
        assert.equal(await qty(bulk, source), 20);
        assert.equal(await qty(bulk, dest), 0);
        assert.equal(await qty(device, source), 1);
        assert.equal((await reverse(transfer)).status, 409);
      },
    );
    await t.test(
      "unidade com movimento posterior exige nova transferência de retorno",
      async () => {
        const tr = await ok(
          "/branch-transfers",
          "POST",
          body([{ product_id: device, quantity: 1, unit_ids: [unit] }]),
        );
        await move(device, dest, 1, "exit", { unit_id: unit });
        await move(device, dest, 1, "entry", { unit_id: unit });
        assert.equal((await reverse(tr.id)).status, 409);
        await ok(
          "/branch-transfers",
          "POST",
          body(
            [{ product_id: device, quantity: 1, unit_ids: [unit] }],
            dest,
            source,
          ),
        );
        assert.equal(await qty(device, source), 1);
        const saleSession = (
          await ok("/pos/open", "POST", {
            register_id: source,
            opening_cents: 0,
          })
        ).id;
        const sale = await ok("/pos/sales", "POST", {
          session_id: saleSession,
          items: [{ product_id: device, quantity: 1, unit_id: unit }],
          expected_total_cents: 5000,
          payments: [{ method: "cash", amount_cents: 5000 }],
        });
        assert.equal(
          (
            await api(
              "/branch-transfers",
              "POST",
              body([{ product_id: device, quantity: 1, unit_ids: [unit] }]),
            )
          ).status,
          409,
        );
        const receipt = await ok("/pos/sales/" + sale.id);
        assert.equal(receipt.items[0].unit_id, unit);
        await ok(`/pos/sales/${sale.id}/return`, "POST", {
          session_id: saleSession,
          kind: "return",
          items: [{ sale_item_id: receipt.items[0].id, quantity: 1 }],
          payments: [{ method: "cash", amount_cents: 5000 }],
          reason: "Devolução para teste de filiais",
        });
      },
    );
    await t.test(
      "rollback, validações e concorrência não duplicam estoque",
      async () => {
        const before = await qty(bulk, source),
          count = (
            await db.system<any>(
              "SELECT count(*)::int AS n FROM stock_transfers",
            )
          )[0].n;
        assert.equal(
          (
            await api(
              "/branch-transfers",
              "POST",
              body([
                { product_id: bulk, quantity: 1 },
                {
                  product_id: device,
                  quantity: 2,
                  unit_ids: [unit, randomUUID()],
                },
              ]),
            )
          ).status,
          409,
        );
        assert.equal(await qty(bulk, source), before);
        assert.equal(
          (
            await db.system<any>(
              "SELECT count(*)::int AS n FROM stock_transfers",
            )
          )[0].n,
          count,
        );
        for (const payload of [
          body([{ product_id: bulk, quantity: 1 }], source, source),
          body([{ product_id: bulk, quantity: 1, unit_ids: [unit] }]),
          body([{ product_id: device, quantity: 2, unit_ids: [unit, unit] }]),
          body([
            { product_id: bulk, quantity: 1 },
            { product_id: bulk, quantity: 1 },
          ]),
          { ...body([{ product_id: bulk, quantity: 1 }]), confirmed: false },
        ])
          assert.equal(
            (await api("/branch-transfers", "POST", payload)).status,
            400,
          );
        const p = (
          await ok("/products", "POST", {
            name: "Último item transferência",
            sku: "BR-LAST",
            condition: "new",
            serialized: false,
            cost: 2,
            price: 5,
            warranty_days: 0,
          })
        ).id;
        await move(p, source, 1);
        const r = await Promise.all([
          api(
            "/branch-transfers",
            "POST",
            body([{ product_id: p, quantity: 1 }]),
          ),
          api(
            "/branch-transfers",
            "POST",
            body([{ product_id: p, quantity: 1 }], source, third),
          ),
        ]);
        assert.deepEqual(r.map((x) => x.status).sort(), [200, 409]);
        assert.equal(await qty(p, source), 0);
        assert.equal((await qty(p, dest)) + (await qty(p, third)), 1);
      },
    );
    await t.test(
      "empresa, duas filiais e direitos individuais são verificados",
      async () => {
        assert.equal(
          (await api("/branch-transfers/" + transfer, "GET", undefined, "b"))
            .status,
          404,
        );
        assert.equal(
          (
            await api(
              "/branch-transfers/" + transfer,
              "GET",
              undefined,
              "limited",
            )
          ).status,
          403,
        );
        assert.equal(
          (await ok("/branch-transfers", "GET", undefined, "limited")).total,
          0,
        );
        assert.equal(
          (
            await api(
              "/branch-transfers",
              "POST",
              body([{ product_id: bulk, quantity: 1 }]),
              "limited",
            )
          ).status,
          403,
        );
        assert.equal(
          (await api("/branches", "GET", undefined, "cashier")).status,
          403,
        );
        assert.equal(
          (
            await api(
              "/branch-transfers",
              "POST",
              body(
                [{ product_id: bulk, quantity: 1 }],
                source,
                b.branches[0].id,
              ),
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await api(
              `/branch-transfers/units?branch_id=${dest}&product_id=${device}`,
              "GET",
              undefined,
              "limited",
            )
          ).status,
          403,
        );
        const hidden = await ok(
          "/branch-transfers/" + transfer,
          "GET",
          undefined,
          "stock",
        );
        assert.ok(hidden.items.every((x: any) => !("unit_cost_cents" in x)));
      },
    );
    await t.test(
      "inativação preserva consulta e impede operação por tela antiga",
      async () => {
        let r = await state(empty, false);
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.equal((await detail(empty)).branch.active, false);
        assert.ok(!(await ok("/me")).branches.some((b: any) => b.id === empty));
        assert.equal(
          (
            await api("/movements", "POST", {
              product_id: bulk,
              branch_id: empty,
              quantity: 1,
              type: "entry",
              reason: "Tela antiga da unidade",
            })
          ).status,
          409,
        );
        assert.equal(
          (
            await api("/pos/open", "POST", {
              register_id: empty,
              opening_cents: 0,
            })
          ).status,
          409,
        );
        assert.equal(
          (
            await api("/finance/accounts", "POST", {
              branch_id: empty,
              name: "Conta inativa",
              kind: "bank",
              opening_cents: 0,
              opening_on: new Date().toISOString().slice(0, 10),
            })
          ).status,
          409,
        );
        assert.equal(
          (
            await api("/repairs", "POST", {
              branch_id: empty,
              customer: { name: "Cliente teste", phone: "85999998888" },
              brand: "Marca",
              model: "Modelo",
              reported_fault: "Teste",
              physical_state: "Íntegro",
            })
          ).status,
          409,
        );
        assert.equal(
          (
            await api(
              "/branch-transfers",
              "POST",
              body([{ product_id: bulk, quantity: 1 }], source, empty),
            )
          ).status,
          409,
        );
        const today = new Date().toLocaleDateString("sv-SE", {
          timeZone: "America/Fortaleza",
        });
        assert.equal(
          (
            await ok(
              `/reports/overview?branch_id=${empty}&start=${today}&end=${today}`,
            )
          ).summary.turnover,
          0,
        );
        const customer = await ok("/crm/customers", "POST", {
          name: "Cliente filial encerrada",
          phone: "85999997777",
        });
        assert.equal(
          (
            await api(
              "/crm/customers/" + customer.id + "/interactions",
              "POST",
              {
                branch_id: empty,
                channel: "note",
                text: "Registro em filial encerrada por tela antiga",
              },
            )
          ).status,
          409,
        );
        r = await state(empty, true);
        assert.equal(r.status, 200);
        await move(bulk, empty, 1);
        assert.equal((await state(empty, false)).status, 409);
        await ok(
          "/branch-transfers",
          "POST",
          body([{ product_id: bulk, quantity: 1 }], empty, source),
        );
        assert.equal((await state(empty, false)).status, 200);
      },
    );
    await t.test(
      "filial com caixa ou funcionário principal não é encerrada",
      async () => {
        const target = await branch("Unidade com equipe");
        const person = await ok("/employees", "POST", {
          name: "Equipe encerramento",
          email: "branch-close@test.local",
          password,
          role: "viewer",
          branch_ids: [target],
        });
        assert.equal((await state(target, false)).status, 409);
        const e = await ok("/employees/" + person.employee_id),
          payload: any = {};
        for (const key of [
          "name",
          "job_title",
          "job_function",
          "employee_code",
          "point_external_id",
          "role",
          "active",
          "permission_grants",
          "permission_denials",
          "version",
        ])
          payload[key] = e[key];
        await ok("/employees/" + person.employee_id, "PUT", {
          ...payload,
          branch_ids: [source],
          home_branch_id: source,
          reason: "Reatribuição de filial de teste",
        });
        const session = (
          await ok(
            "/pos/open",
            "POST",
            { register_id: target, opening_cents: 0 },
            "a",
          )
        ).id;
        assert.equal((await state(target, false)).status, 409);
        await ok(
          "/pos/close",
          "POST",
          { session_id: session, counted_cents: 0 },
          "a",
        );
        assert.equal((await state(target, false)).status, 200);
      },
    );
    await t.test(
      "contas e títulos precisam ser resolvidos antes da inativação",
      async () => {
        const target = await branch("Unidade financeira"),
          today = new Date().toLocaleDateString("sv-SE", {
            timeZone: "America/Fortaleza",
          });
        const account = await ok("/finance/accounts", "POST", {
          branch_id: target,
          name: "Conta filial",
          kind: "bank",
          opening_cents: 0,
          opening_on: today,
        });
        assert.equal((await state(target, false)).status, 409);
        await ok("/finance/accounts/" + account.id, "POST", {
          version: 1,
          name: "Conta filial",
          active: false,
        });
        const title = await ok("/finance/titles", "POST", {
          branch_id: target,
          direction: "payable",
          description: "Conta filial teste",
          counterparty: "Contraparte teste",
          amount_cents: 1000,
          competence_on: today,
          due_on: today,
        });
        assert.equal((await state(target, false)).status, 409);
        await ok("/finance/titles/" + title.id + "/cancel", "POST", {
          version: 1,
          reason: "Cancelamento de teste antes do encerramento",
        });
        assert.equal((await state(target, false)).status, 200);
      },
    );
    await t.test(
      "concorrência entre inativação e entrada não permite estoque em filial encerrada",
      async () => {
        const target = await branch("Unidade concorrente"),
          v = (await detail(target)).branch.version;
        const r = await Promise.all([
          api(`/branches/${target}/state`, "POST", {
            version: v,
            active: false,
            reason: "Inativação concorrente teste",
          }),
          api("/movements", "POST", {
            product_id: bulk,
            branch_id: target,
            type: "entry",
            quantity: 1,
            reason: "Entrada concorrente teste",
          }),
        ]);
        assert.deepEqual(r.map((x) => x.status).sort(), [200, 409]);
        const d = await detail(target);
        assert.ok(d.branch.active || d.summary.stock_units === 0);
      },
    );
    await t.test(
      "registros de transferência são imutáveis e isolados na role de execução",
      async () => {
        await assert.rejects(() =>
          db.transaction(a.tenant.id, (tx) =>
            tx.query(
              "UPDATE stock_transfer_items SET quantity=999 RETURNING id",
            ),
          ),
        );
        await assert.rejects(() =>
          db.transaction(a.tenant.id, (tx) =>
            tx.query("DELETE FROM stock_transfers RETURNING id"),
          ),
        );
        assert.equal(
          (
            await db.transaction(b.tenant.id, (tx) =>
              tx.query("SELECT * FROM stock_transfers"),
            )
          ).length,
          0,
        );
        assert.equal((await ok("/branches?page=1000")).items.length, 0);
        assert.equal((await api("/branches?status=wrong")).status, 400);
      },
    );
  } finally {
    await app.close();
    await db.close();
  }
});

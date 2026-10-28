import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { Database } from "../src/server/db";
import { createApp } from "../src/server/app";
import { InventoryService } from "../src/server/domain";
import { distributeDiscount } from "../src/server/pos";
import { toCents } from "../src/shared/money";

test("cálculo exato de centavos e distribuição proporcional do desconto", () => {
  assert.equal(toCents("12,35"), 1235);
  assert.equal(toCents("0.01"), 1);
  assert.throws(() => toCents("1.005"));
  assert.throws(() => toCents("-1"));
  const values = [...Array(99).fill(100), 1];
  const d = distributeDiscount(9900, values);
  assert.equal(
    d.reduce((n, v) => n + v, 0),
    9900,
  );
  d.forEach((v, j) => assert.ok(v <= values[j]));
  assert.deepEqual(distributeDiscount(1, [1, 1, 1]), [1, 0, 0]);
});

test("atualiza banco do Módulo 1 sem apagar dados e aplica migrações uma única vez", async () => {
  const root = await mkdtemp(join(tmpdir(), "invictus-upgrade-"));
  const path = join(root, "db");
  let old: PGlite | undefined;
  let db: Database | undefined;
  try {
    old = new PGlite(path);
    await old.waitReady;
    await old.exec(
      await readFile(
        resolve("prisma/migrations/202610280001_foundation/migration.sql"),
        "utf8",
      ),
    );
    const tenant = randomUUID(),
      branch = randomUUID();
    await old.query(
      "INSERT INTO tenants(id,name,slug) VALUES($1,'Loja preservada',$2)",
      [tenant, tenant],
    );
    await old.query(
      "INSERT INTO branches(id,tenant_id,name) VALUES($1,$2,'Matriz')",
      [branch, tenant],
    );
    await old.close();
    old = undefined;
    db = new Database();
    await db.open(path);
    assert.equal(
      (await db.system<any>("SELECT name FROM tenants"))[0].name,
      "Loja preservada",
    );
    assert.equal(
      (await db.system<any>("SELECT count(*)::int AS n FROM pos_registers"))[0]
        .n,
      1,
    );
    await db.close();
    db = new Database();
    await db.open(path);
    assert.equal(
      (
        await db.system<any>(
          "SELECT count(*)::int AS n FROM _invictus_migrations",
        )
      )[0].n,
      3,
    );
    assert.equal(
      (await db.system<any>("SELECT count(*)::int AS n FROM pos_registers"))[0]
        .n,
      1,
    );
  } finally {
    await old?.close();
    await db?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("PDV: API, caixa físico, pagamentos, estoque e auditoria transacionais", async (t) => {
  const db = new Database();
  await db.open("memory://");
  const app = await createApp(db);
  await app.listen(0, "127.0.0.1");
  const base = await app.getUrl();
  const clients: Record<string, any> = {};
  const password = "POS-Testing-2026!";
  let a: any,
    b: any,
    session: string,
    laterSale: string,
    otherSession: string,
    cable: string,
    phone: string,
    unit: string,
    sale: string,
    cashierId: string;
  async function api(
    path: string,
    method = "GET",
    body?: unknown,
    who = "a",
    key = randomUUID(),
  ) {
    const c = clients[who];
    const res = await fetch(`${base}/api${path}`, {
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
      status: res.status,
      body: await res.json(),
      cookie: res.headers.get("set-cookie"),
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
  async function login(who: string) {
    const r = await ok(
      "/login",
      "POST",
      { email: `pos-${who}@test.local`, password },
      "none",
    );
    void r;
  }
  async function auth(who: string) {
    const r = await api(
      "/login",
      "POST",
      { email: `pos-${who}@test.local`, password },
      "none",
    );
    assert.equal(r.status, 200);
    clients[who] = { cookie: r.cookie!.split(";")[0] };
    const me = await ok("/me", "GET", undefined, who);
    clients[who].csrf = me.csrf;
    return me;
  }
  async function product(
    sku: string,
    value: number,
    quantity: number,
    serialized = false,
  ) {
    const p = await ok("/products", "POST", {
      name: sku,
      sku,
      condition: "new",
      serialized,
      cost: 1,
      price: value,
      warranty_days: 90,
    });
    if (!serialized)
      await ok("/movements", "POST", {
        product_id: p.id,
        branch_id: a.branches[0].id,
        type: "entry",
        quantity,
        reason: "Estoque para teste de PDV",
      });
    return p.id;
  }
  try {
    await t.test(
      "provisiona empresa, caixa principal e perfil de operador",
      async () => {
        for (const who of ["a", "b"])
          await ok(
            "/setup",
            "POST",
            {
              company: `PDV ${who}`,
              name: `Owner ${who}`,
              email: `pos-${who}@test.local`,
              password,
              branch: "Matriz",
            },
            "none",
          );
        a = await auth("a");
        b = await auth("b");
        const state = await ok(`/pos/state?branch_id=${a.branches[0].id}`);
        assert.equal(state.registers.length, 1);
        assert.equal(
          (
            await api(
              `/pos/state?branch_id=${a.branches[0].id}&register_id=${b.branches[0].id}`,
            )
          ).status,
          404,
        );
        assert.equal(state.session, null);
        const key = randomUUID();
        const body = { register_id: state.register_id, opening_cents: 10000 };
        const first = await ok("/pos/open", "POST", body, "a", key);
        session = first.id;
        assert.equal(
          (await ok("/pos/open", "POST", body, "a", key)).id,
          session,
        );
        assert.equal((await api("/pos/open", "POST", body)).status, 409);
        assert.equal((await api("/pos/open", "POST", body, "b")).status, 404);
        cashierId = (
          await ok("/users", "POST", {
            name: "Operador de teste",
            email: "pos-c@test.local",
            password,
            role: "cashier",
            branch_ids: [a.branches[0].id],
          })
        ).id;
        await auth("c");
        const other = await ok("/pos/registers", "POST", {
          branch_id: a.branches[0].id,
          name: "Caixa 2",
        });
        otherSession = (
          await ok(
            "/pos/open",
            "POST",
            { register_id: other.id, opening_cents: 0 },
            "c",
          )
        ).id;
        cable = await product("CABO-PDV", 25, 20);
        phone = await product("PHONE-PDV", 1500, 0, true);
        await ok("/movements", "POST", {
          product_id: phone,
          branch_id: a.branches[0].id,
          type: "entry",
          quantity: 1,
          reason: "Aparelho de teste",
          device: {
            imeis: ["490154203237518"],
            serial: "PDV-SERIAL",
            provenance: "Documento de teste",
            acquisition_cost: 1000,
          },
        });
        unit = (
          await ok(`/units?branch_id=${a.branches[0].id}&product_id=${phone}`)
        ).items[0].id;
      },
    );
    await t.test(
      "pagamentos mistos, desconto autorizado, troco e reenvio idempotente",
      async () => {
        const body = {
          session_id: session,
          items: [{ product_id: cable, quantity: 2 }],
          discount_cents: 1000,
          expected_total_cents: 4000,
          payments: [
            { method: "cash", amount_cents: 3000 },
            { method: "pix", amount_cents: 2000, reference: "PIX-MANUAL-001" },
          ],
        };
        const key = randomUUID();
        const [first, second] = await Promise.all([
          ok("/pos/sales", "POST", body, "a", key),
          ok("/pos/sales", "POST", body, "a", key),
        ]);
        sale = first.id;
        assert.equal(first.id, second.id);
        assert.equal(first.change_cents, 1000);
        const state = await ok(`/pos/state?branch_id=${a.branches[0].id}`);
        assert.equal(state.session.expected_cents, 12000);
        assert.equal(
          Number(
            state.totals.find((r: any) => r.method === "pix").amount_cents,
          ),
          2000,
        );
        const receipt = await ok(`/pos/sales/${sale}`);
        assert.equal(receipt.items[0].quantity, 2);
        assert.equal(
          receipt.payments.find((p: any) => p.method === "cash").amount_cents,
          2000,
        );
        assert.equal(receipt.sale.total_cents, 4000);
        assert.equal("unit_cost_cents" in receipt.items[0], false);
        assert.equal(
          (
            await api("/pos/sales", "POST", {
              ...body,
              expected_total_cents: 3999,
            })
          ).status,
          409,
        );
      },
    );
    await t.test(
      "caixa fechado, preço desatualizado, pagamento insuficiente e troco não monetário são rejeitados",
      async () => {
        const base = {
          session_id: session,
          items: [{ product_id: cable, quantity: 1 }],
          expected_total_cents: 2500,
          payments: [{ method: "cash", amount_cents: 1000 }],
        };
        assert.equal((await api("/pos/sales", "POST", base)).status, 400);
        assert.equal(
          (
            await api("/pos/sales", "POST", {
              ...base,
              expected_total_cents: 2000,
            })
          ).status,
          409,
        );
        assert.equal(
          (
            await api("/pos/sales", "POST", {
              ...base,
              payments: [
                { method: "pix", amount_cents: 3000, reference: "PIX" },
              ],
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await api("/pos/sales", "POST", {
              ...base,
              payments: [{ method: "debit", amount_cents: 2500 }],
            })
          ).status,
          400,
        );
        const list = await ok(
          `/products?branch_id=${a.branches[0].id}&q=CABO-PDV`,
        );
        assert.equal(list.items[0].quantity, 18);
      },
    );
    await t.test(
      "operador não altera catálogo, não dá desconto e só vende em seu caixa",
      async () => {
        const base = {
          session_id: otherSession,
          items: [{ product_id: cable, quantity: 1 }],
          expected_total_cents: 2500,
          payments: [{ method: "cash", amount_cents: 2500 }],
        };
        assert.equal(
          (
            await api(
              "/pos/sales",
              "POST",
              { ...base, discount_cents: 100, expected_total_cents: 2400 },
              "c",
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await api(
              "/pos/sales",
              "POST",
              { ...base, session_id: session },
              "c",
            )
          ).status,
          403,
        );
        await ok("/pos/sales", "POST", base, "c");
        assert.equal(
          (await api(`/pos/sales/${sale}`, "GET", undefined, "c")).status,
          403,
        );
        const history = await ok(
          `/pos/sales?branch_id=${a.branches[0].id}`,
          "GET",
          undefined,
          "c",
        );
        assert.equal(history.items.length, 1);
        assert.equal(history.items[0].operator_id, cashierId);
        const state = await ok(
          `/pos/state?branch_id=${a.branches[0].id}&register_id=${a.branches[0].id}`,
          "GET",
          undefined,
          "c",
        );
        assert.equal(state.occupied, true);
        assert.equal(state.session, null);
      },
    );
    await t.test(
      "devolução parcial usa desconto original e impede ressarcimento em excesso",
      async () => {
        const receipt = await ok(`/pos/sales/${sale}`);
        const item = receipt.items[0].id;
        const key = randomUUID();
        const body = {
          session_id: session,
          kind: "return",
          items: [{ sale_item_id: item, quantity: 1 }],
          payments: [
            { method: "cash", amount_cents: 1000 },
            { method: "pix", amount_cents: 1000, reference: "REFUND-01" },
          ],
          reason: "Devolução parcial autorizada",
        };
        const r = await ok(`/pos/sales/${sale}/return`, "POST", body, "a", key);
        assert.equal(r.total_cents, 2000);
        assert.equal(r.status, "partial_return");
        assert.equal(
          (await ok(`/pos/sales/${sale}/return`, "POST", body, "a", key)).id,
          r.id,
        );
        assert.equal(
          (
            await api(`/pos/sales/${sale}/return`, "POST", {
              ...body,
              items: [{ sale_item_id: item, quantity: 2 }],
            })
          ).status,
          409,
        );
        assert.equal(
          (
            await api(`/pos/sales/${sale}/return`, "POST", {
              ...body,
              payments: [{ method: "cash", amount_cents: 2001 }],
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await api(`/pos/sales/${sale}/return`, "POST", {
              ...body,
              kind: "cancel",
            })
          ).status,
          400,
        );
        await ok(`/pos/sales/${sale}/return`, "POST", body);
        const after = await ok(`/pos/sales/${sale}`);
        assert.equal(after.sale.status, "returned");
        assert.equal(after.items[0].returned_quantity, 2);
        assert.equal(
          (await api(`/pos/sales/${sale}/return`, "POST", body)).status,
          409,
        );
        const state = await ok(`/pos/state?branch_id=${a.branches[0].id}`);
        assert.equal(state.session.expected_cents, 10000);
      },
    );
    await t.test(
      "venda e cancelamento de IMEI preservam rastreabilidade e bloqueiam estorno pelo estoque",
      async () => {
        const r = await ok("/pos/sales", "POST", {
          session_id: session,
          items: [{ product_id: phone, quantity: 1, unit_id: unit }],
          expected_total_cents: 150000,
          payments: [
            { method: "pix", amount_cents: 150000, reference: "PIX-PHONE" },
          ],
        });
        const receipt = await ok(`/pos/sales/${r.id}`);
        assert.match(receipt.items[0].identifiers, /490154203237518/);
        const moves = await ok(
          `/movements?branch_id=${a.branches[0].id}&product_id=${phone}`,
        );
        const movement = moves.items.find((m: any) => m.sale_item_id);
        assert.equal(
          (
            await api(`/movements/${movement.id}/reverse`, "POST", {
              reason: "Tentativa de contornar PDV",
            })
          ).status,
          409,
        );
        assert.equal(
          (
            await api("/movements", "POST", {
              product_id: phone,
              branch_id: a.branches[0].id,
              type: "entry",
              quantity: 1,
              unit_id: unit,
              reason: "Reentrada fora do PDV",
            })
          ).status,
          409,
        );
        const body = {
          session_id: session,
          kind: "cancel",
          items: [{ sale_item_id: receipt.items[0].id, quantity: 1 }],
          payments: [
            { method: "pix", amount_cents: 150000, reference: "CANCEL-PHONE" },
          ],
          reason: "Cancelamento autorizado",
        };
        assert.equal(
          (await api(`/pos/sales/${r.id}/return`, "POST", body, "c")).status,
          403,
        );
        assert.equal(
          (await ok(`/pos/sales/${r.id}/return`, "POST", body)).status,
          "cancelled",
        );
        assert.equal(
          (await ok(`/units?branch_id=${a.branches[0].id}&product_id=${phone}`))
            .items[0].status,
          "in_stock",
        );
      },
    );
    await t.test(
      "duas vendas concorrentes não vendem a última unidade duas vezes",
      async () => {
        const last = await product("ULTIMA-UNIDADE", 10, 1);
        const body = {
          items: [{ product_id: last, quantity: 1 }],
          expected_total_cents: 1000,
          payments: [{ method: "cash", amount_cents: 1000 }],
        };
        const r = await Promise.all([
          api("/pos/sales", "POST", { ...body, session_id: session }),
          api("/pos/sales", "POST", { ...body, session_id: otherSession }, "c"),
        ]);
        assert.deepEqual(r.map((v) => v.status).sort(), [200, 409]);
        assert.equal(
          (await ok(`/products?branch_id=${a.branches[0].id}&q=ULTIMA-UNIDADE`))
            .items[0].quantity,
          0,
        );
      },
    );
    await t.test(
      "cartões não aumentam dinheiro físico e devoluções parciais preservam os centavos",
      async () => {
        const before = (await ok(`/pos/state?branch_id=${a.branches[0].id}`))
          .session.expected_cents;
        const cent = await product("CENTAVOS-PDV", 0.01, 3);
        const sold = await ok("/pos/sales", "POST", {
          session_id: session,
          items: [{ product_id: cent, quantity: 3 }],
          discount_cents: 1,
          expected_total_cents: 2,
          payments: [
            {
              method: "credit",
              amount_cents: 2,
              reference: "CREDITO-CENTAVOS",
            },
          ],
        });
        const line = (await ok(`/pos/sales/${sold.id}`)).items[0].id;
        for (const [index, value] of [0, 1, 1].entries()) {
          const r = await ok(`/pos/sales/${sold.id}/return`, "POST", {
            session_id: session,
            kind: "return",
            items: [{ sale_item_id: line, quantity: 1 }],
            payments: value
              ? [
                  {
                    method: "credit",
                    amount_cents: value,
                    reference: `ESTORNO-${index}`,
                  },
                ]
              : [],
            reason: "Devolução proporcional de centavos",
          });
          assert.equal(r.total_cents, value);
        }
        assert.equal(
          (await ok(`/pos/sales/${sold.id}`)).sale.status,
          "returned",
        );
        const debit = await product("DEBITO-PDV", 10, 1);
        laterSale = (
          await ok("/pos/sales", "POST", {
            session_id: session,
            items: [{ product_id: debit, quantity: 1 }],
            expected_total_cents: 1000,
            payments: [
              {
                method: "debit",
                amount_cents: 1000,
                reference: "DEBITO-CONFERIDO",
              },
            ],
          })
        ).id;
        assert.equal(
          (await ok(`/pos/state?branch_id=${a.branches[0].id}`)).session
            .expected_cents,
          before,
        );
      },
    );
    await t.test(
      "sangria, suprimento e fechamento com conferência e justificativa",
      async () => {
        await ok("/pos/cash", "POST", {
          session_id: session,
          type: "supply",
          amount_cents: 5000,
          reason: "Suprimento autorizado",
        });
        await ok("/pos/cash", "POST", {
          session_id: session,
          type: "withdrawal",
          amount_cents: 2000,
          reason: "Sangria autorizada",
        });
        assert.equal(
          (
            await api("/pos/cash", "POST", {
              session_id: session,
              type: "withdrawal",
              amount_cents: 99999999,
              reason: "Acima do caixa",
            })
          ).status,
          409,
        );
        const expected = (await ok(`/pos/state?branch_id=${a.branches[0].id}`))
          .session.expected_cents;
        assert.equal(
          (
            await api("/pos/close", "POST", {
              session_id: session,
              counted_cents: expected - 100,
            })
          ).status,
          400,
        );
        const key = randomUUID(),
          body = {
            session_id: session,
            counted_cents: expected - 100,
            note: "Diferença apurada na conferência",
          };
        const r = await ok("/pos/close", "POST", body, "a", key);
        assert.equal(r.difference_cents, -100);
        assert.equal(
          (await ok("/pos/close", "POST", body, "a", key)).id,
          session,
        );
        assert.equal(
          (
            await api("/pos/sales", "POST", {
              session_id: session,
              items: [{ product_id: cable, quantity: 1 }],
              expected_total_cents: 2500,
              payments: [{ method: "cash", amount_cents: 2500 }],
            })
          ).status,
          409,
        );
      },
    );
    await t.test(
      "devolve venda de sessão fechada em uma nova sessão própria da mesma filial",
      async () => {
        const r = await ok(`/pos/sales/${laterSale}`);
        const s = await ok("/pos/open", "POST", {
          register_id: a.branches[0].id,
          opening_cents: 0,
        });
        const returned = await ok(`/pos/sales/${laterSale}/return`, "POST", {
          session_id: s.id,
          kind: "return",
          items: [{ sale_item_id: r.items[0].id, quantity: 1 }],
          payments: [
            {
              method: "debit",
              amount_cents: 1000,
              reference: "DEVOLUCAO-NOVA-SESSAO",
            },
          ],
          reason: "Devolução após fechamento original",
        });
        assert.equal(returned.status, "returned");
        const state = await ok(`/pos/state?branch_id=${a.branches[0].id}`);
        assert.equal(state.session.expected_cents, 0);
        assert.equal(
          Number(
            state.totals.find((x: any) => x.method === "debit").amount_cents,
          ),
          -1000,
        );
      },
    );
    await t.test(
      "relatórios, isolamento e imutabilidade dos pagamentos e caixa",
      async () => {
        const report = await ok(`/pos/report?branch_id=${a.branches[0].id}`);
        assert.equal(report.operators.length, 2);
        assert.ok(
          report.sessions.some(
            (s: any) =>
              s.status === "closed" && Number(s.difference_cents) === -100,
          ),
        );
        const own = await ok(
          `/pos/report?branch_id=${a.branches[0].id}`,
          "GET",
          undefined,
          "c",
        );
        assert.equal(own.operators.length, 1);
        assert.equal(own.operators[0].id, cashierId);
        assert.equal(
          (await api(`/pos/sales/${sale}`, "GET", undefined, "b")).status,
          404,
        );
        assert.equal(
          (
            await api(
              `/pos/report?branch_id=${a.branches[0].id}`,
              "GET",
              undefined,
              "b",
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await db.transaction(b.tenant.id, (tx) =>
              tx.query("SELECT * FROM pos_sales"),
            )
          ).length,
          0,
        );
        await assert.rejects(
          db.transaction(a.tenant.id, (tx) =>
            tx.query(
              "UPDATE pos_sale_payments SET amount_cents=0 RETURNING id",
            ),
          ),
        );
        await assert.rejects(
          db.transaction(a.tenant.id, (tx) =>
            tx.query("DELETE FROM cash_entries RETURNING id"),
          ),
        );
        const events = await ok("/audit");
        assert.ok(
          events.items.some((e: any) => e.action === "pos.sale.completed"),
        );
        assert.ok(
          events.items.some((e: any) => e.action === "pos.cash.closed"),
        );
      },
    );
  } finally {
    await app.close();
    await db.close();
  }
});

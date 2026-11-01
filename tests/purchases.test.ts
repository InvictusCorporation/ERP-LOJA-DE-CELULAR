import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Database } from "../src/server/db";
import { createApp } from "../src/server/app";

test("Compras: fornecedores, pedidos, recebimentos, estoque e contas a pagar", async (t) => {
  const db = new Database();
  await db.open("memory://");
  const app = await createApp(db);
  await app.listen(0, "127.0.0.1");
  const base = await app.getUrl(),
    clients: Record<string, any> = {},
    password = "Purchases-Testing-2026!",
    day = new Date().toLocaleDateString("sv-SE", {
      timeZone: "America/Fortaleza",
    });
  let me: any,
    branch: string,
    branch2: string,
    supplier: string,
    otherSupplier: string,
    product: string,
    phone: string,
    order: string,
    plainLine: string,
    phoneLine: string,
    receipt1: string,
    title1: string,
    receipt2: string,
    receipt3: string,
    bank: string;
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
      { email: `purchases-${who}@test.local`, password },
      "none",
    );
    assert.equal(r.status, 200);
    clients[who] = { cookie: r.cookie!.split(";")[0] };
    const m = await ok("/me", "GET", undefined, who);
    clients[who].csrf = m.csrf;
    return m;
  }
  const detail = () => ok("/purchases/orders/" + order),
    v = async () => (await detail()).order.version;
  const stock = async (id = product) =>
    Number(
      (await ok(`/products?branch_id=${branch}`)).items.find(
        (p: any) => p.id === id,
      ).quantity,
    );
  const report = () =>
    ok(`/finance/reports?branch_id=all&start=${day.slice(0, 7)}-01&end=${day}`);
  const receipt = (ref: string, quantity = 4) => ({
    version: 0,
    reference: ref,
    due_on: day,
    update_cost: true,
    expected_total_cents: quantity * 1000,
    lines: [{ order_line_id: plainLine, quantity }],
  });
  try {
    await t.test(
      "prepara empresas e reutiliza fornecedores do catálogo",
      async () => {
        for (const who of ["a", "b"])
          await ok(
            "/setup",
            "POST",
            {
              company: "Compras " + who,
              name: "Gestor " + who,
              branch: "Matriz",
              email: `purchases-${who}@test.local`,
              password,
            },
            "none",
          );
        me = await auth("a");
        await auth("b");
        branch = me.branches[0].id;
        branch2 = (await ok("/branches", "POST", { name: "Filial restrita" }))
          .id;
        me = await auth("a");
        await ok("/users", "POST", {
          name: "Caixa teste",
          email: "purchases-cash@test.local",
          password,
          role: "cashier",
          branch_ids: [branch],
        });
        await auth("cash");
        await ok("/users", "POST", {
          name: "Gerente limitado",
          email: "purchases-manager@test.local",
          password,
          role: "manager",
          branch_ids: [branch],
        });
        await auth("manager");
        supplier = (
          await ok("/catalog", "POST", {
            kind: "supplier",
            name: "Fornecedor compartilhado",
            contact: "Contato existente",
          })
        ).id;
        const s = (await ok(`/purchases/suppliers/${supplier}?branch_id=all`))
          .supplier;
        assert.equal(s.version, 0);
        await ok(`/purchases/suppliers/${supplier}`, "POST", {
          ...{
            name: s.name,
            contact: s.contact,
            document: "DOC-TESTE",
            email: "fornecedor@test.local",
            phone: "85999990000",
            address: "Endereço de teste",
            notes: "Cadastro de teste",
            active: true,
            version: 0,
          },
        });
        assert.equal((await ok("/purchases/suppliers")).items.length, 1);
        assert.equal(
          (await ok("/catalog")).items.filter((s: any) => s.kind === "supplier")
            .length,
          1,
        );
        otherSupplier = (
          await ok(
            "/purchases/suppliers",
            "POST",
            { name: "Outro fornecedor", contact: "", active: true, version: 0 },
            "b",
          )
        ).id;
      },
    );
    await t.test(
      "protege permissões, empresa, filial e versão do fornecedor",
      async () => {
        assert.equal(
          (await api("/purchases/suppliers", "GET", undefined, "cash")).status,
          403,
        );
        assert.equal(
          (await api(`/purchases/suppliers/${otherSupplier}?branch_id=all`))
            .status,
          404,
        );
        const body = {
          name: "Fornecedor compartilhado",
          contact: "",
          active: true,
          version: 0,
        };
        assert.equal(
          (await api("/purchases/suppliers/" + supplier, "POST", body)).status,
          409,
        );
        assert.equal(
          (
            await api(
              `/purchases/orders?branch_id=${branch2}`,
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
      "rascunho não altera estoque ou financeiro e permite revisão",
      async () => {
        product = (
          await ok("/products", "POST", {
            name: "Produto livre de compra",
            sku: "PUR-PLAIN",
            condition: "new",
            serialized: false,
            cost: 5,
            price: 20,
            warranty_days: 90,
          })
        ).id;
        phone = (
          await ok("/products", "POST", {
            name: "Produto individual de compra",
            sku: "PUR-UNIT",
            condition: "new",
            serialized: true,
            cost: 250,
            price: 700,
            warranty_days: 90,
          })
        ).id;
        const body = {
          branch_id: branch,
          supplier_id: supplier,
          lines: [
            { product_id: product, quantity: 10, unit_cost_cents: 1000 },
            { product_id: phone, quantity: 2, unit_cost_cents: 50000 },
          ],
          note: "Pedido de teste",
          expected_on: day,
        };
        assert.equal(
          (
            await api("/purchases/orders", "POST", {
              ...body,
              supplier_id: otherSupplier,
            })
          ).status,
          404,
        );
        assert.equal(
          (
            await api("/purchases/orders", "POST", {
              ...body,
              lines: [body.lines[0], body.lines[0]],
            })
          ).status,
          400,
        );
        const key = randomUUID();
        order = (await ok("/purchases/orders", "POST", body, "a", key)).id;
        assert.equal(
          (await ok("/purchases/orders", "POST", body, "a", key)).id,
          order,
        );
        await ok("/purchases/orders/" + order, "POST", {
          ...body,
          version: await v(),
          note: "Revisado antes de confirmar",
        });
        assert.equal(await stock(), 0);
        assert.equal(Number((await report()).outstanding.payable), 0);
        assert.equal(
          (await api("/purchases/orders/" + order, "GET", undefined, "b"))
            .status,
          404,
        );
      },
    );
    await t.test(
      "confirma pedido sem criar recebimento ou pagamento fictício",
      async () => {
        const key = randomUUID(),
          body = { version: await v() };
        await ok(`/purchases/orders/${order}/issue`, "POST", body, "a", key);
        await ok(`/purchases/orders/${order}/issue`, "POST", body, "a", key);
        const d = await detail();
        assert.equal(d.order.status, "ordered");
        assert.equal(d.order.total_cents, 110000);
        plainLine = d.lines.find((x: any) => x.product_id === product).id;
        phoneLine = d.lines.find((x: any) => x.product_id === phone).id;
        assert.equal(d.supplier.name, "Fornecedor compartilhado");
        assert.equal(d.receipts.length, 0);
        assert.equal(await stock(), 0);
        assert.equal(
          (
            await api(`/purchases/orders/${order}/issue`, "POST", {
              version: await v(),
            })
          ).status,
          409,
        );
      },
    );
    await t.test(
      "recebimento parcial cria estoque e um único título patrimonial",
      async () => {
        const body = { ...receipt("ENTREGA-001"), version: await v() },
          key = randomUUID();
        const r = await ok(
          `/purchases/orders/${order}/receive`,
          "POST",
          body,
          "a",
          key,
        );
        receipt1 = r.id;
        title1 = r.title_id;
        assert.equal(
          (
            await ok(
              `/purchases/orders/${order}/receive`,
              "POST",
              body,
              "a",
              key,
            )
          ).id,
          receipt1,
        );
        assert.equal(await stock(), 4);
        const d = await detail();
        assert.equal(d.order.status, "partial");
        assert.equal(d.receipts.length, 1);
        const title = (await ok("/finance/titles/" + title1)).title;
        assert.equal(title.direction, "payable");
        assert.equal(title.source_kind, "purchase");
        assert.equal(title.affects_result, false);
        assert.equal(title.amount_cents, 4000);
        assert.equal(Number((await report()).outstanding.payable), 4000);
        assert.equal((await report()).result.expenses, 0);
        const p = (await ok(`/products?branch_id=${branch}`)).items.find(
          (x: any) => x.id === product,
        );
        assert.equal(Number(p.cost), 10);
        const [movement] = await db.system<any>(
          "SELECT id FROM stock_movements WHERE purchase_receipt_line_id IS NOT NULL LIMIT 1",
        );
        assert.equal(
          (
            await api("/movements/" + movement.id + "/reverse", "POST", {
              reason: "Tentativa de desvio do módulo",
            })
          ).status,
          409,
        );
      },
    );
    await t.test(
      "concorrência, referência repetida e excesso não duplicam estoque nem débito",
      async () => {
        const current = await v();
        const result = await Promise.all(
          ["ENTREGA-002-A", "ENTREGA-002-B"].map((reference) =>
            api(`/purchases/orders/${order}/receive`, "POST", {
              ...receipt(reference),
              version: current,
            }),
          ),
        );
        assert.deepEqual(result.map((r) => r.status).sort(), [200, 409]);
        receipt2 = result.find((r) => r.status === 200)!.body.id;
        assert.equal(await stock(), 8);
        assert.equal(
          (
            await api(`/purchases/orders/${order}/receive`, "POST", {
              ...receipt("EXCESSO", 3),
              version: await v(),
            })
          ).status,
          409,
        );
        assert.equal(
          (
            await api(`/purchases/orders/${order}/receive`, "POST", {
              ...receipt("ENTREGA-001", 1),
              version: await v(),
            })
          ).status,
          409,
        );
        assert.equal(await stock(), 8);
      },
    );
    await t.test(
      "identificações inválidas ou repetidas desfazem todo o recebimento",
      async () => {
        const baseBody = {
          version: await v(),
          reference: "UNIDADES-INVALIDAS",
          due_on: day,
          expected_total_cents: 100000,
          lines: [
            {
              order_line_id: phoneLine,
              quantity: 2,
              devices: [
                {
                  serial: "SERIE-IGUAL",
                  imeis: [],
                  provenance: "Compra de teste",
                },
                {
                  serial: "SERIE-IGUAL",
                  imeis: [],
                  provenance: "Compra de teste",
                },
              ],
            },
          ],
        };
        assert.equal(
          (await api(`/purchases/orders/${order}/receive`, "POST", baseBody))
            .status,
          409,
        );
        assert.equal(await stock(phone), 0);
        const malformed = {
          ...baseBody,
          reference: "IMEI-INVALIDO",
          expected_total_cents: 50000,
          lines: [
            {
              order_line_id: phoneLine,
              quantity: 1,
              devices: [
                {
                  serial: "",
                  imeis: ["123456789012345"],
                  provenance: "Compra de teste",
                },
              ],
            },
          ],
        };
        assert.equal(
          (await api(`/purchases/orders/${order}/receive`, "POST", malformed))
            .status,
          400,
        );
        assert.equal(await stock(phone), 0);
      },
    );
    await t.test(
      "conferência mista registra procedência, IMEI, custo e saldo exato",
      async () => {
        const r = await ok(`/purchases/orders/${order}/receive`, "POST", {
          version: await v(),
          reference: "ENTREGA-003",
          due_on: day,
          expected_total_cents: 52000,
          update_cost: true,
          lines: [
            { order_line_id: plainLine, quantity: 2 },
            {
              order_line_id: phoneLine,
              quantity: 1,
              devices: [
                {
                  serial: "SERIE-PUR-001",
                  imeis: ["490154203237518"],
                  provenance: "Nota de compra teste ENTREGA-003",
                },
              ],
            },
          ],
        });
        receipt3 = r.id;
        assert.equal(await stock(), 10);
        assert.equal(await stock(phone), 1);
        const units = (
          await ok(`/units?branch_id=${branch}&product_id=${phone}`)
        ).items;
        assert.equal(Number(units[0].acquisition_cost), 500);
        assert.equal(units[0].imeis[0], "490154203237518");
        assert.equal((await detail()).order.status, "partial");
        assert.equal(Number((await report()).outstanding.payable), 60000);
        assert.equal((await report()).result.expenses, 0);
      },
    );
    await t.test(
      "cancelar saldo pendente preserva recebimentos e suas contas a pagar",
      async () => {
        await ok(`/purchases/orders/${order}/cancel`, "POST", {
          version: await v(),
          reason: "Fornecedor não entregará a unidade restante",
        });
        assert.equal((await detail()).order.status, "cancelled");
        assert.equal(
          (
            await api(`/purchases/orders/${order}/receive`, "POST", {
              ...receipt("APOS-CANCELAMENTO", 1),
              version: await v(),
            })
          ).status,
          409,
        );
        assert.equal(Number((await report()).outstanding.payable), 60000);
      },
    );
    await t.test(
      "pagamento usa o financeiro sem duplicar despesa e bloqueia estorno do recebimento",
      async () => {
        bank = (
          await ok("/finance/accounts", "POST", {
            branch_id: branch,
            name: "Banco de teste de compras",
            kind: "bank",
            opening_cents: 100000,
            opening_on: day,
          })
        ).id;
        const title = await ok("/finance/titles/" + title1);
        const pay = await ok(`/finance/titles/${title1}/settle`, "POST", {
          version: title.title.version,
          account_id: bank,
          amount_cents: 4000,
          posted_on: day,
          reference: "PAGAMENTO-FORNECEDOR-001",
        });
        assert.equal(
          (
            await api(
              `/purchases/orders/${order}/receipts/${receipt1}/reverse`,
              "POST",
              {
                version: await v(),
                reason: "Correção antes de estornar o pagamento",
              },
            )
          ).status,
          409,
        );
        assert.equal((await report()).result.expenses, 0);
        const now = await ok("/finance/titles/" + title1);
        await ok(`/finance/settlements/${pay.id}/reverse`, "POST", {
          version: now.title.version,
          posted_on: day,
          reason: "Pagamento equivocado de teste",
        });
      },
    );
    await t.test(
      "estorno de recebimento compensa estoque e cancela somente seu título",
      async () => {
        const key = randomUUID(),
          body = {
            version: await v(),
            reason: "Correção documentada da primeira entrega",
          };
        await ok(
          `/purchases/orders/${order}/receipts/${receipt1}/reverse`,
          "POST",
          body,
          "a",
          key,
        );
        await ok(
          `/purchases/orders/${order}/receipts/${receipt1}/reverse`,
          "POST",
          body,
          "a",
          key,
        );
        assert.equal(await stock(), 6);
        assert.equal(
          (await ok("/finance/titles/" + title1)).title.cancelled,
          true,
        );
        assert.equal(Number((await report()).outstanding.payable), 56000);
        assert.equal((await detail()).order.status, "cancelled");
        assert.equal(
          (await detail()).receipts.find((r: any) => r.id === receipt1)
            .reversed,
          true,
        );
      },
    );
    await t.test(
      "recebimento com aparelho já movimentado não pode ser estornado parcialmente",
      async () => {
        const unit = (
          await ok(`/units?branch_id=${branch}&product_id=${phone}`)
        ).items[0];
        await ok("/movements", "POST", {
          branch_id: branch,
          product_id: phone,
          type: "exit",
          quantity: 1,
          unit_id: unit.id,
          reason: "Saída posterior para testar bloqueio",
        });
        assert.equal(
          (
            await api(
              `/purchases/orders/${order}/receipts/${receipt3}/reverse`,
              "POST",
              {
                version: await v(),
                reason: "Estorno bloqueado por unidade movimentada",
              },
            )
          ).status,
          409,
        );
        assert.equal(await stock(), 6);
        assert.equal(Number((await report()).outstanding.payable), 56000);
      },
    );
    await t.test(
      "entrega integral conclui pedido e estorno reabre somente o saldo recebido",
      async () => {
        const second = (
          await ok("/purchases/orders", "POST", {
            branch_id: branch,
            supplier_id: supplier,
            lines: [
              { product_id: product, quantity: 3, unit_cost_cents: 2000 },
            ],
          })
        ).id;
        await ok(`/purchases/orders/${second}/issue`, "POST", { version: 1 });
        let d = await ok("/purchases/orders/" + second);
        const r = await ok(`/purchases/orders/${second}/receive`, "POST", {
          version: d.order.version,
          reference: "ENTREGA-INTEGRAL",
          due_on: day,
          expected_total_cents: 6000,
          lines: [{ order_line_id: d.lines[0].id, quantity: 3 }],
        });
        d = await ok("/purchases/orders/" + second);
        assert.equal(d.order.status, "received");
        const snapshot = await ok(
          `/purchases/orders/${second}/receipts/${r.id}`,
        );
        assert.equal(snapshot.lines[0].quantity, 3);
        assert.equal(snapshot.receipt.total_cents, 6000);
        await ok(
          `/purchases/orders/${second}/receipts/${r.id}/reverse`,
          "POST",
          { version: d.order.version, reason: "Correção integral de teste" },
        );
        d = await ok("/purchases/orders/" + second);
        assert.equal(d.order.status, "ordered");
        assert.equal(d.lines[0].received_quantity, 0);
        assert.equal(Number((await report()).outstanding.payable), 56000);
      },
    );
    await t.test(
      "rascunho cancelado conserva fornecedor e itens no histórico",
      async () => {
        const r = await ok("/purchases/orders", "POST", {
          branch_id: branch,
          supplier_id: supplier,
          lines: [{ product_id: product, quantity: 1, unit_cost_cents: 1000 }],
        });
        await ok(`/purchases/orders/${r.id}/cancel`, "POST", {
          version: 1,
          reason: "Cancelamento de rascunho de teste",
        });
        const d = await ok("/purchases/orders/" + r.id);
        assert.equal(d.order.status, "cancelled");
        assert.equal(d.supplier.id, supplier);
        assert.equal(d.lines.length, 1);
        assert.equal(d.lines[0].quantity, 1);
        assert.equal(d.receipts.length, 0);
      },
    );
    await t.test(
      "recebimentos, linhas confirmadas e eventos são imutáveis e isolados",
      async () => {
        for (const table of [
          "purchase_order_lines",
          "purchase_receipts",
          "purchase_receipt_lines",
          "purchase_receipt_units",
          "purchase_receipt_reversals",
          "purchase_events",
        ])
          await assert.rejects(
            db.transaction(me.tenant.id, (tx) =>
              tx.query(`DELETE FROM ${table}`),
            ),
            /permission denied/i,
          );
        const b = await ok("/me", "GET", undefined, "b");
        assert.equal(
          (
            await db.transaction(b.tenant.id, (tx) =>
              tx.query("SELECT * FROM purchase_orders"),
            )
          ).length,
          0,
        );
        assert.equal(
          (await ok(`/purchases/suppliers/${supplier}?branch_id=all`)).orders
            .length,
          3,
        );
      },
    );
  } finally {
    await app.close();
    await db.close();
  }
});

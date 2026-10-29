import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Database } from "../src/server/db";
import { createApp } from "../src/server/app";
const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Fortaleza",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
test("Financeiro: competência, baixas, fontes, conciliação, isolamento e integridade", async (t) => {
  const db = new Database();
  await db.open("memory://");
  const app = await createApp(db);
  await app.listen(0, "127.0.0.1");
  const base = await app.getUrl();
  const clients: Record<string, any> = {};
  const password = "Finance-Testing-2026!";
  const date = today(),
    start = date.slice(0, 7) + "-01";
  let mainBranch: string,
    a: any,
    b: any,
    cash: string,
    bank: string,
    foreignAccount: string,
    otherAccount: string,
    branch2: string,
    center: string,
    payable: string,
    receivable: string,
    s1: string,
    s2: string,
    entry1: string,
    rec: string,
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
      { email: `finance-${who}@test.local`, password },
      "none",
    );
    assert.equal(r.status, 200);
    clients[who] = { cookie: r.cookie!.split(";")[0] };
    const me = await ok("/me", "GET", undefined, who);
    clients[who].csrf = me.csrf;
    return me;
  }
  const config = () => ok("/finance/config?branch_id=all");
  const reports = (branch = "all") =>
    ok(`/finance/reports?branch_id=${branch}&start=${start}&end=${date}`);
  const title = (id: string) => ok("/finance/titles/" + id);
  const v = async (id: string) => (await title(id)).title.version;
  const balance = async (id: string) =>
    Number(
      (await config()).accounts.find((a: any) => a.id === id).balance_cents,
    );
  const entries = () =>
    ok(`/finance/entries?branch_id=all&start=${start}&end=${date}`);
  const titleBody = (
    direction = "payable",
    extra: Record<string, unknown> = {},
  ) => ({
    branch_id: mainBranch,
    direction,
    description: "Título financeiro de teste",
    counterparty: "Contraparte de teste",
    amount_cents: 10000,
    competence_on: date,
    due_on: date,
    center_id: center,
    ...extra,
  });
  try {
    await t.test(
      "prepara filiais, perfis, contas e centro sem efeito na DRE",
      async () => {
        for (const who of ["a", "b"])
          await ok(
            "/setup",
            "POST",
            {
              company: `Financeiro ${who}`,
              name: `Gestor ${who}`,
              branch: "Matriz",
              email: `finance-${who}@test.local`,
              password,
            },
            "none",
          );
        a = await auth("a");
        mainBranch = mainBranch || a.branches[0].id;
        b = await auth("b");
        branch2 = (await ok("/branches", "POST", { name: "Filial financeira" }))
          .id;
        for (const [who, role] of [
          ["cashier", "cashier"],
          ["tech", "technician"],
          ["manager", "manager"],
        ]) {
          await ok("/users", "POST", {
            name: who,
            email: `finance-${who}@test.local`,
            password,
            role,
            branch_ids: [mainBranch],
          });
          await auth(who);
        }
        a = await auth("a");
        mainBranch = mainBranch || a.branches[0].id;
        const body = {
          branch_id: mainBranch,
          name: "Caixa financeiro",
          kind: "cash",
          opening_cents: 10000,
          opening_on: date,
        };
        const key = randomUUID();
        cash = (await ok("/finance/accounts", "POST", body, "a", key)).id;
        assert.equal(
          (await ok("/finance/accounts", "POST", body, "a", key)).id,
          cash,
        );
        bank = (
          await ok("/finance/accounts", "POST", {
            ...body,
            name: "Banco financeiro",
            kind: "bank",
            opening_cents: 0,
          })
        ).id;
        otherAccount = (
          await ok("/finance/accounts", "POST", {
            ...body,
            branch_id: branch2,
            name: "Conta filial",
            opening_cents: 0,
          })
        ).id;
        foreignAccount = (
          await ok(
            "/finance/accounts",
            "POST",
            { ...body, branch_id: b.branches[0].id, name: "Outra empresa" },
            "b",
          )
        ).id;
        center = (
          await ok("/finance/centers", "POST", { name: "Operação loja" })
        ).id;
        assert.equal(await balance(cash), 10000);
        assert.equal((await reports()).result.result, 0);
      },
    );
    await t.test(
      "nega acesso indevido, cruzamento de empresa/filial e datas inválidas",
      async () => {
        for (const who of ["cashier", "tech"])
          assert.equal(
            (await api("/finance/config?branch_id=all", "GET", undefined, who))
              .status,
            403,
          );
        assert.equal(
          (
            await api(
              `/finance/config?branch_id=${branch2}`,
              "GET",
              undefined,
              "manager",
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await api(
              "/finance/titles",
              "POST",
              titleBody("payable", { center_id: randomUUID() }),
            )
          ).status,
          400,
        );
        assert.equal(
          (
            await api("/finance/accounts", "POST", {
              branch_id: mainBranch,
              name: "Inválida",
              kind: "bank",
              opening_on: "0000-01-01",
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await api(
              `/finance/reports?branch_id=all&start=2020-01-01&end=${date}`,
            )
          ).status,
          400,
        );
      },
    );
    await t.test(
      "títulos por competência não duplicam resultados ao baixar",
      async () => {
        const body = titleBody();
        const key = randomUUID();
        payable = (await ok("/finance/titles", "POST", body, "a", key)).id;
        assert.equal(
          (await ok("/finance/titles", "POST", body, "a", key)).id,
          payable,
        );
        receivable = (
          await ok(
            "/finance/titles",
            "POST",
            titleBody("receivable", {
              description: "Receita de teste",
              amount_cents: 20000,
            }),
          )
        ).id;
        const r = await reports();
        assert.equal(r.result.manual_income, 20000);
        assert.equal(r.result.expenses, 10000);
        assert.equal(r.result.result, 10000);
        assert.equal(Number(r.outstanding.payable), 10000);
        assert.equal(
          (await api(`/finance/titles/${payable}`, "GET", undefined, "b"))
            .status,
          404,
        );
      },
    );
    await t.test(
      "baixa parcial idempotente, versão e concorrência impedem pagamento em excesso",
      async () => {
        const body = {
          version: await v(payable),
          account_id: cash,
          amount_cents: 4000,
          posted_on: date,
          reference: "PAG-4000",
        };
        const key = randomUUID();
        const r = await ok(
          `/finance/titles/${payable}/settle`,
          "POST",
          body,
          "a",
          key,
        );
        s1 = r.id;
        entry1 = r.entry_id;
        assert.equal(
          (
            await ok(
              `/finance/titles/${payable}/settle`,
              "POST",
              body,
              "a",
              key,
            )
          ).id,
          s1,
        );
        assert.equal(
          (await api(`/finance/titles/${payable}/settle`, "POST", body)).status,
          409,
        );
        assert.equal(
          (
            await api(`/finance/titles/${payable}/settle`, "POST", {
              ...body,
              version: await v(payable),
              amount_cents: 7000,
            })
          ).status,
          409,
        );
        const next = {
          ...body,
          version: await v(payable),
          amount_cents: 6000,
          reference: "SALDO-6000",
        };
        const results = await Promise.all([
          api(`/finance/titles/${payable}/settle`, "POST", next),
          api(`/finance/titles/${payable}/settle`, "POST", next),
        ]);
        assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
        s2 = results.find((r) => r.status === 200)!.body.id;
        assert.equal((await title(payable)).title.paid_cents, 10000);
        assert.equal(await balance(cash), 0);
        assert.equal((await reports()).result.result, 10000);
      },
    );
    await t.test(
      "conciliação confere valor e conta; desfazer preserva trilha e libera estorno",
      async () => {
        const body = {
          account_id: cash,
          statement_on: date,
          reference: "EXTRATO-4000",
          confirmed_amount_cents: -4000,
          confirmed: true,
        };
        assert.equal(
          (
            await api(`/finance/entries/${entry1}/reconcile`, "POST", {
              ...body,
              confirmed_amount_cents: -3999,
            })
          ).status,
          409,
        );
        assert.equal(
          (
            await api(`/finance/entries/${entry1}/reconcile`, "POST", {
              ...body,
              account_id: foreignAccount,
            })
          ).status,
          404,
        );
        const key = randomUUID();
        rec = (
          await ok(
            `/finance/entries/${entry1}/reconcile`,
            "POST",
            body,
            "a",
            key,
          )
        ).id;
        assert.equal(
          (
            await ok(
              `/finance/entries/${entry1}/reconcile`,
              "POST",
              body,
              "a",
              key,
            )
          ).id,
          rec,
        );
        assert.equal(
          (
            await api(`/finance/settlements/${s1}/reverse`, "POST", {
              version: await v(payable),
              posted_on: date,
              reason: "Reversão bloqueada",
            })
          ).status,
          409,
        );
        await ok(`/finance/reconciliations/${rec}/undo`, "POST", {
          reason: "Conferência refeita",
        });
        await ok(`/finance/settlements/${s1}/reverse`, "POST", {
          version: await v(payable),
          posted_on: date,
          reason: "Pagamento lançado em duplicidade fora do ERP",
        });
        assert.equal((await title(payable)).title.paid_cents, 6000);
        assert.equal(await balance(cash), 4000);
        assert.equal(
          (await ok(`/finance/entries/${entry1}`)).reconciliations[0]
            .voided_at !== null,
          true,
        );
      },
    );
    await t.test(
      "cancelamento exige reversão completa e mantém o registro original",
      async () => {
        assert.equal(
          (
            await api(`/finance/titles/${payable}/cancel`, "POST", {
              version: await v(payable),
              reason: "Ainda possui baixa",
            })
          ).status,
          409,
        );
        await ok(`/finance/settlements/${s2}/reverse`, "POST", {
          version: await v(payable),
          posted_on: date,
          reason: "Correção de teste",
        });
        await ok(`/finance/titles/${payable}/cancel`, "POST", {
          version: await v(payable),
          reason: "Título duplicado",
        });
        assert.equal((await title(payable)).title.cancelled, true);
        assert.equal(await balance(cash), 10000);
        assert.equal((await reports()).result.expenses, 0);
      },
    );
    await t.test(
      "recebimento, transferência e ajuste afetam saldo sem repetir receita na DRE",
      async () => {
        await ok(`/finance/titles/${receivable}/settle`, "POST", {
          version: await v(receivable),
          account_id: bank,
          amount_cents: 5000,
          posted_on: date,
          reference: "REC-5000",
        });
        const body = {
          from_id: bank,
          to_id: cash,
          amount_cents: 1000,
          posted_on: date,
          reason: "Transferência patrimonial",
        };
        const key = randomUUID();
        await ok("/finance/transfers", "POST", body, "a", key);
        await ok("/finance/transfers", "POST", body, "a", key);
        assert.equal(await balance(bank), 4000);
        assert.equal(await balance(cash), 11000);
        await ok(`/finance/accounts/${bank}/adjust`, "POST", {
          amount_cents: -500,
          posted_on: date,
          reason: "Correção do saldo inicial",
        });
        assert.equal(await balance(bank), 3500);
        assert.equal((await reports()).result.manual_income, 20000);
        assert.equal(
          (
            await api("/finance/transfers", "POST", {
              ...body,
              to_id: foreignAccount,
            })
          ).status,
          404,
        );
      },
    );
    await t.test(
      "PDV gera recebimentos uma única vez, sem atribuição presumida de conta",
      async () => {
        part = (
          await ok("/products", "POST", {
            name: "Produto financeiro",
            sku: "FIN-PROD",
            condition: "new",
            serialized: false,
            cost: 20,
            price: 50,
            warranty_days: 90,
          })
        ).id;
        await ok("/movements", "POST", {
          product_id: part,
          branch_id: mainBranch,
          type: "entry",
          quantity: 5,
          reason: "Entrada financeira teste",
        });
        const state = await ok(`/pos/state?branch_id=${mainBranch}`);
        session = (
          await ok("/pos/open", "POST", {
            register_id: state.register_id,
            opening_cents: 3000,
          })
        ).id;
        const body = {
          session_id: session,
          items: [{ product_id: part, quantity: 2 }],
          expected_total_cents: 10000,
          payments: [
            { method: "cash", amount_cents: 6000 },
            { method: "pix", amount_cents: 4000, reference: "PIX-4000" },
          ],
        };
        const key = randomUUID();
        sale = (await ok("/pos/sales", "POST", body, "a", key)).id;
        await ok("/pos/sales", "POST", body, "a", key);
        const r = await reports();
        assert.equal(r.unassigned.count, 2);
        assert.equal(Number(r.unassigned.amount), 10000);
        assert.equal(r.result.sales, 10000);
        assert.equal(r.result.goods_cost, 4000);
        assert.equal(await balance(bank), 3500);
        const pix = (await entries()).items.find(
          (e: any) =>
            e.source_kind === "pos_payment" && e.source_part === "pix",
        );
        await ok(`/finance/entries/${pix.id}/reconcile`, "POST", {
          account_id: bank,
          statement_on: date,
          reference: "EXTRATO-PIX",
          confirmed_amount_cents: 4000,
          confirmed: true,
        });
        assert.equal(await balance(bank), 7500);
        assert.equal((await reports()).unassigned.count, 1);
      },
    );
    await t.test(
      "devolução do PDV compensa receita e CMV e registra estorno financeiro",
      async () => {
        const receipt = await ok("/pos/sales/" + sale);
        await ok(`/pos/sales/${sale}/return`, "POST", {
          session_id: session,
          kind: "return",
          items: [{ sale_item_id: receipt.items[0].id, quantity: 1 }],
          payments: [
            { method: "cash", amount_cents: 3000 },
            { method: "pix", amount_cents: 2000, reference: "REFUND-PIX-2000" },
          ],
          reason: "Devolução financeira de teste",
        });
        const r = await reports();
        assert.equal(r.result.returns, -5000);
        assert.equal(r.result.goods_cost, 2000);
        assert.equal(r.result.revenue, 25000);
        assert.equal(
          (await entries()).items.filter(
            (e: any) => e.source_kind === "pos_refund",
          ).length,
          2,
        );
      },
    );
    await t.test(
      "serviço entregue gera recebível único e custos sem registrar pagamento fictício",
      async () => {
        order = (
          await ok("/repairs", "POST", {
            branch_id: mainBranch,
            customer: { name: "Cliente financeiro", phone: "85999993333" },
            brand: "Marca",
            model: "Modelo",
            reported_fault: "Falha de carga",
            physical_state: "Íntegro",
            technician_id: a.user.id,
          })
        ).id;
        const detail = () => ok("/repairs/" + order);
        const rv = async () => (await detail()).order.version;
        await ok(`/repairs/${order}/diagnosis`, "POST", {
          version: await rv(),
          diagnosis: "Substituir peça de teste",
        });
        await ok(`/repairs/${order}/quote`, "POST", {
          version: await rv(),
          labor_price_cents: 8000,
          labor_cost_cents: 3000,
          items: [{ product_id: part, quantity: 1, unit_price_cents: 5000 }],
          warranty_days: 90,
          warranty_terms: "Garantia teste",
        });
        let d = await detail();
        await ok(`/repairs/${order}/approval`, "POST", {
          version: await rv(),
          quote_id: d.order.current_quote_id,
          decision: "approved",
          customer_representative: "Cliente",
          channel: "in_person",
          reference: "Aprovação financeira teste",
        });
        d = await detail();
        await ok(`/repairs/${order}/parts`, "POST", {
          version: await rv(),
          kind: "issue",
          quote_item_id: d.items[0].id,
          quantity: 1,
          reason: "Aplicação no serviço",
        });
        await ok(`/repairs/${order}/work`, "POST", {
          version: await rv(),
          action: "finish",
          work_report: "Reparo testado e concluído",
        });
        const body = {
          version: await rv(),
          receiver_name: "Cliente",
          confirmed: true,
        };
        const key = randomUUID();
        await ok(`/repairs/${order}/delivery`, "POST", body, "a", key);
        await ok(`/repairs/${order}/delivery`, "POST", body, "a", key);
        const titles = await ok(
          `/finance/titles?branch_id=all&direction=receivable&status=all&start=${start}&end=${date}`,
        );
        const service = titles.items.filter((t: any) => t.source_id === order);
        assert.equal(service.length, 1);
        assert.equal(service[0].amount_cents, 13000);
        assert.equal(service[0].paid_cents, 0);
        const r = await reports();
        assert.equal(r.result.services, 13000);
        assert.equal(r.result.service_cost, 5000);
        assert.equal(Number(r.outstanding.receivable), 28000);
        await ok(`/finance/titles/${service[0].id}/settle`, "POST", {
          version: 1,
          account_id: cash,
          amount_cents: 13000,
          posted_on: date,
          reference: "SERV-13000",
        });
        assert.equal((await reports()).result.services, 13000);
      },
    );
    await t.test(
      "consolidação respeita filiais e não soma transferências como receita",
      async () => {
        await ok(
          "/finance/titles",
          "POST",
          titleBody("payable", {
            branch_id: branch2,
            description: "Despesa outra filial",
            amount_cents: 1000,
          }),
        );
        const consolidated = await reports();
        const one = await reports(mainBranch);
        assert.equal(consolidated.result.result, one.result.result - 1000);
        assert.equal(
          (
            await api(
              `/finance/titles?branch_id=${branch2}&direction=payable&start=${start}&end=${date}`,
              "GET",
              undefined,
              "manager",
            )
          ).status,
          403,
        );
        const safe = await ok(
          `/finance/reports?branch_id=all&start=${start}&end=${date}`,
          "GET",
          undefined,
          "manager",
        );
        assert.equal(safe.branches.length, 1);
      },
    );
    await t.test(
      "compra patrimonial mantém conta a pagar sem duplicar despesas na DRE",
      async () => {
        const before = await reports();
        const bankBefore = await balance(bank);
        const titleId = (
          await ok(
            "/finance/titles",
            "POST",
            titleBody("payable", {
              description: "Compra patrimonial de estoque",
              amount_cents: 9000,
              affects_result: false,
            }),
          )
        ).id;
        const after = await reports();
        assert.equal(after.result.expenses, before.result.expenses);
        assert.equal(after.result.result, before.result.result);
        assert.equal(
          Number(after.outstanding.payable),
          Number(before.outstanding.payable) + 9000,
        );
        await ok(`/finance/titles/${titleId}/settle`, "POST", {
          version: 1,
          account_id: bank,
          amount_cents: 2000,
          posted_on: date,
          reference: "PATRIMONIAL-2000",
        });
        assert.equal(await balance(bank), bankBefore - 2000);
        assert.equal((await reports()).result.result, before.result.result);
      },
    );
    await t.test(
      "ledger, baixas e conciliações originais permanecem imutáveis na role de runtime",
      async () => {
        await assert.rejects(() =>
          db.transaction(a.tenant.id, (tx) =>
            tx.query("DELETE FROM finance_entries"),
          ),
        );
        await assert.rejects(() =>
          db.transaction(a.tenant.id, (tx) =>
            tx.query("UPDATE finance_entries SET amount_cents=1"),
          ),
        );
        await assert.rejects(() =>
          db.transaction(a.tenant.id, (tx) =>
            tx.query("DELETE FROM finance_settlements"),
          ),
        );
        await assert.rejects(() =>
          db.transaction(a.tenant.id, (tx) =>
            tx.query("UPDATE finance_reconciliations SET reference='alterada'"),
          ),
        );
        assert.equal(
          (
            await db.transaction(b.tenant.id, (tx) =>
              tx.query("SELECT id FROM finance_titles"),
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

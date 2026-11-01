import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Database } from "../src/server/db";
import { createApp } from "../src/server/app";
import { creditDay, addDays } from "../src/shared/credit-math";
test("Crediário: aprovação, venda, antecipação, renegociação, cobrança e cancelamento íntegro", async (t) => {
  const db = new Database();
  await db.open("memory://");
  const app = await createApp(db);
  await app.listen(0, "127.0.0.1");
  const base = await app.getUrl(),
    password = "Credit-Testing-2026!",
    today = creditDay(),
    clients: Record<string, any> = {};
  let a: any,
    b: any,
    branch: string,
    customer: string,
    profile: string,
    offer: string,
    session: string,
    product: string,
    sale: string,
    contract: string,
    bank: string,
    firstReceipt: string,
    lateReceipt: string,
    refundSession: string;
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
      { email: `credit-${who}@test.local`, password },
      "none",
    );
    assert.equal(r.status, 200);
    clients[who] = { cookie: r.cookie!.split(";")[0] };
    const me = await ok("/me", "GET", undefined, who);
    clients[who].csrf = me.csrf;
    return me;
  }
  const detail = () => ok("/credit/contracts/" + contract),
    version = async () => (await detail()).contract.version;
  const report = () =>
    ok(
      `/finance/reports?branch_id=all&start=${today.slice(0, 7)}-01&end=${today}`,
    );
  const balance = async () =>
    Number(
      (await ok("/finance/config?branch_id=all")).accounts.find(
        (x: any) => x.id === bank,
      ).balance_cents,
    );
  const conditions = () => ({
    purchase_cents: 50000,
    down_cents: 5000,
    count: 3,
    monthly_bps: 100,
    first_due_on: addDays(today, 30),
  });
  try {
    await t.test(
      "prepara empresas e perfis sem ativar crédito automaticamente",
      async () => {
        for (const who of ["a", "b"])
          await ok(
            "/setup",
            "POST",
            {
              company: `Crediário ${who}`,
              name: `Owner ${who}`,
              branch: "Matriz",
              email: `credit-${who}@test.local`,
              password,
            },
            "none",
          );
        a = await auth("a");
        b = await auth("b");
        branch = a.branches[0].id;
        for (const [who, role] of [
          ["cash", "cashier"],
          ["other", "cashier"],
          ["manager", "manager"],
          ["tech", "technician"],
        ]) {
          await ok("/users", "POST", {
            name: who,
            email: `credit-${who}@test.local`,
            password,
            role,
            branch_ids: [branch],
          });
          await auth(who);
        }
        assert.equal((await ok("/credit/settings")).policy, null);
        assert.equal(
          (await api("/credit/simulate", "POST", conditions())).status,
          409,
        );
        assert.equal(
          (
            await api(
              "/credit/profiles?branch_id=all",
              "GET",
              undefined,
              "cash",
            )
          ).status,
          403,
        );
        assert.equal(
          (await api("/credit/settings", "GET", undefined, "tech")).status,
          403,
        );
      },
    );
    await t.test(
      "termos exigem proprietário, revisão e limites de encargos",
      async () => {
        const body = {
          version: 0,
          enabled: true,
          legal_name: "Empresa de teste do crediário",
          cnpj: "11222333000181",
          address: "Endereço demonstrativo, Fortaleza CE",
          email: "juridico@test.local",
          phone: "85999990000",
          max_monthly_bps: 100,
          late_fee_bps: 200,
          late_monthly_bps: 100,
          max_installments: 12,
          offer_days: 2,
          terms:
            "Termos exclusivos de teste automatizado; não representam revisão jurídica comercial.",
          legal_reference:
            "Revisão fictícia TESTE-001 para validação do software",
          reviewed: true,
        };
        assert.equal(
          (await api("/credit/settings", "POST", body, "manager")).status,
          403,
        );
        assert.equal(
          (
            await api("/credit/settings", "POST", {
              ...body,
              late_fee_bps: 201,
            })
          ).status,
          400,
        );
        await ok("/credit/settings", "POST", body);
        assert.equal(
          (
            await api("/credit/simulate", "POST", {
              ...conditions(),
              monthly_bps: 200,
            })
          ).status,
          400,
        );
      },
    );
    await t.test(
      "comprador reaproveita o CRM e exige CPF e avaliação documentada",
      async () => {
        customer = (
          await ok("/crm/customers", "POST", {
            name: "Cliente de teste do crediário",
            phone: "85999994444",
            email: "comprador@test.local",
          })
        ).id;
        const body = {
          version: 0,
          branch_id: branch,
          customer_id: customer,
          cpf: "52998224725",
          address: "Rua de teste, 100, Fortaleza CE",
          limit_cents: 50000,
          enabled: true,
          assessment: "Capacidade de pagamento avaliada em cenário fictício.",
          bureau_reference: "Consulta externa fictícia TESTE-001",
          capacity_checked: true,
        };
        assert.equal(
          (
            await api("/credit/profiles", "POST", {
              ...body,
              cpf: "11111111111",
            })
          ).status,
          400,
        );
        profile = (await ok("/credit/profiles", "POST", body)).id;
        assert.equal((await api("/credit/profiles", "POST", body)).status, 409);
        const list = (await ok("/credit/profiles?branch_id=all")).items[0];
        assert.equal(list.cpf_suffix, "25");
        assert.equal("cpf" in list, false);
        assert.equal(
          (await api("/credit/profiles/" + profile, "GET", undefined, "b"))
            .status,
          404,
        );
      },
    );
    await t.test(
      "ofertas concorrentes reservam limite sem duplicação no reenvio",
      async () => {
        const body = {
          ...conditions(),
          profile_id: profile,
          branch_id: branch,
          assessment: "Operação avaliada e aprovada para teste.",
          approval_reference: "APROVACAO-001",
          policy_version: 1,
        };
        assert.equal(
          (await api("/credit/offers", "POST", { ...body, policy_version: 99 }))
            .status,
          409,
        );
        const keys = [randomUUID(), randomUUID()];
        const r = await Promise.all(
          keys.map((k) => api("/credit/offers", "POST", body, "a", k)),
        );
        assert.deepEqual(r.map((x) => x.status).sort(), [200, 409]);
        const winner = r.findIndex((x) => x.status === 200);
        offer = r[winner].body.id;
        assert.equal(
          (await ok(`/credit/offers/${offer}/document`)).contract.borrower.cpf,
          "52998224725",
        );
        assert.equal(
          (
            await api(
              `/credit/offers/${offer}/document`,
              "GET",
              undefined,
              "cash",
            )
          ).status,
          403,
        );
        assert.equal(
          (await ok("/credit/offers", "POST", body, "a", keys[winner])).id,
          offer,
        );
        assert.equal(
          (await ok("/credit/offers?branch_id=all")).items.length,
          1,
        );
      },
    );
    await t.test(
      "PDV registra somente entrada em caixa e o principal em parcelas",
      async () => {
        product = (
          await ok("/products", "POST", {
            name: "Aparelho crediário de teste",
            sku: "CRED-TESTE",
            condition: "new",
            serialized: false,
            cost: 250,
            price: 500,
            warranty_days: 90,
          })
        ).id;
        await ok("/movements", "POST", {
          branch_id: branch,
          product_id: product,
          type: "entry",
          quantity: 3,
          reason: "Entrada de teste do crediário",
        });
        const state = await ok(
          `/pos/state?branch_id=${branch}`,
          "GET",
          undefined,
          "cash",
        );
        session = (
          await ok(
            "/pos/open",
            "POST",
            { register_id: state.register_id, opening_cents: 0 },
            "cash",
          )
        ).id;
        const lookup = (
          await ok(
            `/credit/checkout?branch_id=${branch}&q=Cliente`,
            "GET",
            undefined,
            "cash",
          )
        ).items[0];
        assert.equal("borrower" in lookup, false);
        const body = {
          session_id: session,
          customer_id: customer,
          credit_offer_id: offer,
          expected_credit_total_cents: lookup.simulation.total_cents,
          credit_acceptance_reference:
            "Cliente conferiu e recebeu cópia TESTE-001",
          credit_terms_accepted: true,
          items: [{ product_id: product, quantity: 1 }],
          expected_total_cents: 50000,
          payments: [{ method: "cash", amount_cents: 5000 }],
        };
        assert.equal(
          (await api("/pos/sales", "POST", { ...body, payments: [] }, "cash"))
            .status,
          400,
        );
        const key = randomUUID();
        const r = await ok("/pos/sales", "POST", body, "cash", key);
        sale = r.id;
        contract = r.credit_contract_id;
        assert.ok(contract);
        assert.equal(
          (await ok("/pos/sales", "POST", body, "cash", key)).id,
          sale,
        );
        const receipt = await ok(
          "/pos/sales/" + sale,
          "GET",
          undefined,
          "cash",
        );
        assert.equal(
          receipt.payments.reduce((n: number, p: any) => n + p.amount_cents, 0),
          5000,
        );
        assert.equal(receipt.credit.id, contract);
        const d = await detail();
        assert.equal(d.items.length, 3);
        assert.equal(
          d.items.reduce((n: number, x: any) => n + x.principal_cents, 0),
          45000,
        );
        assert.equal((await report()).result.sales, 50000);
        assert.equal((await report()).result.credit_income, 0);
      },
    );
    await t.test(
      "contrato é protegido por empresa, filial e operador responsável",
      async () => {
        assert.equal(
          (await api("/credit/contracts/" + contract, "GET", undefined, "cash"))
            .status,
          403,
        );
        assert.equal(
          (await api("/credit/contracts/" + contract, "GET", undefined, "b"))
            .status,
          404,
        );
        assert.equal(
          (
            await api(
              "/credit/contracts/" + contract + "/document",
              "GET",
              undefined,
              "other",
            )
          ).status,
          403,
        );
        const doc = await ok(
          "/credit/contracts/" + contract + "/document",
          "GET",
          undefined,
          "cash",
        );
        assert.equal(doc.contract.borrower.cpf, "52998224725");
        assert.equal(doc.plans.length, 1);
      },
    );
    await t.test(
      "antecipação parcial reduz juros e gera uma única baixa no financeiro",
      async () => {
        bank = (
          await ok("/finance/accounts", "POST", {
            branch_id: branch,
            name: "Banco do crediário",
            kind: "bank",
            opening_cents: 0,
            opening_on: today,
          })
        ).id;
        const d = await detail(),
          line = d.items[0];
        assert.ok(line.quote.discount_cents > 0);
        const b = {
          version: d.contract.version,
          installment_id: line.id,
          amount_cents: 5000,
          expected_total_cents: line.quote.total_cents,
          account_id: bank,
          reference: "CRED-REC-5000",
        };
        const key = randomUUID();
        const r = await ok(
          `/credit/contracts/${contract}/receive`,
          "POST",
          b,
          "a",
          key,
        );
        firstReceipt = r.id;
        assert.equal(r.principal_cents, 5000);
        assert.ok(r.discount_cents > 0);
        assert.equal(
          (
            await ok(
              `/credit/contracts/${contract}/receive`,
              "POST",
              b,
              "a",
              key,
            )
          ).id,
          r.id,
        );
        assert.equal(await balance(), 5000);
        const finance = await ok("/finance/titles/" + line.title_id);
        assert.equal(finance.title.paid_cents, 5000 + r.discount_cents);
        assert.equal(
          (
            await api("/finance/titles/" + line.title_id + "/settle", "POST", {
              version: finance.title.version,
              account_id: bank,
              amount_cents: 1,
              posted_on: today,
              reference: "BYPASS",
            })
          ).status,
          409,
        );
        assert.equal((await report()).result.revenue, 50000);
      },
    );
    await t.test(
      "recebimentos simultâneos não ultrapassam o saldo da parcela",
      async () => {
        const d = await detail(),
          x = d.items[0],
          b = {
            version: d.contract.version,
            installment_id: x.id,
            amount_cents: x.quote.total_cents,
            expected_total_cents: x.quote.total_cents,
            account_id: bank,
            reference: "CRED-SALDO",
          };
        const r = await Promise.all([
          api(`/credit/contracts/${contract}/receive`, "POST", b),
          api(`/credit/contracts/${contract}/receive`, "POST", b),
        ]);
        assert.deepEqual(r.map((x) => x.status).sort(), [200, 409]);
        assert.equal((await detail()).items[0].quote.total_cents, 0);
        assert.equal(await balance(), 15000);
      },
    );
    await t.test(
      "estorno preserva o recibo e restaura o saldo com os abatimentos corretos",
      async () => {
        await ok(`/credit/contracts/${contract}/reverse`, "POST", {
          version: await version(),
          receipt_id: firstReceipt,
          reason: "Correção de lançamento fictício",
        });
        assert.equal(await balance(), 10000);
        const d = await detail();
        assert.equal(d.items[0].quote.principal_cents, 5000);
        assert.equal(d.items[0].receipts.length, 1);
      },
    );
    await t.test(
      "renegociação preserva pagamentos e não capitaliza encargos não recebidos",
      async () => {
        const before = await balance();
        await ok(`/credit/contracts/${contract}/renegotiate`, "POST", {
          version: await version(),
          policy_version: 1,
          count: 2,
          monthly_bps: 0,
          first_due_on: addDays(today, 30),
          reason: "Repactuação consensual para cenário de teste",
          acceptance_reference: "ACEITE-REN-001",
          assessment: "Nova capacidade de pagamento avaliada no teste.",
          accepted: true,
        });
        const d = await detail();
        assert.equal(d.plans.length, 2);
        assert.equal(d.plan.principal_cents, 35000);
        assert.equal(
          d.items.reduce((n: number, x: any) => n + x.principal_cents, 0),
          35000,
        );
        assert.equal(await balance(), before);
        const open = await report();
        assert.equal(Number(open.outstanding.receivable), 35000);
      },
    );
    await t.test(
      "multa única e mora simples entram no recibo e no relatório de cobrança",
      async () => {
        let d = await detail();
        const x = d.items[0];
        await db.system("UPDATE credit_plans SET issued_on=$2 WHERE id=$1", [
          d.plan.id,
          addDays(today, -40),
        ]);
        await db.system(
          "UPDATE credit_installments SET due_on=$2 WHERE id=$1",
          [x.id, addDays(today, -10)],
        );
        await db.system(
          "UPDATE finance_titles SET due_on=$2,competence_on=$2 WHERE credit_installment_id=$1",
          [x.id, addDays(today, -10)],
        );
        d = await detail();
        const line = d.items[0];
        assert.equal(line.quote.fine_cents, 350);
        assert.equal(line.quote.late_cents, 58);
        const r = await ok(`/credit/contracts/${contract}/receive`, "POST", {
          version: d.contract.version,
          installment_id: line.id,
          amount_cents: 10000,
          expected_total_cents: line.quote.total_cents,
          account_id: bank,
          reference: "CRED-ATRASO",
        });
        lateReceipt = r.id;
        assert.equal(r.fine_cents, 350);
        assert.equal(r.late_cents, 58);
        assert.equal((await detail()).items[0].quote.fine_cents, 0);
        assert.equal((await report()).result.credit_income, 408);
        const collection = await ok("/credit/collections?branch_id=all");
        assert.equal(collection.summary.installments, 1);
        assert.equal(Number(collection.items[0].nominal_cents), 7908);
      },
    );
    await t.test(
      "cancelamento integral reembolsa entradas e parcelas, inclusive após renegociação",
      async () => {
        const reg = await ok("/pos/registers", "POST", {
          branch_id: branch,
          name: "Caixa de cancelamento",
        });
        refundSession = (
          await ok("/pos/open", "POST", {
            register_id: reg.id,
            opening_cents: 10000,
          })
        ).id;
        const receipt = await ok("/pos/sales/" + sale);
        const request = {
          session_id: refundSession,
          kind: "cancel",
          items: receipt.items.map((x: any) => ({
            sale_item_id: x.id,
            quantity: x.quantity,
          })),
          payments: [{ method: "cash", amount_cents: 5000 }],
          reason: "Cancelamento integral de teste com reembolsos conferidos",
          credit_refund_confirmed: true,
          expected_credit_refund_cents: receipt.credit.received_cents,
        };
        assert.equal(receipt.credit.received_cents, 20000);
        const [entry] = await db.transaction(a.tenant.id, (tx) =>
          tx.query(
            "SELECT e.id FROM credit_receipts r JOIN finance_entries e ON e.settlement_id=r.settlement_id AND e.source_kind='settlement' WHERE r.id=$1",
            [lateReceipt],
          ),
        );
        const rec = await ok(
          "/finance/entries/" + entry.id + "/reconcile",
          "POST",
          {
            account_id: bank,
            statement_on: today,
            reference: "EXTRATO-CRED",
            confirmed_amount_cents: 10000,
            confirmed: true,
          },
        );
        assert.equal(
          (await api("/pos/sales/" + sale + "/return", "POST", request)).status,
          409,
        );
        assert.equal(await balance(), 20000);
        assert.equal((await detail()).contract.status, "active");
        await ok("/finance/reconciliations/" + rec.id + "/undo", "POST", {
          reason: "Desfazer para cancelar teste",
        });
        const key = randomUUID();
        await ok("/pos/sales/" + sale + "/return", "POST", request, "a", key);
        await ok("/pos/sales/" + sale + "/return", "POST", request, "a", key);
        assert.equal(await balance(), 0);
        assert.equal((await detail()).contract.status, "cancelled");
        const r = await report();
        assert.equal(r.result.sales + r.result.returns, 0);
        assert.equal(r.result.credit_income, 0);
        assert.equal(Number(r.outstanding.receivable), 0);
      },
    );
    await t.test(
      "planos, recibos e resultados não podem ser reescritos na role da aplicação",
      async () => {
        for (const table of [
          "credit_plans",
          "credit_installments",
          "credit_receipts",
          "credit_income_events",
          "credit_events",
        ])
          await assert.rejects(() =>
            db.transaction(a.tenant.id, (tx) =>
              tx.query("DELETE FROM " + table),
            ),
          );
        assert.equal(
          (
            await db.transaction(b.tenant.id, (tx) =>
              tx.query("SELECT id FROM credit_contracts"),
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

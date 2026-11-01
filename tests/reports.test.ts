import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Database } from "../src/server/db";
import { createApp } from "../src/server/app";
import { addDays, creditDay } from "../src/shared/credit-math";

test("Relatórios gerenciais: períodos, devoluções, custos, acesso e posição atual", async (t) => {
  const db = new Database();
  await db.open("memory://");
  const app = await createApp(db);
  await app.listen(0, "127.0.0.1");
  const base = await app.getUrl(),
    password = "Reports-Testing-2026!",
    today = creditDay(),
    yesterday = addDays(today, -1),
    old = addDays(today, -50);
  const clients: Record<string, any> = {};
  let a: any,
    b: any,
    branch: string,
    other: string,
    product: string,
    session: string,
    sale: string,
    returnId: string,
    oldSale: string,
    managerSession: string;
  async function api(path: string, method = "GET", body?: any, who = "a") {
    const c = clients[who];
    const r = await fetch(base + "/api" + path, {
      method,
      headers: {
        origin: "http://localhost:3000",
        "content-type": "application/json",
        "idempotency-key": randomUUID(),
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
  async function ok(path: string, method = "GET", body?: any, who = "a") {
    const r = await api(path, method, body, who);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return r.body;
  }
  async function auth(who: string) {
    const r = await api(
      "/login",
      "POST",
      { email: `reports-${who}@test.local`, password },
      "none",
    );
    assert.equal(r.status, 200);
    clients[who] = { cookie: r.cookie!.split(";")[0] };
    const me = await ok("/me", "GET", undefined, who);
    clients[who].csrf = me.csrf;
    return me;
  }
  const report = (kind = "overview", extra = "", who = "a") =>
    ok(
      `/reports/${kind}?branch_id=all&start=${yesterday}&end=${today}${extra}`,
      "GET",
      undefined,
      who,
    );
  async function makeProduct(name: string, sku: string) {
    return (
      await ok("/products", "POST", {
        name,
        sku,
        condition: "new",
        serialized: false,
        cost: 4,
        price: 10,
        warranty_days: 30,
      })
    ).id;
  }
  async function entry(p: string, qty = 10, at = branch) {
    await ok("/movements", "POST", {
      branch_id: at,
      product_id: p,
      type: "entry",
      quantity: qty,
      reason: "Entrada de teste gerencial",
    });
  }
  async function sell(p = product, qty = 2) {
    return (
      await ok("/pos/sales", "POST", {
        session_id: session,
        items: [{ product_id: p, quantity: qty }],
        expected_total_cents: qty * 1000,
        payments: [{ method: "cash", amount_cents: qty * 1000 }],
      })
    ).id;
  }
  async function refund(id: string, qty: number, who = "a") {
    const d = await ok("/pos/sales/" + id);
    return (
      await ok(
        `/pos/sales/${id}/return`,
        "POST",
        {
          session_id: who === "manager" ? managerSession : session,
          kind: "return",
          items: [{ sale_item_id: d.items[0].id, quantity: qty }],
          payments: [{ method: "cash", amount_cents: qty * 1000 }],
          reason: "Devolução gerencial de teste",
        },
        who,
      )
    ).id;
  }
  try {
    await t.test(
      "prepara fontes reais com venda antiga e devolução por outro responsável",
      async () => {
        for (const who of ["a", "b"])
          await ok(
            "/setup",
            "POST",
            {
              company: `Relatórios ${who}`,
              name: `Gestor ${who}`,
              branch: "Matriz",
              email: `reports-${who}@test.local`,
              password,
            },
            "none",
          );
        a = await auth("a");
        b = await auth("b");
        branch = a.branches[0].id;
        other = (await ok("/branches", "POST", { name: "Filial sem vendas" }))
          .id;
        a = await auth("a");
        for (const role of [
          "manager",
          "cashier",
          "technician",
          "stock",
          "viewer",
        ]) {
          await ok("/users", "POST", {
            name: `Perfil ${role}`,
            email: `reports-${role}@test.local`,
            password,
            role,
            branch_ids: [branch],
          });
          await auth(role);
        }
        product = await makeProduct("Produto livre de teste", "REL-001");
        await entry(product, 30);
        session = (
          await ok("/pos/open", "POST", {
            register_id: (await ok(`/pos/state?branch_id=${branch}`))
              .register_id,
            opening_cents: 5000,
          })
        ).id;
        managerSession = (
          await ok(
            "/pos/open",
            "POST",
            {
              register_id: (
                await ok("/pos/registers", "POST", {
                  branch_id: branch,
                  name: "Caixa gerente",
                })
              ).id,
              opening_cents: 5000,
            },
            "manager",
          )
        ).id;
        sale = await sell();
        returnId = await refund(sale, 1, "manager");
        oldSale = await sell(product, 1);
        await db.system(
          "UPDATE pos_sales SET created_at=$2::date+interval '12 hours' WHERE id=$1",
          [oldSale, old],
        );
        await refund(oldSale, 1);
        await db.system(
          "UPDATE pos_sales SET created_at=$2::date+interval '12 hours' WHERE id=$1",
          [sale, yesterday],
        );
      },
    );
    await t.test(
      "diário/mensal e DRE usam os mesmos fatos, incluindo dias zerados",
      async () => {
        const r = await report(),
          f = await ok(
            `/finance/reports?branch_id=all&start=${yesterday}&end=${today}`,
          );
        for (const [k, v] of Object.entries(f.result))
          assert.equal(r.summary[k], v, k);
        assert.equal(r.daily.length, 2);
        assert.equal(r.daily[0].turnover, 2000);
        assert.equal(r.daily[1].turnover, -2000);
        assert.equal(r.summary.turnover, 0);
        assert.equal(r.summary.goods_cost, 0);
        assert.equal(r.summary.operating_margin, null);
        assert.equal(r.summary.registered, 1);
        assert.equal(r.summary.kept, 1);
        assert.equal(r.summary.ticket, 1000);
        assert.equal(
          r.monthly.reduce((n: number, m: any) => n + m.turnover, 0),
          r.summary.turnover,
        );
        assert.equal(r.branches.length, 2);
        assert.equal(r.branches.find((x: any) => x.id === other).ticket, null);
        const empty = await ok(
          `/reports/overview?branch_id=${other}&start=${old}&end=${today}`,
        );
        assert.equal(empty.daily.length, 51);
        assert.ok(empty.daily.every((d: any) => d.turnover === 0));
      },
    );
    await t.test(
      "produtos e vendedor preservam custo histórico e atribuição original",
      async () => {
        await db.system("UPDATE products SET cost=99 WHERE id=$1", [product]);
        const p = (await report("products")).items[0];
        assert.equal(p.sold, 2);
        assert.equal(p.returned, 2);
        assert.equal(p.quantity, 0);
        assert.equal(p.revenue, 0);
        assert.equal(p.cost, 0);
        assert.equal(p.margin, null);
        const r = await ok(
          `/reports/products?branch_id=all&start=${today}&end=${today}`,
        );
        assert.equal(r.items[0].quantity, -2);
        assert.equal(r.items[0].cost, -800);
        assert.equal(r.items[0].revenue, -2000);
        const seller = (await report("sellers")).items;
        assert.equal(seller.length, 1);
        assert.equal(seller[0].id, a.user.id);
        assert.equal(seller[0].returned, 2000);
        assert.equal(seller[0].ticket, 1000);
        await refund(sale, 1);
        const after = await report();
        assert.equal(after.summary.kept, 0);
        assert.equal(after.summary.ticket, null);
        const before = await ok(
          `/reports/overview?branch_id=all&start=${yesterday}&end=${yesterday}`,
        );
        assert.equal(before.summary.sales, 2000);
        assert.equal(before.summary.goods_cost, 800);
        assert.equal(before.summary.ticket, null);
      },
    );
    await t.test(
      "estoque parado considera reposição, venda líquida e filial; relatório é atual",
      async () => {
        const p = await makeProduct("Parado de teste", "REL-IDLE");
        await entry(p, 3);
        await entry(p, 2, other);
        await db.system("UPDATE products SET created_at=$2::date WHERE id=$1", [
          p,
          old,
        ]);
        await db.system(
          "UPDATE stock_movements SET created_at=$3::date+interval '12 hours' WHERE product_id=$1 AND branch_id=$2",
          [p, branch, old],
        );
        let r = await report("stagnant", "&days=30");
        assert.equal(r.items.length, 1);
        assert.equal(r.items[0].branch_id, branch);
        assert.equal(r.items[0].idle_days, 50);
        assert.equal(r.items[0].cost, 1200);
        await entry(p, 1);
        r = await report("stagnant", "&days=30");
        assert.equal(r.total, 0);
        const p2 = await makeProduct("Novo sem vendas", "REL-NEW");
        await entry(p2);
        assert.equal((await report("stagnant", "&days=1")).total, 0);
        assert.deepEqual(
          (await report("stagnant", "&start=1900-01-01&end=2200-01-01")).items,
          r.items,
        );
      },
    );
    await t.test(
      "paginação, ordenação e busca literal não perdem a contagem em página vazia",
      async () => {
        // Historical fixtures exercise >30 independent result rows without creating fictitious live data.
        for (let n = 0; n < 32; n++) {
          const p = await makeProduct(
            `Ranking ${String(n).padStart(2, "0")}`,
            `REL-RANK-${n}`,
          );
          await entry(p, 1);
          await sell(p, 1);
        }
        let r = await report("products", "&q=Ranking&sort=profit");
        assert.equal(r.total, 32);
        assert.equal(r.items.length, 30);
        assert.equal(r.items[0].profit, 600);
        const next = await report("products", "&q=Ranking&page=2&sort=profit");
        assert.equal(next.items.length, 2);
        assert.ok(
          !r.items.some((p: any) => next.items.some((x: any) => x.id === p.id)),
        );
        r = await report("products", "&q=Ranking&page=3");
        assert.equal(r.total, 32);
        assert.equal(r.items.length, 0);
        assert.equal((await report("products", "&q=%25")).total, 0);
        assert.equal(
          (await report("products", "&q=" + encodeURIComponent("' OR 1=1 --")))
            .total,
          0,
        );
      },
    );
    await t.test(
      "assistência mede conclusão/entrega e usa peças efetivamente consumidas",
      async () => {
        const id = (
          await ok("/repairs", "POST", {
            branch_id: branch,
            customer: {
              name: "Cliente de teste reservado",
              phone: "85999990123",
            },
            brand: "Marca",
            model: "Modelo",
            reported_fault: "Falha teste",
            physical_state: "Íntegro",
            technician_id: a.user.id,
          })
        ).id;
        const detail = () => ok(`/repairs/${id}`),
          version = async () => (await detail()).order.version;
        await ok(`/repairs/${id}/diagnosis`, "POST", {
          version: await version(),
          diagnosis: "Reparo gerencial teste",
        });
        await ok(`/repairs/${id}/quote`, "POST", {
          version: await version(),
          labor_price_cents: 5000,
          labor_cost_cents: 1000,
          items: [{ product_id: product, quantity: 2, unit_price_cents: 1000 }],
          warranty_days: 30,
          warranty_terms: "Teste",
        });
        let d = await detail();
        await ok(`/repairs/${id}/approval`, "POST", {
          version: await version(),
          quote_id: d.order.current_quote_id,
          decision: "approved",
          customer_representative: "Cliente",
          channel: "in_person",
          reference: "Autorização teste",
        });
        await ok(`/repairs/${id}/parts`, "POST", {
          version: await version(),
          kind: "issue",
          quote_item_id: d.items[0].id,
          quantity: 2,
          reason: "Aplicação de teste",
        });
        d = await detail();
        // The API returns the issue id; use the immutable event from the database when not included in the response.
        const [source] = await db.system<any>(
          "SELECT id FROM repair_part_events WHERE order_id=$1 AND kind='issue'",
          [id],
        );
        await ok(`/repairs/${id}/parts`, "POST", {
          version: await version(),
          kind: "return",
          issue_id: source.id,
          quantity: 1,
          reason: "Peça não utilizada",
        });
        await ok(`/repairs/${id}/work`, "POST", {
          version: await version(),
          action: "finish",
          work_report: "Conferência final teste",
        });
        await db.system(
          "UPDATE repair_orders SET created_at=$2::date+interval '12 hours',ready_at=$3::date+interval '12 hours' WHERE id=$1",
          [id, addDays(today, -4), yesterday],
        );
        let tech = (await report("technicians")).items.find(
          (x: any) => x.id === a.user.id,
        );
        assert.equal(tech.completed, 1);
        assert.equal(tech.delivered, 0);
        assert.equal(tech.elapsed_days, 3);
        assert.equal((await report("services")).total, 0);
        await ok(`/repairs/${id}/delivery`, "POST", {
          version: await version(),
          receiver_name: "Cliente teste",
          confirmed: true,
        });
        const services = await report("services");
        assert.equal(services.total, 1);
        assert.equal(services.items[0].revenue, 6000);
        assert.equal(services.items[0].cost, 10900);
        assert.equal(services.items[0].profit, -4900);
        assert.ok(!JSON.stringify(services).includes("85999990123"));
        assert.ok(
          !JSON.stringify(services).includes("Cliente de teste reservado"),
        );
        const f = await report();
        assert.equal(f.summary.services, 6000);
        assert.equal(f.summary.service_cost, 10900);
        tech = (await report("technicians")).items.find(
          (x: any) => x.id === a.user.id,
        );
        assert.equal(tech.completed, 1);
        assert.equal(tech.delivered, 1);
        assert.equal(tech.backlog, 0);
        const open = (
          await ok("/repairs", "POST", {
            branch_id: branch,
            customer: { name: "Cliente teste aberto", phone: "85999990124" },
            brand: "Marca",
            model: "Modelo",
            reported_fault: "Falha teste",
            physical_state: "Íntegro",
          })
        ).id;
        await db.system("UPDATE repair_orders SET due_on=$2 WHERE id=$1", [
          open,
          yesterday,
        ]);
        const unassigned = (await report("technicians")).items.find(
          (x: any) => x.id === null,
        );
        assert.equal(unassigned.overdue, 1);
        assert.equal(unassigned.completed, 0);
        assert.equal(unassigned.elapsed_days, null);
      },
    );
    await t.test(
      "acesso por perfil, empresa e filial e validação de parâmetros",
      async () => {
        for (const role of ["cashier", "technician", "stock", "viewer"])
          assert.equal(
            (await api("/reports/overview", "GET", undefined, role)).status,
            403,
          );
        for (const kind of [
          "overview",
          "products",
          "stagnant",
          "sellers",
          "technicians",
          "services",
          "credit",
        ]) {
          assert.equal(
            (
              await api(
                `/reports/${kind}?branch_id=${other}`,
                "GET",
                undefined,
                "manager",
              )
            ).status,
            403,
          );
          assert.equal(
            (await api(`/reports/${kind}?branch_id=${b.branches[0].id}`))
              .status,
            403,
          );
          const foreign = await report(kind, "", "b");
          if (kind === "overview") assert.equal(foreign.summary.turnover, 0);
          else if (kind !== "credit") assert.equal(foreign.total, 0);
        }
        const safe = await report("overview", "", "manager");
        assert.equal(safe.branches.length, 1);
        assert.equal(safe.branches[0].id, branch);
        for (const extra of [
          "&start=2026-02-30",
          "&end=2199-01-01",
          "&start=2020-01-01",
          "&start=2026-13-01",
          "&page=0",
          "&sort=DROP",
          "&days=731",
          "&branch_id=invalid",
        ]) {
          assert.equal(
            (
              await api(
                `/reports/products?${(() => {
                  const params = new URLSearchParams({
                    start: yesterday,
                    end: today,
                  });
                  for (const [key, value] of new URLSearchParams(
                    extra.slice(1),
                  ))
                    params.set(key, value);
                  return params;
                })()}`,
              )
            ).status,
            400,
            extra,
          );
        }
        assert.equal((await api("/reports/missing")).status, 404);
        const leap = await ok(
          "/reports/overview?start=2024-01-01&end=2024-12-31",
        );
        assert.equal(leap.daily.length, 366);
      },
    );
    await t.test(
      "consultas não escrevem no estoque, financeiro, auditoria ou cadastros",
      async () => {
        const snapshot = () =>
          db.system(
            "SELECT (SELECT count(*) FROM stock_movements)::int AS stock,(SELECT count(*) FROM finance_entries)::int AS finance,(SELECT count(*) FROM audit_events)::int AS audit,(SELECT count(*) FROM products)::int AS products",
          );
        const before = await snapshot();
        for (const kind of Object.keys({
          overview: 1,
          products: 1,
          stagnant: 1,
          sellers: 1,
          technicians: 1,
          services: 1,
          credit: 1,
        }))
          await report(kind);
        assert.deepEqual(await snapshot(), before);
      },
    );
  } finally {
    await app.close();
    await db.close();
  }
});

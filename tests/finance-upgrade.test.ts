import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { uuid } from "../src/server/domain";
import { Database } from "../src/server/db";
import { InventoryService } from "../src/server/domain";
import { FinanceService } from "../src/server/finance";
import { Identity } from "../src/server/security";
test("migração financeira importa pagamentos, devoluções e serviço legado com identidades válidas", async () => {
  const db = new PGlite();
  await db.waitReady;
  try {
    for (const name of [
      "202610280001_foundation",
      "202610280002_point_of_sale",
      "202610280003_pos_indexes",
      "202610280004_repairs",
      "202610280005_crm",
    ])
      await db.exec(
        await readFile(
          resolve("prisma/migrations", name, "migration.sql"),
          "utf8",
        ),
      );
    const tenant = randomUUID(),
      user = randomUUID(),
      branch = randomUUID(),
      session = randomUUID(),
      sale = randomUUID(),
      returned = randomUUID(),
      customer = randomUUID(),
      order = randomUUID(),
      quote = randomUUID();
    await db.query(
      "INSERT INTO tenants(id,name,slug) VALUES($1,'Legado financeiro',$2)",
      [tenant, tenant],
    );
    await db.query(
      "INSERT INTO users(id,name,email,password_hash) VALUES($1,'Gestor legado','legacy-finance@test.local','unused-test-hash')",
      [user],
    );
    await db.query(
      "INSERT INTO branches(id,tenant_id,name) VALUES($1,$2,'Matriz')",
      [branch, tenant],
    );
    await db.query(
      "INSERT INTO cash_sessions(id,tenant_id,branch_id,register_id,operator_id,status,opening_cents) VALUES($1,$2,$3,$3,$4,'open',0)",
      [session, tenant, branch, user],
    );
    await db.query(
      "INSERT INTO pos_sales(id,tenant_id,branch_id,session_id,operator_id,receipt_code,subtotal_cents,discount_cents,total_cents,change_cents,status) VALUES($1,$2,$3,$4,$5,'LEGACY-SALE',10000,0,10000,0,'partial_return')",
      [sale, tenant, branch, session, user],
    );
    for (const [method, amount] of [
      ["cash", 6000],
      ["pix", 4000],
    ])
      await db.query(
        "INSERT INTO pos_sale_payments(id,tenant_id,sale_id,method,amount_cents,tendered_cents,reference) VALUES($5,$1,$2,$3,$4,$4,'Legacy')",
        [tenant, sale, method, amount, randomUUID()],
      );
    await db.query(
      "INSERT INTO pos_returns(id,tenant_id,branch_id,sale_id,session_id,actor_id,kind,reason,total_cents) VALUES($1,$2,$3,$4,$5,$6,'return','Devolução legada',5000)",
      [returned, tenant, branch, sale, session, user],
    );
    for (const [method, amount] of [
      ["cash", 3000],
      ["pix", 2000],
    ])
      await db.query(
        "INSERT INTO pos_refund_payments(id,tenant_id,return_id,method,amount_cents,reference) VALUES($1,$2,$3,$4,$5,'Legacy refund')",
        [randomUUID(), tenant, returned, method, amount],
      );
    await db.query(
      "INSERT INTO customers(id,tenant_id,name,phone) VALUES($1,$2,'Cliente legado','85999990000')",
      [customer, tenant],
    );
    await db.query(
      "INSERT INTO repair_orders(id,tenant_id,branch_id,customer_id,code,customer_name,customer_phone,brand,model,reported_fault,physical_state,status,created_by,delivered_at,delivered_by,delivery_outcome) VALUES($1,$2,$3,$4,'LEGACY-OS','Cliente legado','85999990000','Marca','Modelo','Falha','Íntegro','delivered',$5,now(),$5,'ready')",
      [order, tenant, branch, customer, user],
    );
    await db.query(
      "INSERT INTO repair_quotes(id,tenant_id,order_id,revision,labor_price_cents,labor_cost_cents,total_cents,warranty_days,created_by) VALUES($1,$2,$3,1,8000,3000,8000,0,$4)",
      [quote, tenant, order, user],
    );
    await db.query("UPDATE repair_orders SET current_quote_id=$2 WHERE id=$1", [
      order,
      quote,
    ]);
    await db.exec(
      await readFile(
        resolve("prisma/migrations/202610280006_finance/migration.sql"),
        "utf8",
      ),
    );
    await db.exec(
      await readFile(
        resolve(
          "prisma/migrations/202610280007_finance_opening_review/migration.sql",
        ),
        "utf8",
      ),
    );
    await db.exec(
      await readFile(
        resolve(
          "prisma/migrations/202610290008_finance_title_classification/migration.sql",
        ),
        "utf8",
      ),
    );
    await db.exec(
      await readFile(
        resolve("prisma/migrations/202610290009_store_credit/migration.sql"),
        "utf8",
      ),
    );
    const entries = (
      await db.query<any>(
        "SELECT id,amount_cents,account_id,source_kind FROM finance_entries",
      )
    ).rows;
    assert.equal(entries.length, 4);
    assert.equal(
      entries.reduce((n, r) => n + r.amount_cents, 0),
      5000,
    );
    assert.ok(
      entries.every(
        (e) => e.account_id === null && uuid.safeParse(e.id).success,
      ),
    );
    const titles = (
      await db.query<any>(
        "SELECT id,source_id,amount_cents FROM finance_titles",
      )
    ).rows;
    assert.equal(titles.length, 1);
    assert.equal(titles[0].source_id, order);
    assert.equal(titles[0].amount_cents, 8000);
    assert.ok(uuid.safeParse(titles[0].id).success);
    const wrapper = new Database();
    wrapper.embedded = db;
    const finance = new FinanceService(wrapper, new InventoryService(wrapper));
    const identity = {
      user_id: user,
      tenant_id: tenant,
      branch_ids: [branch],
      role: "owner",
      name: "Gestor legado",
      email: "legacy-finance@test.local",
      csrf: "unused",
    } as Identity;
    const date = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Fortaleza",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    let report = await finance.reports(
      identity,
      "all",
      date.slice(0, 7) + "-01",
      date,
    );
    assert.equal(Number(report.outstanding.receivable), 0);
    await assert.rejects(() =>
      finance.settle(
        identity,
        titles[0].id,
        {
          version: 1,
          account_id: randomUUID(),
          amount_cents: 100,
          posted_on: date,
          reference: "Bloqueada antes da conferência",
        },
        randomUUID(),
      ),
    );
    const key = randomUUID();
    const review = {
      version: 1,
      remaining_cents: 3000,
      reference: "Comprovantes legados: R$ 50 já recebidos externamente",
    };
    await finance.reviewOpening(identity, titles[0].id, review, key);
    await finance.reviewOpening(identity, titles[0].id, review, key);
    report = await finance.reports(
      identity,
      "all",
      date.slice(0, 7) + "-01",
      date,
    );
    assert.equal(Number(report.outstanding.receivable), 3000);
    assert.equal(
      (await db.query<any>("SELECT count(*)::int AS n FROM finance_entries"))
        .rows[0].n,
      4,
    );
    assert.equal(
      (
        await db.query<any>(
          "SELECT count(*)::int AS n FROM finance_settlements",
        )
      ).rows[0].n,
      0,
    );
  } finally {
    await db.close();
  }
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Database } from "../src/server/db";
import { InventoryService } from "../src/server/domain";
import { PosService } from "../src/server/pos";
import { RepairService } from "../src/server/repairs";
import { Identity } from "../src/server/security";
import {
  queueReadyNotice,
  runWhatsAppQueue,
  whatsappConfig,
} from "../src/server/whatsapp";
import {
  receiptText,
  whatsappPhone,
  receiptWhatsAppUrl,
} from "../src/shared/pos-receipt";

test("Comprovante e WhatsApp: telefone, texto completo e URL codificada", () => {
  assert.equal(whatsappPhone("(85) 99999-0000"), "5585999990000");
  assert.equal(whatsappPhone("+351 912 345 678"), "351912345678");
  for (const p of ["", "00000", "javascript:alert(1)", "+000000000000"])
    assert.throws(() => whatsappPhone(p));
  const r = {
    sale: {
      company_name: "Loja & Ação",
      branch_name: "Centro",
      receipt_code: "V-123",
      created_at: "2026-11-26T12:00:00Z",
      operator_name: "Caixa",
      customer_name: "Cliente",
      status: "completed",
      subtotal_cents: 2500,
      discount_cents: 500,
      total_cents: 2000,
      change_cents: 1000,
    },
    items: [
      {
        quantity: 1,
        product_name: "Cabo + capa",
        sku: "A",
        identifiers: "",
        net_cents: 2000,
        warranty_days: 90,
        warranty_terms: "Garantia de teste",
      },
    ],
    payments: [{ method: "cash", tendered_cents: 3000, reference: "" }],
    returns: [],
    credit: null,
  };
  const text = receiptText(r);
  assert.match(text, /COMPROVANTE NÃO FISCAL/);
  assert.match(text, /20,00/);
  assert.match(text, /10,00/);
  assert.match(text, /Garantia de teste/);
  const url = new URL(receiptWhatsAppUrl("85999990000", text));
  assert.equal(url.origin, "https://wa.me");
  assert.equal(url.pathname, "/5585999990000");
  assert.equal(url.searchParams.get("text"), text);
  assert.equal(whatsappConfig({ WHATSAPP_ENABLED: "false" }), null);
  assert.equal(
    whatsappConfig({
      WHATSAPP_ENABLED: "true",
      WHATSAPP_TENANT_ID: randomUUID(),
    }),
    null,
  );
});

test("WhatsApp automático: fila transacional, consentimento, isolamento e ausência de reenvio incerto", async (t) => {
  const db = new Database();
  await db.open("memory://");
  const inventory = new InventoryService(db),
    pos = new PosService(db, inventory),
    repairs = new RepairService(db, inventory);
  try {
    await inventory.bootstrap({
      company: "Loja notificações",
      name: "Responsável",
      branch: "Centro",
      email: "notifications@test.local",
      password: "Testing-Notifications-2026!",
    });
    const [m] = await db.system<any>("SELECT * FROM memberships");
    const i = {
      ...m,
      user_id: m.user_id,
      permission_grants: [],
      permission_denials: [],
    } as Identity;
    const branch = m.branch_ids[0];
    const config = whatsappConfig({
      WHATSAPP_ENABLED: "true",
      WHATSAPP_TENANT_ID: m.tenant_id,
      WHATSAPP_API_VERSION: "v27.0",
      WHATSAPP_PHONE_NUMBER_ID: "1234567890",
      WHATSAPP_ACCESS_TOKEN: "test-token",
      WHATSAPP_READY_TEMPLATE: "aparelho_pronto",
      WHATSAPP_TEMPLATE_LANGUAGE: "pt_BR",
    })!;
    assert.ok(config);
    const customer = randomUUID();
    await db.provision((tx) =>
      tx.query(
        "INSERT INTO customers(id,tenant_id,name,phone,contact_permission) VALUES($1,$2,'Cliente teste','85999990000',true) RETURNING id",
        [customer, m.tenant_id],
      ),
    );
    async function order() {
      const id = randomUUID();
      await db.provision((tx) =>
        tx.query(
          "INSERT INTO repair_orders(id,tenant_id,branch_id,customer_id,code,customer_name,customer_phone,brand,model,reported_fault,physical_state,status,ready_at,created_by) VALUES($1,$2,$3,$4,$5,'Cliente teste','85999990000','Marca','Modelo','Teste','Íntegro','ready',now(),$6) RETURNING id",
          [id, m.tenant_id, branch, customer, "OS-" + id, m.user_id],
        ),
      );
      await db.transaction(m.tenant_id, (tx) =>
        queueReadyNotice(tx, m.tenant_id, branch, id),
      );
      return id;
    }
    async function notice(id: string) {
      return (
        await db.transaction(m.tenant_id, (tx) =>
          tx.query("SELECT * FROM repair_notifications WHERE order_id=$1", [
            id,
          ]),
        )
      )[0];
    }
    let calls = 0;
    const mock: typeof fetch = async (url, options) => {
      calls++;
      assert.match(
        String(url),
        /^https:\/\/graph.facebook.com\/v27.0\/1234567890\/messages$/,
      );
      const body = JSON.parse(String(options?.body));
      assert.equal(body.to, "5585999990000");
      assert.equal(body.template.components[0].parameters.length, 4);
      assert.equal(body.type, "template");
      return new Response(
        JSON.stringify({ messages: [{ id: "wamid.test-" + calls }] }),
        { status: 200 },
      );
    };
    await t.test(
      "mesma etapa cria um aviso e concorrência envia uma única vez",
      async () => {
        const id = await order();
        await db.transaction(m.tenant_id, (tx) =>
          queueReadyNotice(tx, m.tenant_id, branch, id),
        );
        assert.equal(
          (
            await db.transaction(m.tenant_id, (tx) =>
              tx.query(
                "SELECT id FROM repair_notifications WHERE order_id=$1",
                [id],
              ),
            )
          ).length,
          1,
        );
        await Promise.all([
          runWhatsAppQueue(db, config, mock),
          runWhatsAppQueue(db, config, mock),
        ]);
        assert.equal(calls, 1);
        assert.equal((await notice(id)).state, "accepted");
        await runWhatsAppQueue(db, config, mock);
        assert.equal(calls, 1);
      },
    );
    await t.test(
      "autorização atual e entrega/cancelamento são revalidados antes do envio",
      async () => {
        const id = await order();
        await db.provision((tx) =>
          tx.query(
            "UPDATE customers SET contact_permission=false WHERE id=$1 RETURNING id",
            [customer],
          ),
        );
        await runWhatsAppQueue(db, config, mock);
        assert.equal((await notice(id)).state, "blocked");
        assert.equal(calls, 1);
        await db.provision((tx) =>
          tx.query(
            "UPDATE customers SET contact_permission=true WHERE id=$1 RETURNING id",
            [customer],
          ),
        );
        await repairs.retryNotice(
          i,
          id,
          { notification_id: (await notice(id)).id },
          randomUUID(),
        );
        await runWhatsAppQueue(db, config, mock);
        assert.equal((await notice(id)).state, "accepted");
        assert.equal(calls, 2);
        const cancelled = await order();
        await db.provision((tx) =>
          tx.query(
            "UPDATE repair_orders SET status='delivered' WHERE id=$1 RETURNING id",
            [cancelled],
          ),
        );
        await runWhatsAppQueue(db, config, mock);
        assert.equal((await notice(cancelled)).state, "cancelled");
        assert.equal(calls, 2);
      },
    );
    await t.test(
      "timeout não é reenviado e recusa conhecida exige retomada explícita",
      async () => {
        const id = await order();
        await runWhatsAppQueue(db, config, async () => {
          calls++;
          throw Error("Simulated timeout");
        });
        assert.equal((await notice(id)).state, "uncertain");
        await runWhatsAppQueue(db, config, mock);
        assert.equal(calls, 3);
        const uncertainNotice = await notice(id);
        await assert.rejects(() =>
          repairs.retryNotice(
            i,
            id,
            { notification_id: uncertainNotice.id },
            randomUUID(),
          ),
        );
        const rejected = await order();
        await runWhatsAppQueue(
          db,
          config,
          async () => new Response("{}", { status: 401 }),
        );
        assert.equal((await notice(rejected)).state, "failed");
        assert.equal((await notice(rejected)).attempts, 1);
      },
    );
    await t.test(
      "reinício não repete tentativa perdida e um novo ciclo cancela o aviso antigo",
      async () => {
        const before = calls;
        const interrupted = await order();
        await db.provision((tx) =>
          tx.query(
            "UPDATE repair_notifications SET state='sending',claimed_at=now()-interval '3 minutes',attempts=1 WHERE order_id=$1 RETURNING id",
            [interrupted],
          ),
        );
        await runWhatsAppQueue(db, config, mock);
        assert.equal((await notice(interrupted)).state, "uncertain");
        assert.equal(calls, before);
        const cycle = await order();
        const old = (await notice(cycle)).id;
        await db.provision((tx) =>
          tx.query(
            "UPDATE repair_orders SET ready_at=ready_at+interval '1 second' WHERE id=$1 RETURNING id",
            [cycle],
          ),
        );
        await db.transaction(m.tenant_id, (tx) =>
          queueReadyNotice(tx, m.tenant_id, branch, cycle),
        );
        await runWhatsAppQueue(db, config, mock);
        assert.equal(
          (
            await db.transaction(m.tenant_id, (tx) =>
              tx.query("SELECT state FROM repair_notifications WHERE id=$1", [
                old,
              ]),
            )
          )[0].state,
          "cancelled",
        );
        await runWhatsAppQueue(db, config, mock);
        assert.equal(calls, before + 1);
        const events = await db.transaction(m.tenant_id, (tx) =>
          tx.query(
            "SELECT id FROM audit_events WHERE action='notification.whatsapp.accepted'",
          ),
        );
        assert.ok(events.length >= 1);
      },
    );
    await t.test(
      "tenant errado não consulta nem envia avisos e histórico é limitado à ordem autorizada",
      async () => {
        const before = calls;
        await runWhatsAppQueue(db, { ...config, tenant: randomUUID() }, mock);
        assert.equal(calls, before);
        const id = await order();
        const detail = await repairs.detail(i, id);
        assert.equal(detail.notifications.items.length, 1);
        assert.equal(detail.notifications.configured, false);
        await assert.rejects(
          () => repairs.detail({ ...i, branch_ids: [] }, id),
          /Filial/,
        );
      },
    );
    await t.test(
      "telefone do comprovante respeita venda própria, permissão e preferência atual",
      async () => {
        const product = await inventory.saveProduct(
          i,
          {
            name: "Cabo",
            sku: "REC",
            condition: "new",
            serialized: false,
            cost: 1,
            price: 10,
            warranty_days: 90,
          },
          randomUUID(),
        );
        await inventory.move(
          i,
          {
            product_id: product.id,
            branch_id: branch,
            type: "entry",
            quantity: 2,
            reason: "Teste comprovante",
          },
          randomUUID(),
        );
        const register = await pos.register(
          i,
          { branch_id: branch, name: "Caixa" },
          randomUUID(),
        );
        const session = await pos.open(
          i,
          { register_id: register.id, opening_cents: 0 },
          randomUUID(),
        );
        const sale = await pos.checkout(
          i,
          {
            session_id: session.id,
            customer_id: customer,
            items: [{ product_id: product.id, quantity: 1 }],
            expected_total_cents: 1000,
            payments: [{ method: "cash", amount_cents: 1000 }],
          },
          randomUUID(),
        );
        assert.equal((await pos.receiptContact(i, sale.id)).state, "ready");
        await db.provision((tx) =>
          tx.query(
            "UPDATE customers SET contact_permission=false WHERE id=$1 RETURNING id",
            [customer],
          ),
        );
        const blocked = await pos.receiptContact(i, sale.id);
        assert.equal(blocked.state, "blocked");
        assert.equal("phone" in blocked, false);
        await assert.rejects(
          () => pos.receiptContact({ ...i, role: "viewer" }, sale.id),
          /permissão/,
        );
        await assert.rejects(
          () => pos.receiptContact({ ...i, branch_ids: [] }, sale.id),
          /Filial/,
        );
      },
    );
  } finally {
    await db.close();
  }
});

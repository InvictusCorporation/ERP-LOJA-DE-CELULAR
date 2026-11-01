import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Database, Tx } from "./db";
import { Identity } from "./security";
import {
  InventoryService,
  uuid,
  validate,
  permit,
  branchAccess,
  audit,
  fail,
  validImei,
} from "./domain";
type Row = Record<string, any>;
const text = (max = 180, min = 1) => z.string().trim().min(min).max(max);
const optional = (max = 1000) => z.string().trim().max(max).default("");
const version = z.number().int().positive();
const cents = z.number().int().min(1).max(1000000000);
const date = z.iso.date();
const today = () =>
  new Date().toLocaleDateString("sv-SE", { timeZone: "America/Fortaleza" });
const lineSchema = z
  .object({
    product_id: uuid,
    quantity: z.number().int().min(1).max(1000000),
    unit_cost_cents: cents,
  })
  .strict();
const orderSchema = z
  .object({
    branch_id: uuid,
    supplier_id: uuid,
    expected_on: date.nullable().default(null),
    note: optional(2000),
    lines: z.array(lineSchema).min(1).max(100),
    version: z.number().int().min(0).default(0),
  })
  .strict();
const device = z
  .object({
    serial: optional(100),
    imeis: z
      .array(z.string().regex(/^\d{15}$/))
      .max(3)
      .default([]),
    provenance: text(2000, 3),
  })
  .strict();
const receiptSchema = z
  .object({
    version,
    reference: text(120, 3),
    due_on: date,
    expected_total_cents: cents,
    update_cost: z.boolean().default(false),
    lines: z
      .array(
        z
          .object({
            order_line_id: uuid,
            quantity: z.number().int().min(1).max(1000000),
            devices: z.array(device).max(200).default([]),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();
const receiptPaid = `(coalesce((SELECT sum(s.amount_cents+s.discount_cents-s.charges_cents) FROM finance_settlements s JOIN finance_entries e ON e.settlement_id=s.id AND e.source_kind='settlement' WHERE s.title_id=t.id AND NOT EXISTS(SELECT 1 FROM finance_entries v WHERE v.reverses_entry_id=e.id)),0))`;
export class PurchaseService {
  constructor(
    private db: Database,
    private inventory: InventoryService,
  ) {}
  private scope(i: Identity, branch: string) {
    permit(i, "purchase_read");
    if (branch === "all") return i.branch_ids;
    branchAccess(i, branch);
    return [branch];
  }
  private async event(
    tx: Tx,
    i: Identity,
    branch: string | null,
    id: string,
    action: string,
    details: Row = {},
  ) {
    await tx.query(
      "INSERT INTO purchase_events(id,tenant_id,branch_id,entity_id,action,details,actor_id) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7) RETURNING id",
      [
        randomUUID(),
        i.tenant_id,
        branch,
        id,
        action,
        JSON.stringify(details),
        i.user_id,
      ],
    );
    await audit(tx, i, "purchase." + action, id, details, branch);
  }
  private async supplier(tx: Tx, id: string) {
    const [s] = await tx.query(
      "SELECT c.id,c.name,c.contact,coalesce(p.document,'') AS document,coalesce(p.email,'') AS email,coalesce(p.phone,'') AS phone,coalesce(p.address,'') AS address,coalesce(p.notes,'') AS notes,coalesce(p.active,true) AS active,coalesce(p.version,0) AS version FROM catalog_entries c LEFT JOIN purchase_supplier_profiles p ON p.id=c.id WHERE c.id=$1 AND c.kind='supplier'",
      [id],
    );
    if (!s) fail(404, "Fornecedor não encontrado.");
    return s;
  }
  async suppliers(i: Identity, q: string, page: number) {
    permit(i, "purchase_read");
    return this.db.transaction(i.tenant_id, async (tx) => ({
      items: await tx.query(
        "SELECT c.id,c.name,c.contact,coalesce(p.phone,'') AS phone,coalesce(p.email,'') AS email,coalesce(p.active,true) AS active,coalesce(p.version,0) AS version,count(*) OVER()::int AS total_count FROM catalog_entries c LEFT JOIN purchase_supplier_profiles p ON p.id=c.id WHERE c.kind='supplier' AND (c.name ILIKE $1 OR coalesce(p.document,'') ILIKE $1) ORDER BY c.name,c.id LIMIT 30 OFFSET $2",
        ["%" + q.slice(0, 100) + "%", (page - 1) * 30],
      ),
    }));
  }
  async supplierDetail(i: Identity, id: string, branch: string) {
    validate(uuid, id);
    const ids = this.scope(i, branch);
    return this.db.transaction(i.tenant_id, async (tx) => ({
      supplier: await this.supplier(tx, id),
      orders: await tx.query(
        "SELECT id,code,status,total_cents,created_at FROM purchase_orders WHERE supplier_id=$1 AND branch_id=ANY($2::uuid[]) ORDER BY created_at DESC,id DESC LIMIT 30",
        [id, ids],
      ),
    }));
  }
  async saveSupplier(
    i: Identity,
    id: string | null,
    body: unknown,
    key: unknown,
  ) {
    permit(i, "purchase_manage");
    if (id) validate(uuid, id);
    const b = validate(
      z
        .object({
          name: text(),
          contact: optional(500),
          document: optional(30),
          email: z.union([z.email().max(254), z.literal("")]).default(""),
          phone: optional(30),
          address: optional(),
          notes: optional(2000),
          active: z.boolean(),
          version: z.number().int().min(0),
        })
        .strict(),
      body,
    );
    return this.inventory.write(
      i,
      key,
      { action: "purchase.supplier.save", id, b },
      async (tx) => {
        await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          i.tenant_id + ":suppliers",
        ]);
        let supplierId = id;
        if (id) {
          const old = await this.supplier(tx, id);
          if (old.version !== b.version)
            fail(409, "Fornecedor alterado. Atualize os dados.");
          await tx.query(
            "UPDATE catalog_entries SET name=$2,contact=$3 WHERE id=$1 RETURNING id",
            [id, b.name, b.contact],
          );
        } else {
          const [existing] = await tx.query(
            "SELECT id FROM catalog_entries WHERE kind='supplier' AND lower(name)=lower($1)",
            [b.name],
          );
          if (existing)
            fail(409, "Fornecedor já cadastrado. Revise o cadastro existente.");
          supplierId = randomUUID();
          await tx.query(
            "INSERT INTO catalog_entries(id,tenant_id,kind,name,contact) VALUES($1,$2,'supplier',$3,$4) RETURNING id",
            [supplierId, i.tenant_id, b.name, b.contact],
          );
        }
        await tx.query(
          "INSERT INTO purchase_supplier_profiles(tenant_id,id,document,email,phone,address,notes,active) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(tenant_id,id) DO UPDATE SET document=$3,email=$4,phone=$5,address=$6,notes=$7,active=$8,version=purchase_supplier_profiles.version+1 RETURNING id",
          [
            i.tenant_id,
            supplierId,
            b.document,
            b.email,
            b.phone,
            b.address,
            b.notes,
            b.active,
          ],
        );
        await this.event(tx, i, null, supplierId!, "supplier_saved", {
          active: b.active,
        });
        return { id: supplierId };
      },
    );
  }
  private total(lines: z.infer<typeof lineSchema>[]) {
    if (new Set(lines.map((x) => x.product_id)).size !== lines.length)
      fail(400, "Agrupe o mesmo produto em uma única linha.");
    let sum = 0;
    for (const l of lines) {
      sum += l.quantity * l.unit_cost_cents;
      if (sum > 1000000000)
        fail(400, "Pedido acima do limite de R$ 10 milhões.");
    }
    return sum;
  }
  private async order(tx: Tx, i: Identity, id: string, expected?: number) {
    validate(uuid, id);
    const [o] = await tx.query(
      "SELECT *,expected_on::text AS expected_on FROM purchase_orders WHERE id=$1 FOR UPDATE",
      [id],
    );
    if (!o) fail(404, "Pedido não encontrado.");
    branchAccess(i, o.branch_id);
    if (expected !== undefined && o.version !== expected)
      fail(409, "Pedido atualizado. Recarregue antes de confirmar.");
    return o;
  }
  async saveOrder(i: Identity, id: string | null, body: unknown, key: unknown) {
    permit(i, "purchase_manage");
    const b = validate(orderSchema, body);
    branchAccess(i, b.branch_id);
    const total = this.total(b.lines);
    return this.inventory.write(
      i,
      key,
      { action: "purchase.order.save", id, b },
      async (tx) => {
        if (id) {
          const old = await this.order(tx, i, id, b.version);
          if (old.status !== "draft")
            fail(409, "Somente rascunhos podem ser editados.");
          if (old.branch_id !== b.branch_id)
            fail(409, "A filial do pedido é preservada.");
        }
        const s = await this.supplier(tx, b.supplier_id);
        if (!s.active) fail(409, "Fornecedor inativo para novos pedidos.");
        for (const l of [...b.lines].sort((a, b) =>
          a.product_id.localeCompare(b.product_id),
        )) {
          const [p] = await tx.query(
            "SELECT id FROM products WHERE id=$1 AND active",
            [l.product_id],
          );
          if (!p) fail(400, "Produto inválido ou arquivado.");
        }
        const orderId = id || randomUUID();
        if (id)
          await tx.query(
            "UPDATE purchase_orders SET supplier_id=$2,expected_on=$3,note=$4,draft_lines=$5::jsonb,total_cents=$6,version=version+1 WHERE id=$1 RETURNING id",
            [
              id,
              b.supplier_id,
              b.expected_on,
              b.note,
              JSON.stringify(b.lines),
              total,
            ],
          );
        else
          await tx.query(
            "INSERT INTO purchase_orders(id,tenant_id,branch_id,supplier_id,code,status,draft_lines,total_cents,expected_on,note,created_by) VALUES($1,$2,$3,$4,$5,'draft',$6::jsonb,$7,$8,$9,$10) RETURNING id",
            [
              orderId,
              i.tenant_id,
              b.branch_id,
              b.supplier_id,
              "PC-" + orderId.toUpperCase(),
              JSON.stringify(b.lines),
              total,
              b.expected_on,
              b.note,
              i.user_id,
            ],
          );
        await this.event(tx, i, b.branch_id, orderId, "draft_saved", {
          total_cents: total,
        });
        return { id: orderId };
      },
    );
  }
  async issue(i: Identity, id: string, body: unknown, key: unknown) {
    permit(i, "purchase_manage");
    const b = validate(z.object({ version }).strict(), body);
    return this.inventory.write(
      i,
      key,
      { action: "purchase.order.issue", id, b },
      async (tx) => {
        const o = await this.order(tx, i, id, b.version);
        if (o.status !== "draft")
          fail(409, "Pedido já confirmado ou cancelado.");
        const s = await this.supplier(tx, o.supplier_id);
        if (!s.active) fail(409, "Fornecedor inativo.");
        for (const l of [...o.draft_lines].sort((a, b) =>
          a.product_id.localeCompare(b.product_id),
        )) {
          const [p] = await tx.query(
            "SELECT * FROM products WHERE id=$1 AND active FOR UPDATE",
            [l.product_id],
          );
          if (!p) fail(409, "Produto indisponível. Revise o pedido.");
          await tx.query(
            "INSERT INTO purchase_order_lines(id,tenant_id,order_id,product_id,product_name,sku,serialized,quantity,unit_cost_cents) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id",
            [
              randomUUID(),
              i.tenant_id,
              id,
              p.id,
              p.name,
              p.sku,
              p.serialized,
              l.quantity,
              l.unit_cost_cents,
            ],
          );
        }
        await tx.query(
          "UPDATE purchase_orders SET status='ordered',supplier_snapshot=$2::jsonb,version=version+1 WHERE id=$1 RETURNING id",
          [id, JSON.stringify(s)],
        );
        await this.event(tx, i, o.branch_id, id, "order_issued");
        return { id };
      },
    );
  }
  private async lines(tx: Tx, id: string) {
    return tx.query(
      "SELECT l.*,coalesce((SELECT sum(x.quantity) FROM purchase_receipt_lines x WHERE x.order_line_id=l.id AND NOT EXISTS(SELECT 1 FROM purchase_receipt_reversals r WHERE r.receipt_id=x.receipt_id)),0)::int AS received_quantity FROM purchase_order_lines l WHERE l.order_id=$1 ORDER BY l.product_id",
      [id],
    );
  }
  async list(
    i: Identity,
    branch: string,
    q: string,
    status: string,
    page: number,
  ) {
    const ids = this.scope(i, branch);
    if (
      !["all", "draft", "ordered", "partial", "received", "cancelled"].includes(
        status,
      )
    )
      fail(400, "Situação inválida.");
    return this.db.transaction(i.tenant_id, async (tx) => ({
      items: await tx.query(
        "SELECT o.id,o.code,o.status,o.version,o.total_cents,o.expected_on::text AS expected_on,o.created_at,c.name AS supplier_name,b.name AS branch_name,count(*) OVER()::int AS total_count FROM purchase_orders o JOIN catalog_entries c ON c.id=o.supplier_id JOIN branches b ON b.id=o.branch_id WHERE o.branch_id=ANY($1::uuid[]) AND (o.code ILIKE $2 OR c.name ILIKE $2) AND ($3='all' OR o.status=$3) ORDER BY o.created_at DESC,o.id DESC LIMIT 30 OFFSET $4",
        [ids, "%" + q.slice(0, 100) + "%", status, (page - 1) * 30],
      ),
    }));
  }
  async detail(i: Identity, id: string) {
    permit(i, "purchase_read");
    return this.db.transaction(i.tenant_id, async (tx) => {
      const o = await this.order(tx, i, id),
        s = await this.supplier(tx, o.supplier_id);
      const confirmed = !!o.supplier_snapshot?.id;
      const lines = !confirmed
        ? await Promise.all(
            o.draft_lines.map(async (l: Row) => {
              const [p] = await tx.query(
                "SELECT name,sku,serialized FROM products WHERE id=$1",
                [l.product_id],
              );
              return {
                ...l,
                product_name: p?.name,
                sku: p?.sku,
                serialized: p?.serialized,
                received_quantity: 0,
              };
            }),
          )
        : await this.lines(tx, id);
      const receipts = await tx.query(
        `SELECT r.*,r.received_on::text AS received_on,r.due_on::text AS due_on,v.id IS NOT NULL AS reversed,v.reason AS reversal_reason,t.id AS title_id,t.cancelled AS title_cancelled,${receiptPaid}::text AS paid_cents FROM purchase_receipts r LEFT JOIN purchase_receipt_reversals v ON v.receipt_id=r.id JOIN finance_titles t ON t.purchase_receipt_id=r.id WHERE r.order_id=$1 ORDER BY r.created_at DESC,r.id DESC LIMIT 100`,
        [id],
      );
      const events = await tx.query(
        "SELECT e.*,u.name AS actor_name FROM purchase_events e JOIN users u ON u.id=e.actor_id WHERE entity_id=$1 ORDER BY created_at DESC,e.id DESC LIMIT 100",
        [id],
      );
      return {
        order: o,
        supplier: confirmed ? o.supplier_snapshot : s,
        lines,
        receipts,
        events,
      };
    });
  }
  async receiptDetail(i: Identity, orderId: string, receiptId: string) {
    permit(i, "purchase_read");
    validate(uuid, receiptId);
    return this.db.transaction(i.tenant_id, async (tx) => {
      const o = await this.order(tx, i, orderId);
      const [r] = await tx.query(
        "SELECT r.*,r.received_on::text AS received_on,r.due_on::text AS due_on,v.id IS NOT NULL AS reversed FROM purchase_receipts r LEFT JOIN purchase_receipt_reversals v ON v.receipt_id=r.id WHERE r.id=$1 AND r.order_id=$2",
        [receiptId, orderId],
      );
      if (!r) fail(404, "Recebimento não encontrado.");
      const lines = await tx.query(
        "SELECT l.*,o.product_name,o.sku FROM purchase_receipt_lines l JOIN purchase_order_lines o ON o.id=l.order_line_id WHERE l.receipt_id=$1 ORDER BY o.product_id",
        [receiptId],
      );
      const units = await tx.query(
        "SELECT ru.receipt_line_id,u.id,u.serial,u.provenance,coalesce(array_agg(d.imei) FILTER(WHERE d.imei IS NOT NULL),'{}') AS imeis FROM purchase_receipt_units ru JOIN device_units u ON u.id=ru.unit_id LEFT JOIN device_identifiers d ON d.unit_id=u.id WHERE ru.receipt_line_id=ANY($1::uuid[]) GROUP BY ru.receipt_line_id,u.id,u.serial,u.provenance ORDER BY u.id",
        [lines.map((l) => l.id)],
      );
      return {
        order: o,
        supplier: o.supplier_snapshot,
        receipt: r,
        lines: lines.map((l) => ({
          ...l,
          units: units.filter((u) => u.receipt_line_id === l.id),
        })),
      };
    });
  }
  private async refresh(tx: Tx, o: Row) {
    if (o.status === "cancelled") {
      await tx.query(
        "UPDATE purchase_orders SET version=version+1 WHERE id=$1 RETURNING id",
        [o.id],
      );
      return;
    }
    const lines = await this.lines(tx, o.id),
      any = lines.some((l) => l.received_quantity > 0),
      all = lines.every((l) => l.received_quantity === l.quantity);
    await tx.query(
      "UPDATE purchase_orders SET status=$2,version=version+1 WHERE id=$1 RETURNING id",
      [o.id, all ? "received" : any ? "partial" : "ordered"],
    );
  }
  async cancel(i: Identity, id: string, body: unknown, key: unknown) {
    permit(i, "purchase_manage");
    const b = validate(
      z.object({ version, reason: text(1000, 5) }).strict(),
      body,
    );
    return this.inventory.write(
      i,
      key,
      { action: "purchase.order.cancel", id, b },
      async (tx) => {
        const o = await this.order(tx, i, id, b.version);
        if (!["draft", "ordered", "partial"].includes(o.status))
          fail(409, "Pedido já concluído ou cancelado.");
        await tx.query(
          "UPDATE purchase_orders SET status='cancelled',version=version+1 WHERE id=$1 RETURNING id",
          [id],
        );
        await this.event(tx, i, o.branch_id, id, "remaining_cancelled", {
          reason: b.reason,
        });
        return { id };
      },
    );
  }
  async receive(i: Identity, id: string, body: unknown, key: unknown) {
    permit(i, "purchase_manage");
    const b = validate(receiptSchema, body);
    if (new Set(b.lines.map((l) => l.order_line_id)).size !== b.lines.length)
      fail(400, "Linha repetida no recebimento.");
    if (b.lines.reduce((n, l) => n + l.devices.length, 0) > 200)
      fail(400, "Receba até 200 unidades identificadas por operação.");
    return this.inventory.write(
      i,
      key,
      { action: "purchase.receive", id, b },
      async (tx) => {
        const o = await this.order(tx, i, id, b.version);
        if (!["ordered", "partial"].includes(o.status))
          fail(409, "Pedido não está aberto para recebimento.");
        const lines = await this.lines(tx, id),
          entries = b.lines.map((l) => ({
            input: l,
            line: lines.find((x) => x.id === l.order_line_id),
          }));
        let total = 0;
        for (const { input: l, line: x } of entries) {
          if (!x || l.quantity > x.quantity - x.received_quantity)
            fail(409, "Quantidade recebida acima do saldo do pedido.");
          if (
            x.serialized
              ? l.devices.length !== l.quantity
              : l.devices.length > 0
          )
            fail(
              400,
              "Confira as identificações: uma por unidade com controle individual.",
            );
          total += l.quantity * x.unit_cost_cents;
        }
        if (total !== b.expected_total_cents)
          fail(409, "Total do recebimento alterado. Confira os valores.");
        const receiptId = randomUUID(),
          received = today(),
          titleId = randomUUID();
        await tx.query(
          "INSERT INTO purchase_receipts(id,tenant_id,branch_id,order_id,supplier_id,reference,received_on,due_on,total_cents,update_cost,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id",
          [
            receiptId,
            i.tenant_id,
            o.branch_id,
            id,
            o.supplier_id,
            b.reference,
            received,
            b.due_on,
            total,
            b.update_cost,
            i.user_id,
          ],
        );
        for (const { input: l, line: x } of entries.sort((a, b) =>
          a.line!.product_id.localeCompare(b.line!.product_id),
        )) {
          const { p, stock } = await this.inventory.lockStock(
            tx,
            i,
            x!.product_id,
            o.branch_id,
          );
          if (p.serialized !== x!.serialized)
            fail(
              409,
              "Controle do produto mudou. Cancele o saldo e refaça o pedido.",
            );
          const lineId = randomUUID();
          await tx.query(
            "INSERT INTO purchase_receipt_lines(id,tenant_id,receipt_id,order_id,order_line_id,quantity,unit_cost_cents) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id",
            [
              lineId,
              i.tenant_id,
              receiptId,
              id,
              x!.id,
              l.quantity,
              x!.unit_cost_cents,
            ],
          );
          const ledger = {
            branch_id: o.branch_id,
            product_id: p.id,
            reason: `Recebimento ${o.code} · ${b.reference}`,
          };
          if (p.serialized) {
            let balance = stock.quantity;
            for (const d of l.devices) {
              if (
                (!d.serial && !d.imeis.length) ||
                new Set(d.imeis).size !== d.imeis.length ||
                d.imeis.some((n) => !validImei(n))
              )
                fail(
                  400,
                  "Informe série ou IMEI válido e sem repetição para cada unidade.",
                );
              const unit = randomUUID();
              await tx.query(
                "INSERT INTO device_units(id,tenant_id,product_id,branch_id,serial,provenance,supplier_id,acquisition_cost,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'in_stock') RETURNING id",
                [
                  unit,
                  i.tenant_id,
                  p.id,
                  o.branch_id,
                  d.serial || null,
                  d.provenance,
                  o.supplier_id,
                  x!.unit_cost_cents / 100,
                ],
              );
              for (const imei of d.imeis)
                await tx.query(
                  "INSERT INTO device_identifiers(tenant_id,unit_id,imei) VALUES($1,$2,$3) RETURNING imei",
                  [i.tenant_id, unit, imei],
                );
              await tx.query(
                "INSERT INTO purchase_receipt_units(tenant_id,receipt_line_id,unit_id) VALUES($1,$2,$3) RETURNING unit_id",
                [i.tenant_id, lineId, unit],
              );
              await this.inventory.ledger(
                tx,
                i,
                ledger,
                1,
                ++balance,
                "entry",
                unit,
                null,
                { purchaseReceiptLineId: lineId },
              );
            }
          } else
            await this.inventory.ledger(
              tx,
              i,
              ledger,
              l.quantity,
              stock.quantity + l.quantity,
              "entry",
              null,
              null,
              { purchaseReceiptLineId: lineId },
            );
          if (b.update_cost)
            await tx.query(
              "UPDATE products SET cost=$2,supplier_id=$3,version=version+1 WHERE id=$1 RETURNING id",
              [p.id, x!.unit_cost_cents / 100, o.supplier_id],
            );
        }
        await tx.query(
          "INSERT INTO finance_titles(id,tenant_id,branch_id,direction,description,counterparty,amount_cents,competence_on,due_on,source_kind,purchase_receipt_id,affects_result,created_by) VALUES($1,$2,$3,'payable',$4,$5,$6,$7,$8,'purchase',$9,false,$10) RETURNING id",
          [
            titleId,
            i.tenant_id,
            o.branch_id,
            `Compra ${o.code} · ${b.reference}`,
            o.supplier_snapshot.name,
            total,
            received,
            b.due_on,
            receiptId,
            i.user_id,
          ],
        );
        await tx.query(
          "INSERT INTO finance_events(id,tenant_id,branch_id,entity_id,action,details,actor_id) VALUES($1,$2,$3,$4,'purchase_received',$5::jsonb,$6) RETURNING id",
          [
            randomUUID(),
            i.tenant_id,
            o.branch_id,
            titleId,
            JSON.stringify({ receipt_id: receiptId, order_id: id }),
            i.user_id,
          ],
        );
        await this.refresh(tx, o);
        await this.event(tx, i, o.branch_id, id, "goods_received", {
          receipt_id: receiptId,
          reference: b.reference,
          total_cents: total,
          title_id: titleId,
          update_cost: b.update_cost,
        });
        return { id: receiptId, title_id: titleId };
      },
    );
  }
  async reverseReceipt(
    i: Identity,
    orderId: string,
    receiptId: string,
    body: unknown,
    key: unknown,
  ) {
    permit(i, "purchase_manage");
    validate(uuid, receiptId);
    const b = validate(
      z.object({ version, reason: text(1000, 5) }).strict(),
      body,
    );
    return this.inventory.write(
      i,
      key,
      { action: "purchase.receipt.reverse", orderId, receiptId, b },
      async (tx) => {
        const o = await this.order(tx, i, orderId, b.version),
          [r] = await tx.query(
            "SELECT * FROM purchase_receipts WHERE id=$1 AND order_id=$2",
            [receiptId, orderId],
          );
        if (!r) fail(404, "Recebimento não encontrado.");
        const [reversed] = await tx.query(
          "SELECT id FROM purchase_receipt_reversals WHERE receipt_id=$1",
          [receiptId],
        );
        if (reversed) fail(409, "Recebimento já estornado.");
        const [t] = await tx.query(
          `SELECT t.*,${receiptPaid}::text AS paid_cents FROM finance_titles t WHERE purchase_receipt_id=$1 FOR UPDATE OF t`,
          [receiptId],
        );
        if (!t || Number(t.paid_cents) !== 0)
          fail(
            409,
            "Estorne as baixas financeiras antes de corrigir o recebimento.",
          );
        const rows = await tx.query(
          "SELECT m.* FROM stock_movements m JOIN purchase_receipt_lines l ON l.id=m.purchase_receipt_line_id WHERE l.receipt_id=$1 AND m.type='entry' ORDER BY m.product_id,m.id",
          [receiptId],
        );
        for (const m of rows) {
          const { stock } = await this.inventory.lockStock(
            tx,
            i,
            m.product_id,
            o.branch_id,
          );
          if (stock.quantity < m.quantity)
            fail(409, "Estoque insuficiente para estornar o recebimento.");
          if (m.unit_id) {
            const [later] = await tx.query(
              "SELECT id FROM stock_movements WHERE unit_id=$1 AND id<>$2 AND (created_at>$3 OR (created_at=$3 AND id<>$2)) LIMIT 1",
              [m.unit_id, m.id, m.created_at],
            );
            const [u] = await tx.query(
              "SELECT status FROM device_units WHERE id=$1 FOR UPDATE",
              [m.unit_id],
            );
            if (later || u?.status !== "in_stock")
              fail(
                409,
                "Unidade já movimentada. Não é possível estornar este recebimento.",
              );
            await tx.query(
              "UPDATE device_units SET status='out' WHERE id=$1 RETURNING id",
              [m.unit_id],
            );
          }
          await this.inventory.ledger(
            tx,
            i,
            {
              branch_id: o.branch_id,
              product_id: m.product_id,
              reason: b.reason,
            },
            -m.quantity,
            stock.quantity - m.quantity,
            "reversal",
            m.unit_id,
            m.id,
            { purchaseReceiptLineId: m.purchase_receipt_line_id },
          );
        }
        await tx.query(
          "INSERT INTO purchase_receipt_reversals(id,tenant_id,receipt_id,reason,created_by) VALUES($1,$2,$3,$4,$5) RETURNING id",
          [randomUUID(), i.tenant_id, receiptId, b.reason, i.user_id],
        );
        await tx.query(
          "UPDATE finance_titles SET cancelled=true,version=version+1 WHERE id=$1 RETURNING id",
          [t.id],
        );
        await tx.query(
          "INSERT INTO finance_events(id,tenant_id,branch_id,entity_id,action,details,actor_id) VALUES($1,$2,$3,$4,'purchase_reversed',$5::jsonb,$6) RETURNING id",
          [
            randomUUID(),
            i.tenant_id,
            o.branch_id,
            t.id,
            JSON.stringify({ reason: b.reason, receipt_id: receiptId }),
            i.user_id,
          ],
        );
        await this.refresh(tx, o);
        await this.event(tx, i, o.branch_id, orderId, "receipt_reversed", {
          receipt_id: receiptId,
          reason: b.reason,
        });
        return { id: receiptId };
      },
    );
  }
}

import { randomUUID, createHash } from "node:crypto";
import sharp from "sharp";
import { z } from "zod";
import { Database, Tx } from "./db";
import { Identity, permissions } from "./security";
import {
  InventoryService,
  uuid,
  validate,
  permit,
  branchAccess,
  fail,
  audit,
  validImei,
} from "./domain";
import { toCents } from "../shared/money";

type Row = Record<string, any>;
const text = (max = 2000) => z.string().trim().min(1).max(max);
const optionalText = (max = 2000) => z.string().trim().max(max).default("");
const cents = z.number().int().min(0).max(1000000000);
const version = z.number().int().positive();
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(`${s}T12:00:00Z`);
    return !isNaN(d.valueOf()) && d.toISOString().slice(0, 10) === s;
  }, "Data inválida.")
  .nullable()
  .default(null);
const customerSchema = z
  .object({
    name: text(180),
    phone: z
      .string()
      .transform((v) => v.replace(/\D/g, ""))
      .pipe(z.string().min(10).max(15)),
    email: z.union([z.email().max(254), z.literal("")]).default(""),
    contact_permission: z.boolean().default(false),
  })
  .strict();
const intakeSchema = z
  .object({
    branch_id: uuid,
    customer_id: uuid.optional(),
    customer: customerSchema.optional(),
    brand: text(100),
    model: text(150),
    color: optionalText(80),
    imei: z.string().trim().optional(),
    serial: z.string().trim().max(100).optional(),
    reported_fault: text(),
    physical_state: text(),
    accessories: optionalText(),
    intake_notes: optionalText(),
    technician_id: uuid.nullable().default(null),
    due_on: date,
  })
  .strict()
  .refine(
    (b) => !!b.customer_id !== !!b.customer,
    "Selecione um cliente existente ou cadastre um novo.",
  );
const quoteSchema = z
  .object({
    version,
    labor_price_cents: cents,
    labor_cost_cents: cents,
    items: z
      .array(
        z
          .object({
            product_id: uuid,
            quantity: z.number().int().min(1).max(10000),
            unit_price_cents: cents,
          })
          .strict(),
      )
      .max(50),
    warranty_days: z.number().int().min(0).max(3650),
    warranty_terms: optionalText(),
    notes: optionalText(),
  })
  .strict();
function money(v: unknown) {
  try {
    return toCents(v);
  } catch {
    fail(400, "Custo do produto acima do limite permitido na assistência.");
  }
}
export class RepairService {
  constructor(
    private db: Database,
    private inventory: InventoryService,
  ) {}
  private manages(i: Identity) {
    return permissions(i.role).includes("service_manage");
  }
  private async order(
    tx: Tx,
    i: Identity,
    id: string,
    expected?: number,
    lock = true,
  ): Promise<Row> {
    validate(uuid, id);
    const [o] = await tx.query(
      `SELECT *,due_on::text AS due_on,warranty_expires_on::text AS warranty_expires_on FROM repair_orders WHERE id=$1 ${lock ? "FOR UPDATE" : ""}`,
      [id],
    );
    if (!o) fail(404, "Ordem de serviço não encontrada.");
    branchAccess(i, o.branch_id);
    if (!this.manages(i) && o.technician_id !== i.user_id)
      fail(403, "Você só pode acessar as ordens atribuídas a você.");
    if (expected !== undefined && o.version !== expected)
      fail(
        409,
        "A ordem foi atualizada. Recarregue os dados antes de continuar.",
      );
    return o;
  }
  private editable(o: Row) {
    if (o.status === "delivered")
      fail(409, "Ordem entregue: o histórico não pode ser alterado.");
  }
  private async technician(
    tx: Tx,
    i: Identity,
    branch: string,
    id: string | null,
  ) {
    if (!id) return;
    const [m] = await tx.query(
      `SELECT u.id FROM users u JOIN memberships m ON m.user_id=u.id WHERE u.id=$1 AND m.tenant_id=$2 AND m.active AND u.active AND m.role IN ('owner','manager','technician') AND $3::uuid=ANY(m.branch_ids)`,
      [id, i.tenant_id, branch],
    );
    if (!m) fail(400, "Técnico inválido ou sem acesso à filial.");
  }
  private async event(
    tx: Tx,
    i: Identity,
    o: Row,
    action: string,
    details: unknown = {},
  ) {
    await tx.query(
      "INSERT INTO repair_events(id,tenant_id,order_id,actor_id,action,details) VALUES($1,$2,$3,$4,$5,$6::jsonb) RETURNING id",
      [
        randomUUID(),
        i.tenant_id,
        o.id,
        i.user_id,
        action,
        JSON.stringify(details),
      ],
    );
    await audit(tx, i, `repair.${action}`, o.id, details, o.branch_id);
  }
  private async netParts(tx: Tx, id: string) {
    const [r] = await tx.query(
      "SELECT coalesce(sum(CASE WHEN kind='issue' THEN quantity ELSE -quantity END),0)::int AS quantity FROM repair_part_events WHERE order_id=$1",
      [id],
    );
    return r.quantity as number;
  }
  async technicians(i: Identity, branch: string) {
    permit(i, "service_manage");
    branchAccess(i, branch);
    return this.db.transaction(i.tenant_id, async (tx) => ({
      items: await tx.query(
        "SELECT u.id,u.name,m.role FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.tenant_id=$1 AND m.active AND u.active AND m.role IN ('owner','manager','technician') AND $2::uuid=ANY(m.branch_ids) ORDER BY u.name",
        [i.tenant_id, branch],
      ),
    }));
  }
  async customers(i: Identity, q: string) {
    permit(i, "service_manage");
    return this.db.transaction(i.tenant_id, async (tx) => ({
      items: await tx.query(
        "SELECT id,name,phone,email FROM customers WHERE active AND (name ILIKE $1 OR phone ILIKE $1) ORDER BY name LIMIT 30",
        [`%${q.slice(0, 100)}%`],
      ),
    }));
  }
  async list(
    i: Identity,
    branch: string,
    q: string,
    status: string,
    page: number,
  ) {
    permit(i, "service_read");
    branchAccess(i, branch);
    return this.db.transaction(i.tenant_id, async (tx) => {
      const params = [
        branch,
        this.manages(i),
        i.user_id,
        `%${q.slice(0, 100)}%`,
        status,
        (page - 1) * 30,
      ];
      const items = await tx.query(
        `SELECT o.id,o.code,o.customer_name,o.customer_phone,o.brand,o.model,o.imei,o.serial,o.reported_fault,o.status,o.due_on::text AS due_on,o.version,o.created_at,u.name AS technician_name,q.total_cents,count(*) OVER()::int AS total_count FROM repair_orders o LEFT JOIN users u ON u.id=o.technician_id LEFT JOIN repair_quotes q ON q.id=o.current_quote_id WHERE o.branch_id=$1 AND ($2::boolean OR o.technician_id=$3) AND (o.code ILIKE $4 OR o.customer_name ILIKE $4 OR o.imei ILIKE $4 OR o.serial ILIKE $4 OR o.model ILIKE $4) AND ($5='' OR o.status=$5) ORDER BY o.created_at DESC,o.id DESC LIMIT 30 OFFSET $6`,
        params,
      );
      const [stats] = await tx.query(
        `SELECT count(*) FILTER(WHERE status<>'delivered')::int AS open,count(*) FILTER(WHERE status='awaiting_approval')::int AS approval,count(*) FILTER(WHERE status='in_repair')::int AS repairing,count(*) FILTER(WHERE status IN ('ready','declined','cancelled'))::int AS pickup FROM repair_orders WHERE branch_id=$1 AND ($2::boolean OR technician_id=$3)`,
        params.slice(0, 3),
      );
      return { items, total: items[0]?.total_count || 0, stats };
    });
  }
  async create(i: Identity, body: unknown, key: unknown) {
    permit(i, "service_manage");
    const b = validate(intakeSchema, body);
    branchAccess(i, b.branch_id);
    if (b.imei && !validImei(b.imei)) fail(400, "IMEI inválido.");
    return this.inventory.write(
      i,
      key,
      { action: "repair.create", b },
      async (tx) => {
        await this.technician(tx, i, b.branch_id, b.technician_id);
        let customer: Row;
        if (b.customer_id) {
          const [c] = await tx.query(
            "SELECT * FROM customers WHERE id=$1 AND active FOR SHARE",
            [b.customer_id],
          );
          if (!c) fail(400, "Cliente não encontrado nesta empresa.");
          customer = c;
        } else {
          const c = b.customer!;
          const id = randomUUID();
          await tx.query(
            "INSERT INTO customers(id,tenant_id,name,phone,email,contact_permission) VALUES($1,$2,$3,$4,$5,$6) RETURNING id",
            [id, i.tenant_id, c.name, c.phone, c.email, c.contact_permission],
          );
          customer = { ...c, id };
          await tx.query(
            "INSERT INTO crm_events(id,tenant_id,customer_id,entity_id,action,details,actor_id) VALUES($1,$2,$3,$3,$4,$5::jsonb,$6) RETURNING id",
            [
              randomUUID(),
              i.tenant_id,
              id,
              "contact_permission",
              JSON.stringify({
                allowed: c.contact_permission,
                evidence:
                  "Preferência informada no recebimento da ordem de serviço",
              }),
              i.user_id,
            ],
          );
        }
        const id = randomUUID(),
          code = `OS-${id.toUpperCase()}`;
        await tx.query(
          `INSERT INTO repair_orders(id,tenant_id,branch_id,customer_id,code,customer_name,customer_phone,customer_email,brand,model,color,imei,serial,reported_fault,physical_state,accessories,intake_notes,technician_id,due_on,status,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,'received',$20) RETURNING id`,
          [
            id,
            i.tenant_id,
            b.branch_id,
            customer.id,
            code,
            customer.name,
            customer.phone,
            customer.email,
            b.brand,
            b.model,
            b.color,
            b.imei || null,
            b.serial || null,
            b.reported_fault,
            b.physical_state,
            b.accessories,
            b.intake_notes,
            b.technician_id,
            b.due_on,
            i.user_id,
          ],
        );
        await this.event(tx, i, { id, branch_id: b.branch_id }, "received", {
          code,
          model: b.model,
          customer_name: customer.name,
        });
        return { id, code };
      },
    );
  }
  async detail(i: Identity, id: string) {
    permit(i, "service_read");
    return this.db.transaction(i.tenant_id, async (tx) => {
      const o = await this.order(tx, i, id, undefined, false);
      const [names] = await tx.query(
        "SELECT t.name AS company_name,b.name AS branch_name,u.name AS technician_name FROM tenants t JOIN branches b ON b.tenant_id=t.id LEFT JOIN users u ON u.id=$2 WHERE b.id=$1",
        [o.branch_id, o.technician_id],
      );
      const quotes = await tx.query(
        "SELECT q.*,u.name AS author_name FROM repair_quotes q JOIN users u ON u.id=q.created_by WHERE order_id=$1 ORDER BY revision DESC",
        [id],
      );
      const items = await tx.query(
        `SELECT x.*,coalesce((SELECT sum(CASE WHEN e.kind='issue' THEN e.quantity ELSE -e.quantity END) FROM repair_part_events e WHERE e.quote_item_id=x.id),0)::int AS used_quantity FROM repair_quote_items x WHERE order_id=$1 ORDER BY product_name`,
        [id],
      );
      const parts = await tx.query(
        `SELECT e.*,p.name AS product_name,u.name AS actor_name,coalesce((SELECT sum(r.quantity) FROM repair_part_events r WHERE r.issue_id=e.id),0)::int AS returned_quantity FROM repair_part_events e JOIN products p ON p.id=e.product_id JOIN users u ON u.id=e.actor_id WHERE e.order_id=$1 ORDER BY e.created_at DESC,e.id DESC`,
        [id],
      );
      const current = quotes.find((q) => q.id === o.current_quote_id);
      const currentItems = items.filter(
        (x) => x.quote_id === o.current_quote_id,
      );
      const withoutRepair =
        ["declined", "cancelled"].includes(o.status) ||
        (o.status === "delivered" && o.delivery_outcome !== "ready");
      const total = withoutRepair
        ? 0
        : (current?.labor_price_cents || 0) +
          currentItems.reduce(
            (n, x) => n + x.used_quantity * x.unit_price_cents,
            0,
          );
      const cost = withoutRepair
        ? 0
        : (current?.labor_cost_cents || 0) +
          parts.reduce(
            (n, e) =>
              n +
              (e.kind === "issue" ? 1 : -1) * e.quantity * e.unit_cost_cents,
            0,
          );
      if (!permissions(i.role).includes("service_cost")) {
        quotes.forEach((q) => delete q.labor_cost_cents);
        items.forEach((x) => delete x.unit_cost_cents);
        parts.forEach((e) => delete e.unit_cost_cents);
      }
      const photos = await tx.query(
        "SELECT id,filename,sha256,created_at FROM repair_photos WHERE order_id=$1 ORDER BY created_at",
        [id],
      );
      const approvals = await tx.query(
        "SELECT a.*,u.name AS recorder_name FROM repair_approvals a JOIN users u ON u.id=a.recorded_by WHERE order_id=$1 ORDER BY a.created_at",
        [id],
      );
      const timeline = await tx.query(
        "SELECT e.*,u.name AS actor_name FROM repair_events e JOIN users u ON u.id=e.actor_id WHERE order_id=$1 ORDER BY e.created_at,e.id",
        [id],
      );
      const deviceHistory =
        o.imei || o.serial
          ? await tx.query(
              `SELECT id,code,brand,model,status,created_at,delivered_at FROM repair_orders WHERE id<>$1 AND branch_id=ANY($2::uuid[]) AND ($3::boolean OR technician_id=$4) AND (($5::text IS NOT NULL AND imei=$5) OR ($6::text IS NOT NULL AND serial=$6)) ORDER BY created_at DESC LIMIT 20`,
              [id, i.branch_ids, this.manages(i), i.user_id, o.imei, o.serial],
            )
          : [];
      return {
        order: { ...o, ...names },
        quotes,
        items,
        parts,
        photos,
        approvals,
        timeline,
        device_history: deviceHistory,
        totals: {
          quoted_cents: current?.total_cents || 0,
          actual_cents: total,
          ...(permissions(i.role).includes("service_cost")
            ? { cost_cents: cost, margin_cents: total - cost }
            : {}),
        },
      };
    });
  }
  async info(i: Identity, id: string, body: unknown, key: unknown) {
    permit(i, "service_manage");
    const b = validate(
      z
        .object({
          version,
          technician_id: uuid.nullable(),
          due_on: date,
          intake_notes: optionalText(),
        })
        .strict(),
      body,
    );
    return this.inventory.write(
      i,
      key,
      { action: "repair.info", id, b },
      async (tx) => {
        const o = await this.order(tx, i, id, b.version);
        this.editable(o);
        await this.technician(tx, i, o.branch_id, b.technician_id);
        if (
          ["approved", "in_repair", "ready"].includes(o.status) &&
          !b.technician_id
        )
          fail(400, "Mantenha um técnico responsável pelo serviço aprovado.");
        await tx.query(
          "UPDATE repair_orders SET technician_id=$1,due_on=$2,intake_notes=$3,version=version+1 WHERE id=$4 RETURNING id",
          [b.technician_id, b.due_on, b.intake_notes, id],
        );
        await this.event(tx, i, o, "assigned", {
          technician_id: b.technician_id,
          due_on: b.due_on,
        });
        return { ok: true };
      },
    );
  }
  async diagnose(i: Identity, id: string, body: unknown, key: unknown) {
    permit(i, "service_work");
    const b = validate(z.object({ version, diagnosis: text() }).strict(), body);
    return this.inventory.write(
      i,
      key,
      { action: "repair.diagnose", id, b },
      async (tx) => {
        const o = await this.order(tx, i, id, b.version);
        this.editable(o);
        if (["ready", "declined", "cancelled"].includes(o.status))
          fail(409, "A ordem não está disponível para diagnóstico.");
        const status = o.status === "received" ? "diagnosis" : o.status;
        await tx.query(
          "UPDATE repair_orders SET diagnosis=$1,status=$2,version=version+1 WHERE id=$3 RETURNING id",
          [b.diagnosis, status, id],
        );
        await this.event(tx, i, o, "diagnosed", { diagnosis: b.diagnosis });
        return { ok: true };
      },
    );
  }
  async quote(i: Identity, id: string, body: unknown, key: unknown) {
    permit(i, "service_manage");
    const b = validate(quoteSchema, body);
    if (new Set(b.items.map((x) => x.product_id)).size !== b.items.length)
      fail(400, "Agrupe as peças repetidas.");
    return this.inventory.write(
      i,
      key,
      { action: "repair.quote", id, b },
      async (tx) => {
        const o = await this.order(tx, i, id, b.version);
        this.editable(o);
        if (o.status === "cancelled" || o.status === "ready")
          fail(409, "Não é possível alterar o orçamento nesta situação.");
        if (!o.diagnosis)
          fail(400, "Registre o diagnóstico antes de preparar o orçamento.");
        if (!o.technician_id)
          fail(400, "Defina o técnico responsável antes do orçamento.");
        await this.technician(tx, i, o.branch_id, o.technician_id);
        if (await this.netParts(tx, id))
          fail(
            409,
            "Devolva as peças utilizadas antes de substituir o orçamento aprovado.",
          );
        let total = b.labor_price_cents;
        const lines: Row[] = [];
        for (const item of b.items) {
          const [p] = await tx.query(
            "SELECT * FROM products WHERE id=$1 AND active",
            [item.product_id],
          );
          if (!p || p.serialized)
            fail(
              400,
              "Utilize peças ativas sem controle individual de aparelho.",
            );
          total += item.quantity * item.unit_price_cents;
          lines.push({
            ...item,
            id: randomUUID(),
            product_name: p.name,
            sku: p.sku,
            unit_cost_cents: money(p.cost),
          });
        }
        if (total > 1000000000)
          fail(400, "Orçamento acima do limite de R$ 10 milhões.");
        const [next] = await tx.query(
          "SELECT coalesce(max(revision),0)+1 AS revision FROM repair_quotes WHERE order_id=$1",
          [id],
        );
        const quoteId = randomUUID();
        await tx.query(
          "INSERT INTO repair_quotes(id,tenant_id,order_id,revision,labor_price_cents,labor_cost_cents,total_cents,warranty_days,warranty_terms,notes,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id",
          [
            quoteId,
            i.tenant_id,
            id,
            next.revision,
            b.labor_price_cents,
            b.labor_cost_cents,
            total,
            b.warranty_days,
            b.warranty_terms,
            b.notes,
            i.user_id,
          ],
        );
        for (const l of lines)
          await tx.query(
            "INSERT INTO repair_quote_items(id,tenant_id,order_id,quote_id,product_id,product_name,sku,quantity,unit_price_cents,unit_cost_cents) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id",
            [
              l.id,
              i.tenant_id,
              id,
              quoteId,
              l.product_id,
              l.product_name,
              l.sku,
              l.quantity,
              l.unit_price_cents,
              l.unit_cost_cents,
            ],
          );
        await tx.query(
          "UPDATE repair_orders SET status='awaiting_approval',current_quote_id=$1,warranty_days=$2,warranty_terms=$3,version=version+1 WHERE id=$4 RETURNING id",
          [quoteId, b.warranty_days, b.warranty_terms, id],
        );
        await this.event(tx, i, o, "quoted", {
          quote_id: quoteId,
          revision: next.revision,
          total_cents: total,
        });
        return { id: quoteId, total_cents: total };
      },
    );
  }
  async approve(i: Identity, id: string, body: unknown, key: unknown) {
    permit(i, "service_approve");
    const b = validate(
      z
        .object({
          version,
          quote_id: uuid,
          decision: z.enum(["approved", "declined"]),
          customer_representative: text(180),
          channel: z.enum(["in_person", "phone", "whatsapp", "email"]),
          reference: text(1000),
        })
        .strict(),
      body,
    );
    return this.inventory.write(
      i,
      key,
      { action: "repair.approval", id, b },
      async (tx) => {
        const o = await this.order(tx, i, id, b.version);
        if (
          o.status !== "awaiting_approval" ||
          o.current_quote_id !== b.quote_id
        )
          fail(409, "Orçamento alterado ou já respondido.");
        await tx.query(
          "INSERT INTO repair_approvals(id,tenant_id,order_id,quote_id,decision,customer_representative,channel,reference,recorded_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id",
          [
            randomUUID(),
            i.tenant_id,
            id,
            b.quote_id,
            b.decision,
            b.customer_representative,
            b.channel,
            b.reference,
            i.user_id,
          ],
        );
        await tx.query(
          "UPDATE repair_orders SET status=$1,version=version+1 WHERE id=$2 RETURNING id",
          [b.decision, id],
        );
        await this.event(tx, i, o, b.decision, {
          quote_id: b.quote_id,
          customer_representative: b.customer_representative,
          channel: b.channel,
          reference: b.reference,
        });
        return { ok: true };
      },
    );
  }
  async part(i: Identity, id: string, body: unknown, key: unknown) {
    permit(i, "service_parts");
    const b = validate(
      z
        .object({
          version,
          kind: z.enum(["issue", "return"]),
          quantity: z.number().int().min(1).max(10000),
          quote_item_id: uuid.optional(),
          issue_id: uuid.optional(),
          reason: text(1000),
        })
        .strict(),
      body,
    );
    return this.inventory.write(
      i,
      key,
      { action: "repair.part", id, b },
      async (tx) => {
        const o = await this.order(tx, i, id, b.version);
        if (!["approved", "in_repair", "ready"].includes(o.status))
          fail(
            409,
            "É necessário orçamento aprovado e ordem ainda não entregue.",
          );
        if (o.status === "ready" && b.kind === "issue")
          fail(409, "O reparo já está pronto.");
        let line: Row,
          cost: number,
          issueId: string | null = null;
        if (b.kind === "issue") {
          if (!b.quote_item_id || b.issue_id)
            fail(400, "Selecione uma peça do orçamento atual.");
          const [l] = await tx.query(
            "SELECT * FROM repair_quote_items WHERE id=$1 AND order_id=$2 AND quote_id=$3",
            [b.quote_item_id, id, o.current_quote_id],
          );
          if (!l) fail(400, "Peça não pertence ao orçamento aprovado.");
          line = l;
          const [used] = await tx.query(
            "SELECT coalesce(sum(CASE WHEN kind='issue' THEN quantity ELSE -quantity END),0)::int AS quantity FROM repair_part_events WHERE quote_item_id=$1",
            [line.id],
          );
          if (used.quantity + b.quantity > line.quantity)
            fail(409, "Quantidade superior à aprovada no orçamento.");
          cost = 0;
        } else {
          if (!b.issue_id || b.quote_item_id)
            fail(400, "Selecione a utilização original para devolver.");
          const [event] = await tx.query(
            "SELECT * FROM repair_part_events WHERE id=$1 AND order_id=$2 AND kind='issue'",
            [b.issue_id, id],
          );
          if (!event) fail(404, "Utilização de peça não encontrada.");
          const [returned] = await tx.query(
            "SELECT coalesce(sum(quantity),0)::int AS quantity FROM repair_part_events WHERE issue_id=$1",
            [event.id],
          );
          if (returned.quantity + b.quantity > event.quantity)
            fail(409, "Quantidade já devolvida ou superior à utilização.");
          const [l] = await tx.query(
            "SELECT * FROM repair_quote_items WHERE id=$1",
            [event.quote_item_id],
          );
          line = l;
          cost = event.unit_cost_cents;
          issueId = event.id;
        }
        let p: Row, stock: Row;
        if (b.kind === "issue") {
          ({ p, stock } = await this.inventory.lockStock(
            tx,
            i,
            line.product_id,
            o.branch_id,
          ));
          if (p.serialized)
            fail(400, "Não é permitido consumir um aparelho como peça.");
          if (stock.quantity < b.quantity)
            fail(409, "Estoque insuficiente para a peça.");
          cost = money(p.cost);
        } else {
          [p] = await tx.query(
            "SELECT * FROM products WHERE id=$1 FOR UPDATE",
            [line.product_id],
          );
          [stock] = await tx.query(
            "SELECT * FROM stock_balances WHERE product_id=$1 AND branch_id=$2 FOR UPDATE",
            [line.product_id, o.branch_id],
          );
          if (!p || !stock) fail(409, "Saldo da peça não encontrado.");
        }
        const eventId = randomUUID();
        await tx.query(
          "INSERT INTO repair_part_events(id,tenant_id,order_id,quote_item_id,product_id,kind,quantity,unit_cost_cents,issue_id,reason,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id",
          [
            eventId,
            i.tenant_id,
            id,
            line.id,
            line.product_id,
            b.kind,
            b.quantity,
            cost!,
            issueId,
            b.reason,
            i.user_id,
          ],
        );
        const delta = b.kind === "issue" ? -b.quantity : b.quantity;
        await this.inventory.ledger(
          tx,
          i,
          {
            product_id: line.product_id,
            branch_id: o.branch_id,
            reason: `${o.code}: ${b.reason}`,
          },
          delta,
          stock.quantity + delta,
          b.kind === "issue" ? "exit" : "entry",
          null,
          null,
          { repairEventId: eventId },
        );
        await tx.query(
          "UPDATE repair_orders SET status='in_repair',ready_at=NULL,version=version+1 WHERE id=$1 RETURNING id",
          [id],
        );
        await this.event(
          tx,
          i,
          o,
          b.kind === "issue" ? "part_used" : "part_returned",
          {
            event_id: eventId,
            product_name: line.product_name,
            quantity: b.quantity,
            reason: b.reason,
          },
        );
        return { id: eventId };
      },
    );
  }
  async work(i: Identity, id: string, body: unknown, key: unknown) {
    permit(i, "service_work");
    const b = validate(
      z
        .object({
          version,
          action: z.enum(["start", "finish"]),
          work_report: optionalText(4000),
        })
        .strict(),
      body,
    );
    return this.inventory.write(
      i,
      key,
      { action: "repair.work", id, b },
      async (tx) => {
        const o = await this.order(tx, i, id, b.version);
        if (!o.technician_id) fail(400, "Defina um técnico responsável.");
        if (b.action === "start") {
          if (o.status !== "approved")
            fail(409, "A ordem precisa estar aprovada para iniciar.");
          await tx.query(
            "UPDATE repair_orders SET status='in_repair',version=version+1 WHERE id=$1 RETURNING id",
            [id],
          );
          await this.event(tx, i, o, "started");
        } else {
          if (!["approved", "in_repair"].includes(o.status))
            fail(409, "A ordem não está em reparo aprovado.");
          if (b.work_report.length < 5)
            fail(400, "Descreva o serviço realizado e os testes finais.");
          await tx.query(
            "UPDATE repair_orders SET status='ready',work_report=$1,ready_at=now(),version=version+1 WHERE id=$2 RETURNING id",
            [b.work_report, id],
          );
          await this.event(tx, i, o, "ready", {
            work_report: b.work_report,
            warranty_days: o.warranty_days,
            warranty_terms: o.warranty_terms,
          });
        }
        return { ok: true };
      },
    );
  }
  async cancel(i: Identity, id: string, body: unknown, key: unknown) {
    permit(i, "service_manage");
    const b = validate(
      z.object({ version, reason: text(1000) }).strict(),
      body,
    );
    return this.inventory.write(
      i,
      key,
      { action: "repair.cancel", id, b },
      async (tx) => {
        const o = await this.order(tx, i, id, b.version);
        this.editable(o);
        if (o.status === "cancelled") fail(409, "Ordem já cancelada.");
        if (await this.netParts(tx, id))
          fail(409, "Devolva as peças antes de cancelar o serviço.");
        await tx.query(
          "UPDATE repair_orders SET status='cancelled',version=version+1 WHERE id=$1 RETURNING id",
          [id],
        );
        await this.event(tx, i, o, "cancelled", { reason: b.reason });
        return { ok: true };
      },
    );
  }
  async deliver(i: Identity, id: string, body: unknown, key: unknown) {
    permit(i, "service_deliver");
    const b = validate(
      z
        .object({
          version,
          receiver_name: text(180),
          notes: optionalText(),
          confirmed: z.literal(true),
        })
        .strict(),
      body,
    );
    return this.inventory.write(
      i,
      key,
      { action: "repair.deliver", id, b },
      async (tx) => {
        const o = await this.order(tx, i, id, b.version);
        if (!["ready", "declined", "cancelled"].includes(o.status))
          fail(
            409,
            "Finalize o reparo ou registre a recusa/cancelamento antes da entrega.",
          );
        if (o.status !== "ready" && (await this.netParts(tx, id)))
          fail(409, "Devolva as peças antes de entregar sem reparo.");
        const days = o.status === "ready" ? o.warranty_days : 0;
        await tx.query(
          "UPDATE repair_orders SET status='delivered',delivered_at=now(),receiver_name=$1,delivery_notes=$2,delivery_outcome=$3,delivered_by=$4,warranty_days=$5,warranty_terms=CASE WHEN $3='ready' THEN warranty_terms ELSE '' END,warranty_expires_on=CASE WHEN $5::int>0 THEN (now() AT TIME ZONE 'America/Fortaleza')::date+$5::int ELSE NULL END,version=version+1 WHERE id=$6 RETURNING id",
          [b.receiver_name, b.notes, o.status, i.user_id, days, id],
        );
        await this.event(tx, i, o, "delivered", {
          receiver_name: b.receiver_name,
          notes: b.notes,
          outcome: o.status,
          warranty_days: days,
        });
        return { ok: true };
      },
    );
  }
  async addPhoto(i: Identity, id: string, body: unknown, key: unknown) {
    permit(i, "service_work");
    const b = validate(
      z
        .object({
          filename: text(120),
          data: z
            .string()
            .min(4)
            .max(7000000)
            .regex(/^[A-Za-z0-9+/]+={0,2}$/),
        })
        .strict(),
      body,
    );
    await this.db.transaction(i.tenant_id, async (tx) => {
      await this.order(tx, i, id, undefined, false);
    });
    const input = Buffer.from(b.data, "base64");
    if (input.length > 5 * 1024 * 1024) fail(400, "A foto deve ter até 5 MB.");
    let output: Buffer;
    try {
      const image = sharp(input, { limitInputPixels: 20000000 });
      const meta = await image.metadata();
      if (!["jpeg", "png", "webp"].includes(meta.format || ""))
        fail(400, "Envie uma foto JPEG, PNG ou WebP.");
      output = await image
        .rotate()
        .resize({
          width: 1600,
          height: 1600,
          fit: "inside",
          withoutEnlargement: true,
        })
        .jpeg({ quality: 82 })
        .toBuffer();
    } catch {
      fail(400, "Foto inválida ou acima do limite de resolução.");
    }
    if (output!.length > 1500000)
      fail(400, "A foto processada excedeu o limite.");
    const hash = createHash("sha256").update(output!).digest("hex");
    return this.inventory.write(
      i,
      key,
      { action: "repair.photo", id, filename: b.filename, hash },
      async (tx) => {
        const o = await this.order(tx, i, id);
        this.editable(o);
        if (o.status === "cancelled")
          fail(409, "Ordem cancelada não aceita novas fotos.");
        const [count] = await tx.query(
          "SELECT count(*)::int AS total FROM repair_photos WHERE order_id=$1",
          [id],
        );
        if (count.total >= 12) fail(409, "Limite de 12 fotos por ordem.");
        const photoId = randomUUID();
        await tx.query(
          "INSERT INTO repair_photos(id,tenant_id,order_id,filename,data,sha256,actor_id) VALUES($1,$2,$3,$4,decode($5,'base64'),$6,$7) RETURNING id",
          [
            photoId,
            i.tenant_id,
            id,
            b.filename,
            output!.toString("base64"),
            hash,
            i.user_id,
          ],
        );
        await this.event(tx, i, o, "photo_added", {
          photo_id: photoId,
          filename: b.filename,
        });
        return { id: photoId };
      },
    );
  }
  async photo(i: Identity, id: string, photoId: string) {
    permit(i, "service_read");
    validate(uuid, photoId);
    return this.db.transaction(i.tenant_id, async (tx) => {
      await this.order(tx, i, id, undefined, false);
      const [p] = await tx.query(
        "SELECT encode(data,'base64') AS data FROM repair_photos WHERE id=$1 AND order_id=$2",
        [photoId, id],
      );
      if (!p) fail(404, "Foto não encontrada.");
      return Buffer.from(p.data, "base64");
    });
  }
}

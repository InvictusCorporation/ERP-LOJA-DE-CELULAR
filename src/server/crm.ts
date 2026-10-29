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
  fail,
  audit,
} from "./domain";
const text = (max = 180) => z.string().trim().min(1).max(max);
const optional = (max = 2000) => z.string().trim().max(max).default("");
const version = z.number().int().positive();
const profile = z
  .object({
    name: text(),
    phone: z
      .string()
      .transform((v) => v.replace(/\D/g, ""))
      .pipe(z.string().min(10).max(15)),
    email: z.union([z.email().max(254), z.literal("")]).default(""),
    city: optional(100),
    state: z.union([z.string().regex(/^[A-Z]{2}$/), z.literal("")]).default(""),
    notes: optional(),
  })
  .strict();
const stage = z.enum(["new", "contacted", "proposal", "won", "lost"]);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(s + "T12:00:00Z");
    return !isNaN(d.valueOf()) && d.toISOString().slice(0, 10) === s;
  })
  .nullable()
  .default(null);
const opportunity = z
  .object({
    branch_id: uuid,
    customer_id: uuid,
    title: text(),
    value_cents: z.number().int().min(0).max(1000000000),
    owner_id: uuid,
    expected_on: date,
  })
  .strict();
const reminder = z
  .object({
    branch_id: uuid,
    customer_id: uuid,
    title: text(),
    owner_id: uuid,
    due_at: z.iso.datetime({ offset: true }),
  })
  .strict();
export class CrmService {
  constructor(
    private db: Database,
    private inventory: InventoryService,
  ) {}
  private async customer(
    tx: Tx,
    id: string,
    expected?: number,
    active = false,
  ) {
    validate(uuid, id);
    const [c] = await tx.query(
      "SELECT * FROM customers WHERE id=$1 FOR UPDATE",
      [id],
    );
    if (!c) fail(404, "Cliente não encontrado.");
    if (expected !== undefined && c.version !== expected)
      fail(409, "Cadastro atualizado por outra pessoa. Recarregue os dados.");
    if (active && !c.active)
      fail(409, "Cliente arquivado. Reative o cadastro antes de continuar.");
    return c;
  }
  private async owner(tx: Tx, i: Identity, branch: string, id: string) {
    const [u] = await tx.query(
      "SELECT u.id FROM users u JOIN memberships m ON m.user_id=u.id WHERE u.id=$1 AND m.tenant_id=$2 AND m.active AND u.active AND m.role IN ('owner','manager') AND $3::uuid=ANY(m.branch_ids)",
      [id, i.tenant_id, branch],
    );
    if (!u) fail(400, "Responsável inválido ou sem acesso comercial à filial.");
  }
  private async event(
    tx: Tx,
    i: Identity,
    customer: string,
    entity: string,
    action: string,
    details: unknown = {},
    branch: string | null = null,
  ) {
    await tx.query(
      "INSERT INTO crm_events(id,tenant_id,customer_id,branch_id,entity_id,action,details,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8) RETURNING id",
      [
        randomUUID(),
        i.tenant_id,
        customer,
        branch,
        entity,
        action,
        JSON.stringify(details),
        i.user_id,
      ],
    );
    await audit(tx, i, `crm.${action}`, entity, {}, branch);
  }
  async team(i: Identity, branch: string) {
    permit(i, "crm_manage");
    branchAccess(i, branch);
    return this.db.transaction(i.tenant_id, async (tx) => ({
      items: await tx.query(
        "SELECT u.id,u.name FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.tenant_id=$1 AND m.active AND u.active AND m.role IN ('owner','manager') AND $2::uuid=ANY(m.branch_ids) ORDER BY u.name",
        [i.tenant_id, branch],
      ),
    }));
  }
  async lookup(i: Identity, q: string) {
    permit(i, "customer_lookup");
    if (q.trim().length < 2) return { items: [] };
    return this.db.transaction(i.tenant_id, async (tx) => ({
      items: await tx.query(
        "SELECT id,name,right(phone,4) AS phone_suffix FROM customers WHERE active AND (name ILIKE $1 OR phone ILIKE $1) ORDER BY name,id LIMIT 20",
        [`%${q.slice(0, 100)}%`],
      ),
    }));
  }
  async list(i: Identity, q: string, status: string, page: number) {
    permit(i, "crm_read");
    validate(z.enum(["active", "archived", "all"]), status);
    return this.db.transaction(i.tenant_id, async (tx) => ({
      items: await tx.query(
        "SELECT id,name,phone,email,city,state,active,contact_permission,version,count(*) OVER()::int AS total_count FROM customers WHERE (name ILIKE $1 OR phone ILIKE $1 OR email ILIKE $1) AND ($2='all' OR active=($2='active')) ORDER BY name,id LIMIT 30 OFFSET $3",
        [`%${q.slice(0, 100)}%`, status, (page - 1) * 30],
      ),
    }));
  }
  async create(i: Identity, body: unknown, key: unknown) {
    permit(i, "crm_manage");
    const b = validate(profile, body);
    return this.inventory.write(
      i,
      key,
      { action: "crm.customer.create", b },
      async (tx) => {
        const id = randomUUID();
        await tx.query(
          "INSERT INTO customers(id,tenant_id,name,phone,email,city,state,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id",
          [id, i.tenant_id, b.name, b.phone, b.email, b.city, b.state, b.notes],
        );
        await this.event(tx, i, id, id, "customer_created");
        return { id };
      },
    );
  }
  async update(i: Identity, id: string, body: unknown, key: unknown) {
    permit(i, "crm_manage");
    const b = validate(profile.extend({ version }), body);
    return this.inventory.write(
      i,
      key,
      { action: "crm.customer.update", id, b },
      async (tx) => {
        await this.customer(tx, id, b.version);
        await tx.query(
          "UPDATE customers SET name=$2,phone=$3,email=$4,city=$5,state=$6,notes=$7,version=version+1,updated_at=now() WHERE id=$1 RETURNING id",
          [id, b.name, b.phone, b.email, b.city, b.state, b.notes],
        );
        await this.event(tx, i, id, id, "customer_updated");
        return { id };
      },
    );
  }
  async state(i: Identity, id: string, body: unknown, key: unknown) {
    permit(i, "crm_manage");
    const b = validate(
      z.object({ version, active: z.boolean(), reason: text(500) }).strict(),
      body,
    );
    return this.inventory.write(
      i,
      key,
      { action: "crm.customer.state", id, b },
      async (tx) => {
        await this.customer(tx, id, b.version);
        if (!b.active) {
          const [r] = await tx.query(
            "SELECT (SELECT count(*) FROM crm_tasks WHERE customer_id=$1 AND status='pending')+(SELECT count(*) FROM crm_opportunities WHERE customer_id=$1 AND stage NOT IN ('won','lost')) AS n",
            [id],
          );
          if (Number(r.n))
            fail(
              409,
              "Conclua ou cancele os lembretes e encerre as oportunidades antes de arquivar.",
            );
        }
        await tx.query(
          "UPDATE customers SET active=$2,version=version+1,updated_at=now() WHERE id=$1 RETURNING id",
          [id, b.active],
        );
        await this.event(
          tx,
          i,
          id,
          id,
          b.active ? "customer_reactivated" : "customer_archived",
          { reason: b.reason },
        );
        return { id };
      },
    );
  }
  async consent(i: Identity, id: string, body: unknown, key: unknown) {
    permit(i, "crm_manage");
    const b = validate(
      z.object({ version, allowed: z.boolean(), evidence: text(500) }).strict(),
      body,
    );
    return this.inventory.write(
      i,
      key,
      { action: "crm.customer.consent", id, b },
      async (tx) => {
        await this.customer(tx, id, b.version);
        await tx.query(
          "UPDATE customers SET contact_permission=$2,version=version+1,updated_at=now() WHERE id=$1 RETURNING id",
          [id, b.allowed],
        );
        await this.event(tx, i, id, id, "contact_permission", {
          allowed: b.allowed,
          evidence: b.evidence,
        });
        return { id };
      },
    );
  }
  async detail(i: Identity, id: string) {
    permit(i, "crm_read");
    validate(uuid, id);
    return this.db.transaction(i.tenant_id, async (tx) => {
      const [customer] = await tx.query("SELECT * FROM customers WHERE id=$1", [
        id,
      ]);
      if (!customer) fail(404, "Cliente não encontrado.");
      return { customer };
    });
  }
  async history(i: Identity, id: string, kind: string, page: number) {
    permit(i, "crm_read");
    validate(uuid, id);
    validate(z.enum(["sales", "services", "events"]), kind);
    return this.db.transaction(i.tenant_id, async (tx) => {
      const [c] = await tx.query("SELECT id FROM customers WHERE id=$1", [id]);
      if (!c) fail(404, "Cliente não encontrado.");
      const params = [id, i.branch_ids, (page - 1) * 30];
      if (kind === "sales")
        return {
          items: await tx.query(
            `SELECT x.id,x.sale_id,v.receipt_code,v.created_at,v.status,b.name AS branch_name,x.product_name,x.sku,x.identifiers,x.unit_id,x.quantity,x.net_cents,x.warranty_days,x.warranty_terms,((v.created_at AT TIME ZONE 'America/Fortaleza')::date+x.warranty_days)::text AS warranty_expires_on,coalesce(r.quantity,0)::int AS returned_quantity,coalesce(r.amount,0)::int AS refunded_cents,count(*) OVER()::int AS total_count FROM pos_sales v JOIN pos_sale_items x ON x.sale_id=v.id JOIN branches b ON b.id=v.branch_id LEFT JOIN (SELECT sale_item_id,sum(quantity) AS quantity,sum(amount_cents) AS amount FROM pos_return_items GROUP BY sale_item_id) r ON r.sale_item_id=x.id WHERE v.customer_id=$1 AND v.branch_id=ANY($2::uuid[]) ORDER BY v.created_at DESC,x.id DESC LIMIT 30 OFFSET $3`,
            params,
          ),
        };
      if (kind === "services")
        return {
          items: await tx.query(
            `SELECT o.id,o.code,o.brand,o.model,o.imei,o.serial,o.status,o.created_at,o.delivered_at,o.delivery_outcome,o.warranty_days,o.warranty_terms,o.warranty_expires_on::text AS warranty_expires_on,b.name AS branch_name,count(*) OVER()::int AS total_count FROM repair_orders o JOIN branches b ON b.id=o.branch_id WHERE o.customer_id=$1 AND o.branch_id=ANY($2::uuid[]) ORDER BY o.created_at DESC,o.id DESC LIMIT 30 OFFSET $3`,
            params,
          ),
        };
      return {
        items: await tx.query(
          "SELECT e.*,u.name AS actor_name,b.name AS branch_name,count(*) OVER()::int AS total_count FROM crm_events e JOIN users u ON u.id=e.actor_id LEFT JOIN branches b ON b.id=e.branch_id WHERE e.customer_id=$1 AND (e.branch_id IS NULL OR e.branch_id=ANY($2::uuid[])) ORDER BY e.created_at DESC,e.id DESC LIMIT 30 OFFSET $3",
          params,
        ),
      };
    });
  }
  async interaction(i: Identity, id: string, body: unknown, key: unknown) {
    permit(i, "crm_manage");
    const b = validate(
      z
        .object({
          branch_id: uuid,
          channel: z.enum(["note", "phone", "whatsapp", "email", "in_person"]),
          text: text(2000),
        })
        .strict(),
      body,
    );
    branchAccess(i, b.branch_id);
    return this.inventory.write(
      i,
      key,
      { action: "crm.interaction", id, b },
      async (tx) => {
        const c = await this.customer(tx, id, undefined, true);
        if (
          ["phone", "whatsapp", "email"].includes(b.channel) &&
          !c.contact_permission
        )
          fail(
            409,
            "Cliente sem permissão de contato comercial. Registre a preferência antes do contato.",
          );
        await this.event(
          tx,
          i,
          id,
          id,
          "interaction",
          { channel: b.channel, text: b.text },
          b.branch_id,
        );
        return { id };
      },
    );
  }
  async contact(i: Identity, id: string) {
    permit(i, "crm_manage");
    validate(uuid, id);
    return this.db.transaction(i.tenant_id, async (tx) => {
      const [c] = await tx.query(
        "SELECT name,phone,active,contact_permission FROM customers WHERE id=$1",
        [id],
      );
      if (!c) fail(404, "Cliente não encontrado.");
      if (!c.active || !c.contact_permission)
        fail(409, "Contato comercial não autorizado para este cliente.");
      let phone = c.phone;
      if (phone.length === 10 || phone.length === 11) phone = "55" + phone;
      if (!/^\d{11,15}$/.test(phone))
        fail(400, "Confira o telefone internacional do cliente.");
      return {
        url: `https://wa.me/${phone}`,
        message:
          "Contato manual: confira o destinatário e envie a mensagem no WhatsApp.",
      };
    });
  }
  async board(
    i: Identity,
    branch: string,
    kind: string,
    page: number,
    status: string,
  ) {
    permit(i, "crm_read");
    branchAccess(i, branch);
    return this.db.transaction(i.tenant_id, async (tx) => {
      if (kind === "opportunities") {
        validate(
          z.enum(["all", "new", "contacted", "proposal", "won", "lost"]),
          status,
        );
        return {
          items: await tx.query(
            "SELECT o.*,o.expected_on::text AS expected_on,c.name AS customer_name,u.name AS owner_name,count(*) OVER()::int AS total_count FROM crm_opportunities o JOIN customers c ON c.id=o.customer_id JOIN users u ON u.id=o.owner_id WHERE o.branch_id=$1 AND ($2='all' OR o.stage=$2) ORDER BY o.updated_at DESC,o.id DESC LIMIT 30 OFFSET $3",
            [branch, status, (page - 1) * 30],
          ),
          summary: await tx.query(
            "SELECT stage,count(*)::int AS count,coalesce(sum(value_cents),0)::text AS value_cents FROM crm_opportunities WHERE branch_id=$1 GROUP BY stage",
            [branch],
          ),
        };
      }
      validate(
        z.enum(["pending", "overdue", "done", "cancelled", "all"]),
        status,
      );
      return {
        items: await tx.query(
          "SELECT t.*,c.name AS customer_name,u.name AS owner_name,t.due_at<now() AND t.status='pending' AS overdue,count(*) OVER()::int AS total_count FROM crm_tasks t JOIN customers c ON c.id=t.customer_id JOIN users u ON u.id=t.owner_id WHERE t.branch_id=$1 AND ($2='all' OR t.status=$2 OR ($2='overdue' AND t.status='pending' AND t.due_at<now())) ORDER BY t.due_at,t.id LIMIT 30 OFFSET $3",
          [branch, status, (page - 1) * 30],
        ),
        summary: await tx.query(
          "SELECT count(*) FILTER(WHERE status='pending')::int AS pending,count(*) FILTER(WHERE status='pending' AND due_at<now())::int AS overdue,count(*) FILTER(WHERE status='done')::int AS done FROM crm_tasks WHERE branch_id=$1",
          [branch],
        ),
      };
    });
  }
  async createOpportunity(i: Identity, body: unknown, key: unknown) {
    permit(i, "crm_manage");
    const b = validate(opportunity, body);
    branchAccess(i, b.branch_id);
    return this.inventory.write(
      i,
      key,
      { action: "crm.opportunity.create", b },
      async (tx) => {
        await this.customer(tx, b.customer_id, undefined, true);
        await this.owner(tx, i, b.branch_id, b.owner_id);
        const id = randomUUID();
        await tx.query(
          "INSERT INTO crm_opportunities(id,tenant_id,branch_id,customer_id,title,value_cents,owner_id,expected_on) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id",
          [
            id,
            i.tenant_id,
            b.branch_id,
            b.customer_id,
            b.title,
            b.value_cents,
            b.owner_id,
            b.expected_on,
          ],
        );
        await this.event(
          tx,
          i,
          b.customer_id,
          id,
          "opportunity_created",
          { title: b.title, stage: "new", value_cents: b.value_cents },
          b.branch_id,
        );
        return { id };
      },
    );
  }
  async updateOpportunity(
    i: Identity,
    id: string,
    body: unknown,
    key: unknown,
  ) {
    permit(i, "crm_manage");
    validate(uuid, id);
    const b = validate(
      z
        .object({
          version,
          title: text(),
          value_cents: z.number().int().min(0).max(1000000000),
          owner_id: uuid,
          expected_on: date,
          stage,
          reason: optional(500),
        })
        .strict(),
      body,
    );
    if (["won", "lost"].includes(b.stage) && b.reason.length < 3)
      fail(400, "Informe o motivo do encerramento.");
    return this.inventory.write(
      i,
      key,
      { action: "crm.opportunity.update", id, b },
      async (tx) => {
        const [o] = await tx.query(
          "SELECT * FROM crm_opportunities WHERE id=$1 FOR UPDATE",
          [id],
        );
        if (!o) fail(404, "Oportunidade não encontrada.");
        branchAccess(i, o.branch_id);
        if (o.version !== b.version)
          fail(409, "Oportunidade atualizada. Recarregue os dados.");
        await this.customer(tx, o.customer_id, undefined, true);
        await this.owner(tx, i, o.branch_id, b.owner_id);
        if (
          ["won", "lost"].includes(o.stage) &&
          !["won", "lost"].includes(b.stage) &&
          b.reason.length < 3
        )
          fail(400, "Informe o motivo da reabertura.");
        await tx.query(
          "UPDATE crm_opportunities SET title=$2,value_cents=$3,owner_id=$4,expected_on=$5,stage=$6,close_reason=$7,version=version+1,updated_at=now() WHERE id=$1 RETURNING id",
          [
            id,
            b.title,
            b.value_cents,
            b.owner_id,
            b.expected_on,
            b.stage,
            b.reason,
          ],
        );
        await this.event(
          tx,
          i,
          o.customer_id,
          id,
          "opportunity_updated",
          {
            from: o.stage,
            stage: b.stage,
            title: b.title,
            value_cents: b.value_cents,
            reason: b.reason,
          },
          o.branch_id,
        );
        return { id };
      },
    );
  }
  async createTask(i: Identity, body: unknown, key: unknown) {
    permit(i, "crm_manage");
    const b = validate(reminder, body);
    branchAccess(i, b.branch_id);
    return this.inventory.write(
      i,
      key,
      { action: "crm.task.create", b },
      async (tx) => {
        await this.customer(tx, b.customer_id, undefined, true);
        await this.owner(tx, i, b.branch_id, b.owner_id);
        const id = randomUUID();
        await tx.query(
          "INSERT INTO crm_tasks(id,tenant_id,branch_id,customer_id,title,due_at,owner_id) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id",
          [
            id,
            i.tenant_id,
            b.branch_id,
            b.customer_id,
            b.title,
            b.due_at,
            b.owner_id,
          ],
        );
        await this.event(
          tx,
          i,
          b.customer_id,
          id,
          "task_created",
          { title: b.title, due_at: b.due_at },
          b.branch_id,
        );
        return { id };
      },
    );
  }
  async updateTask(i: Identity, id: string, body: unknown, key: unknown) {
    permit(i, "crm_manage");
    validate(uuid, id);
    const b = validate(
      z
        .object({
          version,
          status: z.enum(["pending", "done", "cancelled"]),
          title: text(),
          owner_id: uuid,
          due_at: z.iso.datetime({ offset: true }),
        })
        .strict(),
      body,
    );
    return this.inventory.write(
      i,
      key,
      { action: "crm.task.update", id, b },
      async (tx) => {
        const [t] = await tx.query(
          "SELECT * FROM crm_tasks WHERE id=$1 FOR UPDATE",
          [id],
        );
        if (!t) fail(404, "Lembrete não encontrado.");
        branchAccess(i, t.branch_id);
        if (t.version !== b.version)
          fail(409, "Lembrete atualizado. Recarregue os dados.");
        await this.customer(
          tx,
          t.customer_id,
          undefined,
          b.status === "pending",
        );
        await this.owner(tx, i, t.branch_id, b.owner_id);
        await tx.query(
          "UPDATE crm_tasks SET title=$2,owner_id=$3,due_at=$4,status=$5,completed_at=CASE WHEN $5='done' THEN now() ELSE NULL END,version=version+1 WHERE id=$1 RETURNING id",
          [id, b.title, b.owner_id, b.due_at, b.status],
        );
        await this.event(
          tx,
          i,
          t.customer_id,
          id,
          "task_updated",
          { title: b.title, status: b.status, due_at: b.due_at },
          t.branch_id,
        );
        return { id };
      },
    );
  }
}

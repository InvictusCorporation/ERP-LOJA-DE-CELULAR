import { randomUUID } from "node:crypto";
import { HttpException } from "@nestjs/common";
import { z } from "zod";
import { Database, Tx } from "./db";
import { Identity, permissions, hashToken, passwordHash } from "./security";

export const uuid = z.uuid();
const text = (max = 180) => z.string().trim().min(1).max(max);
const money = z.coerce
  .number()
  .finite()
  .min(0)
  .max(999999999)
  .refine(
    (n) => Math.abs(n * 100 - Math.round(n * 100)) < 0.00001,
    "Use até duas casas decimais.",
  );
const optionalId = uuid
  .nullable()
  .optional()
  .transform((v) => v || null);
export const productSchema = z
  .object({
    name: text(),
    sku: text(80),
    barcode: z
      .string()
      .trim()
      .max(80)
      .optional()
      .transform((v) => v || null),
    category_id: optionalId,
    brand_id: optionalId,
    model_id: optionalId,
    supplier_id: optionalId,
    color: z.string().trim().max(80).default(""),
    capacity: z.string().trim().max(80).default(""),
    condition: z.enum(["new", "refurbished", "used"]),
    serialized: z.boolean(),
    cost: money,
    price: money,
    warranty_days: z.coerce.number().int().min(0).max(3650),
    warranty_terms: z.string().trim().max(2000).default(""),
    version: z.number().int().positive().optional(),
  })
  .strict();
export const movementSchema = z
  .object({
    product_id: uuid,
    branch_id: uuid,
    type: z.enum(["entry", "exit"]),
    quantity: z.coerce.number().int().positive().max(1000000),
    reason: text(2000),
    unit_id: uuid.optional(),
    device: z
      .object({
        imeis: z
          .array(z.string().regex(/^\d{15}$/))
          .max(3)
          .default([]),
        serial: z.string().trim().max(100).optional(),
        provenance: text(2000),
        acquisition_cost: money,
        supplier_id: optionalId,
      })
      .strict()
      .optional(),
  })
  .strict();
export const inventorySchema = z
  .object({
    product_id: uuid,
    branch_id: uuid,
    expected: z.coerce.number().int().min(0),
    counted: z.coerce.number().int().min(0).max(1000000),
    reason: text(2000),
  })
  .strict();
export function fail(status: number, message: string): never {
  throw new HttpException(message, status);
}
export function validate<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success)
    fail(
      400,
      r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    );
  return r.data;
}
export function permit(identity: Identity, right: string) {
  if (!permissions(identity.role).includes(right))
    fail(403, "Você não tem permissão para esta operação.");
}
export function branchAccess(i: Identity, branch: string) {
  validate(uuid, branch);
  if (!i.branch_ids.includes(branch)) fail(403, "Filial não autorizada.");
}
export function validImei(imei: string) {
  let sum = 0;
  for (let j = 0; j < 15; j++) {
    let n = Number(imei[j]);
    if (j % 2 === 1) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  }
  return /^\d{15}$/.test(imei) && sum % 10 === 0;
}
export async function audit(
  tx: Tx,
  i: Identity,
  action: string,
  entity: string,
  details: unknown = {},
  branch: string | null = null,
) {
  await tx.query(
    "INSERT INTO audit_events(id,tenant_id,actor_id,branch_id,action,entity_id,details) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb) RETURNING id",
    [
      randomUUID(),
      i.tenant_id,
      i.user_id,
      branch,
      action,
      entity,
      JSON.stringify(details),
    ],
  );
}
export class InventoryService {
  constructor(public db: Database) {}
  async write<T>(
    i: Identity,
    key: unknown,
    payload: unknown,
    fn: (tx: Tx) => Promise<T>,
  ): Promise<T> {
    const k = validate(uuid, key);
    const fingerprint = hashToken(JSON.stringify({ user: i.user_id, payload }));
    return this.db.transaction(i.tenant_id, async (tx) => {
      await tx.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))::text AS locked",
        [`${i.tenant_id}:${k}`],
      );
      const [old] = await tx.query(
        "SELECT fingerprint,response FROM idempotency_keys WHERE key=$1",
        [k],
      );
      if (old) {
        if (old.fingerprint !== fingerprint)
          fail(409, "Chave de operação já utilizada com outros dados.");
        return old.response as T;
      }
      const response = await fn(tx);
      await tx.query(
        "INSERT INTO idempotency_keys(tenant_id,key,fingerprint,response) VALUES($1,$2,$3,$4::jsonb) RETURNING key",
        [i.tenant_id, k, fingerprint, JSON.stringify(response)],
      );
      return response;
    });
  }
  async bootstrap(body: unknown) {
    const b = validate(
      z
        .object({
          company: text(),
          name: text(),
          email: z
            .email()
            .max(254)
            .transform((v) => v.toLowerCase()),
          password: z.string().min(12).max(128),
          branch: text(),
        })
        .strict(),
      body,
    );
    const tenant = randomUUID(),
      user = randomUUID(),
      branch = randomUUID();
    await this.db.provision(async (tx) => {
      await tx.query(
        "INSERT INTO tenants(id,name,slug) VALUES($1,$2,$3) RETURNING id",
        [tenant, b.company, tenant],
      );
      await tx.query(
        "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,$3,$4) RETURNING id",
        [user, b.email, b.name, passwordHash(b.password)],
      );
      await tx.query(
        "INSERT INTO branches(id,tenant_id,name) VALUES($1,$2,$3) RETURNING id",
        [branch, tenant, b.branch],
      );
      await tx.query(
        "INSERT INTO memberships(id,tenant_id,user_id,role,branch_ids) VALUES($1,$2,$3,'owner',$4::uuid[]) RETURNING id",
        [randomUUID(), tenant, user, [branch]],
      );
      await audit(
        tx,
        { user_id: user, tenant_id: tenant } as Identity,
        "workspace.created",
        tenant,
      );
    });
    return { ok: true };
  }
  async overview(i: Identity, branch: string) {
    branchAccess(i, branch);
    return this.db.transaction(i.tenant_id, async (tx) => {
      const [metrics] = await tx.query(
        `SELECT count(*)::int AS products, coalesce(sum(coalesce(s.quantity,0)),0)::int AS units,
    count(*) FILTER(WHERE coalesce(s.quantity,0)<=coalesce(s.minimum,0) AND coalesce(s.minimum,0)>0)::int AS low,
    coalesce(sum(coalesce(s.quantity,0)*p.cost),0)::text AS cost_value,
    coalesce(sum(coalesce(s.quantity,0)*p.price),0)::text AS sale_value
    FROM products p LEFT JOIN stock_balances s ON s.product_id=p.id AND s.tenant_id=p.tenant_id AND s.branch_id=$1 WHERE p.active`,
        [branch],
      );
      if (!permissions(i.role).includes("cost")) {
        delete metrics.cost_value;
        delete metrics.sale_value;
      }
      const movements = await tx.query(
        `SELECT m.*,p.name AS product_name,u.name AS actor_name FROM stock_movements m JOIN products p ON p.id=m.product_id JOIN users u ON u.id=m.actor_id WHERE m.branch_id=$1 ORDER BY m.created_at DESC,m.id DESC LIMIT 8`,
        [branch],
      );
      return { metrics, movements };
    });
  }
  async products(
    i: Identity,
    branch: string,
    q = "",
    archived = false,
    page = 1,
  ) {
    branchAccess(i, branch);
    return this.db.transaction(i.tenant_id, async (tx) => {
      const rows = await tx.query(
        `SELECT p.*,coalesce(s.quantity,0) AS quantity,coalesce(s.minimum,0) AS minimum,
    c.name AS category_name,b.name AS brand_name,mo.name AS model_name,count(*) OVER()::int AS total
    FROM products p LEFT JOIN stock_balances s ON s.product_id=p.id AND s.tenant_id=p.tenant_id AND s.branch_id=$1
    LEFT JOIN catalog_entries c ON c.id=p.category_id LEFT JOIN catalog_entries b ON b.id=p.brand_id LEFT JOIN catalog_entries mo ON mo.id=p.model_id
    WHERE ($3::boolean OR p.active) AND (p.name ILIKE $2 OR p.sku ILIKE $2 OR p.barcode ILIKE $2)
    ORDER BY p.created_at DESC,p.id LIMIT 30 OFFSET $4`,
        [branch, `%${q.slice(0, 100)}%`, archived, (page - 1) * 30],
      );
      if (!permissions(i.role).includes("cost"))
        rows.forEach((p) => delete p.cost);
      return { items: rows, total: rows[0]?.total || 0, page };
    });
  }
  async saveProduct(i: Identity, body: unknown, key: unknown, id?: string) {
    permit(i, "catalog");
    const b = validate(productSchema, body);
    if (id) validate(uuid, id);
    return this.write(i, key, { action: "product.save", id, b }, async (tx) => {
      for (const [kind, value] of [
        ["category", b.category_id],
        ["brand", b.brand_id],
        ["model", b.model_id],
        ["supplier", b.supplier_id],
      ])
        if (value) {
          const [entry] = await tx.query(
            "SELECT id FROM catalog_entries WHERE id=$1 AND kind=$2",
            [value, kind],
          );
          if (!entry) fail(400, `Cadastro inválido: ${kind}.`);
        }
      const productId = id || randomUUID();
      if (id) {
        const [old] = await tx.query(
          "SELECT * FROM products WHERE id=$1 FOR UPDATE",
          [id],
        );
        if (!old) fail(404, "Produto não encontrado.");
        if (b.version !== old.version)
          fail(409, "Produto alterado por outra pessoa. Atualize a tela.");
        if (old.serialized !== b.serialized) {
          const [used] = await tx.query(
            "SELECT id FROM stock_movements WHERE product_id=$1 LIMIT 1",
            [id],
          );
          if (used)
            fail(
              409,
              "Não é possível alterar o controle individual após movimentações.",
            );
        }
      }
      const fields = [
        "name",
        "sku",
        "barcode",
        "category_id",
        "brand_id",
        "model_id",
        "supplier_id",
        "color",
        "capacity",
        "condition",
        "serialized",
        "cost",
        "price",
        "warranty_days",
        "warranty_terms",
      ] as const;
      const values = fields.map((f) => b[f]);
      if (id)
        await tx.query(
          `UPDATE products SET ${fields.map((f, j) => `${f}=$${j + 1}`).join(",")},version=version+1 WHERE id=$16 RETURNING id`,
          [...values, id],
        );
      else
        await tx.query(
          `INSERT INTO products(${fields.join(",")},id,tenant_id) VALUES(${Array.from({ length: 17 }, (_, j) => `$${j + 1}`).join(",")}) RETURNING id`,
          [...values, productId, i.tenant_id],
        );
      await audit(
        tx,
        i,
        id ? "product.updated" : "product.created",
        productId,
        { sku: b.sku },
      );
      return { id: productId };
    });
  }
  async archive(i: Identity, id: string, key: unknown) {
    permit(i, "catalog");
    validate(uuid, id);
    return this.write(i, key, { action: "archive", id }, async (tx) => {
      const [p] = await tx.query(
        "SELECT id FROM products WHERE id=$1 FOR UPDATE",
        [id],
      );
      if (!p) fail(404, "Produto não encontrado.");
      const [s] = await tx.query(
        "SELECT quantity FROM stock_balances WHERE product_id=$1 AND quantity>0 LIMIT 1",
        [id],
      );
      if (s) fail(409, "Retire ou ajuste o estoque antes de arquivar.");
      await tx.query(
        "UPDATE products SET active=false,version=version+1 WHERE id=$1 RETURNING id",
        [id],
      );
      await audit(tx, i, "product.archived", id);
      return { ok: true };
    });
  }
  private async lockStock(
    tx: Tx,
    i: Identity,
    product: string,
    branch: string,
  ) {
    const [p] = await tx.query(
      "SELECT * FROM products WHERE id=$1 FOR UPDATE",
      [product],
    );
    if (!p) fail(404, "Produto não encontrado.");
    if (!p.active) fail(409, "Produto arquivado.");
    await tx.query(
      "INSERT INTO stock_balances(tenant_id,branch_id,product_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING product_id",
      [i.tenant_id, branch, product],
    );
    const [stock] = await tx.query(
      "SELECT * FROM stock_balances WHERE product_id=$1 AND branch_id=$2 FOR UPDATE",
      [product, branch],
    );
    return { p, stock };
  }
  private async ledger(
    tx: Tx,
    i: Identity,
    b: { branch_id: string; product_id: string; reason: string },
    quantity: number,
    balance: number,
    type: string,
    unit: string | null = null,
    reverses: string | null = null,
  ) {
    const id = randomUUID();
    await tx.query(
      "UPDATE stock_balances SET quantity=$1 WHERE product_id=$2 AND branch_id=$3 RETURNING product_id",
      [balance, b.product_id, b.branch_id],
    );
    await tx.query(
      "INSERT INTO stock_movements(id,tenant_id,branch_id,product_id,type,quantity,balance_after,reason,actor_id,unit_id,reverses_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id",
      [
        id,
        i.tenant_id,
        b.branch_id,
        b.product_id,
        type,
        quantity,
        balance,
        b.reason,
        i.user_id,
        unit,
        reverses,
      ],
    );
    await audit(
      tx,
      i,
      `stock.${type}`,
      id,
      { quantity, balance, product_id: b.product_id },
      b.branch_id,
    );
    return { id, balance };
  }
  async move(i: Identity, body: unknown, key: unknown) {
    permit(i, "stock");
    const b = validate(movementSchema, body);
    branchAccess(i, b.branch_id);
    return this.write(i, key, { action: "move", b }, async (tx) => {
      const { p, stock } = await this.lockStock(
        tx,
        i,
        b.product_id,
        b.branch_id,
      );
      let unit: string | null = null;
      if (p.serialized) {
        if (b.quantity !== 1)
          fail(400, "Aparelhos são movimentados individualmente.");
        if (b.type === "entry" && !b.unit_id) {
          if (!b.device || (!b.device.imeis.length && !b.device.serial))
            fail(400, "Informe IMEI ou número de série e procedência.");
          if (
            new Set(b.device.imeis).size !== b.device.imeis.length ||
            b.device.imeis.some((v) => !validImei(v))
          )
            fail(400, "IMEI inválido ou repetido.");
          if (b.device.supplier_id) {
            const [s] = await tx.query(
              "SELECT id FROM catalog_entries WHERE id=$1 AND kind='supplier'",
              [b.device.supplier_id],
            );
            if (!s) fail(400, "Fornecedor inválido.");
          }
          unit = randomUUID();
          await tx.query(
            "INSERT INTO device_units(id,tenant_id,product_id,branch_id,serial,provenance,supplier_id,acquisition_cost,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'in_stock') RETURNING id",
            [
              unit,
              i.tenant_id,
              p.id,
              b.branch_id,
              b.device.serial || null,
              b.device.provenance,
              b.device.supplier_id,
              b.device.acquisition_cost,
            ],
          );
          for (const imei of b.device.imeis)
            await tx.query(
              "INSERT INTO device_identifiers(tenant_id,unit_id,imei) VALUES($1,$2,$3) RETURNING imei",
              [i.tenant_id, unit, imei],
            );
        } else {
          if (!b.unit_id || b.device)
            fail(400, "Selecione a unidade existente.");
          const [u] = await tx.query(
            "SELECT * FROM device_units WHERE id=$1 AND product_id=$2 AND branch_id=$3 FOR UPDATE",
            [b.unit_id, p.id, b.branch_id],
          );
          if (!u || u.status !== (b.type === "entry" ? "out" : "in_stock"))
            fail(409, "Aparelho indisponível para esta operação.");
          unit = u.id;
          await tx.query(
            "UPDATE device_units SET status=$1 WHERE id=$2 RETURNING id",
            [b.type === "entry" ? "in_stock" : "out", unit],
          );
        }
      } else if (b.unit_id || b.device)
        fail(400, "Este produto não utiliza controle individual.");
      const delta = b.type === "entry" ? b.quantity : -b.quantity;
      const balance = stock.quantity + delta;
      if (balance < 0) fail(409, "Estoque insuficiente.");
      return this.ledger(tx, i, b, delta, balance, b.type, unit);
    });
  }
  async count(i: Identity, body: unknown, key: unknown) {
    permit(i, "adjust");
    const b = validate(inventorySchema, body);
    branchAccess(i, b.branch_id);
    return this.write(i, key, { action: "inventory", b }, async (tx) => {
      const { p, stock } = await this.lockStock(
        tx,
        i,
        b.product_id,
        b.branch_id,
      );
      if (stock.quantity !== b.expected)
        fail(409, "Saldo mudou durante a contagem. Confira e tente novamente.");
      if (p.serialized && b.counted !== stock.quantity)
        fail(
          409,
          "Para aparelhos, reconcilie as unidades por entradas e saídas identificadas antes de concluir a contagem.",
        );
      const diff = b.counted - stock.quantity;
      const move = diff
        ? await this.ledger(tx, i, b, diff, b.counted, "adjustment")
        : null;
      const id = randomUUID();
      await tx.query(
        "INSERT INTO inventory_counts(id,tenant_id,branch_id,product_id,expected,counted,reason,actor_id,movement_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id",
        [
          id,
          i.tenant_id,
          b.branch_id,
          b.product_id,
          b.expected,
          b.counted,
          b.reason,
          i.user_id,
          move?.id || null,
        ],
      );
      await audit(
        tx,
        i,
        "inventory.counted",
        id,
        { expected: b.expected, counted: b.counted },
        b.branch_id,
      );
      return { id, balance: b.counted };
    });
  }
  async reverse(i: Identity, id: string, reason: string, key: unknown) {
    permit(i, "adjust");
    validate(uuid, id);
    validate(text(2000), reason);
    return this.write(i, key, { action: "reverse", id, reason }, async (tx) => {
      const [m] = await tx.query("SELECT * FROM stock_movements WHERE id=$1", [
        id,
      ]);
      if (!m) fail(404, "Movimentação não encontrada.");
      branchAccess(i, m.branch_id);
      if (m.type === "reversal")
        fail(409, "Registre uma nova movimentação para corrigir um estorno.");
      const { stock } = await this.lockStock(tx, i, m.product_id, m.branch_id);
      const [already] = await tx.query(
        "SELECT id FROM stock_movements WHERE reverses_id=$1",
        [id],
      );
      if (already) fail(409, "Movimentação já estornada.");
      const balance = stock.quantity - m.quantity;
      if (balance < 0) fail(409, "Saldo insuficiente para estornar.");
      if (m.unit_id) {
        const [later] = await tx.query(
          "SELECT id FROM stock_movements WHERE unit_id=$1 AND (created_at>$2 OR (created_at=$2 AND id<>$3)) LIMIT 1",
          [m.unit_id, m.created_at, id],
        );
        if (later) fail(409, "Aparelho possui movimentações posteriores.");
        await tx.query(
          "UPDATE device_units SET status=$1 WHERE id=$2 RETURNING id",
          [m.quantity > 0 ? "out" : "in_stock", m.unit_id],
        );
      }
      return this.ledger(
        tx,
        i,
        { branch_id: m.branch_id, product_id: m.product_id, reason },
        -m.quantity,
        balance,
        "reversal",
        m.unit_id,
        id,
      );
    });
  }
  async minimum(i: Identity, body: unknown, key: unknown) {
    permit(i, "adjust");
    const b = validate(
      z
        .object({
          branch_id: uuid,
          product_id: uuid,
          minimum: z.coerce.number().int().min(0).max(1000000),
        })
        .strict(),
      body,
    );
    branchAccess(i, b.branch_id);
    return this.write(i, key, { action: "minimum", b }, async (tx) => {
      await this.lockStock(tx, i, b.product_id, b.branch_id);
      await tx.query(
        "UPDATE stock_balances SET minimum=$1 WHERE branch_id=$2 AND product_id=$3 RETURNING product_id",
        [b.minimum, b.branch_id, b.product_id],
      );
      await audit(
        tx,
        i,
        "stock.minimum",
        b.product_id,
        { minimum: b.minimum },
        b.branch_id,
      );
      return { ok: true };
    });
  }
}

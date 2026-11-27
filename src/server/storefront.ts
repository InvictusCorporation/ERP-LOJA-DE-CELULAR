import { z } from "zod";
import { Database } from "./db";
import { Identity, permissions } from "./security";
import {
  InventoryService,
  audit,
  branchAccess,
  fail,
  permit,
  uuid,
  validate,
} from "./domain";

export class StorefrontService {
  constructor(
    private db: Database,
    private inventory: InventoryService,
  ) {}
  async dashboard(i: Identity, branch: string, period: unknown) {
    branchAccess(i, branch);
    const days = validate(
      z.coerce.number().pipe(z.union([z.literal(7), z.literal(30)])),
      period ?? 7,
    );
    const rights = permissions(i);
    const salesAllowed = rights.includes("pos_manage");
    const serviceAllowed = rights.includes("service_manage");
    return this.db.transaction(i.tenant_id, async (tx) => {
      const [stock] = await tx.query(
        `SELECT
        (SELECT count(*)::int FROM device_units WHERE branch_id=$1 AND status='in_stock' AND NOT reserved) AS available,
        (SELECT count(*)::int FROM device_units WHERE branch_id=$1 AND reserved) AS reserved,
        (SELECT count(*)::int FROM stock_balances b JOIN products p ON p.id=b.product_id WHERE b.branch_id=$1 AND p.active AND b.minimum>0 AND b.quantity<=b.minimum) AS low`,
        [branch],
      );
      const highlights = await tx.query(
        `SELECT p.id,p.name,p.sku,p.serialized,p.image_data,p.price,b.quantity FROM products p JOIN stock_balances b ON b.product_id=p.id WHERE b.branch_id=$1 AND p.active AND b.quantity>0 ORDER BY b.quantity DESC,p.name,p.id LIMIT 3`,
        [branch],
      );
      let sales = null,
        evolution: any[] = [],
        recent: any[] = [],
        services = null;
      if (salesAllowed) {
        // Net movement by event date: returns are deducted on their actual day.
        const events = `SELECT total_cents::bigint AS amount,created_at FROM pos_sales WHERE branch_id=$1 UNION ALL SELECT -total_cents::bigint,created_at FROM pos_returns WHERE branch_id=$1`;
        [sales] = await tx.query(
          `SELECT (SELECT coalesce(sum(amount),0)::text FROM (${events}) e WHERE (created_at AT TIME ZONE 'America/Fortaleza')::date=(now() AT TIME ZONE 'America/Fortaleza')::date) AS net_cents,
          (SELECT count(*)::int FROM pos_sales WHERE branch_id=$1 AND status IN ('completed','partial_return') AND (created_at AT TIME ZONE 'America/Fortaleza')::date=(now() AT TIME ZONE 'America/Fortaleza')::date) AS count`,
          [branch],
        );
        evolution = await tx.query(
          `WITH days AS (SELECT ((now() AT TIME ZONE 'America/Fortaleza')::date-n)::date AS day FROM generate_series(0,$2::int-1) n), events AS (${events}) SELECT d.day::text,coalesce(sum(e.amount),0)::text AS cents FROM days d LEFT JOIN events e ON (e.created_at AT TIME ZONE 'America/Fortaleza')::date=d.day GROUP BY d.day ORDER BY d.day`,
          [branch, days],
        );
        recent = await tx.query(
          `SELECT s.id,s.receipt_code,s.status,s.created_at,s.total_cents,
          (SELECT string_agg(x.product_name,' + ' ORDER BY x.id) FROM pos_sale_items x WHERE x.sale_id=s.id) AS items,
          (SELECT string_agg(DISTINCT p.method,', ') FROM pos_sale_payments p WHERE p.sale_id=s.id) AS methods
          FROM pos_sales s WHERE s.branch_id=$1 ORDER BY s.created_at DESC,s.id LIMIT 5`,
          [branch],
        );
      }
      if (serviceAllowed)
        [services] = await tx.query(
          `SELECT count(*) FILTER(WHERE status NOT IN ('delivered','cancelled','declined'))::int AS open,count(*) FILTER(WHERE status='ready')::int AS ready FROM repair_orders WHERE branch_id=$1`,
          [branch],
        );
      return { stock, highlights, sales, evolution, recent, services, days };
    });
  }
  async unit(i: Identity, id: string) {
    validate(uuid, id);
    return this.db.transaction(i.tenant_id, async (tx) => {
      const [unit] = await tx.query(
        "SELECT id,branch_id FROM device_units WHERE id=$1",
        [id],
      );
      if (!unit) fail(404, "Aparelho não encontrado.");
      branchAccess(i, unit.branch_id);
      const events = await tx.query(
        "SELECT id,type,quantity,balance_after,reason,created_at FROM stock_movements WHERE unit_id=$1 AND branch_id=ANY($2::uuid[]) ORDER BY created_at DESC,id LIMIT 100",
        [id, i.branch_ids],
      );
      return { items: events };
    });
  }
  async saveUnit(i: Identity, id: string, body: unknown, key: unknown) {
    permit(i, "stock");
    validate(uuid, id);
    const b = validate(
      z
        .object({
          version: z.number().int().positive(),
          battery_health: z.number().int().min(0).max(100).nullable(),
          physical_condition: z.string().trim().max(300),
          location: z.string().trim().max(180),
          reserved: z.boolean(),
        })
        .strict(),
      body,
    );
    return this.inventory.write(
      i,
      key,
      { action: "unit.details", id, b },
      async (tx) => {
        const [u] = await tx.query(
          "SELECT * FROM device_units WHERE id=$1 FOR UPDATE",
          [id],
        );
        if (!u) fail(404, "Aparelho não encontrado.");
        branchAccess(i, u.branch_id);
        const [branch] = await tx.query(
          "SELECT active FROM branches WHERE id=$1",
          [u.branch_id],
        );
        if (!branch?.active) fail(409, "Filial inativa.");
        if (u.details_version !== b.version)
          fail(409, "Ficha alterada. Atualize a tela.");
        if (b.reserved && u.status !== "in_stock")
          fail(409, "Somente um aparelho em estoque pode ser reservado.");
        await tx.query(
          "UPDATE device_units SET battery_health=$1,physical_condition=$2,location=$3,reserved=$4,details_version=details_version+1 WHERE id=$5 RETURNING id",
          [b.battery_health, b.physical_condition, b.location, b.reserved, id],
        );
        await audit(
          tx,
          i,
          "unit.details.updated",
          id,
          { reserved: b.reserved },
          u.branch_id,
        );
        return { id };
      },
    );
  }
}

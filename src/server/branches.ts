import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Database, Tx } from "./db";
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
import { reportInteger as integer } from "./reporting-metrics";
type Row = Record<string, any>;
const optional = (max: number) => z.string().trim().max(max).default("");
const fields = {
  name: z.string().trim().min(1).max(180),
  code: optional(40).transform((s) => s.toUpperCase()),
  phone: optional(40),
  email: z.union([z.email().max(254), z.literal("")]).default(""),
  address: optional(300),
  city: optional(120),
  state: optional(2).refine(
    (s) => !s || /^[A-Z]{2}$/.test(s),
    "Use a UF em maiúsculas.",
  ),
  notes: optional(1000),
};
const createSchema = z.object(fields).strict(),
  editSchema = z
    .object({
      ...fields,
      version: z.number().int().positive(),
      reason: z.string().trim().min(5).max(500),
    })
    .strict();
const reasonSchema = z
  .object({
    reason: z.string().trim().min(5).max(500),
    confirmed: z.literal(true),
  })
  .strict();
const transferSchema = z
  .object({
    source_branch_id: uuid,
    destination_branch_id: uuid,
    reason: z.string().trim().min(5).max(500),
    confirmed: z.literal(true),
    items: z
      .array(
        z
          .object({
            product_id: uuid,
            quantity: z.number().int().min(1).max(1000000),
            unit_ids: z.array(uuid).max(200).default([]),
          })
          .strict(),
      )
      .min(1)
      .max(30),
  })
  .strict();
const paid = `(t.opening_paid_cents+coalesce((SELECT sum(s.amount_cents+s.discount_cents-s.charges_cents) FROM finance_settlements s JOIN finance_entries e ON e.settlement_id=s.id AND e.source_kind='settlement' WHERE s.title_id=t.id AND NOT EXISTS(SELECT 1 FROM finance_entries r WHERE r.reverses_entry_id=e.id)),0))`;
function paging(q: Row) {
  return {
    page: validate(
      z.coerce.number().int().min(1).max(100000).default(1),
      q.page,
    ),
    q: validate(z.string().trim().max(100).default(""), q.q),
  };
}
export class BranchesService {
  constructor(
    private db: Database,
    private inventory: InventoryService,
  ) {}
  private async owner(tx: Tx, i: Identity) {
    const [m] = await tx.query(
      "SELECT m.role,m.branch_ids FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=$1 AND m.user_id=$2 AND m.active AND u.active FOR UPDATE OF m",
      [i.tenant_id, i.user_id],
    );
    if (!m || m.role !== "owner")
      fail(403, "Somente o proprietário pode gerir o cadastro das filiais.");
    return { ...i, ...m } as Identity;
  }
  private async operating(tx: Tx, ids: string[]) {
    const rows = await tx.query(
      "SELECT id,name,active FROM branches WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE",
      [ids],
    );
    if (rows.length !== new Set(ids).size) fail(404, "Filial não encontrada.");
    if (rows.some((b) => !b.active))
      fail(409, "Filial inativa. Reative-a antes de operar.");
    return rows;
  }
  async list(i: Identity, query: Row) {
    permit(i, "branch_read");
    const { q, page } = paging(query),
      status = validate(
        z.enum(["all", "active", "inactive"]).default("all"),
        query.status,
      );
    return this.db.transaction(i.tenant_id, async (tx) => {
      const [r] = await tx.query(
        `WITH rows AS (SELECT * FROM branches WHERE id=ANY($1::uuid[]) AND ($2='all' OR active=($2='active')) AND strpos(lower(name||' '||code||' '||city),lower($3))>0) SELECT (SELECT count(*)::int FROM rows) AS total,coalesce((SELECT jsonb_agg(v) FROM (SELECT * FROM rows ORDER BY active DESC,lower(name),id LIMIT 30 OFFSET $4) v),'[]'::jsonb) AS items`,
        [i.branch_ids, status, q, (page - 1) * 30],
      );
      return {
        ...r,
        page,
        page_size: 30,
        can_manage: permissions(i).includes("branches"),
        can_transfer: permissions(i).includes("branch_transfer"),
      };
    });
  }
  async detail(i: Identity, id: string) {
    permit(i, "branch_read");
    branchAccess(i, id);
    return this.db.transaction(i.tenant_id, async (tx) => {
      const [branch] = await tx.query("SELECT * FROM branches WHERE id=$1", [
        id,
      ]);
      if (!branch) fail(404, "Filial não encontrada.");
      const [summary] = await tx.query(
        `SELECT (SELECT coalesce(sum(quantity),0)::text FROM stock_balances WHERE branch_id=$1) AS stock_units,(SELECT count(*)::int FROM device_units WHERE branch_id=$1 AND status='in_stock') AS identified_units,(SELECT count(*)::int FROM pos_registers WHERE branch_id=$1 AND active) AS registers,(SELECT count(*)::int FROM cash_sessions WHERE branch_id=$1 AND status='open') AS open_sessions,(SELECT count(*)::int FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=$2 AND m.active AND u.active AND $1::uuid=ANY(m.branch_ids)) AS assigned_staff`,
        [id, i.tenant_id],
      );
      summary.stock_units = integer(summary.stock_units);
      return { branch, summary };
    });
  }
  async stock(i: Identity, id: string, query: Row) {
    permit(i, "branch_read");
    branchAccess(i, id);
    const { q, page } = paging(query);
    return this.db.transaction(i.tenant_id, async (tx) => {
      const [r] = await tx.query(
        `WITH rows AS (SELECT p.id,p.name,p.sku,p.serialized,b.quantity,b.minimum FROM stock_balances b JOIN products p ON p.id=b.product_id WHERE b.branch_id=$1 AND b.quantity>0 AND strpos(lower(p.name||' '||p.sku),lower($2))>0) SELECT (SELECT count(*)::int FROM rows) AS total,coalesce((SELECT jsonb_agg(v) FROM (SELECT * FROM rows ORDER BY name,id LIMIT 30 OFFSET $3) v),'[]'::jsonb) AS items`,
        [id, q, (page - 1) * 30],
      );
      return { ...r, page, page_size: 30 };
    });
  }
  async units(i: Identity, query: Row) {
    permit(i, "branch_transfer");
    const branch = validate(uuid, query.branch_id),
      product = validate(uuid, query.product_id);
    branchAccess(i, branch);
    const { q, page } = paging(query);
    return this.db.transaction(i.tenant_id, async (tx) => {
      const [r] = await tx.query(
        `WITH rows AS (SELECT d.id,d.serial,coalesce((SELECT string_agg(imei,', ' ORDER BY imei) FROM device_identifiers WHERE unit_id=d.id),'') AS imeis FROM device_units d WHERE d.branch_id=$1 AND d.product_id=$2 AND d.status='in_stock' AND (strpos(lower(coalesce(d.serial,'')),lower($3))>0 OR EXISTS(SELECT 1 FROM device_identifiers x WHERE x.unit_id=d.id AND strpos(x.imei,$3)>0))) SELECT (SELECT count(*)::int FROM rows) AS total,coalesce((SELECT jsonb_agg(v) FROM (SELECT * FROM rows ORDER BY serial NULLS LAST,id LIMIT 30 OFFSET $4) v),'[]'::jsonb) AS items`,
        [branch, product, q, (page - 1) * 30],
      );
      return { ...r, page, page_size: 30 };
    });
  }
  async save(i: Identity, id: string | null, body: unknown, key: unknown) {
    permit(i, "branches");
    if (id) branchAccess(i, id);
    const b = id ? validate(editSchema, body) : validate(createSchema, body);
    return this.inventory.write(
      i,
      key,
      { action: "branch.save", id, b },
      async (tx) => {
        await tx.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1,0))::text",
          ["branches:" + i.tenant_id],
        );
        await tx.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1,0))::text",
          ["employees:" + i.tenant_id],
        );
        const fresh = await this.owner(tx, i);
        if (id) branchAccess(fresh, id);
        const target = id || randomUUID();
        if (id) {
          const [old] = await tx.query(
            "SELECT * FROM branches WHERE id=$1 FOR UPDATE",
            [id],
          );
          if (!old) fail(404, "Filial não encontrada.");
          if (old.version !== (b as any).version)
            fail(409, "Filial atualizada. Recarregue o cadastro.");
        } else
          await tx.query(
            "INSERT INTO branches(id,tenant_id,name) VALUES($1,$2,$3) RETURNING id",
            [target, i.tenant_id, b.name],
          );
        const [saved] = await tx.query(
          "UPDATE branches SET name=$2,code=$3,phone=$4,email=$5,address=$6,city=$7,state=$8,notes=$9,version=version+$10,updated_at=now() WHERE id=$1 RETURNING version",
          [
            target,
            b.name,
            b.code,
            b.phone,
            b.email,
            b.address,
            b.city,
            b.state,
            b.notes,
            id ? 1 : 0,
          ],
        );
        if (!id)
          await tx.query(
            "UPDATE memberships SET branch_ids=array_append(branch_ids,$1::uuid),version=version+1,updated_at=now() WHERE tenant_id=$2 AND role='owner' AND NOT $1::uuid=ANY(branch_ids) RETURNING id",
            [target, i.tenant_id],
          );
        await audit(
          tx,
          fresh,
          id ? "branch.updated" : "branch.created",
          target,
          { code: b.code, reason: (b as any).reason },
          target,
        );
        return { id: target, version: saved.version };
      },
    );
  }
  private async blockers(tx: Tx, id: string) {
    const checks: [string, string][] = [
      [
        "estoque disponível",
        "SELECT 1 FROM stock_balances WHERE branch_id=$1 AND quantity>0 UNION ALL SELECT 1 FROM device_units WHERE branch_id=$1 AND status='in_stock' LIMIT 1",
      ],
      [
        "caixa aberto",
        "SELECT 1 FROM cash_sessions WHERE branch_id=$1 AND status='open' LIMIT 1",
      ],
      [
        "ordens de serviço aguardando encerramento/retirada",
        "SELECT 1 FROM repair_orders WHERE branch_id=$1 AND status<>'delivered' LIMIT 1",
      ],
      [
        "pedidos de compra em aberto",
        "SELECT 1 FROM purchase_orders WHERE branch_id=$1 AND status IN ('draft','ordered','partial') LIMIT 1",
      ],
      [
        "pendências do CRM",
        "SELECT 1 FROM crm_tasks WHERE branch_id=$1 AND status='pending' UNION ALL SELECT 1 FROM crm_opportunities WHERE branch_id=$1 AND stage NOT IN ('won','lost') LIMIT 1",
      ],
      [
        "ofertas de crediário vigentes",
        "SELECT 1 FROM credit_offers WHERE branch_id=$1 AND status='approved' AND valid_until>=(now() AT TIME ZONE 'America/Fortaleza')::date LIMIT 1",
      ],
      [
        "títulos financeiros abertos ou a conferir",
        `SELECT 1 FROM finance_titles t WHERE t.branch_id=$1 AND NOT t.cancelled AND (t.needs_review OR t.amount_cents-${paid}>0) LIMIT 1`,
      ],
      [
        "contas financeiras ativas ou com saldo",
        `SELECT 1 FROM finance_accounts a WHERE a.branch_id=$1 AND (a.active OR coalesce((SELECT sum(e.amount_cents) FROM finance_entries e LEFT JOIN finance_reconciliations r ON r.entry_id=e.id AND r.voided_at IS NULL WHERE coalesce(e.account_id,r.account_id)=a.id),0)<>0) LIMIT 1`,
      ],
      [
        "movimentos financeiros sem conta",
        `SELECT 1 FROM finance_entries e LEFT JOIN finance_reconciliations r ON r.entry_id=e.id AND r.voided_at IS NULL WHERE e.branch_id=$1 AND coalesce(e.account_id,r.account_id) IS NULL LIMIT 1`,
      ],
      [
        "funcionários com filial de trabalho ou único acesso ativo nesta unidade",
        `SELECT 1 FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=(SELECT tenant_id FROM branches WHERE id=$1) AND m.active AND u.active AND (m.home_branch_id=$1 OR ($1::uuid=ANY(m.branch_ids) AND NOT EXISTS(SELECT 1 FROM branches b WHERE b.id=ANY(m.branch_ids) AND b.id<>$1 AND b.active))) LIMIT 1`,
      ],
    ];
    const result: string[] = [];
    for (const [label, sql] of checks)
      if ((await tx.query(sql, [id])).length) result.push(label);
    return result;
  }
  async state(i: Identity, id: string, body: unknown, key: unknown) {
    permit(i, "branches");
    branchAccess(i, id);
    const b = validate(
      z
        .object({
          version: z.number().int().positive(),
          active: z.boolean(),
          reason: z.string().trim().min(5).max(500),
        })
        .strict(),
      body,
    );
    return this.inventory.write(
      i,
      key,
      { action: "branch.state", id, b },
      async (tx) => {
        await tx.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1,0))::text",
          ["branches:" + i.tenant_id],
        );
        const fresh = await this.owner(tx, i);
        branchAccess(fresh, id);
        const [old] = await tx.query(
          "SELECT * FROM branches WHERE id=$1 FOR UPDATE",
          [id],
        );
        if (!old) fail(404, "Filial não encontrada.");
        if (old.version !== b.version)
          fail(409, "Filial atualizada. Recarregue o cadastro.");
        if (old.active === b.active)
          fail(409, "A filial já está nessa situação.");
        if (!b.active) {
          const [others] = await tx.query(
            "SELECT count(*)::int AS n FROM branches WHERE active AND id<>$1",
            [id],
          );
          if (!others.n) fail(409, "Mantenha pelo menos uma filial ativa.");
          const pending = await this.blockers(tx, id);
          if (pending.length)
            fail(409, "Resolva antes de inativar: " + pending.join("; ") + ".");
        }
        const [saved] = await tx.query(
          "UPDATE branches SET active=$2,version=version+1,updated_at=now() WHERE id=$1 RETURNING version",
          [id, b.active],
        );
        await audit(
          tx,
          fresh,
          b.active ? "branch.reactivated" : "branch.inactivated",
          id,
          { reason: b.reason },
          id,
        );
        return { id, version: saved.version, active: b.active };
      },
    );
  }
  private scope(i: Identity, t: Row) {
    branchAccess(i, t.source_branch_id);
    branchAccess(i, t.destination_branch_id);
  }
  async transfers(i: Identity, query: Row) {
    permit(i, "branch_read");
    const { q, page } = paging(query);
    const branch = String(query.branch_id || "all");
    if (branch !== "all") branchAccess(i, branch);
    return this.db.transaction(i.tenant_id, async (tx) => {
      const [r] = await tx.query(
        `WITH rows AS (SELECT t.*,EXISTS(SELECT 1 FROM stock_transfer_reversals r WHERE r.transfer_id=t.id) AS reversed,(SELECT sum(quantity)::text FROM stock_transfer_items WHERE transfer_id=t.id) AS quantity FROM stock_transfers t WHERE source_branch_id=ANY($1::uuid[]) AND destination_branch_id=ANY($1::uuid[]) AND ($2='all' OR source_branch_id::text=$2 OR destination_branch_id::text=$2) AND strpos(lower(code||' '||source_name||' '||destination_name),lower($3))>0) SELECT (SELECT count(*)::int FROM rows) AS total,coalesce((SELECT jsonb_agg(v) FROM (SELECT * FROM rows ORDER BY created_at DESC,id DESC LIMIT 30 OFFSET $4) v),'[]'::jsonb) AS items`,
        [i.branch_ids, branch, q, (page - 1) * 30],
      );
      return { ...r, page, page_size: 30 };
    });
  }
  async transferDetail(i: Identity, id: string) {
    permit(i, "branch_read");
    validate(uuid, id);
    return this.db.transaction(i.tenant_id, async (tx) => {
      const [transfer] = await tx.query(
        "SELECT t.*,u.name AS actor_name FROM stock_transfers t JOIN users u ON u.id=t.created_by WHERE t.id=$1",
        [id],
      );
      if (!transfer) fail(404, "Transferência não encontrada.");
      this.scope(i, transfer);
      const items = await tx.query(
        "SELECT x.*,d.serial,coalesce((SELECT string_agg(imei,', ' ORDER BY imei) FROM device_identifiers WHERE unit_id=x.unit_id),'') AS imeis FROM stock_transfer_items x LEFT JOIN device_units d ON d.id=x.unit_id WHERE x.transfer_id=$1 ORDER BY x.product_name,x.sku,x.id",
        [id],
      );
      if (!permissions(i).includes("cost"))
        items.forEach((x) => delete x.unit_cost_cents);
      const [reversal] = await tx.query(
        "SELECT r.*,u.name AS actor_name FROM stock_transfer_reversals r JOIN users u ON u.id=r.created_by WHERE r.transfer_id=$1",
        [id],
      );
      return { transfer, items, reversal: reversal || null };
    });
  }
  async transfer(i: Identity, body: unknown, key: unknown) {
    permit(i, "branch_transfer");
    const b = validate(transferSchema, body);
    this.scope(i, b);
    if (b.source_branch_id === b.destination_branch_id)
      fail(400, "Escolha filiais diferentes.");
    if (new Set(b.items.map((x) => x.product_id)).size !== b.items.length)
      fail(400, "Agrupe cada produto em uma linha.");
    const ids = b.items.flatMap((x) => x.unit_ids);
    if (ids.length > 200 || new Set(ids).size !== ids.length)
      fail(400, "Selecione até 200 unidades, sem repetição.");
    return this.inventory.write(
      i,
      key,
      { action: "branch.transfer", b },
      async (tx) => {
        const branches = await this.operating(tx, [
            b.source_branch_id,
            b.destination_branch_id,
          ]),
          id = randomUUID(),
          code =
            "TR-" + randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();
        const plans: Row[] = [];
        for (const line of [...b.items].sort((a, b) =>
          a.product_id.localeCompare(b.product_id),
        )) {
          const { p, stock } = await this.inventory.lockStock(
            tx,
            i,
            line.product_id,
            b.source_branch_id,
          );
          const dest = await this.inventory.lockStock(
            tx,
            i,
            line.product_id,
            b.destination_branch_id,
          );
          if (stock.quantity < line.quantity)
            fail(409, "Estoque insuficiente na origem: " + p.name);
          if (dest.stock.quantity + line.quantity > 2147483647)
            fail(422, "Saldo acima do limite suportado no destino.");
          if (p.serialized) {
            if (line.unit_ids.length !== line.quantity)
              fail(400, "Identifique cada unidade de " + p.name);
            const units = await tx.query(
              "SELECT * FROM device_units WHERE id=ANY($1::uuid[]) AND product_id=$2 AND branch_id=$3 AND status='in_stock' ORDER BY id FOR UPDATE",
              [line.unit_ids, p.id, b.source_branch_id],
            );
            if (units.length !== line.quantity)
              fail(409, "Uma unidade não está disponível na origem.");
            for (const u of units)
              plans.push({
                p,
                quantity: 1,
                unit: u,
                cost: integer(Math.round(Number(u.acquisition_cost) * 100)),
              });
          } else {
            if (line.unit_ids.length)
              fail(
                400,
                "Produto por quantidade não aceita unidades identificadas.",
              );
            plans.push({
              p,
              quantity: line.quantity,
              unit: null,
              cost: integer(Math.round(Number(p.cost) * 100)),
            });
          }
        }
        await tx.query(
          "INSERT INTO stock_transfers(id,tenant_id,source_branch_id,destination_branch_id,source_name,destination_name,code,reason,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id",
          [
            id,
            i.tenant_id,
            b.source_branch_id,
            b.destination_branch_id,
            branches.find((x) => x.id === b.source_branch_id)!.name,
            branches.find((x) => x.id === b.destination_branch_id)!.name,
            code,
            b.reason,
            i.user_id,
          ],
        );
        for (const plan of plans) {
          const item = randomUUID();
          let revision = null;
          if (plan.unit) {
            const [u] = await tx.query(
              "UPDATE device_units SET branch_id=$2 WHERE id=$1 RETURNING movement_version",
              [plan.unit.id, b.destination_branch_id],
            );
            revision = u.movement_version;
          }
          await tx.query(
            "INSERT INTO stock_transfer_items(id,tenant_id,transfer_id,product_id,product_name,sku,quantity,unit_id,unit_revision,unit_cost_cents) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id",
            [
              item,
              i.tenant_id,
              id,
              plan.p.id,
              plan.p.name,
              plan.p.sku,
              plan.quantity,
              plan.unit?.id || null,
              revision,
              plan.cost,
            ],
          );
          for (const [branch, delta, leg, type] of [
            [b.source_branch_id, -plan.quantity, "out", "exit"],
            [b.destination_branch_id, plan.quantity, "in", "entry"],
          ] as const) {
            const [balance] = await tx.query(
              "SELECT quantity FROM stock_balances WHERE branch_id=$1 AND product_id=$2",
              [branch, plan.p.id],
            );
            await this.inventory.ledger(
              tx,
              i,
              {
                branch_id: branch,
                product_id: plan.p.id,
                reason: "Transferência " + code,
              },
              delta,
              balance.quantity + delta,
              type,
              plan.unit?.id || null,
              null,
              { transferItemId: item, transferLeg: leg },
            );
          }
        }
        await audit(tx, i, "branch.transfer", id, { code }, b.source_branch_id);
        return { id, code };
      },
    );
  }
  async reverse(i: Identity, id: string, body: unknown, key: unknown) {
    permit(i, "branch_transfer");
    validate(uuid, id);
    const b = validate(reasonSchema, body);
    return this.inventory.write(
      i,
      key,
      { action: "branch.transfer.reverse", id, b },
      async (tx) => {
        await tx.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1,0))::text",
          ["transfer:" + i.tenant_id + ":" + id],
        );
        const [t] = await tx.query(
          "SELECT * FROM stock_transfers WHERE id=$1",
          [id],
        );
        if (!t) fail(404, "Transferência não encontrada.");
        this.scope(i, t);
        await this.operating(tx, [t.source_branch_id, t.destination_branch_id]);
        if (
          (
            await tx.query(
              "SELECT id FROM stock_transfer_reversals WHERE transfer_id=$1",
              [id],
            )
          ).length
        )
          fail(409, "Transferência já corrigida.");
        const lines = await tx.query(
          "SELECT * FROM stock_transfer_items WHERE transfer_id=$1 ORDER BY product_id,id",
          [id],
        );
        for (const item of lines) {
          await this.inventory.lockStock(
            tx,
            i,
            item.product_id,
            t.source_branch_id,
          );
          await this.inventory.lockStock(
            tx,
            i,
            item.product_id,
            t.destination_branch_id,
          );
        }
        const totals = new Map<string, number>();
        for (const x of lines)
          totals.set(
            x.product_id,
            (totals.get(x.product_id) || 0) + x.quantity,
          );
        for (const [product, quantity] of totals) {
          const [balance] = await tx.query(
            "SELECT quantity FROM stock_balances WHERE product_id=$1 AND branch_id=$2",
            [product, t.destination_branch_id],
          );
          const [original] = await tx.query(
            "SELECT quantity FROM stock_balances WHERE product_id=$1 AND branch_id=$2",
            [product, t.source_branch_id],
          );
          if (original.quantity + quantity > 2147483647)
            fail(422, "Saldo acima do limite suportado na origem.");
          if (balance.quantity < quantity)
            fail(
              409,
              "Saldo insuficiente no destino para corrigir toda a transferência.",
            );
        }
        for (const item of lines) {
          if (item.unit_id) {
            const [u] = await tx.query(
              "SELECT * FROM device_units WHERE id=$1 FOR UPDATE",
              [item.unit_id],
            );
            if (
              !u ||
              u.status !== "in_stock" ||
              u.branch_id !== t.destination_branch_id ||
              u.movement_version !== item.unit_revision
            )
              fail(
                409,
                "Unidade com movimento posterior. Registre uma nova transferência de retorno.",
              );
            await tx.query(
              "UPDATE device_units SET branch_id=$2 WHERE id=$1 RETURNING id",
              [item.unit_id, t.source_branch_id],
            );
          }
          for (const [branch, delta, leg, oldLeg] of [
            [t.destination_branch_id, -item.quantity, "reverse_out", "in"],
            [t.source_branch_id, item.quantity, "reverse_in", "out"],
          ] as const) {
            const [balance] = await tx.query(
                "SELECT quantity FROM stock_balances WHERE branch_id=$1 AND product_id=$2",
                [branch, item.product_id],
              ),
              [movement] = await tx.query(
                "SELECT id FROM stock_movements WHERE transfer_item_id=$1 AND transfer_leg=$2",
                [item.id, oldLeg],
              );
            await this.inventory.ledger(
              tx,
              i,
              {
                branch_id: branch,
                product_id: item.product_id,
                reason: "Correção " + t.code + ": " + b.reason,
              },
              delta,
              balance.quantity + delta,
              "reversal",
              item.unit_id,
              movement.id,
              { transferItemId: item.id, transferLeg: leg },
            );
          }
        }
        const reversal = randomUUID();
        await tx.query(
          "INSERT INTO stock_transfer_reversals(id,tenant_id,transfer_id,reason,created_by) VALUES($1,$2,$3,$4,$5) RETURNING id",
          [reversal, i.tenant_id, id, b.reason, i.user_id],
        );
        await audit(
          tx,
          i,
          "branch.transfer.reversed",
          id,
          { reason: b.reason },
          t.source_branch_id,
        );
        return { id, reversal_id: reversal };
      },
    );
  }
}

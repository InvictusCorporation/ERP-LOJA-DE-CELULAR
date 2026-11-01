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
} from "./domain";
type Row = Record<string, any>;
const text = (max = 180) => z.string().trim().min(1).max(max);
const cents = z.number().int().min(1).max(1000000000);
const signed = z.number().int().min(-1000000000).max(1000000000);
const version = z.number().int().positive();
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(s + "T12:00:00Z");
    return (
      s >= "2000-01-01" &&
      s <= "2199-12-31" &&
      !isNaN(d.valueOf()) &&
      d.toISOString().slice(0, 10) === s
    );
  }, "Data inválida (2000 a 2199).");
const titleSchema = z
  .object({
    branch_id: uuid,
    direction: z.enum(["payable", "receivable"]),
    description: text(),
    counterparty: text(),
    amount_cents: cents,
    competence_on: date,
    due_on: date,
    center_id: uuid.nullable().default(null),
    affects_result: z.boolean().default(true),
  })
  .strict();
const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Fortaleza",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const paidSql = `(t.opening_paid_cents+coalesce((SELECT sum(s.amount_cents+s.discount_cents-s.charges_cents) FROM finance_settlements s JOIN finance_entries e ON e.settlement_id=s.id AND e.source_kind='settlement' WHERE s.title_id=t.id AND NOT EXISTS(SELECT 1 FROM finance_entries r WHERE r.reverses_entry_id=e.id)),0))`;
const activeRec = `LEFT JOIN finance_reconciliations rec ON rec.entry_id=e.id AND rec.voided_at IS NULL`;
const effectiveAccount = "coalesce(e.account_id,rec.account_id)";
function number(value: unknown) {
  const n = Number(value);
  if (!Number.isSafeInteger(n))
    fail(
      422,
      "Valor consolidado acima do limite de cálculo. Reduza o período.",
    );
  return n;
}
export class FinanceService {
  constructor(
    private db: Database,
    private inventory: InventoryService,
  ) {}
  private scope(i: Identity, branch: string) {
    permit(i, "finance_read");
    if (branch === "all") return i.branch_ids;
    validate(uuid, branch);
    branchAccess(i, branch);
    return [branch];
  }
  private period(start: string, end: string) {
    validate(date, start);
    validate(date, end);
    if (start > end || (Date.parse(end) - Date.parse(start)) / 86400000 > 740)
      fail(400, "Escolha um período de até 740 dias.");
  }
  private posted(value: string) {
    validate(date, value);
    if (value > today())
      fail(400, "Movimentos realizados não podem ter data futura.");
  }
  private async event(
    tx: Tx,
    i: Identity,
    entity: string,
    action: string,
    details: unknown = {},
    branch: string | null = null,
  ) {
    await tx.query(
      "INSERT INTO finance_events(id,tenant_id,branch_id,entity_id,action,details,actor_id) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7) RETURNING id",
      [
        randomUUID(),
        i.tenant_id,
        branch,
        entity,
        action,
        JSON.stringify(details),
        i.user_id,
      ],
    );
    await audit(tx, i, `finance.${action}`, entity, details, branch);
  }
  private async lockEntry(tx: Tx, i: Identity, id: string) {
    await tx.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1,0))::text AS locked",
      [i.tenant_id + ":finance:" + id],
    );
  }
  private async account(tx: Tx, i: Identity, id: string, active = true) {
    validate(uuid, id);
    const [a] = await tx.query(
      "SELECT * FROM finance_accounts WHERE id=$1 FOR UPDATE",
      [id],
    );
    if (!a) fail(404, "Conta financeira não encontrada.");
    branchAccess(i, a.branch_id);
    if (active && !a.active) fail(409, "Conta financeira inativa.");
    return a;
  }
  private async balance(tx: Tx, id: string) {
    const [b] = await tx.query(
      `SELECT coalesce(sum(e.amount_cents),0)::text AS balance FROM finance_entries e ${activeRec} WHERE ${effectiveAccount}=$1`,
      [id],
    );
    return number(b.balance);
  }
  private async center(tx: Tx, id: string | null) {
    if (!id) return;
    const [c] = await tx.query(
      "SELECT id FROM finance_centers WHERE id=$1 AND active",
      [id],
    );
    if (!c) fail(400, "Centro de custo indisponível nesta empresa.");
  }
  private async title(tx: Tx, i: Identity, id: string, expected?: number) {
    validate(uuid, id);
    const [t] = await tx.query(
      "SELECT *,competence_on::text AS competence_on,due_on::text AS due_on FROM finance_titles WHERE id=$1 FOR UPDATE",
      [id],
    );
    if (!t) fail(404, "Título financeiro não encontrado.");
    branchAccess(i, t.branch_id);
    if (expected !== undefined && t.version !== expected)
      fail(409, "Título atualizado. Recarregue os dados.");
    const [p] = await tx.query(
      `SELECT ${paidSql}::text AS paid FROM finance_titles t WHERE id=$1`,
      [id],
    );
    return { ...t, paid_cents: number(p.paid) } as Row;
  }
  private async entry(
    tx: Tx,
    i: Identity,
    branch: string,
    account: string | null,
    amount: number,
    posted: string,
    description: string,
    kind: string,
    source: string,
    settlement: string | null = null,
    reverses: string | null = null,
    part = "",
  ) {
    const id = randomUUID();
    await tx.query(
      "INSERT INTO finance_entries(id,tenant_id,branch_id,account_id,amount_cents,posted_on,description,source_kind,source_id,source_part,settlement_id,reverses_entry_id,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id",
      [
        id,
        i.tenant_id,
        branch,
        account,
        amount,
        posted,
        description,
        kind,
        source,
        part,
        settlement,
        reverses,
        i.user_id,
      ],
    );
    return id;
  }
  async config(i: Identity, branch: string) {
    const ids = this.scope(i, branch);
    return this.db.transaction(i.tenant_id, async (tx) => ({
      accounts: await tx.query(
        `SELECT a.*,b.name AS branch_name,coalesce(v.balance,0)::text AS balance_cents FROM finance_accounts a JOIN branches b ON b.id=a.branch_id LEFT JOIN (SELECT ${effectiveAccount} AS account_id,sum(e.amount_cents) AS balance FROM finance_entries e ${activeRec} GROUP BY ${effectiveAccount}) v ON v.account_id=a.id WHERE a.branch_id=ANY($1::uuid[]) ORDER BY b.name,a.name`,
        [ids],
      ),
      centers: await tx.query("SELECT * FROM finance_centers ORDER BY name,id"),
    }));
  }
  async createAccount(i: Identity, body: unknown, key: unknown) {
    permit(i, "finance_manage");
    const b = validate(
      z
        .object({
          branch_id: uuid,
          name: text(120),
          kind: z.enum(["cash", "bank", "other"]),
          opening_cents: signed.default(0),
          opening_on: date,
        })
        .strict(),
      body,
    );
    branchAccess(i, b.branch_id);
    this.posted(b.opening_on);
    return this.inventory.write(
      i,
      key,
      { action: "finance.account.create", b },
      async (tx) => {
        const id = randomUUID();
        await tx.query(
          "INSERT INTO finance_accounts(id,tenant_id,branch_id,name,kind) VALUES($1,$2,$3,$4,$5) RETURNING id",
          [id, i.tenant_id, b.branch_id, b.name, b.kind],
        );
        if (b.opening_cents)
          await this.entry(
            tx,
            i,
            b.branch_id,
            id,
            b.opening_cents,
            b.opening_on,
            "Saldo inicial informado",
            "opening",
            id,
          );
        await this.event(
          tx,
          i,
          id,
          "account_created",
          { opening_cents: b.opening_cents },
          b.branch_id,
        );
        return { id };
      },
    );
  }
  async updateAccount(i: Identity, id: string, body: unknown, key: unknown) {
    permit(i, "finance_manage");
    const b = validate(
      z.object({ version, name: text(120), active: z.boolean() }).strict(),
      body,
    );
    return this.inventory.write(
      i,
      key,
      { action: "finance.account.update", id, b },
      async (tx) => {
        const a = await this.account(tx, i, id, false);
        if (a.version !== b.version)
          fail(409, "Conta atualizada. Recarregue os dados.");
        if (!b.active && (await this.balance(tx, id)) !== 0)
          fail(409, "A conta precisa ter saldo zero para ser inativada.");
        await tx.query(
          "UPDATE finance_accounts SET name=$2,active=$3,version=version+1 WHERE id=$1 RETURNING id",
          [id, b.name, b.active],
        );
        await this.event(
          tx,
          i,
          id,
          "account_updated",
          { active: b.active },
          a.branch_id,
        );
        return { id };
      },
    );
  }
  async saveCenter(
    i: Identity,
    id: string | null,
    body: unknown,
    key: unknown,
  ) {
    permit(i, "finance_manage");
    const b = validate(
      id
        ? z.object({ version, name: text(120), active: z.boolean() }).strict()
        : z.object({ name: text(120) }).strict(),
      body,
    ) as Row;
    if (id) validate(uuid, id);
    return this.inventory.write(
      i,
      key,
      { action: "finance.center.save", id, b },
      async (tx) => {
        const center = id || randomUUID();
        if (id) {
          const [c] = await tx.query(
            "SELECT * FROM finance_centers WHERE id=$1 FOR UPDATE",
            [id],
          );
          if (!c) fail(404, "Centro não encontrado.");
          if (c.version !== b.version)
            fail(409, "Centro atualizado. Recarregue os dados.");
          await tx.query(
            "UPDATE finance_centers SET name=$2,active=$3,version=version+1 WHERE id=$1 RETURNING id",
            [id, b.name, b.active],
          );
        } else
          await tx.query(
            "INSERT INTO finance_centers(id,tenant_id,name) VALUES($1,$2,$3) RETURNING id",
            [center, i.tenant_id, b.name],
          );
        await this.event(tx, i, center, "center_saved");
        return { id: center };
      },
    );
  }
  async createTitle(i: Identity, body: unknown, key: unknown) {
    permit(i, "finance_manage");
    const b = validate(titleSchema, body);
    branchAccess(i, b.branch_id);
    return this.inventory.write(
      i,
      key,
      { action: "finance.title.create", b },
      async (tx) => {
        await this.center(tx, b.center_id);
        const id = randomUUID();
        await tx.query(
          "INSERT INTO finance_titles(id,tenant_id,branch_id,direction,description,counterparty,amount_cents,competence_on,due_on,center_id,created_by,affects_result) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id",
          [
            id,
            i.tenant_id,
            b.branch_id,
            b.direction,
            b.description,
            b.counterparty,
            b.amount_cents,
            b.competence_on,
            b.due_on,
            b.center_id,
            i.user_id,
            b.affects_result,
          ],
        );
        await this.event(
          tx,
          i,
          id,
          "title_created",
          { amount_cents: b.amount_cents },
          b.branch_id,
        );
        return { id };
      },
    );
  }
  async updateTitle(i: Identity, id: string, body: unknown, key: unknown) {
    permit(i, "finance_manage");
    const b = validate(
      titleSchema.omit({ branch_id: true }).extend({ version }),
      body,
    );
    return this.inventory.write(
      i,
      key,
      { action: "finance.title.update", id, b },
      async (tx) => {
        const t = await this.title(tx, i, id, b.version);
        if (t.credit_installment_id)
          fail(409, "Altere as condições da parcela pelo crediário.");
        if (t.cancelled || t.paid_cents)
          fail(
            409,
            "Estorne as baixas antes de editar; títulos cancelados são somente consulta.",
          );
        if (
          t.source_kind !== "manual" &&
          (b.amount_cents !== t.amount_cents ||
            b.direction !== t.direction ||
            b.competence_on !== String(t.competence_on).slice(0, 10))
        )
          fail(
            409,
            "Valor, natureza e competência do serviço são preservados na origem.",
          );
        await this.center(tx, b.center_id);
        await tx.query(
          "UPDATE finance_titles SET description=$2,counterparty=$3,amount_cents=$4,competence_on=$5,due_on=$6,center_id=$7,direction=$8,affects_result=$9,version=version+1 WHERE id=$1 RETURNING id",
          [
            id,
            b.description,
            b.counterparty,
            b.amount_cents,
            b.competence_on,
            b.due_on,
            b.center_id,
            b.direction,
            b.affects_result,
          ],
        );
        await this.event(
          tx,
          i,
          id,
          "title_updated",
          { amount_cents: b.amount_cents },
          t.branch_id,
        );
        return { id };
      },
    );
  }
  async cancel(i: Identity, id: string, body: unknown, key: unknown) {
    permit(i, "finance_manage");
    const b = validate(
      z.object({ version, reason: text(1000) }).strict(),
      body,
    );
    return this.inventory.write(
      i,
      key,
      { action: "finance.title.cancel", id, b },
      async (tx) => {
        const t = await this.title(tx, i, id, b.version);
        if (t.source_kind !== "manual")
          fail(
            409,
            "O título da assistência deve preservar o serviço entregue.",
          );
        if (t.cancelled || t.paid_cents)
          fail(
            409,
            "Título cancelado ou com baixas ativas. Estorne as baixas antes de cancelar.",
          );
        await tx.query(
          "UPDATE finance_titles SET cancelled=true,version=version+1 WHERE id=$1 RETURNING id",
          [id],
        );
        await this.event(
          tx,
          i,
          id,
          "title_cancelled",
          { reason: b.reason },
          t.branch_id,
        );
        return { id };
      },
    );
  }
  async titles(
    i: Identity,
    branch: string,
    direction: string,
    status: string,
    start: string,
    end: string,
    page: number,
    q: string,
  ) {
    const ids = this.scope(i, branch);
    this.period(start, end);
    validate(z.enum(["payable", "receivable"]), direction);
    validate(
      z.enum(["all", "open", "paid", "overdue", "cancelled", "review"]),
      status,
    );
    return this.db.transaction(i.tenant_id, async (tx) => ({
      items: await tx.query(
        `WITH titles AS (SELECT t.*,t.competence_on::text AS competence,t.due_on::text AS due,${paidSql}::int AS paid_cents FROM finance_titles t) SELECT t.*,t.competence AS competence_on,t.due AS due_on,b.name AS branch_name,c.name AS center_name,count(*) OVER()::int AS total_count FROM titles t JOIN branches b ON b.id=t.branch_id LEFT JOIN finance_centers c ON c.id=t.center_id WHERE t.branch_id=ANY($1::uuid[]) AND t.direction=$2 AND ($5='review' OR t.due_on BETWEEN $3::date AND $4::date) AND (t.description ILIKE $6 OR t.counterparty ILIKE $6) AND ($5='all' OR ($5='cancelled' AND t.cancelled) OR ($5='review' AND t.needs_review) OR (NOT t.cancelled AND NOT t.needs_review AND (($5='open' AND t.paid_cents<t.amount_cents) OR ($5='paid' AND t.paid_cents=t.amount_cents) OR ($5='overdue' AND t.paid_cents<t.amount_cents AND t.due_on<(now() AT TIME ZONE 'America/Fortaleza')::date)))) ORDER BY t.due_on,t.id LIMIT 30 OFFSET $7`,
        [
          ids,
          direction,
          start,
          end,
          status,
          `%${q.slice(0, 100)}%`,
          (page - 1) * 30,
        ],
      ),
    }));
  }
  async titleDetail(i: Identity, id: string) {
    permit(i, "finance_read");
    return this.db.transaction(i.tenant_id, async (tx) => {
      const t = await this.title(tx, i, id);
      return {
        title: {
          ...t,
          competence_on:
            typeof t.competence_on === "string"
              ? t.competence_on.slice(0, 10)
              : t.competence_on.toISOString().slice(0, 10),
          due_on:
            typeof t.due_on === "string"
              ? t.due_on.slice(0, 10)
              : t.due_on.toISOString().slice(0, 10),
        },
        settlements: await tx.query(
          `SELECT s.*,e.id AS entry_id,e.posted_on::text AS posted_on,a.name AS account_name,EXISTS(SELECT 1 FROM finance_entries r WHERE r.reverses_entry_id=e.id) AS reversed,rec.id IS NOT NULL AS reconciled FROM finance_settlements s JOIN finance_entries e ON e.settlement_id=s.id AND e.source_kind='settlement' LEFT JOIN finance_accounts a ON a.id=e.account_id ${activeRec} WHERE s.title_id=$1 ORDER BY s.created_at DESC,s.id DESC`,
          [id],
        ),
        events: await tx.query(
          "SELECT e.*,u.name AS actor_name FROM finance_events e JOIN users u ON u.id=e.actor_id WHERE entity_id=$1 ORDER BY created_at DESC,id DESC",
          [id],
        ),
      };
    });
  }
  async reviewOpening(i: Identity, id: string, body: unknown, key: unknown) {
    permit(i, "finance_manage");
    const b = validate(
      z
        .object({
          version,
          remaining_cents: z.number().int().min(0).max(1000000000),
          reference: text(500),
        })
        .strict(),
      body,
    );
    return this.inventory.write(
      i,
      key,
      { action: "finance.opening.review", id, b },
      async (tx) => {
        const t = await this.title(tx, i, id, b.version);
        if (!t.imported || t.cancelled || t.paid_cents !== t.opening_paid_cents)
          fail(
            409,
            "Conferência disponível somente para títulos importados sem baixas posteriores ativas.",
          );
        if (b.remaining_cents > t.amount_cents)
          fail(400, "Saldo anterior não pode superar o valor do serviço.");
        await tx.query(
          "UPDATE finance_titles SET opening_paid_cents=amount_cents-$2,needs_review=false,version=version+1 WHERE id=$1 RETURNING id",
          [id, b.remaining_cents],
        );
        await this.event(
          tx,
          i,
          id,
          "opening_reviewed",
          { remaining_cents: b.remaining_cents, reference: b.reference },
          t.branch_id,
        );
        return { id };
      },
    );
  }
  async settle(i: Identity, id: string, body: unknown, key: unknown) {
    permit(i, "finance_manage");
    const b = validate(
      z
        .object({
          version,
          account_id: uuid,
          amount_cents: cents,
          posted_on: date,
          reference: text(120),
        })
        .strict(),
      body,
    );
    this.posted(b.posted_on);
    return this.inventory.write(
      i,
      key,
      { action: "finance.settle", id, b },
      async (tx) => {
        const t = await this.title(tx, i, id, b.version);
        if (t.needs_review)
          fail(
            409,
            "Confira o saldo anterior deste serviço antes de registrar a baixa.",
          );
        if (t.credit_installment_id)
          fail(
            409,
            "Receba parcelas pelo crediário para aplicar abatimentos e encargos corretamente.",
          );
        if (t.cancelled || b.amount_cents > t.amount_cents - t.paid_cents)
          fail(409, "Baixa acima do saldo aberto ou título cancelado.");
        const a = await this.account(tx, i, b.account_id);
        if (a.branch_id !== t.branch_id)
          fail(400, "Escolha uma conta da mesma filial do título.");
        const settlement = randomUUID();
        await tx.query(
          "INSERT INTO finance_settlements(id,tenant_id,branch_id,title_id,amount_cents,reference,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id",
          [
            settlement,
            i.tenant_id,
            t.branch_id,
            id,
            b.amount_cents,
            b.reference,
            i.user_id,
          ],
        );
        const entry = await this.entry(
          tx,
          i,
          t.branch_id,
          a.id,
          t.direction === "receivable" ? b.amount_cents : -b.amount_cents,
          b.posted_on,
          t.description,
          "settlement",
          settlement,
          settlement,
        );
        await tx.query(
          "UPDATE finance_titles SET version=version+1 WHERE id=$1 RETURNING id",
          [id],
        );
        await this.event(
          tx,
          i,
          id,
          "settled",
          {
            amount_cents: b.amount_cents,
            entry_id: entry,
            reference: b.reference,
          },
          t.branch_id,
        );
        return { id: settlement, entry_id: entry };
      },
    );
  }
  async reverse(i: Identity, id: string, body: unknown, key: unknown) {
    permit(i, "finance_manage");
    validate(uuid, id);
    const b = validate(
      z.object({ version, posted_on: date, reason: text(1000) }).strict(),
      body,
    );
    this.posted(b.posted_on);
    return this.inventory.write(
      i,
      key,
      { action: "finance.settlement.reverse", id, b },
      async (tx) => {
        const [s] = await tx.query(
          "SELECT * FROM finance_settlements WHERE id=$1",
          [id],
        );
        if (!s) fail(404, "Baixa não encontrada.");
        const t = await this.title(tx, i, s.title_id, b.version);
        if (t.credit_installment_id)
          fail(409, "Estorne este recebimento pelo crediário.");
        const [e] = await tx.query(
          "SELECT *,posted_on::text AS posted_on FROM finance_entries WHERE settlement_id=$1 AND source_kind='settlement'",
          [id],
        );
        await this.lockEntry(tx, i, e.id);
        const [prior] = await tx.query(
          "SELECT id FROM finance_entries WHERE reverses_entry_id=$1",
          [e.id],
        );
        if (prior) fail(409, "Baixa já estornada.");
        const [rec] = await tx.query(
          "SELECT id FROM finance_reconciliations WHERE entry_id=$1 AND voided_at IS NULL",
          [e.id],
        );
        if (rec) fail(409, "Desfaça a conciliação antes de estornar a baixa.");
        if (b.posted_on < e.posted_on.toString().slice(0, 10))
          fail(400, "Estorno não pode ser anterior à baixa.");
        await this.account(tx, i, e.account_id, false);
        const reversal = await this.entry(
          tx,
          i,
          e.branch_id,
          e.account_id,
          -e.amount_cents,
          b.posted_on,
          "Estorno: " + e.description,
          "settlement_reversal",
          id,
          id,
          e.id,
        );
        await tx.query(
          "UPDATE finance_titles SET version=version+1 WHERE id=$1 RETURNING id",
          [t.id],
        );
        await this.event(
          tx,
          i,
          t.id,
          "settlement_reversed",
          { entry_id: reversal, reason: b.reason },
          t.branch_id,
        );
        return { id: reversal };
      },
    );
  }
  async transfer(i: Identity, body: unknown, key: unknown) {
    permit(i, "finance_manage");
    const b = validate(
      z
        .object({
          from_id: uuid,
          to_id: uuid,
          amount_cents: cents,
          posted_on: date,
          reason: text(500),
        })
        .strict(),
      body,
    );
    this.posted(b.posted_on);
    if (b.from_id === b.to_id) fail(400, "Escolha contas diferentes.");
    return this.inventory.write(
      i,
      key,
      { action: "finance.transfer", b },
      async (tx) => {
        const locked = new Map();
        for (const id of [b.from_id, b.to_id].sort())
          locked.set(id, await this.account(tx, i, id));
        const from = locked.get(b.from_id),
          to = locked.get(b.to_id);
        const id = randomUUID();
        await this.entry(
          tx,
          i,
          from.branch_id,
          from.id,
          -b.amount_cents,
          b.posted_on,
          b.reason,
          "transfer",
          id,
          null,
          null,
          "out",
        );
        await this.entry(
          tx,
          i,
          to.branch_id,
          to.id,
          b.amount_cents,
          b.posted_on,
          b.reason,
          "transfer",
          id,
          null,
          null,
          "in",
        );
        await this.event(
          tx,
          i,
          id,
          "transferred",
          { amount_cents: b.amount_cents, from_id: from.id, to_id: to.id },
          from.branch_id,
        );
        return { id };
      },
    );
  }
  async adjustment(i: Identity, id: string, body: unknown, key: unknown) {
    permit(i, "finance_manage");
    const b = validate(
      z
        .object({
          amount_cents: signed.refine((n) => n !== 0),
          posted_on: date,
          reason: text(1000),
        })
        .strict(),
      body,
    );
    this.posted(b.posted_on);
    return this.inventory.write(
      i,
      key,
      { action: "finance.adjustment", id, b },
      async (tx) => {
        const a = await this.account(tx, i, id);
        const source = randomUUID();
        const entry = await this.entry(
          tx,
          i,
          a.branch_id,
          id,
          b.amount_cents,
          b.posted_on,
          b.reason,
          "adjustment",
          source,
        );
        await this.event(
          tx,
          i,
          entry,
          "adjusted",
          { reason: b.reason },
          a.branch_id,
        );
        return { id: entry };
      },
    );
  }
  async entries(
    i: Identity,
    branch: string,
    start: string,
    end: string,
    status: string,
    page: number,
  ) {
    const ids = this.scope(i, branch);
    this.period(start, end);
    validate(z.enum(["all", "pending", "reconciled", "unassigned"]), status);
    return this.db.transaction(i.tenant_id, async (tx) => ({
      items: await tx.query(
        `SELECT e.*,e.posted_on::text AS posted_on,b.name AS branch_name,a.name AS account_name,${effectiveAccount} AS effective_account_id,rec.id AS reconciliation_id,rec.reference AS statement_reference,rec.statement_on::text AS statement_on,count(*) OVER()::int AS total_count FROM finance_entries e JOIN branches b ON b.id=e.branch_id ${activeRec} LEFT JOIN finance_accounts a ON a.id=${effectiveAccount} WHERE e.branch_id=ANY($1::uuid[]) AND e.posted_on BETWEEN $2::date AND $3::date AND ($4='all' OR ($4='pending' AND rec.id IS NULL) OR ($4='reconciled' AND rec.id IS NOT NULL) OR ($4='unassigned' AND ${effectiveAccount} IS NULL)) ORDER BY e.posted_on DESC,e.created_at DESC,e.id DESC LIMIT 30 OFFSET $5`,
        [ids, start, end, status, (page - 1) * 30],
      ),
    }));
  }
  async reconcile(i: Identity, id: string, body: unknown, key: unknown) {
    permit(i, "finance_manage");
    validate(uuid, id);
    const b = validate(
      z
        .object({
          account_id: uuid,
          statement_on: date,
          reference: text(120),
          confirmed_amount_cents: signed,
          confirmed: z.literal(true),
        })
        .strict(),
      body,
    );
    this.posted(b.statement_on);
    return this.inventory.write(
      i,
      key,
      { action: "finance.reconcile", id, b },
      async (tx) => {
        await this.lockEntry(tx, i, id);
        const [e] = await tx.query(
          "SELECT * FROM finance_entries WHERE id=$1",
          [id],
        );
        if (!e) fail(404, "Movimento não encontrado.");
        branchAccess(i, e.branch_id);
        const a = await this.account(tx, i, b.account_id);
        if (
          a.branch_id !== e.branch_id ||
          (e.account_id && e.account_id !== a.id)
        )
          fail(
            400,
            "A conta deve corresponder à filial e à conta original do movimento.",
          );
        if (e.amount_cents !== b.confirmed_amount_cents)
          fail(
            409,
            "Valor do extrato difere do movimento. Registre taxas/diferenças separadamente.",
          );
        const [prior] = await tx.query(
          "SELECT id FROM finance_reconciliations WHERE entry_id=$1 AND voided_at IS NULL",
          [id],
        );
        if (prior) fail(409, "Movimento já conciliado.");
        const rec = randomUUID();
        await tx.query(
          "INSERT INTO finance_reconciliations(id,tenant_id,branch_id,entry_id,account_id,statement_on,reference,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id",
          [
            rec,
            i.tenant_id,
            e.branch_id,
            id,
            a.id,
            b.statement_on,
            b.reference,
            i.user_id,
          ],
        );
        await this.event(
          tx,
          i,
          id,
          "reconciled",
          { reconciliation_id: rec, reference: b.reference, account_id: a.id },
          e.branch_id,
        );
        return { id: rec };
      },
    );
  }
  async undoReconciliation(
    i: Identity,
    id: string,
    body: unknown,
    key: unknown,
  ) {
    permit(i, "finance_manage");
    validate(uuid, id);
    const b = validate(z.object({ reason: text(1000) }).strict(), body);
    return this.inventory.write(
      i,
      key,
      { action: "finance.reconciliation.undo", id, b },
      async (tx) => {
        const [rec] = await tx.query(
          "SELECT * FROM finance_reconciliations WHERE id=$1",
          [id],
        );
        if (!rec) fail(404, "Conciliação não encontrada.");
        branchAccess(i, rec.branch_id);
        await this.lockEntry(tx, i, rec.entry_id);
        const [r] = await tx.query(
          "SELECT * FROM finance_reconciliations WHERE id=$1 AND voided_at IS NULL",
          [id],
        );
        if (!r) fail(409, "Conciliação já desfeita.");
        await tx.query(
          "UPDATE finance_reconciliations SET voided_at=now(),voided_by=$2 WHERE id=$1 RETURNING id",
          [id, i.user_id],
        );
        await this.event(
          tx,
          i,
          rec.entry_id,
          "reconciliation_undone",
          { reconciliation_id: id, reason: b.reason },
          rec.branch_id,
        );
        return { id };
      },
    );
  }
  async entryDetail(i: Identity, id: string) {
    permit(i, "finance_read");
    validate(uuid, id);
    return this.db.transaction(i.tenant_id, async (tx) => {
      const [e] = await tx.query("SELECT * FROM finance_entries WHERE id=$1", [
        id,
      ]);
      if (!e) fail(404, "Movimento não encontrado.");
      branchAccess(i, e.branch_id);
      return {
        entry: e,
        reconciliations: await tx.query(
          "SELECT r.*,a.name AS account_name,r.statement_on::text AS statement_on FROM finance_reconciliations r JOIN finance_accounts a ON a.id=r.account_id WHERE r.entry_id=$1 ORDER BY r.created_at DESC",
          [id],
        ),
        events: await tx.query(
          "SELECT e.*,u.name AS actor_name FROM finance_events e JOIN users u ON u.id=e.actor_id WHERE entity_id=$1 ORDER BY created_at DESC,id DESC",
          [id],
        ),
      };
    });
  }
  async creditSettlement(
    tx: Tx,
    i: Identity,
    titleId: string,
    accountId: string,
    amount: number,
    discount: number,
    charges: number,
    reference: string,
  ) {
    permit(i, "finance_manage");
    const t = await this.title(tx, i, titleId);
    if (!t.credit_installment_id || t.cancelled)
      fail(409, "Parcela indisponível no financeiro.");
    const reduction = amount + discount - charges;
    if (reduction < 0 || reduction > t.amount_cents - t.paid_cents)
      fail(409, "Recebimento excede o saldo nominal.");
    const a = await this.account(tx, i, accountId);
    if (a.branch_id !== t.branch_id)
      fail(400, "Escolha uma conta da filial da parcela.");
    const id = randomUUID();
    await tx.query(
      "INSERT INTO finance_settlements(id,tenant_id,branch_id,title_id,amount_cents,reference,created_by,discount_cents,charges_cents) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id",
      [
        id,
        i.tenant_id,
        t.branch_id,
        t.id,
        amount,
        reference,
        i.user_id,
        discount,
        charges,
      ],
    );
    const entry = await this.entry(
      tx,
      i,
      t.branch_id,
      a.id,
      amount,
      today(),
      t.description,
      "settlement",
      id,
      id,
    );
    await tx.query(
      "UPDATE finance_titles SET version=version+1 WHERE id=$1 RETURNING id",
      [t.id],
    );
    await this.event(
      tx,
      i,
      t.id,
      "settled",
      {
        amount_cents: amount,
        discount_cents: discount,
        charges_cents: charges,
        reference,
      },
      t.branch_id,
    );
    return { id, entry_id: entry };
  }
  async reverseCredit(tx: Tx, i: Identity, id: string, reason: string) {
    permit(i, "finance_manage");
    const [s] = await tx.query(
      "SELECT * FROM finance_settlements WHERE id=$1",
      [id],
    );
    if (!s) fail(404, "Recebimento não encontrado.");
    const t = await this.title(tx, i, s.title_id);
    if (!t.credit_installment_id)
      fail(400, "Recebimento não pertence ao crediário.");
    const [e] = await tx.query(
      "SELECT * FROM finance_entries WHERE settlement_id=$1 AND source_kind='settlement'",
      [id],
    );
    await this.lockEntry(tx, i, e.id);
    if (
      (
        await tx.query(
          "SELECT id FROM finance_entries WHERE reverses_entry_id=$1",
          [e.id],
        )
      ).length
    )
      fail(409, "Recebimento já estornado.");
    if (
      (
        await tx.query(
          "SELECT id FROM finance_reconciliations WHERE entry_id=$1 AND voided_at IS NULL",
          [e.id],
        )
      ).length
    )
      fail(
        409,
        "Desfaça a conciliação do recebimento antes de estornar ou cancelar.",
      );
    await this.account(tx, i, e.account_id, false);
    const reversal = await this.entry(
      tx,
      i,
      t.branch_id,
      e.account_id,
      -e.amount_cents,
      today(),
      "Estorno: " + e.description,
      "settlement_reversal",
      id,
      id,
      e.id,
    );
    await tx.query(
      "UPDATE finance_titles SET version=version+1 WHERE id=$1 RETURNING id",
      [t.id],
    );
    await this.event(
      tx,
      i,
      t.id,
      "settlement_reversed",
      { reason, entry_id: reversal },
      t.branch_id,
    );
    return { id: reversal };
  }
  async reports(i: Identity, branch: string, start: string, end: string) {
    const ids = this.scope(i, branch);
    this.period(start, end);
    return this.db.transaction(i.tenant_id, async (tx) => {
      const facts = await tx.query(
        `WITH parts AS (SELECT e.order_id,sum((CASE WHEN e.kind='issue' THEN e.quantity ELSE -e.quantity END)::bigint*x.unit_price_cents) AS price,sum((CASE WHEN e.kind='issue' THEN e.quantity ELSE -e.quantity END)::bigint*e.unit_cost_cents) AS cost FROM repair_part_events e JOIN repair_quote_items x ON x.id=e.quote_item_id GROUP BY e.order_id),facts AS (
 SELECT branch_id,'sales' AS category,total_cents::bigint AS amount,(created_at AT TIME ZONE 'America/Fortaleza')::date AS day FROM pos_sales
 UNION ALL SELECT branch_id,'returns',-total_cents::bigint,(created_at AT TIME ZONE 'America/Fortaleza')::date FROM pos_returns
 UNION ALL SELECT v.branch_id,'goods_cost',x.quantity::bigint*x.unit_cost_cents,(v.created_at AT TIME ZONE 'America/Fortaleza')::date FROM pos_sales v JOIN pos_sale_items x ON x.sale_id=v.id
 UNION ALL SELECT r.branch_id,'goods_cost',-x.quantity::bigint*p.unit_cost_cents,(r.created_at AT TIME ZONE 'America/Fortaleza')::date FROM pos_returns r JOIN pos_return_items x ON x.return_id=r.id JOIN pos_sale_items p ON p.id=x.sale_item_id
 UNION ALL SELECT o.branch_id,'services',q.labor_price_cents+coalesce(p.price,0),(o.delivered_at AT TIME ZONE 'America/Fortaleza')::date FROM repair_orders o JOIN repair_quotes q ON q.id=o.current_quote_id LEFT JOIN parts p ON p.order_id=o.id WHERE o.status='delivered' AND o.delivery_outcome='ready'
 UNION ALL SELECT o.branch_id,'service_cost',q.labor_cost_cents+coalesce(p.cost,0),(o.delivered_at AT TIME ZONE 'America/Fortaleza')::date FROM repair_orders o JOIN repair_quotes q ON q.id=o.current_quote_id LEFT JOIN parts p ON p.order_id=o.id WHERE o.status='delivered' AND o.delivery_outcome='ready'
 UNION ALL SELECT branch_id,'credit_income',amount_cents::bigint,competence_on FROM credit_income_events
 UNION ALL SELECT branch_id,CASE WHEN direction='receivable' THEN 'manual_income' ELSE 'expenses' END,amount_cents::bigint,competence_on FROM finance_titles WHERE source_kind='manual' AND affects_result AND NOT cancelled
 ) SELECT branch_id,category,sum(amount)::text AS amount FROM facts WHERE branch_id=ANY($1::uuid[]) AND day BETWEEN $2::date AND $3::date GROUP BY branch_id,category`,
        [ids, start, end],
      );
      const branches = await tx.query(
        "SELECT id,name FROM branches WHERE id=ANY($1::uuid[]) ORDER BY name",
        [ids],
      );
      const calculate = (rows: Row[]) => {
        const r: Row = {
          sales: 0,
          returns: 0,
          goods_cost: 0,
          services: 0,
          service_cost: 0,
          manual_income: 0,
          credit_income: 0,
          expenses: 0,
        };
        for (const f of rows)
          r[f.category] = number(r[f.category] + number(f.amount));
        r.revenue = number(
          r.sales + r.returns + r.services + r.manual_income + r.credit_income,
        );
        r.gross = number(r.revenue - r.goods_cost - r.service_cost);
        r.result = number(r.gross - r.expenses);
        r.margin = r.revenue > 0 ? (r.result / r.revenue) * 100 : null;
        return r;
      };
      const cashflow = await tx.query(
        `SELECT posted_on::text AS day,coalesce(sum(CASE WHEN amount_cents>0 AND source_kind NOT IN ('opening','transfer','adjustment') THEN amount_cents ELSE 0 END),0)::text AS income_cents,coalesce(sum(CASE WHEN amount_cents<0 AND source_kind NOT IN ('opening','transfer','adjustment') THEN -amount_cents ELSE 0 END),0)::text AS expense_cents,coalesce(sum(CASE WHEN source_kind IN ('opening','transfer','adjustment') THEN amount_cents ELSE 0 END),0)::text AS other_cents,sum(amount_cents)::text AS net_cents FROM finance_entries WHERE branch_id=ANY($1::uuid[]) AND posted_on BETWEEN $2::date AND $3::date GROUP BY posted_on ORDER BY posted_on`,
        [ids, start, end],
      );
      const [opening] = await tx.query(
        "SELECT coalesce(sum(amount_cents),0)::text AS amount FROM finance_entries WHERE branch_id=ANY($1::uuid[]) AND posted_on<$2::date",
        [ids, start],
      );
      const [outstanding] = await tx.query(
        `WITH open AS (SELECT t.*,t.amount_cents-${paidSql} AS remaining FROM finance_titles t WHERE NOT t.cancelled AND NOT t.needs_review AND t.branch_id=ANY($1::uuid[])) SELECT coalesce(sum(remaining) FILTER(WHERE direction='receivable'),0)::text AS receivable,coalesce(sum(remaining) FILTER(WHERE direction='payable'),0)::text AS payable,coalesce(sum(remaining) FILTER(WHERE due_on<(now() AT TIME ZONE 'America/Fortaleza')::date AND direction='receivable'),0)::text AS overdue_receivable,coalesce(sum(remaining) FILTER(WHERE due_on<(now() AT TIME ZONE 'America/Fortaleza')::date AND direction='payable'),0)::text AS overdue_payable FROM open`,
        [ids],
      );
      const projected = await tx.query(
        `SELECT t.due_on::text AS day,t.direction,sum(t.amount_cents-${paidSql})::text AS amount FROM finance_titles t WHERE NOT t.cancelled AND NOT t.needs_review AND t.branch_id=ANY($1::uuid[]) AND t.due_on BETWEEN $2::date AND $3::date GROUP BY t.due_on,t.direction HAVING sum(t.amount_cents-${paidSql})>0 ORDER BY t.due_on`,
        [ids, start, end],
      );
      const [unassigned] = await tx.query(
        `SELECT count(*)::int AS count,coalesce(sum(e.amount_cents),0)::text AS amount FROM finance_entries e ${activeRec} WHERE e.branch_id=ANY($1::uuid[]) AND ${effectiveAccount} IS NULL`,
        [ids],
      );
      const centers = await tx.query(
        "SELECT coalesce(c.name,'Sem centro') AS name,coalesce(sum(CASE WHEN t.direction='receivable' THEN t.amount_cents ELSE 0 END),0)::text AS income_cents,coalesce(sum(CASE WHEN t.direction='payable' THEN t.amount_cents ELSE 0 END),0)::text AS expense_cents FROM finance_titles t LEFT JOIN finance_centers c ON c.id=t.center_id WHERE t.branch_id=ANY($1::uuid[]) AND t.source_kind='manual' AND t.affects_result AND NOT t.cancelled AND t.competence_on BETWEEN $2::date AND $3::date GROUP BY c.id,c.name ORDER BY c.name",
        [ids, start, end],
      );
      return {
        start,
        end,
        result: calculate(facts),
        branches: branches.map((b) => ({
          ...b,
          ...calculate(facts.filter((f) => f.branch_id === b.id)),
        })),
        cashflow,
        opening_cents: number(opening.amount),
        outstanding,
        projected,
        unassigned,
        centers,
      };
    });
  }
}

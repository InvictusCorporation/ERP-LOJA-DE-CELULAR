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
import { FinanceService } from "./finance";
import {
  simulateCredit,
  installmentQuote,
  allocateCreditPayment,
  validCpf,
  validCnpj,
  creditDay,
  addDays,
  days,
  type CreditLine,
} from "../shared/credit-math";
type Row = Record<string, any>;
const text = (max = 180, min = 1) => z.string().trim().min(min).max(max);
const cents = z.number().int().min(0).max(1000000000);
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
  });
const condition = z
  .object({
    purchase_cents: cents.refine((n) => n > 0),
    down_cents: cents,
    count: z.number().int().min(1).max(36),
    monthly_bps: z.number().int().min(0).max(300),
    first_due_on: date,
  })
  .strict();
const activeReceipts = `SELECT r.*,r.posted_on::text AS posted_on FROM credit_receipts r JOIN finance_entries e ON e.settlement_id=r.settlement_id AND e.source_kind='settlement' WHERE r.installment_id=$1 AND NOT EXISTS(SELECT 1 FROM finance_entries v WHERE v.reverses_entry_id=e.id) ORDER BY r.posted_on,r.created_at,r.id`;
export class CreditService {
  private finance: FinanceService;
  constructor(
    private db: Database,
    private inventory: InventoryService,
  ) {
    this.finance = new FinanceService(db, inventory);
  }
  private scope(i: Identity, branch: string) {
    permit(i, "credit_read");
    if (branch === "all") return i.branch_ids;
    validate(uuid, branch);
    branchAccess(i, branch);
    return [branch];
  }
  private async event(
    tx: Tx,
    i: Identity,
    branch: string,
    id: string,
    action: string,
    details: unknown = {},
  ) {
    await tx.query(
      "INSERT INTO credit_events(id,tenant_id,branch_id,entity_id,action,details,actor_id) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7) RETURNING id",
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
    await audit(tx, i, "credit." + action, id, {}, branch);
  }
  private async policy(tx: Tx, required = true) {
    const [p] = await tx.query("SELECT * FROM credit_policies");
    if (required && (!p || !p.legal_reference))
      fail(
        409,
        "Configure e registre a revisão jurídica dos termos antes de operar o crediário.",
      );
    return p as Row | undefined;
  }
  private quote(p: Row, b: z.infer<typeof condition>, issued = creditDay()) {
    if (b.count > p.max_installments || b.monthly_bps > p.max_monthly_bps)
      fail(400, "Condições acima dos limites revisados da empresa.");
    try {
      return simulateCredit(
        b.purchase_cents,
        b.down_cents,
        b.count,
        b.monthly_bps,
        issued,
        b.first_due_on,
      );
    } catch (e: any) {
      fail(400, e.message);
    }
  }
  async settings(i: Identity) {
    permit(i, "credit_read");
    return this.db.transaction(i.tenant_id, async (tx) => ({
      policy: (await this.policy(tx, false)) || null,
    }));
  }
  async saveSettings(i: Identity, body: unknown, key: unknown) {
    permit(i, "credit_settings");
    const b = validate(
      z
        .object({
          version: z.number().int().min(0),
          enabled: z.boolean(),
          legal_name: text(),
          cnpj: z
            .string()
            .transform((v) => v.replace(/\D/g, ""))
            .pipe(z.string().refine(validCnpj, "CNPJ inválido.")),
          address: text(1000),
          email: z.email().max(254),
          phone: text(25),
          max_monthly_bps: z.number().int().min(0).max(300),
          late_fee_bps: z.number().int().min(0).max(200),
          late_monthly_bps: z.number().int().min(0).max(100),
          max_installments: z.number().int().min(1).max(36),
          offer_days: z.number().int().min(2).max(30),
          terms: text(12000, 30),
          legal_reference: text(1000, 5),
          reviewed: z.literal(true),
        })
        .strict(),
      body,
    );
    return this.inventory.write(
      i,
      key,
      { action: "credit.policy", b },
      async (tx) => {
        await tx.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1,0))::text",
          [i.tenant_id + ":credit-policy"],
        );
        const p = await this.policy(tx, false);
        if ((p?.version || 0) !== b.version)
          fail(409, "Configuração atualizada. Recarregue os dados.");
        await tx.query(
          "INSERT INTO credit_policies(tenant_id,enabled,legal_name,cnpj,address,email,phone,max_monthly_bps,late_fee_bps,late_monthly_bps,max_installments,offer_days,terms,legal_reference,reviewed_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) ON CONFLICT(tenant_id) DO UPDATE SET enabled=$2,legal_name=$3,cnpj=$4,address=$5,email=$6,phone=$7,max_monthly_bps=$8,late_fee_bps=$9,late_monthly_bps=$10,max_installments=$11,offer_days=$12,terms=$13,legal_reference=$14,reviewed_by=$15,reviewed_at=now(),version=credit_policies.version+1 RETURNING tenant_id",
          [
            i.tenant_id,
            b.enabled,
            b.legal_name,
            b.cnpj,
            b.address,
            b.email,
            b.phone,
            b.max_monthly_bps,
            b.late_fee_bps,
            b.late_monthly_bps,
            b.max_installments,
            b.offer_days,
            b.terms,
            b.legal_reference,
            i.user_id,
          ],
        );
        await audit(tx, i, "credit.policy.updated", i.tenant_id, {
          enabled: b.enabled,
        });
        return { ok: true };
      },
    );
  }
  async profiles(i: Identity, branch: string, q: string, page: number) {
    const ids = this.scope(i, branch);
    return this.db.transaction(i.tenant_id, async (tx) => ({
      items: await tx.query(
        "SELECT p.id,p.customer_id,p.branch_id,p.limit_cents,p.enabled,p.version,c.name,c.phone,right(p.cpf,2) AS cpf_suffix,b.name AS branch_name,count(*) OVER()::int AS total_count FROM credit_profiles p JOIN customers c ON c.id=p.customer_id JOIN branches b ON b.id=p.branch_id WHERE p.branch_id=ANY($1::uuid[]) AND (c.name ILIKE $2 OR c.phone ILIKE $2) ORDER BY c.name,p.id LIMIT 30 OFFSET $3",
        [ids, "%" + q.slice(0, 100) + "%", (page - 1) * 30],
      ),
    }));
  }
  async profileDetail(i: Identity, id: string) {
    permit(i, "credit_manage");
    validate(uuid, id);
    return this.db.transaction(i.tenant_id, async (tx) => {
      const [p] = await tx.query(
        "SELECT p.*,c.name,c.phone,c.email FROM credit_profiles p JOIN customers c ON c.id=p.customer_id WHERE p.id=$1",
        [id],
      );
      if (!p) fail(404, "Perfil não encontrado.");
      branchAccess(i, p.branch_id);
      return { profile: p };
    });
  }
  async saveProfile(
    i: Identity,
    id: string | null,
    body: unknown,
    key: unknown,
  ) {
    permit(i, "credit_manage");
    const b = validate(
      z
        .object({
          version: z.number().int().min(0),
          branch_id: uuid,
          customer_id: uuid,
          cpf: z
            .string()
            .transform((v) => v.replace(/\D/g, ""))
            .pipe(z.string().refine(validCpf, "CPF inválido.")),
          address: text(1000, 10),
          limit_cents: cents,
          enabled: z.boolean(),
          assessment: text(1500, 10),
          bureau_reference: text(500, 3),
          capacity_checked: z.literal(true),
        })
        .strict(),
      body,
    );
    branchAccess(i, b.branch_id);
    if (id) validate(uuid, id);
    return this.inventory.write(
      i,
      key,
      { action: "credit.profile", id, b },
      async (tx) => {
        const [c] = await tx.query(
          "SELECT id FROM customers WHERE id=$1 AND active FOR SHARE",
          [b.customer_id],
        );
        if (!c) fail(400, "Selecione um cliente ativo do CRM.");
        const profile = id || randomUUID();
        if (id) {
          const [old] = await tx.query(
            "SELECT * FROM credit_profiles WHERE id=$1 FOR UPDATE",
            [id],
          );
          if (!old) fail(404, "Perfil não encontrado.");
          branchAccess(i, old.branch_id);
          if (old.version !== b.version)
            fail(409, "Perfil atualizado. Recarregue.");
          if (
            old.customer_id !== b.customer_id ||
            old.cpf !== b.cpf ||
            old.branch_id !== b.branch_id
          )
            fail(
              409,
              "CPF, cliente e filial de origem são preservados no perfil.",
            );
          await tx.query(
            "UPDATE credit_profiles SET address=$2,limit_cents=$3,enabled=$4,assessment=$5,bureau_reference=$6,approved_by=$7,approved_at=now(),version=version+1 WHERE id=$1 RETURNING id",
            [
              id,
              b.address,
              b.limit_cents,
              b.enabled,
              b.assessment,
              b.bureau_reference,
              i.user_id,
            ],
          );
        } else {
          if (b.version !== 0) fail(400, "Versão inicial inválida.");
          await tx.query(
            "INSERT INTO credit_profiles(id,tenant_id,branch_id,customer_id,cpf,address,limit_cents,enabled,assessment,bureau_reference,approved_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id",
            [
              profile,
              i.tenant_id,
              b.branch_id,
              b.customer_id,
              b.cpf,
              b.address,
              b.limit_cents,
              b.enabled,
              b.assessment,
              b.bureau_reference,
              i.user_id,
            ],
          );
        }
        await this.event(tx, i, b.branch_id, profile, "profile_approved", {
          enabled: b.enabled,
        });
        return { id: profile };
      },
    );
  }
  async simulate(i: Identity, body: unknown) {
    permit(i, "credit_manage");
    const b = validate(condition, body);
    return this.db.transaction(i.tenant_id, async (tx) => {
      const p = (await this.policy(tx))!;
      return {
        simulation: this.quote(p, b),
        valid_until: addDays(creditDay(), p.offer_days),
        policy_version: p.version,
      };
    });
  }
  private async profile(tx: Tx, i: Identity, id: string) {
    const [p] = await tx.query(
      "SELECT p.*,c.name,c.phone,c.email,c.active AS customer_active FROM credit_profiles p JOIN customers c ON c.id=p.customer_id WHERE p.id=$1 FOR UPDATE OF p",
      [id],
    );
    if (!p) fail(404, "Perfil de crédito não encontrado.");
    branchAccess(i, p.branch_id);
    return p;
  }
  private async exposure(tx: Tx, id: string, exclude: string | null = null) {
    const [r] = await tx.query(
      `SELECT coalesce((SELECT sum(o.purchase_cents-o.down_cents) FROM credit_offers o WHERE o.profile_id=$1 AND o.status='approved' AND o.valid_until>=(now() AT TIME ZONE 'America/Fortaleza')::date AND ($2::uuid IS NULL OR o.id<>$2)),0)+coalesce((SELECT sum(x.principal_cents-coalesce(v.paid,0)) FROM credit_contracts c JOIN credit_installments x ON x.plan_id=c.current_plan_id LEFT JOIN (SELECT r.installment_id,sum(r.principal_cents) AS paid FROM credit_receipts r JOIN finance_entries e ON e.settlement_id=r.settlement_id AND e.source_kind='settlement' WHERE NOT EXISTS(SELECT 1 FROM finance_entries v WHERE v.reverses_entry_id=e.id) GROUP BY r.installment_id) v ON v.installment_id=x.id WHERE c.profile_id=$1 AND c.status='active'),0) AS amount`,
      [id, exclude],
    );
    return Number(r.amount);
  }
  async offer(i: Identity, body: unknown, key: unknown) {
    permit(i, "credit_manage");
    const b = validate(
      condition.extend({
        branch_id: uuid,
        profile_id: uuid,
        policy_version: version,
        assessment: text(1500, 10),
        approval_reference: text(500, 3),
      }),
      body,
    );
    branchAccess(i, b.branch_id);
    return this.inventory.write(
      i,
      key,
      { action: "credit.offer", b },
      async (tx) => {
        const policy = (await this.policy(tx))!;
        if (policy.version !== b.policy_version)
          fail(409, "Condições comerciais alteradas. Simule novamente.");
        if (!policy.enabled) fail(409, "Novas vendas a prazo estão suspensas.");
        const p = await this.profile(tx, i, b.profile_id);
        if (!p.enabled || !p.customer_active)
          fail(409, "Cliente sem aprovação ativa.");
        if (
          (await this.exposure(tx, p.id)) + b.purchase_cents - b.down_cents >
          p.limit_cents
        )
          fail(
            409,
            "Limite disponível insuficiente, considerando contratos e ofertas aprovadas.",
          );
        if (b.first_due_on <= addDays(creditDay(), policy.offer_days))
          fail(
            400,
            "Primeiro vencimento deve ser posterior à validade da oferta.",
          );
        const simulation = this.quote(policy, b),
          id = randomUUID(),
          borrower = {
            customer_id: p.customer_id,
            name: p.name,
            phone: p.phone,
            email: p.email,
            cpf: p.cpf,
            address: p.address,
          };
        await tx.query(
          "INSERT INTO credit_offers(id,tenant_id,branch_id,profile_id,customer_id,code,purchase_cents,down_cents,count,monthly_bps,first_due_on,issued_on,valid_until,policy,borrower,simulation,assessment,approval_reference,approved_by,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb,$16::jsonb,$17,$18,$19,'approved') RETURNING id",
          [
            id,
            i.tenant_id,
            b.branch_id,
            p.id,
            p.customer_id,
            "OF-" + id.toUpperCase(),
            b.purchase_cents,
            b.down_cents,
            b.count,
            b.monthly_bps,
            b.first_due_on,
            creditDay(),
            addDays(creditDay(), policy.offer_days),
            JSON.stringify(policy),
            JSON.stringify(borrower),
            JSON.stringify(simulation),
            b.assessment,
            b.approval_reference,
            i.user_id,
          ],
        );
        await this.event(tx, i, b.branch_id, id, "offer_approved", {
          purchase_cents: b.purchase_cents,
        });
        return { id };
      },
    );
  }
  async offers(i: Identity, branch: string, page: number) {
    const ids = this.scope(i, branch);
    return this.db.transaction(i.tenant_id, async (tx) => ({
      items: await tx.query(
        "SELECT id,code,branch_id,customer_id,borrower->>'name' AS customer_name,purchase_cents,down_cents,count,monthly_bps,first_due_on::text AS first_due_on,valid_until::text AS valid_until,status,version,simulation,count(*) OVER()::int AS total_count FROM credit_offers WHERE branch_id=ANY($1::uuid[]) ORDER BY created_at DESC,id DESC LIMIT 30 OFFSET $2",
        [ids, (page - 1) * 30],
      ),
    }));
  }
  async cancelOffer(i: Identity, id: string, body: unknown, key: unknown) {
    permit(i, "credit_manage");
    validate(uuid, id);
    const b = validate(
      z.object({ version, reason: text(500, 3) }).strict(),
      body,
    );
    return this.inventory.write(
      i,
      key,
      { action: "credit.offer.cancel", id, b },
      async (tx) => {
        const [o] = await tx.query("SELECT * FROM credit_offers WHERE id=$1", [
          id,
        ]);
        if (!o) fail(404, "Oferta não encontrada.");
        branchAccess(i, o.branch_id);
        await this.profile(tx, i, o.profile_id);
        const [current] = await tx.query(
          "SELECT * FROM credit_offers WHERE id=$1 FOR UPDATE",
          [id],
        );
        if (current.version !== b.version || current.status !== "approved")
          fail(409, "Oferta atualizada ou já utilizada.");
        await tx.query(
          "UPDATE credit_offers SET status='cancelled',version=version+1 WHERE id=$1 RETURNING id",
          [id],
        );
        await this.event(tx, i, o.branch_id, id, "offer_cancelled", {
          reason: b.reason,
        });
        return { id };
      },
    );
  }
  async checkoutOffers(i: Identity, branch: string, q: string) {
    permit(i, "credit_sell");
    branchAccess(i, branch);
    return this.db.transaction(i.tenant_id, async (tx) => {
      const offers = await tx.query(
        "SELECT o.*,o.first_due_on::text AS first_due_on,c.name FROM credit_offers o JOIN customers c ON c.id=o.customer_id JOIN credit_profiles p ON p.id=o.profile_id WHERE o.branch_id=$1 AND o.status='approved' AND o.valid_until>=(now() AT TIME ZONE 'America/Fortaleza')::date AND c.active AND p.enabled AND c.name ILIKE $2 ORDER BY o.created_at DESC LIMIT 20",
        [branch, "%" + q.slice(0, 100) + "%"],
      );
      return {
        items: offers
          .filter((o) => o.first_due_on.toString().slice(0, 10) > creditDay())
          .map((o) => ({
            id: o.id,
            code: o.code,
            customer_id: o.customer_id,
            customer_name: o.name,
            purchase_cents: o.purchase_cents,
            down_cents: o.down_cents,
            simulation: this.quote(o.policy, {
              purchase_cents: o.purchase_cents,
              down_cents: o.down_cents,
              count: o.count,
              monthly_bps: o.monthly_bps,
              first_due_on: String(o.first_due_on).slice(0, 10),
            }),
          })),
      };
    });
  }
  async prepareSale(
    tx: Tx,
    i: Identity,
    id: string,
    branch: string,
    customer: string | undefined,
    total: number,
    expectedCredit: number,
    acceptance: string,
    confirmed: boolean,
  ) {
    permit(i, "credit_sell");
    validate(uuid, id);
    if (!confirmed || acceptance.trim().length < 3)
      fail(
        400,
        "Registre a entrega das condições e a aceitação manual do contrato.",
      );
    const [offer] = await tx.query(
      "SELECT *,first_due_on::text AS first_due_on,valid_until::text AS valid_until FROM credit_offers WHERE id=$1",
      [id],
    );
    if (!offer) fail(404, "Oferta não encontrada.");
    branchAccess(i, offer.branch_id);
    const p = await this.profile(tx, i, offer.profile_id);
    const [o] = await tx.query(
      "SELECT *,first_due_on::text AS first_due_on,valid_until::text AS valid_until FROM credit_offers WHERE id=$1 FOR UPDATE",
      [id],
    );
    if (
      !(await this.policy(tx))!.enabled ||
      o.status !== "approved" ||
      o.valid_until < creditDay() ||
      !p.enabled ||
      !p.customer_active
    )
      fail(409, "Oferta indisponível, vencida ou cliente bloqueado.");
    if (
      o.branch_id !== branch ||
      o.customer_id !== customer ||
      o.purchase_cents !== total
    )
      fail(
        409,
        "Cliente, filial e total devem corresponder à oferta aprovada.",
      );
    if (
      (await this.exposure(tx, p.id, id)) + total - o.down_cents >
      p.limit_cents
    )
      fail(409, "Limite disponível alterado.");
    const simulation = this.quote(o.policy, {
      purchase_cents: total,
      down_cents: o.down_cents,
      count: o.count,
      monthly_bps: o.monthly_bps,
      first_due_on: o.first_due_on,
    });
    if (simulation.total_cents !== expectedCredit)
      fail(409, "Atualize as condições do crediário antes de confirmar.");
    return { offer: o, simulation, acceptance };
  }
  private async income(
    tx: Tx,
    i: Identity,
    c: Row,
    plan: string,
    amount: number,
    date: string,
    kind: string,
    receipt: string | null = null,
  ) {
    if (!amount) return;
    await tx.query(
      "INSERT INTO credit_income_events(id,tenant_id,branch_id,contract_id,plan_id,receipt_id,amount_cents,competence_on,kind,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id",
      [
        randomUUID(),
        i.tenant_id,
        c.branch_id,
        c.id,
        plan,
        receipt,
        amount,
        date,
        kind,
        i.user_id,
      ],
    );
  }
  private async newPlan(
    tx: Tx,
    i: Identity,
    c: Row,
    sim: ReturnType<typeof simulateCredit>,
    policy: Row,
    reason: string,
    acceptance: string,
  ) {
    const id = randomUUID();
    const [r] = await tx.query(
      "SELECT coalesce(max(revision),0)::int+1 AS next FROM credit_plans WHERE contract_id=$1",
      [c.id],
    );
    await tx.query(
      "INSERT INTO credit_plans(id,tenant_id,contract_id,revision,principal_cents,issued_on,monthly_bps,late_fee_bps,late_monthly_bps,simulation,policy,reason,acceptance_reference,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12,$13,$14) RETURNING id",
      [
        id,
        i.tenant_id,
        c.id,
        r.next,
        sim.principal_cents,
        sim.issued_on,
        sim.monthly_bps,
        policy.late_fee_bps,
        policy.late_monthly_bps,
        JSON.stringify(sim),
        JSON.stringify(policy),
        reason,
        acceptance,
        i.user_id,
      ],
    );
    for (const line of sim.lines) {
      const installment = randomUUID();
      await tx.query(
        "INSERT INTO credit_installments(id,tenant_id,contract_id,plan_id,number,principal_cents,interest_cents,due_on) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id",
        [
          installment,
          i.tenant_id,
          c.id,
          id,
          line.number,
          line.principal_cents,
          line.interest_cents,
          line.due_on,
        ],
      );
      await tx.query(
        "INSERT INTO finance_titles(id,tenant_id,branch_id,direction,description,counterparty,amount_cents,competence_on,due_on,source_kind,created_by,credit_installment_id,affects_result) VALUES($1,$2,$3,'receivable',$4,$5,$6,$7,$7,'credit',$8,$9,false) RETURNING id",
        [
          randomUUID(),
          i.tenant_id,
          c.branch_id,
          c.code + " · Parcela " + line.number + " / revisão " + r.next,
          c.borrower.name,
          line.amount_cents,
          line.due_on,
          i.user_id,
          installment,
        ],
      );
      await this.income(
        tx,
        i,
        c,
        id,
        line.interest_cents,
        line.due_on,
        "scheduled",
      );
    }
    await tx.query(
      "UPDATE credit_contracts SET current_plan_id=$2,version=version+1 WHERE id=$1 RETURNING id",
      [c.id, id],
    );
    return id;
  }
  async activateSale(
    tx: Tx,
    i: Identity,
    sale: string,
    prepared: Awaited<ReturnType<CreditService["prepareSale"]>>,
  ) {
    const { offer: o, simulation, acceptance } = prepared,
      id = randomUUID();
    const c = {
      id,
      code: "CR-" + id.toUpperCase(),
      branch_id: o.branch_id,
      borrower: o.borrower,
    };
    await tx.query(
      "INSERT INTO credit_contracts(id,tenant_id,branch_id,profile_id,customer_id,sale_id,offer_id,code,status,borrower,policy,acceptance_reference,accepted_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'active',$9::jsonb,$10::jsonb,$11,$12) RETURNING id",
      [
        id,
        i.tenant_id,
        o.branch_id,
        o.profile_id,
        o.customer_id,
        sale,
        o.id,
        c.code,
        JSON.stringify(o.borrower),
        JSON.stringify(o.policy),
        acceptance,
        i.user_id,
      ],
    );
    await this.newPlan(
      tx,
      i,
      c,
      simulation,
      o.policy,
      "Venda inicial",
      acceptance,
    );
    await tx.query(
      "UPDATE credit_offers SET status='used',version=version+1 WHERE id=$1 RETURNING id",
      [o.id],
    );
    await this.event(tx, i, o.branch_id, id, "contract_created", {
      sale_id: sale,
    });
    return { id, code: c.code };
  }
  private async contract(tx: Tx, i: Identity, id: string, expected?: number) {
    validate(uuid, id);
    const [c] = await tx.query(
      "SELECT * FROM credit_contracts WHERE id=$1 FOR UPDATE",
      [id],
    );
    if (!c) fail(404, "Contrato não encontrado.");
    branchAccess(i, c.branch_id);
    if (expected !== undefined && expected !== c.version)
      fail(409, "Contrato atualizado. Recarregue.");
    return c;
  }
  private async installments(tx: Tx, c: Row) {
    const rows = await tx.query(
      "SELECT x.*,x.due_on::text AS due_on,t.id AS title_id,t.cancelled AS title_cancelled FROM credit_installments x JOIN finance_titles t ON t.credit_installment_id=x.id WHERE x.plan_id=$1 ORDER BY x.number",
      [c.current_plan_id],
    );
    const [plan] = await tx.query(
      "SELECT *,issued_on::text AS issued_on FROM credit_plans WHERE id=$1",
      [c.current_plan_id],
    );
    const result: Row[] = [];
    for (const x of rows) {
      const receipts = await tx.query(activeReceipts, [x.id]);
      const line = {
        number: x.number,
        due_on: x.due_on,
        principal_cents: x.principal_cents,
        interest_cents: x.interest_cents,
        amount_cents: x.principal_cents + x.interest_cents,
      };
      result.push({
        ...x,
        quote: installmentQuote(
          line,
          plan.issued_on,
          creditDay(),
          receipts as any,
          plan.late_monthly_bps,
          plan.late_fee_bps,
        ),
        receipts,
      });
    }
    return { plan, items: result };
  }
  async detail(i: Identity, id: string) {
    permit(i, "credit_read");
    return this.db.transaction(i.tenant_id, async (tx) => {
      const c = await this.contract(tx, i, id);
      const data = await this.installments(tx, c);
      const plans = await tx.query(
        "SELECT id,revision,principal_cents,issued_on::text AS issued_on,simulation,reason,acceptance_reference,created_at FROM credit_plans WHERE contract_id=$1 ORDER BY revision DESC",
        [id],
      );
      const events = await tx.query(
        "SELECT e.*,u.name AS actor_name FROM credit_events e JOIN users u ON u.id=e.actor_id WHERE entity_id=$1 ORDER BY created_at DESC,id DESC",
        [id],
      );
      return { contract: c, ...data, plans, events };
    });
  }
  async list(
    i: Identity,
    branch: string,
    q: string,
    page: number,
    status: string,
  ) {
    const ids = this.scope(i, branch);
    validate(
      z.enum(["all", "active", "overdue", "settled", "cancelled"]),
      status,
    );
    return this.db.transaction(i.tenant_id, async (tx) => ({
      items: await tx.query(
        `WITH debts AS (SELECT c.id,coalesce(sum(t.amount_cents-t.opening_paid_cents-coalesce(p.paid,0)),0)::bigint AS nominal,coalesce(sum(t.amount_cents-t.opening_paid_cents-coalesce(p.paid,0)) FILTER(WHERE t.due_on<(now() AT TIME ZONE 'America/Fortaleza')::date),0)::bigint AS overdue FROM credit_contracts c JOIN credit_installments x ON x.plan_id=c.current_plan_id JOIN finance_titles t ON t.credit_installment_id=x.id LEFT JOIN (SELECT s.title_id,sum(s.amount_cents+s.discount_cents-s.charges_cents) AS paid FROM finance_settlements s JOIN finance_entries e ON e.settlement_id=s.id AND e.source_kind='settlement' WHERE NOT EXISTS(SELECT 1 FROM finance_entries v WHERE v.reverses_entry_id=e.id) GROUP BY s.title_id) p ON p.title_id=t.id GROUP BY c.id) SELECT c.id,c.code,c.branch_id,c.status,c.version,c.customer_id,c.borrower->>'name' AS customer_name,c.borrower->>'phone' AS phone,b.name AS branch_name,d.nominal::text AS nominal_cents,d.overdue::text AS overdue_cents,count(*) OVER()::int AS total_count FROM credit_contracts c JOIN debts d ON d.id=c.id JOIN branches b ON b.id=c.branch_id WHERE c.branch_id=ANY($1::uuid[]) AND (c.code ILIKE $2 OR c.borrower->>'name' ILIKE $2) AND ($3='all' OR ($3='cancelled' AND c.status='cancelled') OR (c.status='active' AND (($3='active' AND d.nominal>0) OR ($3='overdue' AND d.overdue>0) OR ($3='settled' AND d.nominal=0)))) ORDER BY c.created_at DESC,c.id DESC LIMIT 30 OFFSET $4`,
        [ids, "%" + q.slice(0, 100) + "%", status, (page - 1) * 30],
      ),
    }));
  }
  async receive(i: Identity, id: string, body: unknown, key: unknown) {
    permit(i, "credit_manage");
    const b = validate(
      z
        .object({
          version,
          installment_id: uuid,
          amount_cents: cents.refine((n) => n > 0),
          expected_total_cents: cents,
          account_id: uuid,
          reference: text(120, 3),
        })
        .strict(),
      body,
    );
    return this.inventory.write(
      i,
      key,
      { action: "credit.receive", id, b },
      async (tx) => {
        const c = await this.contract(tx, i, id, b.version);
        if (c.status !== "active") fail(409, "Contrato cancelado.");
        const d = await this.installments(tx, c),
          line = d.items.find((x) => x.id === b.installment_id);
        if (!line) fail(400, "Parcela não pertence ao plano vigente.");
        if (line.quote.total_cents !== b.expected_total_cents)
          fail(409, "Valor atualizado. Confira juros e abatimentos de hoje.");
        let allocation;
        try {
          allocation = allocateCreditPayment(b.amount_cents, line.quote);
        } catch (e: any) {
          fail(400, e.message);
        }
        const posted = await this.finance.creditSettlement(
          tx,
          i,
          line.title_id,
          b.account_id,
          b.amount_cents,
          allocation!.discount_cents,
          allocation!.fine_cents + allocation!.late_cents,
          b.reference,
        );
        const receipt = randomUUID();
        await tx.query(
          "INSERT INTO credit_receipts(id,tenant_id,contract_id,installment_id,settlement_id,posted_on,principal_cents,interest_cents,discount_cents,fine_cents,late_cents,reference,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id",
          [
            receipt,
            i.tenant_id,
            c.id,
            line.id,
            posted.id,
            creditDay(),
            allocation!.principal_cents,
            allocation!.interest_cents,
            allocation!.discount_cents,
            allocation!.fine_cents,
            allocation!.late_cents,
            b.reference,
            i.user_id,
          ],
        );
        if (creditDay() < line.due_on) {
          await this.income(
            tx,
            i,
            c,
            c.current_plan_id,
            -allocation!.interest_cents - allocation!.discount_cents,
            line.due_on,
            "advance_reduction",
            receipt,
          );
          await this.income(
            tx,
            i,
            c,
            c.current_plan_id,
            allocation!.interest_cents,
            creditDay(),
            "earned_early",
            receipt,
          );
        }
        await this.income(
          tx,
          i,
          c,
          c.current_plan_id,
          allocation!.fine_cents + allocation!.late_cents,
          creditDay(),
          "late_charges",
          receipt,
        );
        await tx.query(
          "UPDATE credit_contracts SET version=version+1 WHERE id=$1 RETURNING id",
          [id],
        );
        await this.event(tx, i, c.branch_id, id, "payment_received", {
          receipt_id: receipt,
          amount_cents: b.amount_cents,
          ...allocation,
        });
        return { id: receipt, ...allocation };
      },
    );
  }
  async reverseReceipt(i: Identity, id: string, body: unknown, key: unknown) {
    permit(i, "credit_manage");
    validate(uuid, id);
    const b = validate(
      z.object({ version, receipt_id: uuid, reason: text(1000, 5) }).strict(),
      body,
    );
    return this.inventory.write(
      i,
      key,
      { action: "credit.receipt.reverse", id, b },
      async (tx) => {
        const c = await this.contract(tx, i, id, b.version);
        if (c.status !== "active") fail(409, "Contrato cancelado.");
        const [r] = await tx.query(
          "SELECT * FROM credit_receipts WHERE id=$1 AND contract_id=$2",
          [b.receipt_id, id],
        );
        if (!r) fail(404, "Recebimento não encontrado.");
        if (
          !(
            await tx.query(
              "SELECT id FROM credit_installments WHERE id=$1 AND plan_id=$2",
              [r.installment_id, c.current_plan_id],
            )
          ).length
        )
          fail(409, "Recebimento de plano renegociado é preservado.");
        await this.finance.reverseCredit(tx, i, r.settlement_id, b.reason);
        const effects = await tx.query(
          "SELECT *,competence_on::text AS competence_on FROM credit_income_events WHERE receipt_id=$1",
          [r.id],
        );
        for (const effect of effects)
          await this.income(
            tx,
            i,
            c,
            c.current_plan_id,
            -effect.amount_cents,
            effect.kind === "advance_reduction"
              ? String(effect.competence_on).slice(0, 10)
              : creditDay(),
            "receipt_reversal",
            null,
          );
        await tx.query(
          "UPDATE credit_contracts SET version=version+1 WHERE id=$1 RETURNING id",
          [id],
        );
        await this.event(tx, i, c.branch_id, id, "payment_reversed", {
          reason: b.reason,
          receipt_id: r.id,
        });
        return { ok: true };
      },
    );
  }
  private async closeIncome(tx: Tx, i: Identity, c: Row, keepPaid: boolean) {
    const facts = await tx.query(
      "SELECT competence_on::text AS day,sum(amount_cents)::text AS amount FROM credit_income_events WHERE plan_id=$1 GROUP BY competence_on",
      [c.current_plan_id],
    );
    let past = 0;
    for (const f of facts) {
      if (f.day > creditDay())
        await this.income(
          tx,
          i,
          c,
          c.current_plan_id,
          -Number(f.amount),
          f.day,
          "plan_closed",
        );
      else past += Number(f.amount);
    }
    let retained = 0;
    if (keepPaid) {
      const [p] = await tx.query(
        `SELECT coalesce(sum(r.interest_cents+r.fine_cents+r.late_cents),0)::text AS amount FROM credit_receipts r JOIN credit_installments x ON x.id=r.installment_id JOIN finance_entries e ON e.settlement_id=r.settlement_id AND e.source_kind='settlement' WHERE x.plan_id=$1 AND NOT EXISTS(SELECT 1 FROM finance_entries v WHERE v.reverses_entry_id=e.id)`,
        [c.current_plan_id],
      );
      retained = Number(p.amount);
    }
    await this.income(
      tx,
      i,
      c,
      c.current_plan_id,
      retained - past,
      creditDay(),
      "plan_closed",
    );
  }
  async renegotiate(i: Identity, id: string, body: unknown, key: unknown) {
    permit(i, "credit_manage");
    const b = validate(
      z
        .object({
          version,
          count: z.number().int().min(1).max(36),
          policy_version: version,
          monthly_bps: z.number().int().min(0).max(300),
          first_due_on: date,
          reason: text(1500, 10),
          acceptance_reference: text(500, 3),
          assessment: text(1500, 10),
          accepted: z.literal(true),
        })
        .strict(),
      body,
    );
    return this.inventory.write(
      i,
      key,
      { action: "credit.renegotiate", id, b },
      async (tx) => {
        const c = await this.contract(tx, i, id, b.version);
        if (c.status !== "active") fail(409, "Contrato cancelado.");
        const d = await this.installments(tx, c),
          principal = d.items.reduce((n, x) => n + x.quote.principal_cents, 0);
        if (!principal) fail(409, "Sem principal aberto para renegociar.");
        const p = (await this.policy(tx))!;
        if (p.version !== b.policy_version)
          fail(409, "Condições comerciais alteradas. Simule novamente.");
        const simulation = this.quote(p, {
          purchase_cents: principal,
          down_cents: 0,
          count: b.count,
          monthly_bps: b.monthly_bps,
          first_due_on: b.first_due_on,
        });
        await this.closeIncome(tx, i, c, true);
        await tx.query(
          "UPDATE finance_titles SET cancelled=true,version=version+1 WHERE credit_installment_id IN (SELECT id FROM credit_installments WHERE plan_id=$1) RETURNING id",
          [c.current_plan_id],
        );
        await this.newPlan(
          tx,
          i,
          c,
          simulation,
          p,
          b.reason,
          b.acceptance_reference,
        );
        await this.event(tx, i, c.branch_id, id, "renegotiated", {
          reason: b.reason,
          assessment: b.assessment,
          principal_cents: principal,
          waived_unpaid_interest: true,
        });
        return { id };
      },
    );
  }
  async cancelSale(
    tx: Tx,
    i: Identity,
    sale: string,
    reason: string,
    expected: number,
    confirmed: boolean,
  ) {
    const [found] = await tx.query(
      "SELECT id FROM credit_contracts WHERE sale_id=$1",
      [sale],
    );
    if (!found) return null;
    permit(i, "credit_manage");
    const c = await this.contract(tx, i, found.id);
    if (c.status !== "active") fail(409, "Contrato já cancelado.");
    const receipts = await tx.query(
      "SELECT r.*,e.amount_cents FROM credit_receipts r JOIN finance_entries e ON e.settlement_id=r.settlement_id AND e.source_kind='settlement' WHERE r.contract_id=$1 AND NOT EXISTS(SELECT 1 FROM finance_entries v WHERE v.reverses_entry_id=e.id) ORDER BY r.id",
      [c.id],
    );
    const refund = receipts.reduce((n, r) => n + r.amount_cents, 0);
    if (!confirmed || refund !== expected)
      fail(
        409,
        "Confira e confirme o reembolso da entrada e dos recebimentos do crediário. Atualize o comprovante se os valores mudaram.",
      );
    for (const r of receipts)
      await this.finance.reverseCredit(
        tx,
        i,
        r.settlement_id,
        "Cancelamento integral: " + reason,
      );
    const plans = await tx.query(
      "SELECT id FROM credit_plans WHERE contract_id=$1 ORDER BY revision",
      [c.id],
    );
    for (const plan of plans)
      await this.closeIncome(tx, i, { ...c, current_plan_id: plan.id }, false);
    await tx.query(
      "UPDATE finance_titles SET cancelled=true,version=version+1 WHERE credit_installment_id IN (SELECT id FROM credit_installments WHERE contract_id=$1) RETURNING id",
      [c.id],
    );
    await tx.query(
      "UPDATE credit_contracts SET status='cancelled',version=version+1 WHERE id=$1 RETURNING id",
      [c.id],
    );
    await this.event(tx, i, c.branch_id, c.id, "contract_cancelled", {
      reason,
      refunded_credit_cents: refund,
    });
    return c;
  }
  async collections(i: Identity, branch: string, page: number) {
    const ids = this.scope(i, branch);
    return this.db.transaction(i.tenant_id, async (tx) => {
      const base = `WITH debt AS (SELECT c.id AS contract_id,c.code,c.borrower->>'name' AS customer_name,c.borrower->>'phone' AS phone,c.branch_id,b.name AS branch_name,x.number,x.due_on::text AS due_on,(now() AT TIME ZONE 'America/Fortaleza')::date-x.due_on AS days_late,t.amount_cents-coalesce(p.paid,0) AS nominal_cents FROM credit_contracts c JOIN credit_installments x ON x.plan_id=c.current_plan_id JOIN finance_titles t ON t.credit_installment_id=x.id JOIN branches b ON b.id=c.branch_id LEFT JOIN (SELECT s.title_id,sum(s.amount_cents+s.discount_cents-s.charges_cents) AS paid FROM finance_settlements s JOIN finance_entries e ON e.settlement_id=s.id AND e.source_kind='settlement' WHERE NOT EXISTS(SELECT 1 FROM finance_entries v WHERE v.reverses_entry_id=e.id) GROUP BY s.title_id) p ON p.title_id=t.id WHERE c.status='active' AND c.branch_id=ANY($1::uuid[]) AND x.due_on<(now() AT TIME ZONE 'America/Fortaleza')::date AND t.amount_cents>coalesce(p.paid,0)) `;
      const items = await tx.query(
        base +
          "SELECT *,nominal_cents::text AS nominal_cents,count(*) OVER()::int AS total_count FROM debt ORDER BY days_late DESC,contract_id,number LIMIT 30 OFFSET $2",
        [ids, (page - 1) * 30],
      );
      const [summary] = await tx.query(
        base +
          "SELECT count(*)::int AS installments,count(DISTINCT contract_id)::int AS contracts,coalesce(sum(nominal_cents),0)::text AS total_cents,coalesce(sum(nominal_cents) FILTER(WHERE days_late<=30),0)::text AS days_30,coalesce(sum(nominal_cents) FILTER(WHERE days_late BETWEEN 31 AND 60),0)::text AS days_60,coalesce(sum(nominal_cents) FILTER(WHERE days_late>60),0)::text AS days_over60 FROM debt",
        [ids],
      );
      return { items, summary };
    });
  }
  async offerDocument(i: Identity, id: string) {
    permit(i, "credit_read");
    validate(uuid, id);
    return this.db.transaction(i.tenant_id, async (tx) => {
      const [o] = await tx.query(
        "SELECT *,valid_until::text AS valid_until FROM credit_offers WHERE id=$1",
        [id],
      );
      if (!o) fail(404, "Oferta não encontrada.");
      branchAccess(i, o.branch_id);
      await this.event(tx, i, o.branch_id, id, "offer_document_accessed");
      return {
        kind: "offer",
        contract: { ...o, total_cents: o.purchase_cents, receipt_code: "" },
        plans: [
          {
            revision: 1,
            simulation: o.simulation,
            policy: o.policy,
            reason: "Condições aprovadas para conferência antes da venda",
            acceptance_reference:
              "Oferta para conferência; aceite registrado na venda",
          },
        ],
        items: [],
      };
    });
  }
  async document(i: Identity, id: string) {
    validate(uuid, id);
    return this.db.transaction(i.tenant_id, async (tx) => {
      const [c] = await tx.query(
        "SELECT c.*,v.operator_id,v.receipt_code,v.total_cents FROM credit_contracts c JOIN pos_sales v ON v.id=c.sale_id WHERE c.id=$1",
        [id],
      );
      if (!c) fail(404, "Contrato não encontrado.");
      branchAccess(i, c.branch_id);
      if (!["owner", "manager"].includes(i.role)) {
        permit(i, "credit_sell");
        if (c.operator_id !== i.user_id)
          fail(403, "Documento restrito ao operador responsável pela venda.");
      }
      const plans = await tx.query(
        "SELECT revision,simulation,policy,reason,acceptance_reference,created_at FROM credit_plans WHERE contract_id=$1 ORDER BY revision",
        [id],
      );
      const items = await tx.query(
        "SELECT product_name,sku,identifiers,quantity,net_cents FROM pos_sale_items WHERE sale_id=$1 ORDER BY id",
        [c.sale_id],
      );
      await this.event(tx, i, c.branch_id, id, "document_accessed");
      return { contract: c, plans, items };
    });
  }
}

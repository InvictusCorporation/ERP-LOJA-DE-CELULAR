import { z } from "zod";
import { Database, Tx } from "./db";
import { Identity } from "./security";
import { branchAccess, fail, permit, uuid, validate } from "./domain";
import {
  financialFactsCte,
  financialResult,
  reportInteger as integer,
} from "./reporting-metrics";
type Row = Record<string, any>;
const day = (column: string) =>
  `(${column} AT TIME ZONE 'America/Fortaleza')::date`;
const today = () =>
  new Date().toLocaleDateString("sv-SE", { timeZone: "America/Fortaleza" });
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (s) =>
      s >= "2000-01-01" &&
      s <= "2199-12-31" &&
      !isNaN(Date.parse(s + "T12:00:00Z")) &&
      new Date(s + "T12:00:00Z").toISOString().slice(0, 10) === s,
    "Data inválida.",
  );
const returned = `(SELECT coalesce(sum(r.total_cents),0) FROM pos_returns r WHERE r.sale_id=s.id)`;
const paid = `(t.opening_paid_cents+coalesce((SELECT sum(s.amount_cents+s.discount_cents-s.charges_cents) FROM finance_settlements s JOIN finance_entries e ON e.settlement_id=s.id AND e.source_kind='settlement' WHERE s.title_id=t.id AND NOT EXISTS(SELECT 1 FROM finance_entries r WHERE r.reverses_entry_id=e.id)),0))`;
function result(rows: Row[]) {
  const f = financialResult(rows);
  f.turnover = integer(f.sales + f.returns + f.services);
  f.operating_gross = integer(f.turnover - f.goods_cost - f.service_cost);
  f.operating_margin =
    f.turnover > 0 ? (f.operating_gross / f.turnover) * 100 : null;
  return f;
}
export class ReportsService {
  constructor(private db: Database) {}
  async read(i: Identity, kind: string, query: Row) {
    permit(i, "reports_read");
    const branch = String(query.branch_id || "all");
    let ids = i.branch_ids;
    if (branch !== "all") {
      validate(uuid, branch);
      branchAccess(i, branch);
      ids = [branch];
    }
    if (
      ![
        "overview",
        "products",
        "stagnant",
        "sellers",
        "technicians",
        "services",
        "credit",
      ].includes(kind)
    )
      fail(404, "Relatório não encontrado.");
    const current = kind === "stagnant" || kind === "credit";
    const start = String(query.start || today()),
      end = String(query.end || today());
    if (!current) {
      validate(date, start);
      validate(date, end);
      if (
        start > end ||
        end > today() ||
        (Date.parse(end) - Date.parse(start)) / 86400000 > 365
      )
        fail(400, "Escolha até 366 dias, sem datas futuras.");
    }
    const page = validate(
      z.coerce.number().int().min(1).max(100000).default(1),
      query.page,
    );
    const q = validate(z.string().trim().max(100).default(""), query.q);
    const days = validate(
      z.coerce.number().int().min(1).max(730).default(30),
      query.days,
    );
    const sort = validate(
      z.enum(["quantity", "revenue", "profit"]).default("quantity"),
      query.sort,
    );
    try {
      return await this.db.transaction(i.tenant_id, async (tx) => {
        await tx.query("SELECT set_config('statement_timeout','10000',true)");
        if (kind === "overview") return this.overview(tx, ids, start, end);
        const params: any[] = [ids];
        let sql = "",
          order = "";
        if (!current) params.push(start, end);
        if (kind === "products") {
          params.push(q);
          sql = `WITH movements AS (
            SELECT x.product_id,x.quantity::bigint AS sold,0::bigint AS returned,x.net_cents::bigint AS revenue,x.quantity::bigint*x.unit_cost_cents AS cost FROM pos_sale_items x JOIN pos_sales s ON s.id=x.sale_id WHERE s.branch_id=ANY($1::uuid[]) AND ${day("s.created_at")} BETWEEN $2::date AND $3::date
            UNION ALL SELECT x.product_id,0,r.quantity::bigint,-r.amount_cents::bigint,-r.quantity::bigint*x.unit_cost_cents FROM pos_return_items r JOIN pos_returns v ON v.id=r.return_id JOIN pos_sale_items x ON x.id=r.sale_item_id WHERE v.branch_id=ANY($1::uuid[]) AND ${day("v.created_at")} BETWEEN $2::date AND $3::date
          ), rows AS (SELECT p.id,p.name,p.sku,sum(m.sold)::text AS sold,sum(m.returned)::text AS returned,(sum(m.sold)-sum(m.returned))::text AS quantity,sum(m.revenue)::text AS revenue,sum(m.cost)::text AS cost,(sum(m.revenue)-sum(m.cost))::text AS profit FROM movements m JOIN products p ON p.id=m.product_id WHERE strpos(lower(p.name||' '||p.sku),lower($4))>0 GROUP BY p.id)`;
          order = `${sort}::numeric DESC,name,id`;
        } else if (kind === "stagnant") {
          params.push(days, q);
          sql = `WITH activity AS (SELECT b.*,p.name,p.sku,p.cost,p.serialized,p.created_at,
            (SELECT max(${day("s.created_at")}) FROM pos_sales s JOIN pos_sale_items x ON x.sale_id=s.id WHERE s.branch_id=b.branch_id AND x.product_id=b.product_id AND x.quantity>(SELECT coalesce(sum(r.quantity),0) FROM pos_return_items r WHERE r.sale_item_id=x.id)) AS last_sale,
            (SELECT max(${day("m.created_at")}) FROM stock_movements m WHERE m.product_id=b.product_id AND m.branch_id=b.branch_id AND m.quantity>0) AS last_entry
            FROM stock_balances b JOIN products p ON p.id=b.product_id WHERE b.branch_id=ANY($1::uuid[]) AND b.quantity>0 AND strpos(lower(p.name||' '||p.sku),lower($3))>0), rows AS (
            SELECT a.product_id AS id,a.name,a.sku,b.name AS branch,a.branch_id,a.quantity,a.last_sale::text,a.last_entry::text,((now() AT TIME ZONE 'America/Fortaleza')::date-greatest(a.last_sale,a.last_entry,${day("a.created_at")}))::int AS idle_days,
            (CASE WHEN a.serialized THEN (SELECT coalesce(sum(u.acquisition_cost*100),0) FROM device_units u WHERE u.branch_id=a.branch_id AND u.product_id=a.product_id AND u.status='in_stock') ELSE a.quantity::numeric*a.cost*100 END)::bigint::text AS cost
            FROM activity a JOIN branches b ON b.id=a.branch_id WHERE (now() AT TIME ZONE 'America/Fortaleza')::date-greatest(a.last_sale,a.last_entry,${day("a.created_at")}) >= $2::int)`;
          order = "idle_days DESC,name,id,branch_id";
        } else if (kind === "sellers") {
          sql = `WITH movements AS (
            SELECT s.operator_id,s.total_cents::bigint AS gross,0::bigint AS returned,(SELECT coalesce(sum(x.quantity::bigint*x.unit_cost_cents),0) FROM pos_sale_items x WHERE x.sale_id=s.id) AS cost FROM pos_sales s WHERE s.branch_id=ANY($1::uuid[]) AND ${day("s.created_at")} BETWEEN $2::date AND $3::date
            UNION ALL SELECT s.operator_id,0,r.total_cents::bigint,-(SELECT coalesce(sum(x.quantity::bigint*p.unit_cost_cents),0) FROM pos_return_items x JOIN pos_sale_items p ON p.id=x.sale_item_id WHERE x.return_id=r.id) FROM pos_returns r JOIN pos_sales s ON s.id=r.sale_id WHERE r.branch_id=ANY($1::uuid[]) AND ${day("r.created_at")} BETWEEN $2::date AND $3::date
          ), cohort AS (SELECT s.operator_id,count(*) AS registered,count(*) FILTER(WHERE s.total_cents-${returned}>0) AS kept,coalesce(sum(s.total_cents-${returned}),0) AS kept_revenue FROM pos_sales s WHERE s.branch_id=ANY($1::uuid[]) AND ${day("s.created_at")} BETWEEN $2::date AND $3::date GROUP BY s.operator_id), rows AS (
            SELECT u.id,u.name,coalesce(c.registered,0)::text AS registered,coalesce(c.kept,0)::text AS kept,coalesce(c.kept_revenue,0)::text AS kept_revenue,sum(m.gross)::text AS gross,sum(m.returned)::text AS returned,(sum(m.gross)-sum(m.returned))::text AS revenue,sum(m.cost)::text AS cost,(sum(m.gross)-sum(m.returned)-sum(m.cost))::text AS profit FROM movements m JOIN users u ON u.id=m.operator_id LEFT JOIN cohort c ON c.operator_id=u.id GROUP BY u.id,c.registered,c.kept,c.kept_revenue)`;
          order = "revenue::numeric DESC,name,id";
        } else if (kind === "technicians") {
          sql = `WITH rows AS (SELECT o.technician_id AS id,coalesce(u.name,'Sem técnico') AS name,
            count(*) FILTER(WHERE ${day("o.ready_at")} BETWEEN $2::date AND $3::date AND (o.status='ready' OR (o.status='delivered' AND o.delivery_outcome='ready')))::text AS completed,
            count(*) FILTER(WHERE ${day("o.delivered_at")} BETWEEN $2::date AND $3::date AND o.delivery_outcome='ready')::text AS delivered,
            count(*) FILTER(WHERE o.status<>'delivered')::text AS backlog,
            count(*) FILTER(WHERE o.status IN ('received','diagnosis','awaiting_approval','approved','in_repair') AND o.due_on<(now() AT TIME ZONE 'America/Fortaleza')::date)::text AS overdue,
            avg(extract(epoch FROM (o.ready_at-o.created_at))/86400) FILTER(WHERE ${day("o.ready_at")} BETWEEN $2::date AND $3::date AND (o.status='ready' OR (o.status='delivered' AND o.delivery_outcome='ready')))::float8 AS elapsed_days
            FROM repair_orders o LEFT JOIN users u ON u.id=o.technician_id WHERE o.branch_id=ANY($1::uuid[]) GROUP BY o.technician_id,u.name)`;
          order = "completed::numeric DESC,name,id NULLS LAST";
        } else if (kind === "services") {
          params.push(q);
          sql = `${financialFactsCte}, rows AS (SELECT o.id,o.code,o.brand||' '||o.model AS device,b.name AS branch,coalesce(u.name,'Sem técnico') AS technician,${day("o.delivered_at")}::text AS delivered_on,(q.labor_price_cents+coalesce(p.price,0))::text AS revenue,(q.labor_cost_cents+coalesce(p.cost,0))::text AS cost,(q.labor_price_cents+coalesce(p.price,0)-q.labor_cost_cents-coalesce(p.cost,0))::text AS profit FROM repair_orders o JOIN repair_quotes q ON q.id=o.current_quote_id LEFT JOIN parts p ON p.order_id=o.id JOIN branches b ON b.id=o.branch_id LEFT JOIN users u ON u.id=o.technician_id WHERE o.branch_id=ANY($1::uuid[]) AND o.status='delivered' AND o.delivery_outcome='ready' AND ${day("o.delivered_at")} BETWEEN $2::date AND $3::date AND strpos(lower(o.code||' '||o.brand||' '||o.model),lower($4))>0)`;
          order = "delivered_on DESC,code,id";
        } else {
          sql = `WITH open AS (SELECT c.branch_id,t.due_on,greatest(0,t.amount_cents-${paid}) AS remaining FROM credit_contracts c JOIN credit_installments x ON x.plan_id=c.current_plan_id AND x.contract_id=c.id JOIN finance_titles t ON t.credit_installment_id=x.id WHERE c.status='active' AND NOT t.cancelled AND NOT t.needs_review AND c.branch_id=ANY($1::uuid[])), rows AS (
            SELECT b.id,b.name,count(*) FILTER(WHERE o.remaining>0)::text AS installments,coalesce(sum(o.remaining),0)::text AS open,
            coalesce(sum(o.remaining) FILTER(WHERE o.due_on<(now() AT TIME ZONE 'America/Fortaleza')::date),0)::text AS overdue,
            coalesce(sum(o.remaining) FILTER(WHERE (now() AT TIME ZONE 'America/Fortaleza')::date-o.due_on BETWEEN 1 AND 30),0)::text AS age_30,
            coalesce(sum(o.remaining) FILTER(WHERE (now() AT TIME ZONE 'America/Fortaleza')::date-o.due_on BETWEEN 31 AND 60),0)::text AS age_60,
            coalesce(sum(o.remaining) FILTER(WHERE (now() AT TIME ZONE 'America/Fortaleza')::date-o.due_on BETWEEN 61 AND 90),0)::text AS age_90,
            coalesce(sum(o.remaining) FILTER(WHERE (now() AT TIME ZONE 'America/Fortaleza')::date-o.due_on>90),0)::text AS age_over_90 FROM branches b LEFT JOIN open o ON o.branch_id=b.id WHERE b.id=ANY($1::uuid[]) GROUP BY b.id)`;
          order = "overdue::numeric DESC,name,id";
        }
        params.push(30, (page - 1) * 30);
        const totals =
          kind === "credit"
            ? `,(SELECT jsonb_build_object(${["installments", "open", "overdue", "age_30", "age_60", "age_90", "age_over_90"].map((k) => `'${k}',coalesce(sum(${k}::numeric),0)::text`).join(",")}) FROM rows) AS summary`
            : "";
        const [data] = await tx.query(
          `${sql} SELECT (now() AT TIME ZONE 'America/Fortaleza')::date::text AS position_on,now()::text AS generated_at,(SELECT count(*)::int FROM rows) AS total,coalesce((SELECT jsonb_agg(v) FROM (SELECT * FROM rows ORDER BY ${order} LIMIT $${params.length - 1} OFFSET $${params.length}) v),'[]'::jsonb) AS items${totals}`,
          params,
        );
        const numeric = [
          "sold",
          "returned",
          "quantity",
          "revenue",
          "cost",
          "profit",
          "registered",
          "kept",
          "kept_revenue",
          "gross",
          "completed",
          "delivered",
          "backlog",
          "overdue",
          "installments",
          "open",
          "age_30",
          "age_60",
          "age_90",
          "age_over_90",
        ];
        for (const row of data.items) {
          for (const key of numeric)
            if (row[key] !== undefined) row[key] = integer(row[key]);
          if (row.revenue !== undefined)
            row.margin =
              row.revenue > 0 ? (row.profit / row.revenue) * 100 : null;
          if (row.kept !== undefined)
            row.ticket =
              row.kept > 0 ? Math.round(row.kept_revenue / row.kept) : null;
          if (row.open !== undefined)
            row.delinquency =
              row.open > 0 ? (row.overdue / row.open) * 100 : null;
        }
        if (data.summary) {
          for (const key of Object.keys(data.summary))
            data.summary[key] = integer(data.summary[key]);
          data.summary.delinquency =
            data.summary.open > 0
              ? (data.summary.overdue / data.summary.open) * 100
              : null;
        }
        return {
          ...data,
          kind,
          branch_id: branch,
          start: current ? null : start,
          end: current ? null : end,
          page,
          page_size: 30,
          days,
          q,
          sort,
        };
      });
    } catch (error: any) {
      if ((error.meta?.code || error.code) === "57014")
        fail(
          422,
          "Consulta muito extensa. Reduza o período ou selecione uma filial.",
        );
      throw error;
    }
  }
  private async overview(tx: Tx, ids: string[], start: string, end: string) {
    const [data] = await tx.query(
      `${financialFactsCte}, cohort AS (SELECT s.branch_id,count(*)::int AS registered,count(*) FILTER(WHERE s.total_cents-${returned}>0)::int AS kept,coalesce(sum(s.total_cents-${returned}),0)::text AS kept_revenue FROM pos_sales s WHERE s.branch_id=ANY($1::uuid[]) AND ${day("s.created_at")} BETWEEN $2::date AND $3::date GROUP BY s.branch_id)
      SELECT now()::text AS generated_at,coalesce((SELECT jsonb_agg(v) FROM (SELECT branch_id,day::text,category,sum(amount)::text AS amount FROM facts WHERE branch_id=ANY($1::uuid[]) AND day BETWEEN $2::date AND $3::date GROUP BY branch_id,day,category) v),'[]'::jsonb) AS facts,coalesce((SELECT jsonb_agg(v) FROM (SELECT b.id,b.name,coalesce(c.registered,0) AS registered,coalesce(c.kept,0) AS kept,coalesce(c.kept_revenue,'0') AS kept_revenue FROM branches b LEFT JOIN cohort c ON c.branch_id=b.id WHERE b.id=ANY($1::uuid[]) ORDER BY b.name,b.id) v),'[]'::jsonb) AS branches`,
      [ids, start, end],
    );
    const days = new Map<string, Row[]>(),
      months = new Map<string, Row[]>(),
      branches = new Map<string, Row[]>();
    for (const fact of data.facts) {
      for (const [map, key] of [
        [days, fact.day],
        [months, fact.day.slice(0, 7)],
        [branches, fact.branch_id],
      ] as [Map<string, Row[]>, string][]) {
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(fact);
      }
    }
    const daily: Row[] = [],
      monthly: Row[] = [];
    for (
      let stamp = Date.parse(start);
      stamp <= Date.parse(end);
      stamp += 86400000
    ) {
      const key = new Date(stamp).toISOString().slice(0, 10);
      daily.push({ day: key, ...result(days.get(key) || []) });
      if (!monthly.some((m) => m.day === key.slice(0, 7)))
        monthly.push({
          day: key.slice(0, 7),
          ...result(months.get(key.slice(0, 7)) || []),
        });
    }
    let kept = 0,
      revenue = 0,
      registered = 0;
    for (const b of data.branches) {
      b.kept_revenue = integer(b.kept_revenue);
      kept = integer(kept + b.kept);
      registered = integer(registered + b.registered);
      revenue = integer(revenue + b.kept_revenue);
      b.ticket = b.kept > 0 ? Math.round(b.kept_revenue / b.kept) : null;
      Object.assign(b, result(branches.get(b.id) || []));
    }
    return {
      start,
      end,
      generated_at: data.generated_at,
      summary: {
        ...result(data.facts),
        registered,
        kept,
        ticket: kept > 0 ? Math.round(revenue / kept) : null,
      },
      daily,
      monthly,
      branches: data.branches,
    };
  }
}

import { fail } from "./domain";
type Row = Record<string, any>;

// Canonical competence facts shared by Finance and Management Reports.
export const financialFactsCte = `WITH parts AS (SELECT e.order_id,sum((CASE WHEN e.kind='issue' THEN e.quantity ELSE -e.quantity END)::bigint*x.unit_price_cents) AS price,sum((CASE WHEN e.kind='issue' THEN e.quantity ELSE -e.quantity END)::bigint*e.unit_cost_cents) AS cost FROM repair_part_events e JOIN repair_quote_items x ON x.id=e.quote_item_id GROUP BY e.order_id),facts AS (
 SELECT branch_id,'sales' AS category,total_cents::bigint AS amount,(created_at AT TIME ZONE 'America/Fortaleza')::date AS day FROM pos_sales
 UNION ALL SELECT branch_id,'returns',-total_cents::bigint,(created_at AT TIME ZONE 'America/Fortaleza')::date FROM pos_returns
 UNION ALL SELECT v.branch_id,'goods_cost',x.quantity::bigint*x.unit_cost_cents,(v.created_at AT TIME ZONE 'America/Fortaleza')::date FROM pos_sales v JOIN pos_sale_items x ON x.sale_id=v.id
 UNION ALL SELECT r.branch_id,'goods_cost',-x.quantity::bigint*p.unit_cost_cents,(r.created_at AT TIME ZONE 'America/Fortaleza')::date FROM pos_returns r JOIN pos_return_items x ON x.return_id=r.id JOIN pos_sale_items p ON p.id=x.sale_item_id
 UNION ALL SELECT o.branch_id,'services',q.labor_price_cents+coalesce(p.price,0),(o.delivered_at AT TIME ZONE 'America/Fortaleza')::date FROM repair_orders o JOIN repair_quotes q ON q.id=o.current_quote_id LEFT JOIN parts p ON p.order_id=o.id WHERE o.status='delivered' AND o.delivery_outcome='ready'
 UNION ALL SELECT o.branch_id,'service_cost',q.labor_cost_cents+coalesce(p.cost,0),(o.delivered_at AT TIME ZONE 'America/Fortaleza')::date FROM repair_orders o JOIN repair_quotes q ON q.id=o.current_quote_id LEFT JOIN parts p ON p.order_id=o.id WHERE o.status='delivered' AND o.delivery_outcome='ready'
 UNION ALL SELECT branch_id,'credit_income',amount_cents::bigint,competence_on FROM credit_income_events
 UNION ALL SELECT branch_id,CASE WHEN direction='receivable' THEN 'manual_income' ELSE 'expenses' END,amount_cents::bigint,competence_on FROM finance_titles WHERE source_kind='manual' AND affects_result AND NOT cancelled
 )`;

export function reportInteger(value: unknown) {
  const n = Number(value);
  if (!Number.isSafeInteger(n))
    fail(
      422,
      "Valor consolidado acima do limite de cálculo. Reduza o período.",
    );
  return n;
}
export function financialResult(rows: Row[]) {
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
    r[f.category] = reportInteger(r[f.category] + reportInteger(f.amount));
  r.revenue = reportInteger(
    r.sales + r.returns + r.services + r.manual_income + r.credit_income,
  );
  r.gross = reportInteger(r.revenue - r.goods_cost - r.service_cost);
  r.result = reportInteger(r.gross - r.expenses);
  r.margin = r.revenue > 0 ? (r.result / r.revenue) * 100 : null;
  return r;
}

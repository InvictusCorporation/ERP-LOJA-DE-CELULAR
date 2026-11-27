import { formatCents } from "./money";
type Row = Record<string, any>;
const methodNames: Row = {
  cash: "Dinheiro",
  pix: "Pix",
  debit: "Cartão de débito",
  credit: "Cartão de crédito",
};
const statusNames: Row = {
  completed: "Concluída",
  partial_return: "Devolução parcial",
  returned: "Devolvida",
  cancelled: "Cancelada",
};
const when = (s: string) =>
  new Date(s).toLocaleString("pt-BR", { timeZone: "America/Fortaleza" });
export function receiptText(r: Row): string {
  return [
    r.sale.company_name,
    r.sale.branch_name,
    "COMPROVANTE NÃO FISCAL",
    r.sale.receipt_code,
    ...(r.sale.customer_name ? ["Cliente: " + r.sale.customer_name] : []),
    when(r.sale.created_at),
    `Operador: ${r.sale.operator_name}`,
    `Situação: ${statusNames[r.sale.status]}`,
    "",
    ...r.items.map(
      (l: Row) =>
        `${l.quantity}x ${l.product_name} [${l.sku}] ${l.identifiers}\n${formatCents(l.net_cents)} · Garantia: ${l.warranty_days} dias ${l.warranty_terms}`,
    ),
    `Subtotal: ${formatCents(r.sale.subtotal_cents)}`,
    `Desconto: ${formatCents(r.sale.discount_cents)}`,
    `TOTAL: ${formatCents(r.sale.total_cents)}`,
    ...r.payments.map(
      (p: Row) =>
        `${methodNames[p.method]}: recebido ${formatCents(p.tendered_cents)} · referência ${p.reference || "—"}`,
    ),
    `Troco: ${formatCents(r.sale.change_cents)}`,
    ...(r.credit
      ? [
          `Crediário: ${r.credit.code} · Situação: ${r.credit.status}`,
          `Principal financiado: ${formatCents(r.credit.simulation.principal_cents)} · Juros previstos: ${formatCents(r.credit.simulation.interest_cents)}`,
          ...r.credit.simulation.lines.map(
            (l: Row) =>
              `Parcela ${l.number} · ${l.due_on} · ${formatCents(l.amount_cents)}`,
          ),
          "Condições e revisões constam no contrato. Este comprovante não declara quitação das parcelas.",
        ]
      : []),
    ...r.returns.map(
      (x: Row) =>
        `${x.kind === "cancel" ? "Cancelamento" : "Devolução"} ${when(x.created_at)}: ${formatCents(x.total_cents)} · ${x.reason}`,
    ),
    "",
    "Pagamentos Pix/cartão registrados manualmente. Este comprovante não substitui documento fiscal.",
  ].join("\n");
}
export function whatsappPhone(input: string): string {
  const raw = input.trim();
  if (/[^0-9+\s().-]/.test(raw))
    throw Error("Informe um telefone válido com DDD ou código internacional.");
  let phone = raw.replace(/\D/g, "");
  if (!raw.startsWith("+") && (phone.length === 10 || phone.length === 11))
    phone = "55" + phone;
  if (!/^[1-9]\d{10,14}$/.test(phone))
    throw Error("Informe um telefone válido com DDD ou código internacional.");
  return phone;
}
export function receiptWhatsAppUrl(phone: string, text: string): string {
  const url = new URL("https://wa.me/" + whatsappPhone(phone));
  url.searchParams.set("text", text);
  return url.toString();
}

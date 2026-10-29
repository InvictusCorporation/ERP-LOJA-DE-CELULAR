"use client";
import { Download, Printer, X } from "lucide-react";
import { createPortal } from "react-dom";
import { formatCents } from "../shared/money";
import "./credit.css";
type Row = Record<string, any>;
const day = (s: string) =>
  s ? s.slice(0, 10).split("-").reverse().join("/") : "—";
export default function CreditDocument({
  data,
  onClose,
}: {
  data: Row;
  onClose: () => void;
}) {
  const c = data.contract,
    original = data.plans[0]?.simulation,
    current = data.plans[data.plans.length - 1],
    p = current?.policy || c.policy;
  const method =
    "Juros simples por principal de cada parcela, dias corridos e base de 30 dias. Parcelas mensais com principal distribuído em centavos; os valores podem variar. A antecipação reduz juros do prazo não decorrido. Encargos vencidos são pagos antes do principal, sem capitalização; a mora incide somente sobre principal não pago.";
  const text = [
    data.kind === "offer"
      ? "OFERTA DE VENDA A PRAZO"
      : "INSTRUMENTO DE VENDA A PRAZO",
    c.code,
    "Situação: " + c.status,
    data.kind === "offer"
      ? "Oferta válida até " + day(c.valid_until)
      : "Venda: " + c.receipt_code,
    `${p.legal_name} · CNPJ ${p.cnpj}`,
    p.address,
    `${p.email} · ${p.phone}`,
    `Comprador: ${c.borrower.name} · CPF ${c.borrower.cpf}`,
    c.borrower.address,
    `${c.borrower.phone} · ${c.borrower.email || ""}`,
    `Preço sem financiamento: ${formatCents(c.total_cents || original.purchase_cents)}`,
    `Entrada original: ${formatCents(original.down_cents)}`,
    method,
    ...(data.items || []).map(
      (x: Row) =>
        `${x.quantity}x ${x.product_name} · ${x.identifiers || x.sku} · ${formatCents(x.net_cents)}`,
    ),
    ...data.plans.flatMap((plan: Row) => {
      const s = plan.simulation;
      return [
        `REVISÃO ${plan.revision}`,
        `Principal: ${formatCents(s.principal_cents)} · Juros: ${formatCents(s.interest_cents)}`,
        `Total das parcelas: ${formatCents(s.installment_total_cents)} · Total com entrada: ${formatCents(s.total_cents)}`,
        `Juros simples contratados: ${(s.monthly_bps / 100).toFixed(2)}% ao mês · Taxa efetiva mensal do cronograma: ${s.effective_monthly_percent.toFixed(4)}% · CET anual: ${s.annual_percent.toFixed(4)}%`,
        `Multa única: ${(plan.policy.late_fee_bps / 100).toFixed(2)}% · Mora simples: ${(plan.policy.late_monthly_bps / 100).toFixed(2)}% ao mês`,
        ...s.lines.map(
          (l: Row) =>
            `${l.number}: ${day(l.due_on)} · Principal ${formatCents(l.principal_cents)} · Juros ${formatCents(l.interest_cents)} · Total ${formatCents(l.amount_cents)}`,
        ),
        plan.reason,
        `Aceitação manual: ${plan.acceptance_reference}`,
        plan.policy.terms,
      ];
    }),
    "Sem tarifas ou seguros adicionais cadastrados nesta modalidade. CET calculado pelos fluxos datados; encargos de atraso não integram o custo previsto para pagamentos pontuais.",
    "Registro de aceitação manual. Assinaturas e entrega da cópia são conferidas pela loja. Este instrumento não comprova quitação.",
    "Assinatura do comprador: ________________________",
    "Assinatura do fornecedor: ________________________",
  ]
    .filter(Boolean)
    .join("\n\n");
  const download = () => {
    const url = URL.createObjectURL(
      new Blob([text], { type: "text/plain;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = c.code + ".txt";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return createPortal(
    <div className="modal-backdrop">
      <section
        className="modal credit-document-modal"
        role="dialog"
        aria-modal="true"
        aria-label={
          data.kind === "offer"
            ? "Documento da oferta"
            : "Documento do contrato"
        }
      >
        <header className="modal-header no-print">
          <h2>
            {data.kind === "offer"
              ? "Oferta para o cliente"
              : "Contrato e revisões"}
          </h2>
          <button
            className="icon-button"
            aria-label="Fechar documento do crediário"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </header>
        <article className="credit-document">
          <header>
            <span>INVICTUS ERP MOBILE</span>
            <h1>
              {data.kind === "offer"
                ? "Oferta de venda a prazo"
                : "Instrumento de venda a prazo"}
            </h1>
            <code>{c.code}</code>
            <p>
              {p.legal_name} · CNPJ {p.cnpj}
            </p>
            <p>{p.address}</p>
            <p>
              {p.email} · {p.phone}
            </p>
          </header>
          <section>
            <h2>Comprador e operação</h2>
            <p>
              <strong>{c.borrower.name}</strong> · CPF {c.borrower.cpf}
            </p>
            <p>{c.borrower.address}</p>
            <p>
              {c.borrower.phone} · {c.borrower.email}
            </p>
            <p>
              Situação:{" "}
              {c.status === "cancelled"
                ? "Cancelado"
                : data.kind === "offer"
                  ? c.status === "used"
                    ? "Oferta utilizada"
                    : "Oferta aprovada"
                  : "Contrato registrado"}{" "}
              {data.kind === "offer"
                ? "· Válida até " + day(c.valid_until)
                : "· Venda " + c.receipt_code}
            </p>
            <p>
              Preço sem financiamento:{" "}
              <strong>
                {formatCents(c.total_cents || original.purchase_cents)}
              </strong>{" "}
              · Entrada original:{" "}
              <strong>{formatCents(original.down_cents)}</strong>
            </p>
            {data.items?.map((x: Row, i: number) => (
              <p key={i}>
                {x.quantity}x {x.product_name} · {x.identifiers || x.sku} ·{" "}
                {formatCents(x.net_cents)}
              </p>
            ))}
          </section>
          <section>
            <h2>Critérios e transparência</h2>
            <p>{method}</p>
            <p>
              Sem tarifas ou seguros adicionais cadastrados nesta modalidade.
              CET calculado pelos fluxos datados. Encargos de atraso não
              integram o custo previsto para pagamentos pontuais.
            </p>
          </section>
          {data.plans.map((plan: Row, index: number) => {
            const s = plan.simulation;
            return (
              <section key={index}>
                <h2>
                  {data.kind === "offer"
                    ? "Condições da oferta"
                    : "Revisão " +
                      plan.revision +
                      (index === data.plans.length - 1
                        ? " · Plano vigente"
                        : " · Histórico preservado")}
                </h2>
                <p>
                  Principal financiado:{" "}
                  <strong>{formatCents(s.principal_cents)}</strong> · Juros
                  totais: <strong>{formatCents(s.interest_cents)}</strong>
                </p>
                <p>
                  Soma das parcelas:{" "}
                  <strong>{formatCents(s.installment_total_cents)}</strong> ·
                  Total com entrada desta revisão:{" "}
                  <strong>{formatCents(s.total_cents)}</strong>
                </p>
                <p>
                  Juros simples contratados: {(s.monthly_bps / 100).toFixed(2)}%
                  a.m. · Taxa efetiva mensal do cronograma:{" "}
                  {s.effective_monthly_percent.toFixed(4)}% · CET anual:{" "}
                  {s.annual_percent.toFixed(4)}%
                </p>
                <p>
                  Multa única após vencimento:{" "}
                  {(plan.policy.late_fee_bps / 100).toFixed(2)}% · Mora simples:{" "}
                  {(plan.policy.late_monthly_bps / 100).toFixed(2)}% a.m.
                </p>
                <table>
                  <thead>
                    <tr>
                      <th>Parcela</th>
                      <th>Vencimento</th>
                      <th>Principal</th>
                      <th>Juros</th>
                      <th>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.lines.map((l: Row) => (
                      <tr key={l.number}>
                        <td>{l.number}</td>
                        <td>{day(l.due_on)}</td>
                        <td>{formatCents(l.principal_cents)}</td>
                        <td>{formatCents(l.interest_cents)}</td>
                        <td>{formatCents(l.amount_cents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p>{plan.reason}</p>
                <p>
                  Referência de aceitação manual: {plan.acceptance_reference}
                </p>
                <div className="credit-terms">{plan.policy.terms}</div>
              </section>
            );
          })}
          <footer>
            <p>
              Registro manual: confira assinaturas e entrega da cópia. Este
              instrumento descreve as condições e não comprova quitação.
            </p>
            <p>Comprador: _____________________________________</p>
            <p>Fornecedor: _____________________________________</p>
          </footer>
        </article>
        <footer className="modal-footer no-print">
          <button className="btn secondary" onClick={download}>
            <Download size={16} />
            Baixar documento
          </button>
          <button className="btn primary" onClick={() => window.print()}>
            <Printer size={16} />
            Imprimir documento
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

"use client";
import {
  useEffect,
  useState,
  useId,
  cloneElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Download, Printer, RefreshCw, X } from "lucide-react";
import { formatCents } from "../shared/money";
import "./credit.css";
import "./reports.css";
type Row = Record<string, any>;
type Column = [string, string, ("money" | "percent" | "number" | "text")?];
const tabs: Record<string, string> = {
  overview: "Visão consolidada",
  products: "Produtos vendidos",
  stagnant: "Produtos parados",
  sellers: "Vendedores",
  technicians: "Técnicos",
  services: "Serviços realizados",
  credit: "Inadimplência",
};
const columns: Record<string, Column[]> = {
  products: [
    ["name", "Produto"],
    ["sku", "SKU"],
    ["sold", "Vendidos", "number"],
    ["returned", "Devolvidos", "number"],
    ["quantity", "Qtd. líquida", "number"],
    ["revenue", "Receita líquida", "money"],
    ["cost", "Custo líquido", "money"],
    ["profit", "Lucro bruto", "money"],
    ["margin", "Margem bruta", "percent"],
  ],
  stagnant: [
    ["name", "Produto"],
    ["sku", "SKU"],
    ["branch", "Filial"],
    ["quantity", "Saldo", "number"],
    ["last_sale", "Última venda líquida"],
    ["last_entry", "Última entrada"],
    ["idle_days", "Dias sem atividade", "number"],
    ["cost", "Custo estimado", "money"],
  ],
  sellers: [
    ["name", "Vendedor"],
    ["registered", "Vendas registradas", "number"],
    ["kept", "Vendas mantidas", "number"],
    ["gross", "Vendas no período", "money"],
    ["returned", "Devoluções no período", "money"],
    ["revenue", "Receita líquida", "money"],
    ["profit", "Lucro bruto", "money"],
    ["margin", "Margem bruta", "percent"],
    ["ticket", "Ticket das vendas", "money"],
  ],
  technicians: [
    ["name", "Responsável atual"],
    ["completed", "Concluídas no período", "number"],
    ["delivered", "Entregues no período", "number"],
    ["elapsed_days", "Dias corridos até conclusão", "number"],
    ["backlog", "Em aberto agora", "number"],
    ["overdue", "Em execução atrasadas agora", "number"],
  ],
  services: [
    ["code", "OS"],
    ["device", "Equipamento"],
    ["branch", "Filial"],
    ["technician", "Técnico"],
    ["delivered_on", "Entrega"],
    ["revenue", "Receita", "money"],
    ["cost", "Custo", "money"],
    ["profit", "Lucro bruto", "money"],
    ["margin", "Margem bruta", "percent"],
  ],
  credit: [
    ["name", "Filial"],
    ["installments", "Parcelas abertas", "number"],
    ["open", "Saldo nominal aberto", "money"],
    ["overdue", "Saldo vencido", "money"],
    ["delinquency", "Inadimplência", "percent"],
    ["age_30", "1–30 dias", "money"],
    ["age_60", "31–60 dias", "money"],
    ["age_90", "61–90 dias", "money"],
    ["age_over_90", "Mais de 90 dias", "money"],
  ],
  branches: [
    ["name", "Filial"],
    ["turnover", "Faturamento líquido", "money"],
    ["operating_gross", "Lucro bruto operacional", "money"],
    ["operating_margin", "Margem operacional", "percent"],
    ["result", "Resultado DRE", "money"],
    ["kept", "Vendas mantidas", "number"],
    ["ticket", "Ticket das vendas", "money"],
  ],
  series: [
    ["day", "Período"],
    ["sales", "Vendas", "money"],
    ["returns", "Devoluções", "money"],
    ["services", "Serviços", "money"],
    ["turnover", "Faturamento líquido", "money"],
    ["operating_gross", "Lucro bruto operacional", "money"],
    ["result", "Resultado DRE", "money"],
  ],
};
const notes: Record<string, string> = {
  overview:
    "Faturamento líquido = vendas − devoluções + serviços entregues. DRE inclui também receitas manuais, receitas do crediário e despesas por competência. O recebimento de uma venda não soma receita novamente. Custos refletem os valores registrados na operação.",
  products:
    "Movimentos pela data da venda ou devolução. Uma devolução de venda antiga pode tornar o saldo do período negativo. Custos históricos da venda; lucro bruto sem rateio de despesas. Não inclui peças usadas em reparos.",
  stagnant:
    "Posição atual. Produtos com saldo positivo sem venda líquida ou entrada há pelo menos o prazo escolhido. Reposição ou devolução reinicia o prazo do produto na filial. Não representa a idade individual de cada unidade. Custo estimado: cadastro para quantidade e aquisição para unidades individuais.",
  sellers:
    "Devoluções atribuídas ao vendedor original. Ticket = saldo mantido das vendas criadas no período ÷ quantidade dessas vendas com saldo positivo, considerando todas as devoluções conhecidas hoje. Vendas integralmente devolvidas ficam fora do ticket. Receita líquida usa os movimentos do período.",
  technicians:
    "Conclusões pela última data de pronto; entregas pelo dia da entrega com reparo realizado. Responsável atual da OS. Tempo em dias corridos desde a abertura, incluindo espera; não mede horas trabalhadas. Abertas e atrasadas são posições atuais. Atrasos excluem prontas, recusadas e canceladas.",
  services:
    "Reparos entregues com resultado pronto no período. Receita e custo incluem mão de obra e peças efetivamente consumidas, descontadas as devoluções. Recusas e cancelamentos não geram receita de serviço.",
  credit:
    "Posição atual dos planos vigentes de contratos ativos, após baixas, descontos e estornos. Vencida: parcela com vencimento anterior a hoje. Percentual = saldo nominal vencido ÷ saldo nominal aberto. Não inclui encargos de atraso ainda não lançados; consulte o Crediário para quitação.",
};
const ticketNote =
  "Ticket das vendas: saldo mantido das vendas criadas no período, após todas as devoluções conhecidas hoje, dividido pelas vendas com saldo positivo. Pode diferir do faturamento líquido do período.";
const now = () =>
  new Date().toLocaleDateString("sv-SE", { timeZone: "America/Fortaleza" });
function Field({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {cloneElement(children as ReactElement<any>, { id })}
    </div>
  );
}
function cell(v: any, type?: string) {
  if (v === null || v === undefined) return "—";
  if (type === "money") return formatCents(v);
  if (type === "percent")
    return (
      Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 2 }) + "%"
    );
  if (type === "number")
    return Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
  return String(v);
}
function Table({ items, cols }: { items: Row[]; cols: Column[] }) {
  return (
    <div className="report-table">
      <table>
        <thead>
          <tr>
            {cols.map(([key, label]) => (
              <th key={key}>{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((r, index) => (
            <tr
              key={String(r.id || r.day || index) + String(r.branch_id || "")}
            >
              {cols.map(([key, , type]) => (
                <td key={key}>{cell(r[key], type)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!items.length && (
        <p className="report-empty">
          Nenhum registro encontrado para estes filtros.
        </p>
      )}
    </div>
  );
}
function exportCsv(rows: any[][], name: string) {
  const encode = (v: any) =>
    '"' +
    (typeof v === "string" &&
    !/^-?\d+(\.\d+)?$/.test(v) &&
    /^[=+@\-\t\r\n]/.test(v.trimStart())
      ? "'"
      : "") +
    String(v ?? "").replace(/"/g, '""') +
    '"';
  const url = URL.createObjectURL(
    new Blob(
      ["\uFEFF" + rows.map((r) => r.map(encode).join(";")).join("\r\n")],
      { type: "text/csv;charset=utf-8" },
    ),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function ReportsPanel({
  branch,
  branches,
  companyName,
}: {
  branch: string;
  branches: Row[];
  companyName: string;
}) {
  const [tab, setTab] = useState("overview"),
    [scope, setScope] = useState(branch),
    [start, setStart] = useState(now().slice(0, 7) + "-01"),
    [end, setEnd] = useState(now()),
    [q, setQ] = useState(""),
    [days, setDays] = useState("30"),
    [sort, setSort] = useState("quantity");
  const [applied, setApplied] = useState({
      branch_id: branch,
      start,
      end,
      q: "",
      days: "30",
      sort: "quantity",
    }),
    [page, setPage] = useState(1),
    [reload, setReload] = useState(0),
    [response, setResponse] = useState<{
      key: string;
      data?: Row;
      error?: string;
    } | null>(null),
    [monthly, setMonthly] = useState(false),
    [print, setPrint] = useState(false);
  const queryKey = JSON.stringify([tab, applied, page, reload]);
  const data = response?.key === queryKey ? response.data : null;
  const error = response?.key === queryKey ? response.error : "";
  const loading = response?.key !== queryKey;
  const current = tab === "stagnant" || tab === "credit";
  useEffect(() => {
    let alive = true;
    const query = new URLSearchParams({ ...applied, page: String(page) });
    fetch("/api/reports/" + tab + "?" + query, { cache: "no-store" })
      .then(async (r) => {
        const b = await r.json();
        if (!r.ok) throw Error(b.error || "Não foi possível consultar.");
        if (alive) setResponse({ key: queryKey, data: b });
      })
      .catch((e) => {
        if (alive) setResponse({ key: queryKey, error: e.message });
      });
    return () => {
      alive = false;
    };
  }, [queryKey]);
  const title = tabs[tab],
    scopeName =
      applied.branch_id === "all"
        ? "Todas as filiais autorizadas"
        : branches.find((b) => b.id === applied.branch_id)?.name || "Filial";
  const period = current
    ? "Posição atual em " + (data?.position_on || now())
    : applied.start + " a " + applied.end;
  const series = data?.[monthly ? "monthly" : "daily"] || [],
    cols = columns[tab] || [],
    items = data?.items || [];
  const content = data && (
    <>
      <p className="report-note">{notes[tab]}</p>
      {tab === "overview" ? (
        <>
          <div className="report-cards">
            {[
              ["Faturamento líquido", data.summary.turnover, "money"],
              [
                "Lucro bruto operacional",
                data.summary.operating_gross,
                "money",
              ],
              ["Margem operacional", data.summary.operating_margin, "percent"],
              ["Resultado DRE", data.summary.result, "money"],
              ["Vendas mantidas", data.summary.kept, "number"],
              ["Ticket das vendas", data.summary.ticket, "money"],
            ].map(([label, value, type]) => (
              <article key={String(label)}>
                <span>{label}</span>
                <strong>{cell(value, String(type))}</strong>
              </article>
            ))}
          </div>
          <p className="report-note">{ticketNote}</p>
          <section>
            <div className="report-heading">
              <h2>Faturamento {monthly ? "mensal" : "diário"}</h2>
              <label className="report-switch">
                <input
                  type="checkbox"
                  checked={monthly}
                  onChange={(e) => setMonthly(e.target.checked)}
                />
                Agrupar por mês
              </label>
            </div>
            <div
              className="report-chart"
              style={{ gap: series.length > 60 ? 0 : 3 }}
              role="img"
              aria-label={
                "Faturamento líquido " +
                (monthly ? "mensal" : "diário") +
                ". Valores detalhados na tabela abaixo."
              }
            >
              {series.map((r: Row) => {
                const max = Math.max(
                  1,
                  ...series.map((s: Row) => Math.abs(s.turnover)),
                );
                return (
                  <div
                    key={r.day}
                    title={r.day + ": " + formatCents(r.turnover)}
                    className={r.turnover < 0 ? "negative" : ""}
                    style={{
                      height:
                        Math.max(2, (Math.abs(r.turnover) / max) * 145) + "px",
                    }}
                  />
                );
              })}
            </div>
            <Table items={series} cols={columns.series} />
          </section>
          <section>
            <h2>Comparativo de filiais</h2>
            <Table items={data.branches} cols={columns.branches} />
          </section>
        </>
      ) : (
        <>
          {tab === "credit" && (
            <>
              <h3>Consolidado de todas as filiais selecionadas</h3>
              <Table
                items={[{ ...data.summary, name: "Consolidado" }]}
                cols={columns.credit}
              />
              <h3>Detalhamento por filial</h3>
            </>
          )}
          <Table items={items} cols={cols} />
          <p className="report-note">
            Página {page} · {data.total} registros · até 30 por página.
            Exportação e impressão incluem somente esta página.
          </p>
        </>
      )}
    </>
  );
  function csv() {
    if (!data || loading) return;
    const rows: any[][] = [
      [companyName],
      [title],
      [scopeName],
      [period],
      ["Gerado em", data.generated_at],
      [notes[tab]],
    ];
    const add = (label: string, list: Row[], c: Column[]) => {
      rows.push(
        [label],
        c.map((x) => x[1]),
      );
      for (const r of list)
        rows.push(
          c.map(([k, , t]) =>
            t === "money" && r[k] != null
              ? (Number(r[k]) / 100).toFixed(2)
              : (r[k] ?? ""),
          ),
        );
    };
    if (tab === "overview") {
      rows.push([ticketNote]);
      add(
        "Resumo",
        [{ ...data.summary, name: "Consolidado" }],
        columns.branches,
      );
      add(monthly ? "Mensal" : "Diário", series, columns.series);
      add("Filiais", data.branches, columns.branches);
    } else {
      if (tab === "credit")
        add(
          "Consolidado de todas as filiais selecionadas",
          [{ ...data.summary, name: "Consolidado" }],
          columns.credit,
        );
      rows.push(["Página", page], ["Total de registros", data.total]);
      add("Valores monetários em reais", items, cols);
    }
    exportCsv(
      rows,
      "relatorios-" +
        tab +
        (tab === "overview" ? "" : "-pagina-" + page) +
        ".csv",
    );
  }
  return (
    <div className="reports-panel">
      <div
        className="report-tabs"
        role="tablist"
        aria-label="Tipos de relatório"
      >
        {Object.entries(tabs).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => {
              setTab(key);
              setPage(1);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <form
        className="report-filters"
        onSubmit={(e) => {
          e.preventDefault();
          setApplied({ branch_id: scope, start, end, q, days, sort });
          setPage(1);
          setReload((v) => v + 1);
        }}
      >
        <Field label="Filiais do relatório">
          <select value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="all">Todas as autorizadas</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </Field>
        {!current && (
          <>
            <Field label="Data inicial">
              <input
                required
                type="date"
                min="2000-01-01"
                max={now()}
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </Field>
            <Field label="Data final">
              <input
                required
                type="date"
                min={start}
                max={now()}
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </Field>
          </>
        )}
        {tab === "stagnant" && (
          <Field label="Sem atividade há (dias)">
            <input
              type="number"
              min="1"
              max="730"
              required
              value={days}
              onChange={(e) => setDays(e.target.value)}
            />
          </Field>
        )}
        {["products", "services", "stagnant"].includes(tab) && (
          <Field label="Buscar no relatório">
            <input
              maxLength={100}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Nome, SKU ou OS"
            />
          </Field>
        )}
        {tab === "products" && (
          <Field label="Ordenar produtos">
            <select value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="quantity">Quantidade líquida</option>
              <option value="revenue">Receita líquida</option>
              <option value="profit">Lucro bruto</option>
            </select>
          </Field>
        )}
        <button className="btn primary" type="submit">
          Aplicar filtros
        </button>
      </form>
      <div className="report-heading">
        <div>
          <h2>{title}</h2>
          <p>
            {scopeName} · {period}
          </p>
          {data && (
            <small>
              Consulta em{" "}
              {new Date(data.generated_at).toLocaleString("pt-BR", {
                timeZone: "America/Fortaleza",
              })}{" "}
              · horário de Fortaleza
            </small>
          )}
        </div>
        <div className="report-actions">
          <button
            className="btn"
            disabled={loading}
            onClick={() => setReload((v) => v + 1)}
          >
            <RefreshCw size={16} />
            Atualizar
          </button>
          <button className="btn" disabled={!data || loading} onClick={csv}>
            <Download size={16} />
            Exportar CSV
          </button>
          <button
            className="btn"
            disabled={!data || loading}
            onClick={() => setPrint(true)}
          >
            <Printer size={16} />
            Imprimir
          </button>
        </div>
      </div>
      {loading ? (
        <p role="status">Consultando os registros…</p>
      ) : error ? (
        <div role="alert" className="report-error">
          <p>{error}</p>
          <button className="btn" onClick={() => setReload((v) => v + 1)}>
            Tentar novamente
          </button>
        </div>
      ) : (
        content
      )}
      {data && tab !== "overview" && !loading && (
        <div className="report-pagination">
          <button
            className="btn"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Anterior
          </button>
          <span>
            Página {page} de {Math.max(1, Math.ceil(data.total / 30))}
          </span>
          <button
            className="btn"
            disabled={page * 30 >= data.total}
            onClick={() => setPage((p) => p + 1)}
          >
            Próxima
          </button>
        </div>
      )}
      {print &&
        data &&
        createPortal(
          <div
            className="modal-backdrop report-print-backdrop"
            role="dialog"
            aria-modal="true"
            aria-label="Impressão do relatório"
          >
            <div className="modal credit-document-modal report-document">
              <div className="document-actions no-print">
                <button className="btn primary" onClick={() => window.print()}>
                  <Printer size={16} />
                  Imprimir documento
                </button>
                <button
                  className="btn"
                  autoFocus
                  onClick={() => setPrint(false)}
                >
                  <X size={16} />
                  Fechar
                </button>
              </div>
              <article className="credit-document">
                <h1>{companyName}</h1>
                <h2>{title}</h2>
                <p>
                  {scopeName} · {period}
                </p>
                <p>
                  Gerado em{" "}
                  {new Date(data.generated_at).toLocaleString("pt-BR", {
                    timeZone: "America/Fortaleza",
                  })}
                </p>
                {content}
              </article>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

"use client";
import {
  useState,
  useEffect,
  useId,
  useRef,
  cloneElement,
  type ReactElement,
  type ReactNode,
  type FormEvent,
} from "react";
import {
  Plus,
  X,
  Wallet,
  ArrowDownLeft,
  ArrowUpRight,
  ChartNoAxesCombined,
  Download,
  RefreshCw,
  Check,
  History,
} from "lucide-react";
import { formatCents, toCents } from "../shared/money";
import "./crm.css";
import "./finance.css";
type Row = Record<string, any>;
type Props = {
  branch: string;
  branches: Row[];
  mutate: (path: string, body: unknown, method?: string) => Promise<any>;
  onNotice: (text: string, error?: boolean) => void;
};
const money = (n: unknown) => formatCents(Number(n || 0));
const decimal = (n: unknown) => (Number(n || 0) / 100).toFixed(2);
const signedMoney = (s: string) =>
  s.trim().startsWith("-") ? -toCents(s.trim().slice(1)) : toCents(s);
const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Fortaleza",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const day = (s: string) =>
  s ? s.slice(0, 10).split("-").reverse().join("/") : "—";
const when = (s: string) =>
  new Date(s).toLocaleString("pt-BR", { timeZone: "America/Fortaleza" });
const sourceNames: Row = {
  pos_payment: "Recebimento do PDV",
  pos_refund: "Devolução do PDV",
  settlement: "Baixa de título",
  settlement_reversal: "Estorno de baixa",
  opening: "Saldo inicial",
  transfer: "Transferência",
  adjustment: "Ajuste patrimonial",
};
const methods: Row = {
  cash: "Dinheiro",
  pix: "Pix",
  debit: "Débito",
  credit: "Crédito",
};
const eventNames: Row = {
  title_created: "Título lançado",
  title_updated: "Título atualizado",
  title_cancelled: "Título cancelado",
  opening_reviewed: "Saldo anterior conferido",
  settled: "Baixa registrada",
  settlement_reversed: "Baixa estornada",
  reconciled: "Conciliado",
  reconciliation_undone: "Conciliação desfeita",
  adjusted: "Saldo ajustado",
};
const dreLines: Row = {
  sales: "Vendas do PDV",
  returns: "Devoluções de vendas",
  services: "Serviços entregues",
  manual_income: "Outras receitas",
  credit_income: "Juros e encargos do crediário",
  revenue: "Receita líquida gerencial",
  goods_cost: "Custo das mercadorias",
  service_cost: "Custo dos serviços",
  gross: "Resultado bruto",
  expenses: "Despesas por competência",
  result: "Resultado gerencial",
};
async function get(path: string) {
  const r = await fetch("/api" + path, { cache: "no-store" });
  const b = await r.json();
  if (!r.ok) throw Error(b.error || "Falha ao consultar o financeiro.");
  return b;
}
function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {cloneElement(children as ReactElement<any>, { id })}
      {hint && <small>{hint}</small>}
    </div>
  );
}
function download(name: string, rows: (string | number)[][]) {
  const csv =
    "\uFEFF" +
    rows
      .map((row) =>
        row
          .map((v) => {
            if (typeof v === "number") return String(v);
            const safe = /^[=+\-@\t\r]/.test(v) ? "'" + v : v;
            return '"' + safe.replaceAll('"', '""') + '"';
          })
          .join(";"),
      )
      .join("\r\n");
  const url = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function FinancePanel({
  branch,
  branches,
  mutate,
  onNotice,
}: Props) {
  const now = today(),
    monthEnd = new Date(
      Date.UTC(Number(now.slice(0, 4)), Number(now.slice(5, 7)), 0),
    )
      .toISOString()
      .slice(0, 10);
  const [tab, setTab] = useState("dashboard"),
    [scope, setScope] = useState(branch),
    [start, setStart] = useState(now.slice(0, 7) + "-01"),
    [end, setEnd] = useState(monthEnd),
    [status, setStatus] = useState("all"),
    [page, setPage] = useState(1),
    [query, setQuery] = useState(""),
    [config, setConfig] = useState<Row>({ accounts: [], centers: [] }),
    [report, setReport] = useState<Row>({}),
    [rows, setRows] = useState<Row[]>([]),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(false),
    [revision, setRevision] = useState(0),
    [dialog, setDialog] = useState(""),
    [editing, setEditing] = useState<Row | null>(null),
    [detail, setDetail] = useState<Row | null>(null),
    [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const params = `branch_id=${scope}&start=${start}&end=${end}`;
  useEffect(() => {
    let alive = true;
    setLoading(true);
    const timer = setTimeout(async () => {
      if (!start || !end) {
        setReport({});
        setRows([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(false);
      try {
        const jobs = [
          get("/finance/config?branch_id=all"),
          get("/finance/reports?" + params),
        ];
        if (tab === "entries")
          jobs.push(
            get(`/finance/entries?${params}&status=${status}&page=${page}`),
          );
        if (["payable", "receivable"].includes(tab))
          jobs.push(
            get(
              `/finance/titles?${params}&direction=${tab}&status=${status}&page=${page}&q=${encodeURIComponent(query)}`,
            ),
          );
        const [c, r, list] = await Promise.all(jobs);
        if (alive) {
          setConfig(c);
          setReport(r);
          setRows(list?.items || []);
        }
      } catch (e: any) {
        if (alive) {
          onNotice(e.message, true);
          setError(true);
          setReport({});
          setRows([]);
        }
      } finally {
        if (alive) setLoading(false);
      }
    }, 200);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [params, tab, status, page, query, revision, start, end, onNotice]);
  const accounts: Row[] = config.accounts || [],
    centers: Row[] = config.centers || [];
  const scopedAccounts = accounts.filter(
    (a) => scope === "all" || a.branch_id === scope,
  );
  function navigate(v: string) {
    setTab(v);
    setStatus("all");
    setPage(1);
    setQuery("");
    setRows([]);
  }
  function open(type: string, row: Row | null = null) {
    setEditing(row);
    setDialog(type);
  }
  async function showTitle(id: string) {
    if (busyRef.current) return;
    try {
      const d = await get("/finance/titles/" + id);
      setDetail(d);
      setEditing(d.title);
      setDialog("title-detail");
    } catch (e: any) {
      onNotice(e.message, true);
    }
  }
  async function showEntry(id: string) {
    try {
      const d = await get("/finance/entries/" + id);
      setDetail(d);
      setEditing(d.entry);
      setDialog("entry-detail");
    } catch (e: any) {
      onNotice(e.message, true);
    }
  }
  const dateField = (
    name: string,
    label: string,
    value = now,
    actual = false,
  ) => (
    <Field label={label}>
      <input
        name={name}
        type="date"
        min="2000-01-01"
        max={actual ? now : "2199-12-31"}
        required
        defaultValue={value}
      />
    </Field>
  );
  const amountField = (
    name = "amount",
    label = "Valor (R$)",
    value = 0,
    negative = false,
  ) => (
    <Field label={label}>
      <input
        name={name}
        type="number"
        step="0.01"
        min={negative ? "-10000000" : "0.01"}
        max="10000000"
        defaultValue={decimal(value)}
        required
      />
    </Field>
  );
  const accountField = (
    name = "account_id",
    label = "Conta financeira",
    value?: string,
    ownBranch?: string,
  ) => (
    <Field label={label}>
      <select name={name} defaultValue={value || ""} required>
        <option value="">Selecione</option>
        {accounts
          .filter((a) => a.active && (!ownBranch || a.branch_id === ownBranch))
          .map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} · {a.branch_name} · {money(a.balance_cents)}
            </option>
          ))}
      </select>
    </Field>
  );
  const reasonField = (label = "Justificativa") => (
    <Field label={label}>
      <textarea
        name="reason"
        rows={3}
        minLength={3}
        maxLength={1000}
        required
      />
    </Field>
  );
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    const fd = new FormData(e.currentTarget),
      v = (n: string) => String(fd.get(n) || "");
    try {
      if (dialog === "account") {
        if (editing)
          await mutate(`/finance/accounts/${editing.id}`, {
            version: editing.version,
            name: v("name"),
            active: fd.has("active"),
          });
        else
          await mutate("/finance/accounts", {
            branch_id: v("branch_id"),
            name: v("name"),
            kind: v("kind"),
            opening_cents: signedMoney(v("opening")),
            opening_on: v("opening_on"),
          });
      }
      if (dialog === "center")
        await mutate(
          editing ? `/finance/centers/${editing.id}` : "/finance/centers",
          editing
            ? {
                version: editing.version,
                name: v("name"),
                active: fd.has("active"),
              }
            : { name: v("name") },
        );
      if (dialog === "title") {
        const body = {
          direction: v("direction") || editing?.direction || tab,
          description: v("description"),
          counterparty: v("counterparty"),
          amount_cents: toCents(v("amount")),
          competence_on: v("competence_on"),
          due_on: v("due_on"),
          center_id: v("center_id") || null,
          affects_result:
            editing?.source_kind === "repair"
              ? editing.affects_result
              : v("affects_result") !== "no",
        };
        await mutate(
          editing ? `/finance/titles/${editing.id}` : "/finance/titles",
          editing
            ? { ...body, version: editing.version }
            : { ...body, branch_id: v("branch_id") },
        );
      }
      if (dialog === "review")
        await mutate(`/finance/titles/${editing!.id}/review`, {
          version: editing!.version,
          remaining_cents: toCents(v("amount")),
          reference: v("reference"),
        });
      if (dialog === "settle")
        await mutate(`/finance/titles/${editing!.id}/settle`, {
          version: editing!.version,
          account_id: v("account_id"),
          amount_cents: toCents(v("amount")),
          posted_on: v("posted_on"),
          reference: v("reference"),
        });
      if (dialog === "cancel")
        await mutate(`/finance/titles/${editing!.id}/cancel`, {
          version: editing!.version,
          reason: v("reason"),
        });
      if (dialog === "reverse")
        await mutate(`/finance/settlements/${editing!.id}/reverse`, {
          version: detail!.title.version,
          posted_on: v("posted_on"),
          reason: v("reason"),
        });
      if (dialog === "transfer")
        await mutate("/finance/transfers", {
          from_id: v("from_id"),
          to_id: v("to_id"),
          amount_cents: toCents(v("amount")),
          posted_on: v("posted_on"),
          reason: v("reason"),
        });
      if (dialog === "adjust")
        await mutate(`/finance/accounts/${editing!.id}/adjust`, {
          amount_cents: signedMoney(v("amount")),
          posted_on: v("posted_on"),
          reason: v("reason"),
        });
      if (dialog === "reconcile")
        await mutate(`/finance/entries/${editing!.id}/reconcile`, {
          account_id: v("account_id"),
          statement_on: v("statement_on"),
          reference: v("reference"),
          confirmed_amount_cents: signedMoney(v("amount")),
          confirmed: fd.has("confirmed"),
        });
      if (dialog === "undo")
        await mutate(
          `/finance/reconciliations/${editing!.reconciliation_id}/undo`,
          { reason: v("reason") },
        );
      setDialog("");
      setRevision((r) => r + 1);
      onNotice("Operação financeira registrada.");
    } catch (e: any) {
      onNotice(e.message, true);
    } finally {
      setBusy(false);
      busyRef.current = false;
    }
  }
  const pagination = (
    <div className="crm-pagination">
      <span>
        {rows[0]?.total_count || 0} registro(s) · Página {page}
      </span>
      <div>
        <button
          className="btn secondary small"
          disabled={page === 1 || loading}
          onClick={() => setPage((p) => p - 1)}
        >
          Anterior
        </button>
        <button
          className="btn secondary small"
          disabled={page * 30 >= (rows[0]?.total_count || 0) || loading}
          onClick={() => setPage((p) => p + 1)}
        >
          Próxima
        </button>
      </div>
    </div>
  );
  const titleStatus = (t: Row) =>
    t.needs_review
      ? "Saldo a conferir"
      : t.cancelled
        ? "Cancelado"
        : t.paid_cents === t.amount_cents
          ? "Liquidado"
          : t.due_on < now
            ? "Vencido"
            : t.paid_cents > 0
              ? "Parcial"
              : "Em aberto";
  function exportReport() {
    download(`financeiro-${start}-${end}.csv`, [
      ["DRE gerencial", start, end],
      ["Indicador", "Valor (R$)"],
      ...Object.entries(dreLines).map(([id, label]) => [
        String(label),
        Number(report.result?.[id] || 0) / 100,
      ]),
      [],
      [
        "Filial",
        "Receita (R$)",
        "Custos (R$)",
        "Despesas (R$)",
        "Resultado (R$)",
      ],
      ...(report.branches || []).map((b: Row) => [
        b.name,
        b.revenue / 100,
        (b.goods_cost + b.service_cost) / 100,
        b.expenses / 100,
        b.result / 100,
      ]),
      [],
      [
        "Fluxo realizado",
        "Entradas (R$)",
        "Saídas (R$)",
        "Outros (R$)",
        "Líquido (R$)",
      ],
      ...(report.cashflow || []).map((r: Row) => [
        r.day,
        Number(r.income_cents) / 100,
        Number(r.expense_cents) / 100,
        Number(r.other_cents) / 100,
        Number(r.net_cents) / 100,
      ]),
    ]);
  }
  return (
    <div className="crm-panel finance-panel" aria-busy={loading}>
      <div className="crm-tabs">
        {[
          ["dashboard", "Painel e resultados"],
          ["payable", "Contas a pagar"],
          ["receivable", "Contas a receber"],
          ["entries", "Movimentos e conciliação"],
          ["config", "Contas e centros"],
        ].map(([id, label]) => (
          <button
            key={id}
            className={tab === id ? "active" : ""}
            onClick={() => navigate(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="finance-filters">
        <Field label="Escopo financeiro">
          <select
            value={scope}
            onChange={(e) => {
              setScope(e.target.value);
              setPage(1);
            }}
          >
            <option value="all">Consolidado · filiais autorizadas</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label={
            ["payable", "receivable"].includes(tab)
              ? "Vencimentos de"
              : "Período de"
          }
        >
          <input
            type="date"
            min="2000-01-01"
            max="2199-12-31"
            value={start}
            onChange={(e) => {
              setStart(e.target.value);
              setPage(1);
            }}
          />
        </Field>
        <Field label="Até">
          <input
            type="date"
            min="2000-01-01"
            max="2199-12-31"
            value={end}
            onChange={(e) => {
              setEnd(e.target.value);
              setPage(1);
            }}
          />
        </Field>
        <button
          className="btn secondary"
          onClick={() => setRevision((r) => r + 1)}
          aria-label="Atualizar financeiro"
        >
          <RefreshCw size={17} />
        </button>
        {tab === "dashboard" && (
          <button
            className="btn secondary"
            onClick={exportReport}
            disabled={loading || !report.result}
          >
            <Download size={16} />
            Baixar relatório CSV
          </button>
        )}
      </div>
      {error && (
        <div className="info-strip">
          Não foi possível atualizar os dados. Confira as datas e tente
          novamente.
        </div>
      )}
      {report.unassigned?.count > 0 && (
        <div className="finance-classify">
          <Wallet size={19} />
          <p>
            <strong>
              {report.unassigned.count} movimento(s) do PDV aguardam conta
              financeira
            </strong>
            <span>
              Líquido a classificar: {money(report.unassigned.amount)}. Estes
              registros já constam no fluxo; entram no saldo da conta escolhida
              ao conciliar.
            </span>
          </p>
          <button
            className="btn secondary small"
            onClick={() => {
              navigate("entries");
              setStatus("unassigned");
            }}
          >
            Classificar
          </button>
        </div>
      )}
      {tab === "dashboard" && report.result && (
        <>
          <div className="finance-metrics">
            {[
              [
                "Receita por competência",
                report.result?.revenue,
                "No período selecionado",
              ],
              [
                "Resultado gerencial",
                report.result?.result,
                report.result?.margin == null
                  ? "Margem não calculável"
                  : Number(report.result.margin).toFixed(1) +
                    "% de margem gerencial",
              ],
              [
                "A receber em aberto",
                report.outstanding?.receivable,
                "Todos os vencimentos",
              ],
              [
                "A pagar em aberto",
                report.outstanding?.payable,
                "Todos os vencimentos",
              ],
            ].map(([label, value, hint]) => (
              <article className="finance-metric" key={String(label)}>
                <span>{label}</span>
                <strong>{money(value)}</strong>
                <small>{hint}</small>
              </article>
            ))}
          </div>
          <div className="finance-alerts">
            <span>
              A receber vencido:{" "}
              <strong>{money(report.outstanding?.overdue_receivable)}</strong>
            </span>
            <span>
              A pagar vencido:{" "}
              <strong>{money(report.outstanding?.overdue_payable)}</strong>
            </span>
          </div>
          <div className="finance-grid">
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h2>DRE gerencial</h2>
                  <p>
                    Competência · {day(report.start)} a {day(report.end)}
                  </p>
                </div>
                <ChartNoAxesCombined size={22} />
              </div>
              <div className="finance-dre">
                {Object.entries(dreLines).map(([id, label]) => (
                  <div
                    key={id}
                    className={
                      ["revenue", "gross", "result"].includes(id)
                        ? "subtotal"
                        : ""
                    }
                  >
                    <span>{String(label)}</span>
                    <strong>{money(report.result?.[id])}</strong>
                  </div>
                ))}
              </div>
              <p className="finance-footnote">
                Vendas e devoluções nas datas de operação; serviços na entrega;
                títulos manuais na competência. Baixar um título não reconhece a
                receita ou despesa novamente. Resultado gerencial, sem apuração
                fiscal ou demonstração contábil.
              </p>
            </section>
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h2>Resultados por filial</h2>
                  <p>Mesmo período e critérios da DRE</p>
                </div>
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Filial</th>
                      <th>Receita</th>
                      <th>Resultado</th>
                      <th>Margem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(report.branches || []).map((b: Row) => (
                      <tr key={b.id}>
                        <td>{b.name}</td>
                        <td>{money(b.revenue)}</td>
                        <td>{money(b.result)}</td>
                        <td>
                          {b.margin == null ? "—" : b.margin.toFixed(1) + "%"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="panel-heading">
                <div>
                  <h2>Centros de custo</h2>
                  <p>Receitas e despesas manuais por competência</p>
                </div>
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Centro</th>
                      <th>Receitas</th>
                      <th>Despesas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(report.centers || []).map((c: Row, i: number) => (
                      <tr key={i}>
                        <td>{c.name}</td>
                        <td>{money(c.income_cents)}</td>
                        <td>{money(c.expense_cents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>Fluxo realizado</h2>
                <p>
                  Recebimentos e pagamentos registrados, incluindo PDV ainda sem
                  conta
                </p>
              </div>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Entradas registradas</th>
                    <th>Saídas registradas</th>
                    <th>Saldo inicial / transferências / ajustes</th>
                    <th>Movimento líquido</th>
                  </tr>
                </thead>
                <tbody>
                  {(report.cashflow || []).map((r: Row) => (
                    <tr key={r.day}>
                      <td>{day(r.day)}</td>
                      <td>{money(r.income_cents)}</td>
                      <td>{money(r.expense_cents)}</td>
                      <td>{money(r.other_cents)}</td>
                      <td>
                        <strong>{money(r.net_cents)}</strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!report.cashflow?.length && (
              <div className="crm-empty">Sem movimentos neste período.</div>
            )}
            <p className="finance-footnote">
              Acumulado registrado antes do período:{" "}
              {money(report.opening_cents)}. Aberturas, sangrias e suprimentos
              do caixa do PDV não são novas receitas/despesas. Movimente contas
              financeiras para representar transferências patrimoniais.
            </p>
          </section>
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>Fluxo previsto</h2>
                <p>
                  Saldos em aberto por vencimento; não representam recebimento
                  ou pagamento confirmado
                </p>
              </div>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Vencimento</th>
                    <th>Natureza</th>
                    <th>Valor aberto</th>
                  </tr>
                </thead>
                <tbody>
                  {(report.projected || []).map((r: Row, i: number) => (
                    <tr key={i}>
                      <td>{day(r.day)}</td>
                      <td>
                        {r.direction === "receivable" ? "A receber" : "A pagar"}
                      </td>
                      <td>{money(r.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!report.projected?.length && (
              <div className="crm-empty">
                Sem valores em aberto neste período.
              </div>
            )}
          </section>
        </>
      )}
      {["payable", "receivable"].includes(tab) && (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>
                {tab === "payable" ? "Contas a pagar" : "Contas a receber"}
              </h2>
              <p>
                Filtro por vencimento · Baixas parciais e histórico preservado
                {tab === "receivable" &&
                  " · Use “Conferir saldos anteriores” para validar serviços anteriores ao financeiro."}
              </p>
            </div>
            <button className="btn primary" onClick={() => open("title")}>
              <Plus size={17} />
              Novo título
            </button>
          </div>
          <div className="finance-list-filters">
            <input
              aria-label="Pesquisar títulos"
              placeholder="Descrição ou contraparte"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
            />
            <select
              aria-label="Situação dos títulos"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              {Object.entries({
                all: "Todos",
                open: "Em aberto",
                paid: "Liquidados",
                overdue: "Vencidos",
                cancelled: "Cancelados",
                review: "Conferir saldos anteriores",
              }).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Título / contraparte</th>
                  <th>Filial / centro</th>
                  <th>Vencimento</th>
                  <th>Total / baixado</th>
                  <th>Saldo / situação</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <strong>{t.description}</strong>
                      <small>
                        {t.counterparty} ·{" "}
                        {t.source_kind === "repair" ? "Assistência" : "Manual"}
                      </small>
                    </td>
                    <td>
                      {t.branch_name}
                      <small>{t.center_name || "Sem centro"}</small>
                    </td>
                    <td>{day(t.due_on)}</td>
                    <td>
                      {money(t.amount_cents)}
                      <small>Baixado: {money(t.paid_cents)}</small>
                    </td>
                    <td>
                      <strong>
                        {t.needs_review
                          ? "A conferir"
                          : money(
                              t.cancelled ? 0 : t.amount_cents - t.paid_cents,
                            )}
                      </strong>
                      <small>{titleStatus(t)}</small>
                    </td>
                    <td>
                      <button
                        className="btn secondary small"
                        onClick={() => showTitle(t.id)}
                      >
                        Abrir título
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!rows.length && (
            <div className="crm-empty">
              {loading ? "Carregando…" : "Nenhum título encontrado no período."}
            </div>
          )}
          {pagination}
        </section>
      )}
      {tab === "entries" && (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Movimentos e conciliação</h2>
              <p>
                Confira valor e data com o extrato ou comprovante antes de
                conciliar
              </p>
            </div>
            <button
              className="btn secondary small"
              disabled={!rows.length}
              onClick={() =>
                download("movimentos-pagina-" + page + ".csv", [
                  [
                    "Data",
                    "Descrição",
                    "Filial",
                    "Conta",
                    "Valor (R$)",
                    "Origem",
                    "Conciliação",
                  ],
                  ...rows.map((r) => [
                    r.posted_on,
                    r.description,
                    r.branch_name,
                    r.account_name || "A classificar",
                    r.amount_cents / 100,
                    sourceNames[r.source_kind],
                    r.reconciliation_id ? "Conciliado" : "Pendente",
                  ]),
                ])
              }
            >
              <Download size={15} />
              Baixar página CSV
            </button>
          </div>
          <div className="finance-list-filters">
            <select
              aria-label="Situação da conciliação"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              {Object.entries({
                all: "Todos os movimentos",
                pending: "Não conciliados",
                reconciled: "Conciliados",
                unassigned: "Sem conta financeira",
              }).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Data / origem</th>
                  <th>Descrição / filial</th>
                  <th>Conta</th>
                  <th>Valor</th>
                  <th>Conciliação</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      {day(r.posted_on)}
                      <small>
                        {sourceNames[r.source_kind]}{" "}
                        {methods[r.source_part] || ""}
                      </small>
                    </td>
                    <td>
                      <strong>{r.description}</strong>
                      <small>{r.branch_name}</small>
                    </td>
                    <td>{r.account_name || "A classificar"}</td>
                    <td
                      className={
                        r.amount_cents < 0
                          ? "finance-negative"
                          : "finance-positive"
                      }
                    >
                      {money(r.amount_cents)}
                    </td>
                    <td>
                      {r.reconciliation_id ? (
                        <>
                          <span className="badge">Conciliado</span>
                          <small>
                            {r.statement_reference} · {day(r.statement_on)}
                          </small>
                        </>
                      ) : (
                        <span className="badge">Pendente</span>
                      )}
                    </td>
                    <td>
                      <div className="finance-row-actions">
                        <button
                          className="btn secondary small"
                          onClick={() =>
                            open(r.reconciliation_id ? "undo" : "reconcile", r)
                          }
                        >
                          {r.reconciliation_id ? "Desfazer" : "Conciliar"}
                        </button>
                        <button
                          className="icon-button"
                          aria-label={"Histórico do movimento " + r.id}
                          onClick={() => showEntry(r.id)}
                        >
                          <History size={17} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!rows.length && (
            <div className="crm-empty">
              {loading ? "Carregando…" : "Nenhum movimento neste período."}
            </div>
          )}
          {pagination}
        </section>
      )}
      {tab === "config" && (
        <>
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>Contas financeiras</h2>
                <p>
                  Saldo registrado por conta; valores do PDV ainda sem conta
                  aparecem para classificação
                </p>
              </div>
              <div className="finance-row-actions">
                <button
                  className="btn secondary"
                  onClick={() => open("transfer")}
                >
                  Transferir
                </button>
                <button className="btn primary" onClick={() => open("account")}>
                  <Plus size={16} />
                  Nova conta
                </button>
              </div>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Conta</th>
                    <th>Filial / tipo</th>
                    <th>Saldo registrado</th>
                    <th>Situação</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {scopedAccounts.map((a) => (
                    <tr key={a.id}>
                      <td>
                        <strong>{a.name}</strong>
                      </td>
                      <td>
                        {a.branch_name}
                        <small>
                          {
                            { cash: "Caixa", bank: "Banco", other: "Outros" }[
                              a.kind as "cash"
                            ]
                          }
                        </small>
                      </td>
                      <td>{money(a.balance_cents)}</td>
                      <td>{a.active ? "Ativa" : "Inativa"}</td>
                      <td>
                        <div className="finance-row-actions">
                          <button
                            className="btn secondary small"
                            onClick={() => open("account", a)}
                          >
                            Editar conta
                          </button>
                          {a.active && (
                            <button
                              className="btn secondary small"
                              onClick={() => open("adjust", a)}
                            >
                              Ajustar saldo
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!scopedAccounts.length && (
              <div className="crm-empty">
                Cadastre a primeira conta financeira.
              </div>
            )}
          </section>
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>Centros de custo</h2>
                <p>
                  Compartilhados pela empresa para classificar títulos manuais
                </p>
              </div>
              <button className="btn primary" onClick={() => open("center")}>
                <Plus size={16} />
                Novo centro
              </button>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Centro</th>
                    <th>Situação</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {centers.map((c) => (
                    <tr key={c.id}>
                      <td>{c.name}</td>
                      <td>{c.active ? "Ativo" : "Inativo"}</td>
                      <td>
                        <button
                          className="btn secondary small"
                          onClick={() => open("center", c)}
                        >
                          Editar centro
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!centers.length && (
              <div className="crm-empty">Nenhum centro cadastrado.</div>
            )}
          </section>
        </>
      )}
      {dialog && (
        <div className="modal-backdrop">
          <section
            className="modal finance-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="finance-dialog-title"
          >
            <header className="modal-header">
              <div>
                <span className="eyebrow">GESTÃO FINANCEIRA</span>
                <h2 id="finance-dialog-title">
                  {
                    {
                      account: editing
                        ? "Editar conta"
                        : "Nova conta financeira",
                      center: editing
                        ? "Editar centro"
                        : "Novo centro de custo",
                      title: editing
                        ? "Editar título"
                        : "Novo título financeiro",
                      settle: "Registrar baixa",
                      review: "Conferir saldo anterior",
                      cancel: "Cancelar título",
                      reverse: "Estornar baixa",
                      transfer: "Transferir entre contas",
                      adjust: "Ajuste patrimonial",
                      reconcile: "Conciliar movimento",
                      undo: "Desfazer conciliação",
                      "title-detail": "Detalhes do título",
                      "entry-detail": "Histórico do movimento",
                    }[dialog]
                  }
                </h2>
              </div>
              <button
                className="icon-button"
                aria-label="Fechar janela financeira"
                disabled={busy}
                onClick={() => setDialog("")}
              >
                <X size={20} />
              </button>
            </header>
            {dialog === "title-detail" && detail ? (
              <div className="modal-body">
                <div className="finance-title-summary">
                  <strong>{detail.title.description}</strong>
                  <p>{detail.title.counterparty}</p>
                  <span>
                    Vencimento: {day(detail.title.due_on)} · Competência:{" "}
                    {day(detail.title.competence_on)}
                  </span>
                  <h3>
                    Saldo em aberto:{" "}
                    {detail.title.needs_review
                      ? "A conferir"
                      : money(
                          detail.title.cancelled
                            ? 0
                            : detail.title.amount_cents -
                                detail.title.paid_cents,
                        )}
                  </h3>
                  <span className="badge">{titleStatus(detail.title)}</span>
                  {detail.title.opening_paid_cents > 0 && (
                    <p>
                      Recebido antes do financeiro:{" "}
                      {money(detail.title.opening_paid_cents)}. Valor conferido
                      sem movimentar contas atuais.
                    </p>
                  )}
                </div>
                <div className="finance-row-actions">
                  {detail.title.imported &&
                    !detail.title.cancelled &&
                    detail.title.paid_cents ===
                      detail.title.opening_paid_cents && (
                      <button
                        className="btn primary"
                        onClick={() => open("review", detail.title)}
                      >
                        Conferir saldo anterior
                      </button>
                    )}
                  {detail.title.source_kind !== "credit" &&
                    !detail.title.cancelled &&
                    !detail.title.needs_review &&
                    detail.title.paid_cents < detail.title.amount_cents && (
                      <button
                        className="btn primary"
                        onClick={() => open("settle", detail.title)}
                      >
                        Registrar baixa
                      </button>
                    )}
                  {detail.title.source_kind !== "credit" &&
                    !detail.title.cancelled &&
                    !detail.title.paid_cents && (
                      <>
                        <button
                          className="btn secondary"
                          onClick={() => open("title", detail.title)}
                        >
                          Editar título
                        </button>
                        {detail.title.source_kind === "manual" && (
                          <button
                            className="btn secondary"
                            onClick={() => open("cancel", detail.title)}
                          >
                            Cancelar título
                          </button>
                        )}
                      </>
                    )}
                </div>
                {detail.title.source_kind === "credit" && (
                  <p className="form-hint">
                    Receba ou estorne esta parcela em Crediário próprio. O
                    módulo calcula o abatimento de juros, a multa e a mora
                    conforme o contrato.
                  </p>
                )}
                <h3>Baixas e estornos</h3>
                {detail.settlements.length ? (
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Baixa</th>
                          <th>Valor / situação</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {detail.settlements.map((s: Row) => (
                          <tr key={s.id}>
                            <td>
                              {day(s.posted_on)}
                              <small>
                                {s.account_name} · {s.reference}
                              </small>
                            </td>
                            <td>
                              {money(s.amount_cents)}
                              {Number(s.discount_cents) > 0 && (
                                <small>
                                  Abatimento de juros: {money(s.discount_cents)}
                                </small>
                              )}
                              {Number(s.charges_cents) > 0 && (
                                <small>
                                  Encargos incluídos: {money(s.charges_cents)}
                                </small>
                              )}
                              <small>
                                {s.reversed
                                  ? "Estornada"
                                  : s.reconciled
                                    ? "Conciliada"
                                    : "Ativa"}
                              </small>
                            </td>
                            <td>
                              {detail.title.source_kind !== "credit" &&
                                !s.reversed && (
                                  <button
                                    className="btn secondary small"
                                    disabled={s.reconciled}
                                    onClick={() => open("reverse", s)}
                                  >
                                    Estornar baixa
                                  </button>
                                )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="form-hint">Nenhuma baixa registrada.</p>
                )}
                <h3>Trilha de operações</h3>
                <div className="finance-events">
                  {detail.events.map((e: Row) => (
                    <article key={e.id}>
                      <strong>{eventNames[e.action] || e.action}</strong>
                      <small>
                        {when(e.created_at)} · {e.actor_name}
                      </small>
                      {(e.details.reason || e.details.reference) && (
                        <p>{e.details.reason || e.details.reference}</p>
                      )}
                    </article>
                  ))}
                </div>
              </div>
            ) : dialog === "entry-detail" && detail ? (
              <div className="modal-body">
                <h3>{detail.entry.description}</h3>
                <p>
                  {sourceNames[detail.entry.source_kind]} ·{" "}
                  {money(detail.entry.amount_cents)}
                </p>
                <h3>Conciliações preservadas</h3>
                {detail.reconciliations.map((r: Row) => (
                  <article className="finance-note" key={r.id}>
                    <strong>
                      {r.account_name} · {r.reference}
                    </strong>
                    <p>
                      {day(r.statement_on)} ·{" "}
                      {r.voided_at
                        ? "Desfeita em " + when(r.voided_at)
                        : "Ativa"}
                    </p>
                  </article>
                ))}
                <div className="finance-events">
                  {detail.events.map((e: Row) => (
                    <article key={e.id}>
                      <strong>{eventNames[e.action] || e.action}</strong>
                      <small>
                        {when(e.created_at)} · {e.actor_name}
                      </small>
                      <p>{e.details.reason || e.details.reference}</p>
                    </article>
                  ))}
                </div>
              </div>
            ) : (
              <form
                onSubmit={submit}
                key={dialog + String(editing?.id || "new")}
              >
                <div className="modal-body">
                  {dialog === "account" && (
                    <>
                      <Field label="Nome da conta">
                        <input
                          name="name"
                          maxLength={120}
                          defaultValue={editing?.name}
                          required
                          autoFocus
                        />
                      </Field>
                      {editing ? (
                        <label className="finance-checkbox">
                          <input
                            name="active"
                            type="checkbox"
                            defaultChecked={editing.active}
                          />
                          Conta ativa (inativação exige saldo zero)
                        </label>
                      ) : (
                        <>
                          <Field label="Filial da conta">
                            <select
                              name="branch_id"
                              defaultValue={scope === "all" ? branch : scope}
                            >
                              {branches.map((b) => (
                                <option key={b.id} value={b.id}>
                                  {b.name}
                                </option>
                              ))}
                            </select>
                          </Field>
                          <Field label="Tipo de conta">
                            <select name="kind">
                              <option value="bank">Banco</option>
                              <option value="cash">Caixa</option>
                              <option value="other">Outros</option>
                            </select>
                          </Field>
                          {amountField(
                            "opening",
                            "Saldo inicial (R$)",
                            0,
                            true,
                          )}
                          {dateField(
                            "opening_on",
                            "Data do saldo inicial",
                            now,
                            true,
                          )}
                          <p className="form-hint">
                            Informe o saldo já existente. Ele compõe o
                            patrimônio, sem gerar receita na DRE.
                          </p>
                        </>
                      )}
                    </>
                  )}
                  {dialog === "center" && (
                    <>
                      <Field label="Nome do centro">
                        <input
                          name="name"
                          maxLength={120}
                          required
                          defaultValue={editing?.name}
                          autoFocus
                        />
                      </Field>
                      {editing && (
                        <label className="finance-checkbox">
                          <input
                            name="active"
                            type="checkbox"
                            defaultChecked={editing.active}
                          />
                          Centro ativo para novos títulos
                        </label>
                      )}
                    </>
                  )}
                  {dialog === "title" && (
                    <>
                      {!editing && (
                        <Field label="Filial do título">
                          <select
                            name="branch_id"
                            defaultValue={scope === "all" ? branch : scope}
                          >
                            {branches.map((b) => (
                              <option key={b.id} value={b.id}>
                                {b.name}
                              </option>
                            ))}
                          </select>
                        </Field>
                      )}
                      <Field label="Natureza">
                        <select
                          name="direction"
                          defaultValue={editing?.direction || tab}
                          disabled={editing?.source_kind === "repair"}
                        >
                          <option value="payable">A pagar</option>
                          <option value="receivable">A receber</option>
                        </select>
                      </Field>
                      <Field label="Descrição do título">
                        <input
                          name="description"
                          required
                          maxLength={180}
                          defaultValue={editing?.description}
                        />
                      </Field>
                      <Field label="Cliente / fornecedor / contraparte">
                        <input
                          name="counterparty"
                          required
                          maxLength={180}
                          defaultValue={editing?.counterparty}
                        />
                      </Field>
                      {editing?.source_kind !== "repair" && (
                        <Field
                          label="Tratamento na DRE"
                          hint="Compras de estoque e movimentos patrimoniais não repetem receitas/despesas na DRE."
                        >
                          <select
                            name="affects_result"
                            defaultValue={
                              editing?.affects_result === false ? "no" : "yes"
                            }
                          >
                            <option value="yes">
                              Receita / despesa operacional
                            </option>
                            <option value="no">
                              Patrimonial / estoque (fora da DRE)
                            </option>
                          </select>
                        </Field>
                      )}
                      <Field label="Valor do título (R$)">
                        <input
                          name="amount"
                          type="number"
                          min="0.01"
                          max="10000000"
                          step="0.01"
                          required
                          defaultValue={decimal(editing?.amount_cents)}
                          readOnly={editing?.source_kind === "repair"}
                        />
                      </Field>
                      <div className="form-grid">
                        <Field label="Competência">
                          <input
                            name="competence_on"
                            type="date"
                            min="2000-01-01"
                            max="2199-12-31"
                            required
                            defaultValue={editing?.competence_on || now}
                            readOnly={editing?.source_kind === "repair"}
                          />
                        </Field>
                        {dateField(
                          "due_on",
                          "Vencimento",
                          editing?.due_on || now,
                        )}
                      </div>
                      <Field label="Centro de custo">
                        <select
                          name="center_id"
                          defaultValue={editing?.center_id || ""}
                        >
                          <option value="">Sem centro</option>
                          {centers
                            .filter(
                              (c) => c.active || c.id === editing?.center_id,
                            )
                            .map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                                {!c.active ? " (inativo)" : ""}
                              </option>
                            ))}
                        </select>
                      </Field>
                      <p className="form-hint">
                        Recebimentos do PDV e serviços entregues já estão
                        integrados. Use títulos manuais para outras receitas e
                        despesas.
                      </p>
                    </>
                  )}
                  {dialog === "review" && (
                    <>
                      <p>
                        Valor original do serviço:{" "}
                        {money(editing?.amount_cents)}. Informe o que ainda
                        falta receber após conferir os comprovantes anteriores à
                        implantação do financeiro.
                      </p>
                      <Field label="Saldo anterior em aberto (R$)">
                        <input
                          name="amount"
                          type="number"
                          min="0"
                          max={decimal(editing?.amount_cents)}
                          step="0.01"
                          defaultValue={decimal(
                            editing!.amount_cents - editing!.opening_paid_cents,
                          )}
                          required
                        />
                      </Field>
                      <Field label="Referência da conferência">
                        <textarea
                          name="reference"
                          maxLength={500}
                          minLength={3}
                          rows={3}
                          required
                        />
                      </Field>
                      <p className="form-hint">
                        O valor já recebido externamente atualiza o saldo do
                        título sem gerar entrada fictícia nas contas
                        financeiras.
                      </p>
                    </>
                  )}
                  {dialog === "settle" && (
                    <>
                      <p>
                        <strong>{editing?.description}</strong> · Saldo:{" "}
                        {money(editing!.amount_cents - editing!.paid_cents)}
                      </p>
                      {accountField(
                        "account_id",
                        "Conta da baixa",
                        undefined,
                        editing?.branch_id,
                      )}
                      {amountField(
                        "amount",
                        "Valor da baixa (R$)",
                        editing!.amount_cents - editing!.paid_cents,
                      )}
                      {dateField(
                        "posted_on",
                        "Data do recebimento / pagamento",
                        now,
                        true,
                      )}
                      <Field label="Referência da baixa">
                        <input name="reference" maxLength={120} required />
                      </Field>
                    </>
                  )}
                  {["cancel", "reverse", "undo"].includes(dialog) && (
                    <>
                      {dialog === "reverse" &&
                        dateField("posted_on", "Data do estorno", now, true)}
                      {reasonField("Motivo")}
                      <p className="form-hint">
                        O registro original e a justificativa ficam preservados
                        no histórico.
                      </p>
                    </>
                  )}
                  {dialog === "transfer" && (
                    <>
                      {accountField("from_id", "Conta de origem")}
                      {accountField("to_id", "Conta de destino")}
                      {amountField()}
                      {dateField(
                        "posted_on",
                        "Data da transferência",
                        now,
                        true,
                      )}
                      {reasonField()}
                      <p className="form-hint">
                        A transferência grava saída e entrada juntas e não
                        altera a DRE.
                      </p>
                    </>
                  )}
                  {dialog === "adjust" && (
                    <>
                      <p>
                        {editing?.name} · Saldo atual:{" "}
                        {money(editing?.balance_cents)}
                      </p>
                      {amountField("amount", "Ajuste com sinal (R$)", 0, true)}
                      {dateField("posted_on", "Data do ajuste", now, true)}
                      {reasonField()}
                      <p className="form-hint">
                        Correção patrimonial justificada. O ajuste não compõe
                        receitas ou despesas da DRE.
                      </p>
                    </>
                  )}
                  {dialog === "reconcile" && (
                    <>
                      <p>
                        {editing?.description} ·{" "}
                        <strong>{money(editing?.amount_cents)}</strong>
                      </p>
                      {accountField(
                        "account_id",
                        "Conta do extrato",
                        editing?.effective_account_id || undefined,
                        editing?.branch_id,
                      )}
                      {dateField("statement_on", "Data no extrato", now, true)}
                      {amountField(
                        "amount",
                        "Valor no extrato com sinal (R$)",
                        editing?.amount_cents,
                        true,
                      )}
                      <Field label="Referência do extrato">
                        <input name="reference" maxLength={120} required />
                      </Field>
                      <label className="finance-checkbox">
                        <input name="confirmed" type="checkbox" required />
                        Conferi conta, valor e referência no extrato ou
                        comprovante.
                      </label>
                      <p className="form-hint">
                        Taxas e diferenças são lançadas separadamente. A
                        conciliação preserva o valor original.
                      </p>
                    </>
                  )}
                </div>
                <footer className="modal-footer">
                  <button
                    type="button"
                    className="btn secondary"
                    disabled={busy}
                    onClick={() => setDialog("")}
                  >
                    Cancelar
                  </button>
                  <button className="btn primary" disabled={busy}>
                    {busy ? "Registrando…" : "Confirmar registro"}
                  </button>
                </footer>
              </form>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

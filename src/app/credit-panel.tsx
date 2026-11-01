"use client";
import {
  useState,
  useEffect,
  useRef,
  useId,
  cloneElement,
  type ReactElement,
  type ReactNode,
  type FormEvent,
} from "react";
import {
  Plus,
  X,
  ArrowLeft,
  Search,
  Download,
  FileText,
  Calculator,
  ShieldCheck,
  Wallet,
  CalendarClock,
} from "lucide-react";
import { toCents, formatCents } from "../shared/money";
import { creditDay, addDays } from "../shared/credit-math";
import CreditDocument from "./credit-document";
import "./credit.css";
type Row = Record<string, any>;
type Props = {
  branch: string;
  branches: Row[];
  permissions: string[];
  companyName: string;
  mutate: (path: string, body: unknown, method?: string) => Promise<any>;
  onNotice: (text: string, error?: boolean) => void;
};
const cash = (n: unknown) => formatCents(n),
  decimal = (n: unknown) => (Number(n || 0) / 100).toFixed(2),
  day = (s: string) =>
    s ? s.slice(0, 10).split("-").reverse().join("/") : "—";
const actions: Row = {
  profile_approved: "Perfil avaliado",
  offer_approved: "Oferta aprovada",
  offer_cancelled: "Oferta cancelada",
  contract_created: "Contrato vinculado à venda",
  payment_received: "Recebimento registrado",
  payment_reversed: "Recebimento estornado",
  renegotiated: "Plano renegociado",
  contract_cancelled: "Contrato cancelado",
  document_accessed: "Documento consultado",
};
async function get(path: string) {
  const r = await fetch("/api" + path, { cache: "no-store" });
  const b = await r.json();
  if (!r.ok) throw Error(b.error || "Falha ao consultar o crediário.");
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
export default function CreditPanel({
  branch,
  branches,
  permissions,
  companyName,
  mutate,
  onNotice,
}: Props) {
  const [tab, setTab] = useState("contracts"),
    [scope, setScope] = useState(branch),
    [query, setQuery] = useState(""),
    [status, setStatus] = useState("all"),
    [page, setPage] = useState(1),
    [rows, setRows] = useState<Row[]>([]),
    [summary, setSummary] = useState<Row>({}),
    [policy, setPolicy] = useState<Row | null>(null),
    [config, setConfig] = useState<Row>({ accounts: [] }),
    [selected, setSelected] = useState(""),
    [detail, setDetail] = useState<Row | null>(null),
    [revision, setRevision] = useState(0),
    [loading, setLoading] = useState(false),
    [failed, setFailed] = useState(false),
    [dialog, setDialog] = useState(""),
    [editing, setEditing] = useState<Row | null>(null),
    [search, setSearch] = useState(""),
    [matches, setMatches] = useState<Row[]>([]),
    [picked, setPicked] = useState<Row | null>(null),
    [simulation, setSimulation] = useState<Row | null>(null),
    [simInput, setSimInput] = useState(""),
    [document, setDocument] = useState<Row | null>(null),
    [busy, setBusy] = useState(false);
  const busyRef = useRef(false),
    formRef = useRef<HTMLFormElement>(null),
    now = creditDay();
  const canSettings = permissions.includes("credit_settings");
  useEffect(() => {
    let alive = true;
    const timer = setTimeout(async () => {
      setLoading(true);
      setFailed(false);
      try {
        const jobs = [
          get("/credit/settings"),
          get("/finance/config?branch_id=all"),
        ];
        if (selected) jobs.push(get("/credit/contracts/" + selected));
        else if (tab !== "settings")
          jobs.push(
            get(
              `/credit/${tab === "contracts" ? "contracts" : tab === "profiles" ? "profiles" : tab === "offers" ? "offers" : "collections"}?branch_id=${scope}&q=${encodeURIComponent(query)}&page=${page}&status=${status}`,
            ),
          );
        const [s, f, r] = await Promise.all(jobs);
        if (alive) {
          setPolicy(s.policy);
          setConfig(f);
          if (selected) setDetail(r);
          else {
            setRows(r?.items || []);
            setSummary(r?.summary || {});
          }
        }
      } catch (e: any) {
        if (alive) {
          onNotice(e.message, true);
          setFailed(true);
        }
      } finally {
        if (alive) setLoading(false);
      }
    }, 180);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [scope, tab, query, status, page, selected, revision, onNotice]);
  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => {
      if (search.trim().length < 2) {
        setMatches([]);
        return;
      }
      const path =
        dialog === "profile"
          ? "/crm/lookup?q=" + encodeURIComponent(search)
          : `/credit/profiles?branch_id=${scope}&q=${encodeURIComponent(search)}`;
      get(path)
        .then((r) => {
          if (alive) setMatches(r.items);
        })
        .catch((e) => {
          if (alive) onNotice(e.message, true);
        });
    }, 200);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [search, dialog, scope, onNotice]);
  function navigate(v: string) {
    setTab(v);
    setSelected("");
    setDetail(null);
    setQuery("");
    setPage(1);
    setStatus("all");
    setRows([]);
  }
  function open(type: string, row: Row | null = null) {
    setDialog(type);
    setEditing(row);
    setSearch("");
    setMatches([]);
    setPicked(null);
    setSimulation(null);
    setSimInput("");
  }
  async function profile(id: string) {
    try {
      const r = await get("/credit/profiles/" + id);
      open("profile", r.profile);
    } catch (e: any) {
      onNotice(e.message, true);
    }
  }
  function view(id: string) {
    setSelected(id);
    setDetail(null);
  }
  async function showDocument(id: string, type = "contracts") {
    try {
      const r = await get(`/credit/${type}/${id}/document`);
      setDocument(r);
    } catch (e: any) {
      onNotice(e.message, true);
    }
  }
  function conditions(fd: FormData) {
    const value = (n: string) => String(fd.get(n) || "");
    return {
      purchase_cents:
        dialog === "renegotiate"
          ? detail!.items.reduce(
              (s: number, x: Row) => s + x.quote.principal_cents,
              0,
            )
          : toCents(value("purchase")),
      down_cents: dialog === "renegotiate" ? 0 : toCents(value("down")),
      count: Number(value("count")),
      monthly_bps: toCents(value("monthly")),
      first_due_on: value("first_due_on"),
    };
  }
  async function simulate() {
    if (!formRef.current || busyRef.current) return;
    try {
      const b = conditions(new FormData(formRef.current));
      const r = await mutate("/credit/simulate", b);
      setSimulation(r);
      setSimInput(JSON.stringify(b));
    } catch (e: any) {
      onNotice(e.message, true);
    }
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    const fd = new FormData(e.currentTarget),
      v = (n: string) => String(fd.get(n) || "");
    try {
      if (dialog === "policy")
        await mutate("/credit/settings", {
          version: policy?.version || 0,
          enabled: fd.has("enabled"),
          legal_name: v("legal_name"),
          cnpj: v("cnpj"),
          address: v("address"),
          email: v("email"),
          phone: v("phone"),
          max_monthly_bps: toCents(v("max_monthly")),
          late_fee_bps: toCents(v("late_fee")),
          late_monthly_bps: toCents(v("late_monthly")),
          max_installments: Number(v("max_installments")),
          offer_days: Number(v("offer_days")),
          terms: v("terms"),
          legal_reference: v("legal_reference"),
          reviewed: fd.has("reviewed"),
        });
      if (dialog === "profile") {
        const customerId = editing?.customer_id || picked?.id;
        if (!customerId) throw Error("Selecione um cliente do CRM.");
        await mutate(
          editing ? `/credit/profiles/${editing.id}` : "/credit/profiles",
          {
            version: editing?.version || 0,
            branch_id: editing?.branch_id || v("branch_id"),
            customer_id: customerId,
            cpf: v("cpf"),
            address: v("address"),
            limit_cents: toCents(v("limit")),
            enabled: fd.has("enabled"),
            assessment: v("assessment"),
            bureau_reference: v("bureau_reference"),
            capacity_checked: fd.has("capacity_checked"),
          },
        );
      }
      if (dialog === "offer" || dialog === "renegotiate") {
        const b = conditions(fd);
        if (!simulation || simInput !== JSON.stringify(b))
          throw Error("Simule novamente as condições antes de confirmar.");
        if (dialog === "offer") {
          if (!picked) throw Error("Selecione um perfil aprovado.");
          await mutate("/credit/offers", {
            ...b,
            branch_id: v("branch_id"),
            policy_version: simulation.policy_version,
            profile_id: picked.id,
            assessment: v("assessment"),
            approval_reference: v("approval_reference"),
          });
        } else
          await mutate(`/credit/contracts/${selected}/renegotiate`, {
            version: detail!.contract.version,
            policy_version: simulation.policy_version,
            count: b.count,
            monthly_bps: b.monthly_bps,
            first_due_on: b.first_due_on,
            reason: v("reason"),
            assessment: v("assessment"),
            acceptance_reference: v("acceptance_reference"),
            accepted: fd.has("accepted"),
          });
      }
      if (dialog === "cancel-offer")
        await mutate(`/credit/offers/${editing!.id}/cancel`, {
          version: editing!.version,
          reason: v("reason"),
        });
      if (dialog === "receive")
        await mutate(`/credit/contracts/${selected}/receive`, {
          version: detail!.contract.version,
          installment_id: editing!.id,
          amount_cents: toCents(v("amount")),
          expected_total_cents: editing!.quote.total_cents,
          account_id: v("account_id"),
          reference: v("reference"),
        });
      if (dialog === "reverse")
        await mutate(`/credit/contracts/${selected}/reverse`, {
          version: detail!.contract.version,
          receipt_id: editing!.id,
          reason: v("reason"),
        });
      setDialog("");
      setRevision((r) => r + 1);
      onNotice("Registro do crediário salvo.");
    } catch (e: any) {
      onNotice(e.message, true);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  const picker = (
    <div className="crm-customer-picker">
      <Field
        label={
          dialog === "profile"
            ? "Buscar cliente no CRM"
            : "Buscar perfil de crédito"
        }
      >
        <input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPicked(null);
          }}
          placeholder="Digite nome ou telefone"
          autoComplete="off"
        />
      </Field>
      {picked ? (
        <p className="crm-picked">
          {picked.name}
          <button
            type="button"
            className="btn secondary small"
            onClick={() => setPicked(null)}
          >
            Trocar
          </button>
        </p>
      ) : (
        <div className="crm-matches">
          {matches.map((r) => (
            <button
              type="button"
              key={r.id}
              onClick={() => {
                setPicked(r);
                setSearch("");
                setMatches([]);
              }}
            >
              {r.name}
              <small>
                {r.cpf_suffix
                  ? "CPF final " + r.cpf_suffix
                  : "Telefone final " + r.phone_suffix}
              </small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
  const branchField = (
    <Field label="Filial da operação">
      <select
        name="branch_id"
        defaultValue={scope === "all" ? branch : scope}
        required
      >
        {branches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
    </Field>
  );
  const simulationView = simulation && (
    <section className="credit-simulation">
      <h3>Condições simuladas</h3>
      <div className="credit-sim-totals">
        <p>
          Preço sem financiamento
          <strong>{cash(simulation.simulation.purchase_cents)}</strong>
        </p>
        <p>
          Entrada<strong>{cash(simulation.simulation.down_cents)}</strong>
        </p>
        <p>
          Principal
          <strong>{cash(simulation.simulation.principal_cents)}</strong>
        </p>
        <p>
          Juros<strong>{cash(simulation.simulation.interest_cents)}</strong>
        </p>
        <p>
          Total com entrada
          <strong>{cash(simulation.simulation.total_cents)}</strong>
        </p>
      </div>
      <p>
        Taxa efetiva mensal do cronograma:{" "}
        {simulation.simulation.effective_monthly_percent.toFixed(4)}% · CET
        anual: {simulation.simulation.annual_percent.toFixed(4)}% · Oferta
        válida até {day(simulation.valid_until)}
      </p>
      <div className="table-scroll">
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
            {simulation.simulation.lines.map((l: Row) => (
              <tr key={l.number}>
                <td>{l.number}</td>
                <td>{day(l.due_on)}</td>
                <td>{cash(l.principal_cents)}</td>
                <td>{cash(l.interest_cents)}</td>
                <td>{cash(l.amount_cents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
  const exportCollections = () => {
    const csv =
      "\uFEFF" +
      [
        [
          "Contrato",
          "Cliente",
          "Telefone",
          "Filial",
          "Parcela",
          "Vencimento",
          "Dias em atraso",
          "Saldo nominal (R$)",
        ],
        ...rows.map((r) => [
          r.code,
          r.customer_name,
          r.phone,
          r.branch_name,
          r.number,
          r.due_on,
          r.days_late,
          Number(r.nominal_cents) / 100,
        ]),
      ]
        .map((row) =>
          row
            .map((value) => {
              if (typeof value === "number") return String(value);
              const s = String(value);
              return (
                '"' +
                (/^[=+\-@\t\r]/.test(s) ? "'" : "") +
                s.replaceAll('"', '""') +
                '"'
              );
            })
            .join(";"),
        )
        .join("\r\n");
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    const a = window.document.createElement("a");
    a.href = url;
    a.download = "cobranca-pagina-" + page + ".csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const paginate = (
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
  return (
    <div className="credit-panel crm-panel" aria-busy={loading}>
      <div className="crm-tabs">
        {[
          ["contracts", "Contratos"],
          ["profiles", "Clientes e análise"],
          ["offers", "Ofertas aprovadas"],
          ["collections", "Cobrança"],
          ["settings", "Condições comerciais"],
        ].map(([id, label]) => (
          <button
            key={id}
            onClick={() => navigate(id)}
            className={tab === id ? "active" : ""}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="credit-toolbar">
        <Field label="Filiais do crediário">
          <select
            value={scope}
            onChange={(e) => {
              setScope(e.target.value);
              setPage(1);
              setSelected("");
              setDetail(null);
            }}
          >
            <option value="all">Todas as filiais autorizadas</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </Field>
        <span className="badge">
          {policy?.enabled
            ? "Novas vendas habilitadas"
            : "Novas vendas suspensas"}
        </span>
      </div>
      {failed && (
        <div className="info-strip">
          <span>Não foi possível atualizar os dados.</span>
          <button
            className="btn secondary small"
            onClick={() => setRevision((r) => r + 1)}
          >
            Tentar novamente
          </button>
        </div>
      )}
      {!policy && (
        <div className="credit-notice">
          <ShieldCheck size={20} />
          <p>
            Registre as condições comerciais e a referência da revisão jurídica
            antes de aprovar ofertas. Clientes e pagamentos usam os cadastros
            existentes.
          </p>
          {canSettings && (
            <button className="btn primary" onClick={() => open("policy")}>
              Configurar condições
            </button>
          )}
        </div>
      )}
      {selected && detail ? (
        <>
          <button
            className="crm-back"
            onClick={() => {
              setSelected("");
              setDetail(null);
            }}
          >
            <ArrowLeft size={16} />
            Voltar aos contratos
          </button>
          <section className="credit-contract-header">
            <div>
              <span className="eyebrow">VENDA A PRAZO</span>
              <h2>{detail.contract.borrower.name}</h2>
              <small>
                {detail.contract.code} · CPF final{" "}
                {detail.contract.borrower.cpf.slice(-2)}
              </small>
            </div>
            <span className="badge">
              {detail.contract.status === "cancelled"
                ? "Cancelado"
                : detail.items.every((x: Row) => x.quote.total_cents === 0)
                  ? "Liquidado"
                  : "Em acompanhamento"}
            </span>
          </section>
          <div className="finance-row-actions">
            <button
              className="btn secondary"
              onClick={() => showDocument(selected)}
            >
              <FileText size={16} />
              Documento do contrato
            </button>
            {detail.contract.status === "active" &&
              detail.items.some((x: Row) => x.quote.principal_cents > 0) && (
                <button
                  className="btn secondary"
                  onClick={() => open("renegotiate")}
                >
                  Renegociar principal aberto
                </button>
              )}
          </div>
          <div className="credit-metrics">
            <article>
              <span>Principal aberto</span>
              <strong>
                {cash(
                  detail.contract.status === "cancelled"
                    ? 0
                    : detail.items.reduce(
                        (n: number, x: Row) => n + x.quote.principal_cents,
                        0,
                      ),
                )}
              </strong>
            </article>
            <article>
              <span>Juros abatidos se quitar hoje</span>
              <strong>
                {cash(
                  detail.contract.status === "cancelled"
                    ? 0
                    : detail.items.reduce(
                        (n: number, x: Row) => n + x.quote.discount_cents,
                        0,
                      ),
                )}
              </strong>
            </article>
            <article>
              <span>Quitação hoje, com encargos</span>
              <strong>
                {cash(
                  detail.contract.status === "cancelled"
                    ? 0
                    : detail.items.reduce(
                        (n: number, x: Row) => n + x.quote.total_cents,
                        0,
                      ),
                )}
              </strong>
            </article>
          </div>
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>Calendário de parcelas</h2>
                <p>
                  Revisão {detail.plan.revision} · Valores calculados em{" "}
                  {day(now)}. Pagamentos fora do ERP precisam ser conferidos
                  pela loja.
                </p>
              </div>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Parcela / vencimento</th>
                    <th>Principal / juros abertos</th>
                    <th>Desconto de antecipação</th>
                    <th>Multa / mora</th>
                    <th>Receber hoje</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {detail.items.map((x: Row) => (
                    <tr key={x.id}>
                      <td>
                        <strong>
                          {x.number} · {day(x.due_on)}
                        </strong>
                        <small>
                          {x.quote.overdue_days
                            ? x.quote.overdue_days + " dia(s) após vencimento"
                            : "No prazo"}
                        </small>
                      </td>
                      <td>
                        {cash(x.quote.principal_cents)}
                        <small>
                          Juros nominais: {cash(x.quote.interest_cents)}
                        </small>
                      </td>
                      <td>{cash(x.quote.discount_cents)}</td>
                      <td>
                        {cash(x.quote.fine_cents)}
                        <small>Mora simples: {cash(x.quote.late_cents)}</small>
                      </td>
                      <td>
                        <strong>
                          {cash(
                            detail.contract.status === "cancelled"
                              ? 0
                              : x.quote.total_cents,
                          )}
                        </strong>
                      </td>
                      <td>
                        {detail.contract.status === "active" &&
                          x.quote.total_cents > 0 && (
                            <button
                              className="btn primary small"
                              onClick={() => open("receive", x)}
                            >
                              Receber parcela
                            </button>
                          )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>Recebimentos do plano vigente</h2>
                <p>
                  Estornos preservam a origem. Desfaça conciliações financeiras
                  antes de corrigir um recebimento.
                </p>
              </div>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Data / parcela</th>
                    <th>Principal / juros</th>
                    <th>Abatimento</th>
                    <th>Encargos</th>
                    <th>Referência</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {detail.items.flatMap((x: Row) =>
                    x.receipts.map((r: Row) => (
                      <tr key={r.id}>
                        <td>
                          {day(r.posted_on)} · {x.number}
                        </td>
                        <td>
                          {cash(r.principal_cents)}
                          <small>Juros pagos: {cash(r.interest_cents)}</small>
                        </td>
                        <td>{cash(r.discount_cents)}</td>
                        <td>{cash(r.fine_cents + r.late_cents)}</td>
                        <td>{r.reference}</td>
                        <td>
                          <button
                            className="btn secondary small"
                            onClick={() => open("reverse", r)}
                          >
                            Corrigir recebimento
                          </button>
                        </td>
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
            </div>
          </section>
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>Planos e acompanhamento</h2>
                <p>Revisões anteriores e eventos permanecem preservados</p>
              </div>
            </div>
            <div className="credit-history">
              {detail.plans.map((p: Row) => (
                <article key={p.id}>
                  <strong>
                    Revisão {p.revision} · Principal {cash(p.principal_cents)}
                  </strong>
                  <p>{p.reason}</p>
                  <small>Aceitação: {p.acceptance_reference}</small>
                </article>
              ))}
              {detail.events.map((e: Row) => (
                <article key={e.id}>
                  <strong>{actions[e.action] || e.action}</strong>
                  <small>
                    {new Date(e.created_at).toLocaleString("pt-BR", {
                      timeZone: "America/Fortaleza",
                    })}{" "}
                    · {e.actor_name}
                  </small>
                  {e.details.reason && <p>{e.details.reason}</p>}
                </article>
              ))}
            </div>
          </section>
        </>
      ) : selected ? (
        <div className="crm-empty">
          {loading
            ? "Carregando contrato…"
            : "Atualize para consultar o contrato."}
        </div>
      ) : (
        <>
          {tab === "settings" ? (
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h2>Condições comerciais e revisão</h2>
                  <p>
                    Taxas zero por padrão; limites técnicos não equivalem a
                    autorização jurídica.
                  </p>
                </div>
                {canSettings && (
                  <button
                    className="btn primary"
                    onClick={() => open("policy")}
                  >
                    Revisar condições
                  </button>
                )}
              </div>
              {policy ? (
                <div className="credit-policy">
                  <h3>
                    {policy.legal_name} · CNPJ {policy.cnpj}
                  </h3>
                  <p>
                    {policy.address} · {policy.email} · {policy.phone}
                  </p>
                  <div className="credit-sim-totals">
                    <p>
                      Juros simples máximos
                      <strong>{decimal(policy.max_monthly_bps)}% a.m.</strong>
                    </p>
                    <p>
                      Multa única
                      <strong>{decimal(policy.late_fee_bps)}%</strong>
                    </p>
                    <p>
                      Mora simples
                      <strong>{decimal(policy.late_monthly_bps)}% a.m.</strong>
                    </p>
                    <p>
                      Parcelas / validade
                      <strong>
                        {policy.max_installments} / {policy.offer_days} dias
                      </strong>
                    </p>
                  </div>
                  <p>Revisão: {policy.legal_reference}</p>
                  <div className="credit-terms">{policy.terms}</div>
                </div>
              ) : (
                <div className="crm-empty">
                  Condições ainda não configuradas.
                </div>
              )}
            </section>
          ) : (
            <>
              <div className="credit-list-toolbar">
                {tab !== "collections" && (
                  <div className="search-box">
                    <Search size={17} />
                    <input
                      aria-label="Pesquisar crediário"
                      value={query}
                      onChange={(e) => {
                        setQuery(e.target.value);
                        setPage(1);
                      }}
                      placeholder="Nome do cliente ou contrato"
                    />
                  </div>
                )}
                {tab === "contracts" && (
                  <select
                    aria-label="Situação dos contratos"
                    value={status}
                    onChange={(e) => {
                      setStatus(e.target.value);
                      setPage(1);
                    }}
                  >
                    {Object.entries({
                      all: "Todos",
                      active: "Com saldo",
                      overdue: "Em atraso",
                      settled: "Liquidados",
                      cancelled: "Cancelados",
                    }).map(([id, label]) => (
                      <option key={id} value={id}>
                        {label}
                      </option>
                    ))}
                  </select>
                )}
                {tab === "profiles" && (
                  <button
                    className="btn primary"
                    onClick={() => open("profile")}
                  >
                    <Plus size={17} />
                    Analisar cliente
                  </button>
                )}
                {tab === "offers" && (
                  <button
                    className="btn primary"
                    disabled={!policy?.enabled}
                    onClick={() => open("offer")}
                  >
                    <Calculator size={17} />
                    Simular e aprovar oferta
                  </button>
                )}
                {tab === "collections" && (
                  <button
                    className="btn secondary"
                    disabled={!rows.length}
                    onClick={exportCollections}
                  >
                    <Download size={16} />
                    Exportar página de cobrança
                  </button>
                )}
              </div>
              {tab === "collections" && (
                <div className="credit-metrics">
                  <article>
                    <span>Contratos em atraso</span>
                    <strong>{summary.contracts || 0}</strong>
                  </article>
                  <article>
                    <span>Parcelas vencidas</span>
                    <strong>{summary.installments || 0}</strong>
                  </article>
                  <article>
                    <span>Nominal em atraso</span>
                    <strong>{cash(summary.total_cents)}</strong>
                  </article>
                </div>
              )}
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <h2>
                      {
                        {
                          contracts: "Contratos de crediário",
                          profiles: "Clientes e análise de crédito",
                          offers: "Ofertas para uso no PDV",
                          collections: "Relatório de cobrança",
                        }[tab]
                      }
                    </h2>
                    <p>
                      {tab === "profiles"
                        ? "CPF restrito à análise e ao documento. Referências de avaliação e consulta são manuais."
                        : tab === "offers"
                          ? "A oferta reserva limite. O caixa utiliza o número aprovado para a venda correspondente."
                          : tab === "collections"
                            ? "Saldo nominal por vencimento; encargos são calculados na confirmação. Nenhuma mensagem é enviada."
                            : "Saldo nominal das parcelas; a quitação de hoje considera abatimentos e encargos."}
                    </p>
                  </div>
                </div>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        {(tab === "profiles"
                          ? ["Cliente", "Filial", "Limite / situação", ""]
                          : tab === "offers"
                            ? [
                                "Oferta / cliente",
                                "Compra / entrada",
                                "Parcelas / validade",
                                "Situação",
                                "",
                              ]
                            : tab === "collections"
                              ? [
                                  "Contrato / cliente",
                                  "Filial / contato",
                                  "Vencimento / atraso",
                                  "Nominal",
                                  "",
                                ]
                              : [
                                  "Contrato / cliente",
                                  "Filial",
                                  "Nominal aberto",
                                  "Vencido / situação",
                                  "",
                                ]
                        ).map((x, i) => (
                          <th key={i}>{x}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, index) => (
                        <tr key={r.id || r.contract_id + "-" + r.number}>
                          {tab === "profiles" ? (
                            <>
                              <td>
                                <strong>{r.name}</strong>
                                <small>
                                  CPF final {r.cpf_suffix} · {r.phone}
                                </small>
                              </td>
                              <td>{r.branch_name}</td>
                              <td>
                                {cash(r.limit_cents)}
                                <small>
                                  {r.enabled
                                    ? "Perfil aprovado"
                                    : "Bloqueado para novas ofertas"}
                                </small>
                              </td>
                              <td>
                                <button
                                  className="btn secondary small"
                                  onClick={() => profile(r.id)}
                                >
                                  Revisar análise
                                </button>
                              </td>
                            </>
                          ) : tab === "offers" ? (
                            <>
                              <td>
                                <strong>{r.customer_name}</strong>
                                <small>{r.code}</small>
                              </td>
                              <td>
                                {cash(r.purchase_cents)}
                                <small>Entrada: {cash(r.down_cents)}</small>
                              </td>
                              <td>
                                {r.count} parcela(s)
                                <small>Até {day(r.valid_until)}</small>
                              </td>
                              <td>
                                <span className="badge">
                                  {r.status === "approved"
                                    ? r.valid_until < now
                                      ? "Expirada"
                                      : "Aprovada"
                                    : r.status === "used"
                                      ? "Utilizada"
                                      : "Cancelada"}
                                </span>
                              </td>
                              <td>
                                <div className="finance-row-actions">
                                  <button
                                    className="btn secondary small"
                                    onClick={() => showDocument(r.id, "offers")}
                                  >
                                    Documento da oferta
                                  </button>
                                  {r.status === "approved" && (
                                    <button
                                      className="btn secondary small"
                                      onClick={() => open("cancel-offer", r)}
                                    >
                                      Cancelar oferta
                                    </button>
                                  )}
                                </div>
                              </td>
                            </>
                          ) : tab === "collections" ? (
                            <>
                              <td>
                                <strong>{r.customer_name}</strong>
                                <small>
                                  {r.code} · Parcela {r.number}
                                </small>
                              </td>
                              <td>
                                {r.branch_name}
                                <small>{r.phone}</small>
                              </td>
                              <td>
                                {day(r.due_on)}
                                <small>{r.days_late} dia(s)</small>
                              </td>
                              <td>{cash(r.nominal_cents)}</td>
                              <td>
                                <button
                                  className="btn secondary small"
                                  onClick={() => view(r.contract_id)}
                                >
                                  Abrir contrato
                                </button>
                              </td>
                            </>
                          ) : (
                            <>
                              <td>
                                <strong>{r.customer_name}</strong>
                                <small>{r.code}</small>
                              </td>
                              <td>{r.branch_name}</td>
                              <td>
                                {cash(
                                  r.status === "cancelled"
                                    ? 0
                                    : r.nominal_cents,
                                )}
                              </td>
                              <td>
                                {cash(
                                  r.status === "cancelled"
                                    ? 0
                                    : r.overdue_cents,
                                )}
                                <small>
                                  {r.status === "cancelled"
                                    ? "Cancelado"
                                    : Number(r.nominal_cents) === 0
                                      ? "Liquidado"
                                      : Number(r.overdue_cents) > 0
                                        ? "Em atraso"
                                        : "No prazo"}
                                </small>
                              </td>
                              <td>
                                <button
                                  className="btn secondary small"
                                  onClick={() => view(r.id)}
                                >
                                  Abrir contrato
                                </button>
                              </td>
                            </>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!rows.length && (
                  <div className="crm-empty">
                    {loading ? "Carregando…" : "Nenhum registro encontrado."}
                  </div>
                )}
                {paginate}
              </section>
            </>
          )}
        </>
      )}
      {dialog && (
        <div className="modal-backdrop">
          <section
            className="modal credit-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="credit-dialog-title"
          >
            <header className="modal-header">
              <div>
                <span className="eyebrow">CREDIÁRIO PRÓPRIO</span>
                <h2 id="credit-dialog-title">
                  {
                    {
                      policy: "Condições comerciais",
                      profile: "Análise do comprador",
                      offer: "Simular e aprovar oferta",
                      receive: "Receber parcela",
                      reverse: "Corrigir recebimento",
                      renegotiate: "Renegociar principal aberto",
                      "cancel-offer": "Cancelar oferta",
                    }[dialog]
                  }
                </h2>
              </div>
              <button
                className="icon-button"
                aria-label="Fechar janela do crediário"
                disabled={busy}
                onClick={() => setDialog("")}
              >
                <X size={20} />
              </button>
            </header>
            <form
              ref={formRef}
              onSubmit={submit}
              key={dialog + String(editing?.id || "new")}
            >
              <div className="modal-body">
                {dialog === "policy" && (
                  <>
                    <label className="credit-check">
                      <input
                        name="enabled"
                        type="checkbox"
                        defaultChecked={policy?.enabled}
                      />
                      Habilitar novas vendas a prazo
                    </label>
                    <div className="form-grid">
                      <Field label="Razão social do fornecedor">
                        <input
                          name="legal_name"
                          required
                          maxLength={180}
                          defaultValue={policy?.legal_name || companyName}
                        />
                      </Field>
                      <Field label="CNPJ do fornecedor">
                        <input
                          name="cnpj"
                          required
                          maxLength={18}
                          defaultValue={policy?.cnpj}
                        />
                      </Field>
                    </div>
                    <Field label="Endereço do fornecedor">
                      <textarea
                        name="address"
                        required
                        maxLength={1000}
                        rows={2}
                        defaultValue={policy?.address}
                      />
                    </Field>
                    <div className="form-grid">
                      <Field label="E-mail do fornecedor">
                        <input
                          name="email"
                          type="email"
                          maxLength={254}
                          required
                          defaultValue={policy?.email}
                        />
                      </Field>
                      <Field label="Telefone do fornecedor">
                        <input
                          name="phone"
                          type="tel"
                          maxLength={25}
                          required
                          defaultValue={policy?.phone}
                        />
                      </Field>
                      <Field label="Juros simples máximos ao mês (%)">
                        <input
                          name="max_monthly"
                          type="number"
                          min="0"
                          max="3"
                          step="0.01"
                          required
                          defaultValue={decimal(policy?.max_monthly_bps)}
                        />
                      </Field>
                      <Field label="Multa única de atraso (%)">
                        <input
                          name="late_fee"
                          type="number"
                          min="0"
                          max="2"
                          step="0.01"
                          required
                          defaultValue={decimal(policy?.late_fee_bps)}
                        />
                      </Field>
                      <Field label="Mora simples ao mês (%)">
                        <input
                          name="late_monthly"
                          type="number"
                          min="0"
                          max="1"
                          step="0.01"
                          required
                          defaultValue={decimal(policy?.late_monthly_bps)}
                        />
                      </Field>
                      <Field label="Máximo de parcelas">
                        <input
                          name="max_installments"
                          type="number"
                          min="1"
                          max="36"
                          required
                          defaultValue={policy?.max_installments || 12}
                        />
                      </Field>
                      <Field label="Validade da oferta (dias)">
                        <input
                          name="offer_days"
                          type="number"
                          min="2"
                          max="30"
                          required
                          defaultValue={policy?.offer_days || 7}
                        />
                      </Field>
                    </div>
                    <Field label="Termos comerciais revisados">
                      <textarea
                        name="terms"
                        required
                        minLength={30}
                        maxLength={12000}
                        rows={8}
                        defaultValue={policy?.terms}
                      />
                    </Field>
                    <Field label="Referência da revisão jurídica">
                      <textarea
                        name="legal_reference"
                        minLength={5}
                        maxLength={1000}
                        rows={2}
                        required
                        defaultValue={policy?.legal_reference}
                      />
                    </Field>
                    <label className="credit-check">
                      <input name="reviewed" type="checkbox" required />
                      Registrei a revisão jurídica dos termos, taxas e método de
                      cálculo para esta operação.
                    </label>
                    <p className="form-hint">
                      Método: juros simples por principal de cada parcela, dias
                      corridos/base 30, sem tarifas adicionais. Encargos
                      vencidos são pagos antes do principal, sem capitalização.
                      Limites do formulário são técnicos; a revisão define as
                      condições válidas para a empresa.
                    </p>
                  </>
                )}
                {dialog === "profile" && (
                  <>
                    {editing ? (
                      <p>
                        <strong>{editing.name}</strong> · {editing.phone}
                      </p>
                    ) : (
                      <>
                        {picker}
                        {branchField}
                      </>
                    )}
                    <Field label="CPF do comprador">
                      <input
                        name="cpf"
                        maxLength={14}
                        required
                        defaultValue={editing?.cpf}
                        readOnly={!!editing}
                      />
                    </Field>
                    <Field label="Endereço do comprador">
                      <textarea
                        name="address"
                        minLength={10}
                        maxLength={1000}
                        rows={3}
                        required
                        defaultValue={editing?.address}
                      />
                    </Field>
                    <Field label="Limite de principal (R$)">
                      <input
                        name="limit"
                        type="number"
                        min="0"
                        max="10000000"
                        step="0.01"
                        required
                        defaultValue={decimal(editing?.limit_cents)}
                      />
                    </Field>
                    <label className="credit-check">
                      <input
                        name="enabled"
                        type="checkbox"
                        defaultChecked={editing?.enabled}
                      />
                      Aprovar perfil para novas ofertas dentro do limite
                    </label>
                    <Field label="Avaliação da capacidade de pagamento">
                      <textarea
                        name="assessment"
                        rows={4}
                        required
                        minLength={10}
                        maxLength={1500}
                        defaultValue={editing?.assessment}
                      />
                    </Field>
                    <Field label="Referência da consulta externa de crédito">
                      <textarea
                        name="bureau_reference"
                        rows={2}
                        required
                        minLength={3}
                        maxLength={500}
                        defaultValue={editing?.bureau_reference}
                      />
                    </Field>
                    <label className="credit-check">
                      <input name="capacity_checked" type="checkbox" required />
                      Conferi a capacidade civil, os dados e a avaliação
                      responsável do comprador.
                    </label>
                    <p className="form-hint">
                      O sistema registra a análise manual. Não consulta bureaus
                      automaticamente nem aprova crédito por pontuação simulada.
                    </p>
                  </>
                )}
                {(dialog === "offer" || dialog === "renegotiate") && (
                  <>
                    {dialog === "offer" && (
                      <>
                        {picker}
                        {branchField}
                        <div className="form-grid">
                          <Field label="Preço da compra sem juros (R$)">
                            <input
                              name="purchase"
                              type="number"
                              step="0.01"
                              min="0.01"
                              max="10000000"
                              required
                              defaultValue="0.00"
                            />
                          </Field>
                          <Field label="Entrada (R$)">
                            <input
                              name="down"
                              type="number"
                              step="0.01"
                              min="0"
                              max="10000000"
                              required
                              defaultValue="0.00"
                            />
                          </Field>
                        </div>
                      </>
                    )}
                    {dialog === "renegotiate" && (
                      <p>
                        O novo plano utilizará somente o principal aberto. Juros
                        e encargos ainda não recebidos serão dispensados, sem
                        capitalização. Recebimentos anteriores ficam
                        preservados.
                      </p>
                    )}
                    <div className="form-grid">
                      <Field label="Quantidade de parcelas">
                        <input
                          name="count"
                          type="number"
                          min="1"
                          max={policy?.max_installments || 36}
                          required
                          defaultValue="3"
                        />
                      </Field>
                      <Field label="Juros simples ao mês (%)">
                        <input
                          name="monthly"
                          type="number"
                          min="0"
                          max={Number(policy?.max_monthly_bps || 0) / 100}
                          step="0.01"
                          required
                          defaultValue="0.00"
                        />
                      </Field>
                      <Field label="Primeiro vencimento">
                        <input
                          name="first_due_on"
                          type="date"
                          required
                          min={addDays(now, (policy?.offer_days || 7) + 1)}
                          max={addDays(now, 90)}
                          defaultValue={addDays(now, 30)}
                        />
                      </Field>
                    </div>
                    <button
                      className="btn secondary"
                      type="button"
                      onClick={simulate}
                    >
                      <Calculator size={16} />
                      Simular condições
                    </button>
                    {simulationView}
                    <Field label="Avaliação desta operação">
                      <textarea
                        name="assessment"
                        minLength={10}
                        maxLength={1500}
                        required
                        rows={3}
                      />
                    </Field>
                    {dialog === "offer" ? (
                      <Field label="Referência da aprovação">
                        <input
                          name="approval_reference"
                          required
                          minLength={3}
                          maxLength={500}
                        />
                      </Field>
                    ) : (
                      <>
                        <Field label="Motivo da renegociação">
                          <textarea
                            name="reason"
                            required
                            minLength={10}
                            maxLength={1500}
                            rows={2}
                          />
                        </Field>
                        <Field label="Referência da aceitação do novo plano">
                          <input
                            name="acceptance_reference"
                            required
                            minLength={3}
                            maxLength={500}
                          />
                        </Field>
                        <label className="credit-check">
                          <input name="accepted" type="checkbox" required />
                          Cliente recebeu e aceitou as condições do novo plano.
                        </label>
                      </>
                    )}
                  </>
                )}
                {dialog === "receive" && (
                  <>
                    <p>
                      Parcela {editing?.number} · Vencimento{" "}
                      {day(editing?.due_on)} · Calculado em {day(now)}
                    </p>
                    <div className="credit-payment-summary">
                      <p>
                        Principal aberto{" "}
                        <strong>{cash(editing?.quote.principal_cents)}</strong>
                      </p>
                      <p>
                        Juros cobrados hoje{" "}
                        <strong>
                          {cash(editing?.quote.earned_interest_cents)}
                        </strong>
                      </p>
                      <p>
                        Abatimento proporcional{" "}
                        <strong>{cash(editing?.quote.discount_cents)}</strong>
                      </p>
                      <p>
                        Multa / mora{" "}
                        <strong>
                          {cash(
                            editing?.quote.fine_cents +
                              editing?.quote.late_cents,
                          )}
                        </strong>
                      </p>
                      <p>
                        Total para quitar hoje{" "}
                        <strong>{cash(editing?.quote.total_cents)}</strong>
                      </p>
                    </div>
                    <Field label="Conta do recebimento">
                      <select name="account_id" required>
                        <option value="">Selecione</option>
                        {config.accounts
                          .filter(
                            (a: Row) =>
                              a.active &&
                              a.branch_id === detail!.contract.branch_id,
                          )
                          .map((a: Row) => (
                            <option key={a.id} value={a.id}>
                              {a.name}
                            </option>
                          ))}
                      </select>
                    </Field>
                    <Field label="Valor recebido (R$)">
                      <input
                        name="amount"
                        type="number"
                        min="0.01"
                        max={decimal(editing?.quote.total_cents)}
                        step="0.01"
                        defaultValue={decimal(editing?.quote.total_cents)}
                        required
                      />
                    </Field>
                    <Field label="Referência do recebimento">
                      <input
                        name="reference"
                        minLength={3}
                        maxLength={120}
                        required
                      />
                    </Field>
                    <p className="form-hint">
                      Baixas são registradas na data de hoje. Em pagamento
                      parcial, encargos vencidos são quitados primeiro;
                      principal, juros e abatimento são discriminados no recibo.
                    </p>
                  </>
                )}
                {(dialog === "reverse" || dialog === "cancel-offer") && (
                  <>
                    <Field label="Motivo">
                      <textarea
                        name="reason"
                        required
                        minLength={5}
                        maxLength={1000}
                        rows={4}
                      />
                    </Field>
                    <p className="form-hint">
                      A operação e sua referência original permanecerão na
                      trilha de auditoria.
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
                <button
                  className="btn primary"
                  disabled={busy || (dialog === "policy" && !canSettings)}
                >
                  {busy ? "Registrando…" : "Confirmar registro"}
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}
      {document && (
        <CreditDocument data={document} onClose={() => setDocument(null)} />
      )}
    </div>
  );
}

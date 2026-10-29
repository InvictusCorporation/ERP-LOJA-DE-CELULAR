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
  Search,
  ArrowLeft,
  X,
  UsersRound,
  Target,
  CalendarClock,
  ShieldCheck,
  MessageCircle,
  History,
  ArrowUpRight,
} from "lucide-react";
import { formatCents, toCents } from "../shared/money";
import "./crm.css";
type Row = Record<string, any>;
type Props = {
  branch: string;
  mutate: (path: string, body: unknown, method?: string) => Promise<any>;
  onNotice: (message: string, error?: boolean) => void;
};
const stages: Row = {
  new: "Novo contato",
  contacted: "Em conversa",
  proposal: "Proposta",
  won: "Ganha",
  lost: "Perdida",
};
const taskStates: Row = {
  pending: "Pendente",
  done: "Concluído",
  cancelled: "Cancelado",
};
const repairStates: Row = {
  received: "Recebida",
  diagnosis: "Diagnóstico",
  awaiting_approval: "Aprovação pendente",
  approved: "Aprovada",
  in_repair: "Em reparo",
  ready: "Pronta",
  declined: "Recusada",
  cancelled: "Cancelada",
  delivered: "Entregue",
};
const saleStates: Row = {
  completed: "Concluída",
  partial_return: "Devolução parcial",
  returned: "Devolvida",
  cancelled: "Cancelada",
};
const actions: Row = {
  customer_created: "Cliente cadastrado",
  customer_updated: "Cadastro atualizado",
  contact_permission: "Preferência de contato",
  customer_archived: "Cliente arquivado",
  customer_reactivated: "Cliente reativado",
  interaction: "Atendimento registrado",
  opportunity_created: "Oportunidade criada",
  opportunity_updated: "Oportunidade atualizada",
  task_created: "Lembrete criado",
  task_updated: "Lembrete atualizado",
};
const channels: Row = {
  note: "Nota interna",
  phone: "Telefone",
  whatsapp: "WhatsApp",
  email: "E-mail",
  in_person: "Presencial",
};
const when = (s: string) =>
  new Date(s).toLocaleString("pt-BR", { timeZone: "America/Fortaleza" });
const day = (s: string) => (s ? s.split("-").reverse().join("/") : "—");
const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Fortaleza",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
function warranty(days: number, expires: string | null, returned = false) {
  if (returned) return "Item devolvido";
  if (!days || !expires) return "Sem prazo iniciado";
  return expires >= today() ? "Prazo vigente" : "Prazo encerrado";
}
function localDate(s?: string) {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Fortaleza",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(s || Date.now() + 86400000));
  return parts.replace(" ", "T");
}
async function get(path: string) {
  const r = await fetch("/api" + path, { cache: "no-store" });
  const b = await r.json();
  if (!r.ok) throw Error(b.error || "Falha ao consultar o CRM.");
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
export default function CrmPanel({ branch, mutate, onNotice }: Props) {
  const [view, setView] = useState("customers"),
    [query, setQuery] = useState(""),
    [status, setStatus] = useState("active"),
    [page, setPage] = useState(1),
    [rows, setRows] = useState<Row[]>([]),
    [summary, setSummary] = useState<Row[]>([]),
    [team, setTeam] = useState<Row[]>([]),
    [selected, setSelected] = useState(""),
    [customer, setCustomer] = useState<Row | null>(null),
    [kind, setKind] = useState("events"),
    [historyPage, setHistoryPage] = useState(1),
    [entries, setEntries] = useState<Row[]>([]),
    [dialog, setDialog] = useState(""),
    [editing, setEditing] = useState<Row | null>(null),
    [lookup, setLookup] = useState(""),
    [matches, setMatches] = useState<Row[]>([]),
    [picked, setPicked] = useState<Row | null>(null),
    [revision, setRevision] = useState(0),
    [loading, setLoading] = useState(false),
    [failed, setFailed] = useState(false),
    [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  useEffect(() => {
    let alive = true;
    get(`/crm/team?branch_id=${branch}`)
      .then((r) => {
        if (alive) setTeam(r.items);
      })
      .catch((e) => onNotice(e.message, true));
    return () => {
      alive = false;
    };
  }, [branch, onNotice]);
  useEffect(() => {
    let alive = true;
    const timer = setTimeout(async () => {
      setLoading(true);
      setFailed(false);
      try {
        if (selected) {
          const [c, h] = await Promise.all([
            get(`/crm/customers/${selected}`),
            get(
              `/crm/customers/${selected}/history?kind=${kind}&page=${historyPage}`,
            ),
          ]);
          if (alive) {
            setCustomer(c.customer);
            setEntries(h.items);
          }
        } else {
          const path =
            view === "customers"
              ? `/crm/customers?q=${encodeURIComponent(query)}&status=${status}&page=${page}`
              : `/crm/${view}?branch_id=${branch}&status=${status}&page=${page}`;
          const r = await get(path);
          if (alive) {
            setRows(r.items);
            setSummary(r.summary || []);
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
  }, [
    branch,
    view,
    query,
    status,
    page,
    selected,
    kind,
    historyPage,
    revision,
    onNotice,
  ]);
  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => {
      if (lookup.trim().length < 2) {
        setMatches([]);
        return;
      }
      get("/crm/lookup?q=" + encodeURIComponent(lookup))
        .then((r) => {
          if (alive) setMatches(r.items);
        })
        .catch((e) => {
          if (alive) onNotice(e.message, true);
        });
    }, 220);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [lookup, onNotice]);
  function navigate(v: string) {
    setView(v);
    setSelected("");
    setCustomer(null);
    setQuery("");
    setStatus(v === "customers" ? "active" : v === "tasks" ? "pending" : "all");
    setPage(1);
    setRows([]);
    setSummary([]);
  }
  function openCustomer(id: string) {
    setSelected(id);
    setCustomer(null);
    setEntries([]);
    setKind("events");
    setHistoryPage(1);
  }
  function open(type: string, row: Row | null = null) {
    setEditing(row);
    setPicked(customer || null);
    setLookup("");
    setMatches([]);
    setDialog(type);
  }
  function history(k: string) {
    setKind(k);
    setHistoryPage(1);
    setEntries([]);
  }
  const ownerField = (
    <Field label="Responsável">
      <select
        name="owner_id"
        defaultValue={editing?.owner_id || team[0]?.id}
        required
      >
        <option value="">Selecione</option>
        {team.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name}
          </option>
        ))}
      </select>
    </Field>
  );
  const customerField = (
    <div className="crm-customer-picker">
      <Field
        label="Buscar cliente"
        hint="Digite pelo menos duas letras ou números."
      >
        <input
          value={lookup}
          onChange={(e) => {
            setLookup(e.target.value);
            setPicked(null);
          }}
          placeholder="Nome ou telefone"
          autoComplete="off"
        />
      </Field>
      {picked ? (
        <p className="crm-picked">
          <UsersRound size={16} />
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
          {matches.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                setPicked(c);
                setMatches([]);
                setLookup("");
              }}
            >
              {c.name}
              <small>Telefone final {c.phone_suffix}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    const fd = new FormData(e.currentTarget),
      v = (n: string) => String(fd.get(n) || "");
    try {
      let result: Row = {};
      if (dialog === "customer") {
        const b = {
          name: v("name"),
          phone: v("phone"),
          email: v("email"),
          city: v("city"),
          state: v("state").toUpperCase(),
          notes: v("notes"),
        };
        result = await mutate(
          editing ? `/crm/customers/${editing.id}` : "/crm/customers",
          editing ? { ...b, version: editing.version } : b,
        );
        if (!editing) openCustomer(result.id);
      }
      if (dialog === "consent")
        await mutate(`/crm/customers/${customer!.id}/consent`, {
          version: customer!.version,
          allowed: v("allowed") === "yes",
          evidence: v("evidence"),
        });
      if (dialog === "state")
        await mutate(`/crm/customers/${customer!.id}/state`, {
          version: customer!.version,
          active: !customer!.active,
          reason: v("reason"),
        });
      if (dialog === "interaction")
        await mutate(`/crm/customers/${customer!.id}/interactions`, {
          branch_id: branch,
          channel: v("channel"),
          text: v("text"),
        });
      if (dialog === "opportunity") {
        const b = {
          title: v("title"),
          value_cents: toCents(v("value")),
          owner_id: v("owner_id"),
          expected_on: v("expected_on") || null,
        };
        if (editing)
          await mutate(`/crm/opportunities/${editing.id}`, {
            ...b,
            version: editing.version,
            stage: v("stage"),
            reason: v("reason"),
          });
        else {
          if (!picked) throw Error("Selecione um cliente.");
          await mutate("/crm/opportunities", {
            ...b,
            branch_id: branch,
            customer_id: picked.id,
          });
        }
      }
      if (dialog === "task") {
        const due_at = new Date(v("due") + ":00-03:00").toISOString();
        const b = { title: v("title"), owner_id: v("owner_id"), due_at };
        if (editing)
          await mutate(`/crm/tasks/${editing.id}`, {
            ...b,
            version: editing.version,
            status: v("task_status"),
          });
        else {
          if (!picked) throw Error("Selecione um cliente.");
          await mutate("/crm/tasks", {
            ...b,
            branch_id: branch,
            customer_id: picked.id,
          });
        }
      }
      setDialog("");
      setRevision((r) => r + 1);
      onNotice("Registro salvo no CRM.");
    } catch (e: any) {
      onNotice(e.message, true);
    } finally {
      setBusy(false);
      busyRef.current = false;
    }
  }
  async function whatsapp() {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      const r = await get(`/crm/customers/${customer!.id}/contact`);
      setEditing(r);
      setDialog("contact");
    } catch (e: any) {
      onNotice(e.message, true);
    } finally {
      busyRef.current = false;
    }
  }
  const currentItems = selected ? entries : rows,
    currentPage = selected ? historyPage : page;
  const total = currentItems[0]?.total_count || 0;
  const paginate = (
    <div className="crm-pagination">
      <span>
        {total} registro(s) · Página {currentPage}
      </span>
      <div>
        <button
          className="btn secondary small"
          disabled={currentPage === 1 || loading}
          onClick={() =>
            selected ? setHistoryPage((p) => p - 1) : setPage((p) => p - 1)
          }
        >
          Anterior
        </button>
        <button
          className="btn secondary small"
          disabled={currentPage * 30 >= total || loading}
          onClick={() =>
            selected ? setHistoryPage((p) => p + 1) : setPage((p) => p + 1)
          }
        >
          Próxima
        </button>
      </div>
    </div>
  );
  return (
    <div className="crm-panel" aria-busy={loading}>
      <div className="crm-tabs" aria-label="Áreas do CRM">
        {[
          ["customers", "Clientes", UsersRound],
          ["opportunities", "Funil comercial", Target],
          ["tasks", "Lembretes", CalendarClock],
        ].map(([id, label, Icon]: any) => (
          <button
            key={id}
            className={view === id ? "active" : ""}
            onClick={() => navigate(id)}
          >
            <Icon size={17} />
            {label}
          </button>
        ))}
      </div>
      {failed && (
        <div className="info-strip">
          <span>Não foi possível carregar os dados.</span>
          <button
            className="btn secondary small"
            onClick={() => setRevision((r) => r + 1)}
          >
            Tentar novamente
          </button>
          {selected && (
            <button
              className="btn secondary small"
              onClick={() => navigate("customers")}
            >
              Voltar aos clientes
            </button>
          )}
        </div>
      )}
      {selected && customer ? (
        <>
          <button className="crm-back" onClick={() => navigate("customers")}>
            <ArrowLeft size={16} />
            Voltar aos clientes
          </button>
          <section className="crm-profile">
            <div className="crm-avatar">
              {customer.name.slice(0, 1).toUpperCase()}
            </div>
            <div className="crm-profile-info">
              <span className="eyebrow">RELACIONAMENTO COM O CLIENTE</span>
              <h2>{customer.name}</h2>
              <p>
                {customer.phone} {customer.email && " · " + customer.email}
              </p>
              <small>
                {[customer.city, customer.state].filter(Boolean).join(" / ") ||
                  "Localidade não informada"}
              </small>
            </div>
            <span className="badge">
              {customer.active ? "Ativo" : "Arquivado"}
            </span>
          </section>
          <div className="crm-actionbar">
            <button
              className="btn secondary"
              onClick={() => open("customer", customer)}
            >
              Editar cadastro
            </button>
            <button className="btn secondary" onClick={() => open("consent")}>
              <ShieldCheck size={16} />
              Preferência de contato
            </button>
            <button className="btn secondary" onClick={() => open("state")}>
              {customer.active ? "Arquivar" : "Reativar"}
            </button>
            {customer.active && (
              <>
                <button
                  className="btn primary"
                  onClick={() => open("interaction")}
                >
                  <Plus size={16} />
                  Registrar atendimento
                </button>
                <button
                  className="btn secondary"
                  onClick={() => open("opportunity")}
                >
                  Nova oportunidade
                </button>
                <button className="btn secondary" onClick={() => open("task")}>
                  Novo lembrete
                </button>
                <button
                  className="btn secondary"
                  disabled={!customer.contact_permission}
                  onClick={whatsapp}
                >
                  <MessageCircle size={16} />
                  Preparar WhatsApp
                </button>
              </>
            )}
          </div>
          <div className="crm-privacy">
            <ShieldCheck size={18} />
            <p>
              Contato comercial:{" "}
              <strong>
                {customer.contact_permission
                  ? "permitido pelo cliente"
                  : "sem permissão registrada"}
              </strong>
              . A preferência pode ser revogada. Dados compartilhados pela
              empresa; históricos limitados às suas filiais.
            </p>
          </div>
          {customer.notes && (
            <section className="crm-note">
              <strong>Observações do cadastro</strong>
              <p>{customer.notes}</p>
            </section>
          )}
          <div className="crm-tabs crm-history-tabs">
            {[
              ["events", "Atendimentos e atividades"],
              ["sales", "Compras, aparelhos e garantias"],
              ["services", "Serviços e garantias"],
            ].map(([id, label]) => (
              <button
                key={id}
                onClick={() => history(id)}
                className={kind === id ? "active" : ""}
              >
                {label}
              </button>
            ))}
          </div>
          <section className="panel crm-history">
            <div className="panel-heading">
              <div>
                <h2>
                  {kind === "sales"
                    ? "Histórico de compras"
                    : kind === "services"
                      ? "Histórico de serviços"
                      : "Linha do relacionamento"}
                </h2>
                <p>
                  {kind === "sales"
                    ? "Vendas vinculadas ao cliente, com devoluções e prazos cadastrados."
                    : kind === "services"
                      ? "Aparelhos recebidos e garantia dos serviços entregues."
                      : "Registros preservados, do mais recente ao mais antigo."}
                </p>
              </div>
              <History size={21} />
            </div>
            {!entries.length ? (
              <div className="crm-empty">
                {loading
                  ? "Carregando histórico…"
                  : "Nenhum registro neste histórico."}
              </div>
            ) : kind === "events" ? (
              <div className="crm-timeline">
                {entries.map((r) => (
                  <article key={r.id}>
                    <span className="crm-event-dot" />
                    <div>
                      <strong>{actions[r.action] || r.action}</strong>
                      <small>
                        {when(r.created_at)} · {r.actor_name} ·{" "}
                        {r.branch_name || "Cadastro compartilhado"}
                      </small>
                      <p>
                        {r.details.text ||
                          r.details.title ||
                          r.details.reason ||
                          r.details.evidence ||
                          ""}
                      </p>
                      {r.action === "contact_permission" && (
                        <span className="badge">
                          {r.details.allowed
                            ? "Contato permitido"
                            : "Contato revogado"}
                        </span>
                      )}
                      {r.details.stage && (
                        <span className="badge">{stages[r.details.stage]}</span>
                      )}
                      {r.details.status && (
                        <span className="badge">
                          {taskStates[r.details.status]}
                        </span>
                      )}
                      {r.details.channel && (
                        <small>{channels[r.details.channel]}</small>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>
                        {kind === "sales"
                          ? "Compra / produto"
                          : "Ordem / aparelho"}
                      </th>
                      <th>Identificação</th>
                      <th>Situação</th>
                      <th>Garantia cadastrada</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((r) => (
                      <tr key={r.id}>
                        <td>
                          <strong>
                            {kind === "sales"
                              ? r.product_name
                              : r.brand + " " + r.model}
                          </strong>
                          <small>
                            {kind === "sales" ? r.receipt_code : r.code}
                          </small>
                          <small>
                            {when(r.created_at)} · {r.branch_name}
                          </small>
                          {kind === "sales" && (
                            <small>
                              {r.quantity} un. · Líquido após devoluções:{" "}
                              {formatCents(r.net_cents - r.refunded_cents)}
                            </small>
                          )}
                        </td>
                        <td>
                          {kind === "sales"
                            ? r.identifiers || "Sem controle individual"
                            : [
                                r.imei && "IMEI " + r.imei,
                                r.serial && "Série " + r.serial,
                              ]
                                .filter(Boolean)
                                .join(" · ") || "Não informada"}
                        </td>
                        <td>
                          <span className="badge">
                            {kind === "sales"
                              ? saleStates[r.status]
                              : repairStates[r.status]}
                          </span>
                          {kind === "sales" && r.returned_quantity > 0 && (
                            <small>
                              {r.returned_quantity} unidade(s) devolvida(s)
                            </small>
                          )}
                        </td>
                        <td>
                          <strong>
                            {warranty(
                              r.warranty_days,
                              r.warranty_expires_on,
                              kind === "sales" &&
                                r.returned_quantity >= r.quantity,
                            )}
                          </strong>
                          <small>
                            {r.warranty_days > 0 && r.warranty_expires_on
                              ? "Até " +
                                day(r.warranty_expires_on) +
                                " · " +
                                r.warranty_days +
                                " dias"
                              : "Sem prazo iniciado"}
                          </small>
                          <small>{r.warranty_terms}</small>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {paginate}
          </section>
        </>
      ) : !selected ? (
        <>
          <div className="crm-toolbar">
            <div className="search-box">
              <Search size={18} />
              {view === "customers" ? (
                <input
                  aria-label="Pesquisar clientes"
                  placeholder="Nome, telefone ou e-mail"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setPage(1);
                  }}
                />
              ) : (
                <span>
                  {view === "tasks"
                    ? "Agenda da filial selecionada"
                    : "Oportunidades da filial selecionada"}
                </span>
              )}
            </div>
            <select
              aria-label="Filtrar situação"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              {Object.entries(
                view === "customers"
                  ? { active: "Ativos", archived: "Arquivados", all: "Todos" }
                  : view === "tasks"
                    ? {
                        pending: "Pendentes",
                        overdue: "Atrasados",
                        done: "Concluídos",
                        cancelled: "Cancelados",
                        all: "Todos",
                      }
                    : { all: "Todas as etapas", ...stages },
              ).map(([id, label]) => (
                <option key={id} value={id}>
                  {String(label)}
                </option>
              ))}
            </select>
            <button
              className="btn primary"
              onClick={() =>
                open(
                  view === "customers"
                    ? "customer"
                    : view === "tasks"
                      ? "task"
                      : "opportunity",
                )
              }
            >
              <Plus size={17} />
              {view === "customers"
                ? "Novo cliente"
                : view === "tasks"
                  ? "Novo lembrete"
                  : "Nova oportunidade"}
            </button>
          </div>
          {view === "opportunities" && (
            <div className="crm-pipeline">
              {Object.entries(stages).map(([id, label]) => {
                const s = summary.find((r) => r.stage === id);
                return (
                  <button
                    key={id}
                    className={"crm-stage " + (status === id ? "selected" : "")}
                    onClick={() => {
                      setStatus(id);
                      setPage(1);
                    }}
                  >
                    <span>{String(label)}</span>
                    <strong>{s?.count || 0}</strong>
                    <small>{formatCents(Number(s?.value_cents || 0))}</small>
                  </button>
                );
              })}
            </div>
          )}
          {view === "tasks" && (
            <div className="crm-agenda-metrics">
              {[
                ["pending", "Pendentes"],
                ["overdue", "Atrasados"],
                ["done", "Concluídos"],
              ].map(([id, label]) => (
                <article key={id}>
                  <span>{label}</span>
                  <strong>{summary[0]?.[id] || 0}</strong>
                </article>
              ))}
            </div>
          )}
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>
                  {view === "customers"
                    ? "Base de clientes"
                    : view === "tasks"
                      ? "Próximos atendimentos"
                      : "Acompanhamento comercial"}
                </h2>
                <p>
                  {view === "customers"
                    ? "O mesmo cadastro para vendas e assistência."
                    : view === "tasks"
                      ? "Lembretes internos, exibidos no ERP. Sem envio automático."
                      : "Mover uma oportunidade não registra venda nem recebimento."}
                </p>
              </div>
            </div>
            {!rows.length ? (
              <div className="crm-empty">
                <UsersRound size={28} />
                <h3>
                  {loading ? "Carregando…" : "Nenhum registro encontrado"}
                </h3>
                <p>
                  {view === "customers"
                    ? "Cadastre o primeiro cliente ou ajuste a pesquisa."
                    : "Crie um registro para acompanhar o próximo passo."}
                </p>
              </div>
            ) : (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      {(view === "customers"
                        ? [
                            "Cliente",
                            "Contato",
                            "Localidade",
                            "Preferência",
                            "",
                          ]
                        : view === "tasks"
                          ? [
                              "Atendimento",
                              "Cliente",
                              "Prazo / responsável",
                              "Situação",
                              "",
                            ]
                          : [
                              "Oportunidade",
                              "Cliente",
                              "Valor / responsável",
                              "Etapa",
                              "",
                            ]
                      ).map((t, i) => (
                        <th key={i}>{t}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id}>
                        {view === "customers" ? (
                          <>
                            <td>
                              <strong>{r.name}</strong>
                              <small>{r.active ? "Ativo" : "Arquivado"}</small>
                            </td>
                            <td>
                              {r.phone}
                              <small>{r.email}</small>
                            </td>
                            <td>
                              {[r.city, r.state].filter(Boolean).join(" / ") ||
                                "—"}
                            </td>
                            <td>
                              <span className="badge">
                                {r.contact_permission
                                  ? "Contato permitido"
                                  : "Sem permissão"}
                              </span>
                            </td>
                            <td>
                              <button
                                className="btn secondary small"
                                onClick={() => openCustomer(r.id)}
                              >
                                Abrir cliente
                                <ArrowUpRight size={14} />
                              </button>
                            </td>
                          </>
                        ) : (
                          <>
                            <td>
                              <strong>{r.title}</strong>
                              {view === "opportunities" && r.expected_on && (
                                <small>Previsão: {day(r.expected_on)}</small>
                              )}
                            </td>
                            <td>
                              <button
                                className="crm-link"
                                onClick={() => openCustomer(r.customer_id)}
                              >
                                {r.customer_name}
                              </button>
                            </td>
                            <td>
                              {view === "tasks"
                                ? when(r.due_at)
                                : formatCents(r.value_cents)}
                              <small>{r.owner_name}</small>
                            </td>
                            <td>
                              <span
                                className={
                                  "badge " + (r.overdue ? "crm-overdue" : "")
                                }
                              >
                                {view === "tasks"
                                  ? r.overdue
                                    ? "Atrasado"
                                    : taskStates[r.status]
                                  : stages[r.stage]}
                              </span>
                            </td>
                            <td>
                              <button
                                className="btn secondary small"
                                onClick={() =>
                                  open(
                                    view === "tasks" ? "task" : "opportunity",
                                    r,
                                  )
                                }
                              >
                                Atualizar
                              </button>
                            </td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {paginate}
          </section>
        </>
      ) : (
        <div className="crm-empty">
          {loading
            ? "Carregando cliente…"
            : "Selecione Tentar novamente para consultar o cliente."}
        </div>
      )}
      {dialog && (
        <div className="modal-backdrop">
          <section
            className="modal crm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="crm-dialog-title"
          >
            <header className="modal-header">
              <div>
                <span className="eyebrow">CRM E CLIENTES</span>
                <h2 id="crm-dialog-title">
                  {
                    {
                      customer: editing ? "Editar cliente" : "Novo cliente",
                      consent: "Preferência de contato comercial",
                      state: customer?.active
                        ? "Arquivar cliente"
                        : "Reativar cliente",
                      interaction: "Registrar atendimento",
                      opportunity: editing
                        ? "Atualizar oportunidade"
                        : "Nova oportunidade",
                      task: editing ? "Atualizar lembrete" : "Novo lembrete",
                      contact: "Preparar contato no WhatsApp",
                    }[dialog]
                  }
                </h2>
              </div>
              <button
                className="icon-button"
                aria-label="Fechar janela do CRM"
                disabled={busy}
                onClick={() => setDialog("")}
              >
                <X size={20} />
              </button>
            </header>
            {dialog === "contact" ? (
              <div className="modal-body">
                <p>
                  Confirme o número de <strong>{customer?.name}</strong>:{" "}
                  {customer?.phone}.
                </p>
                <p className="form-hint">
                  O WhatsApp será aberto para atendimento manual. Nenhuma
                  mensagem foi enviada. Registre o resultado do contato na linha
                  do relacionamento.
                </p>
                <a
                  className="btn primary"
                  href={editing?.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Abrir WhatsApp
                  <ArrowUpRight size={16} />
                </a>
              </div>
            ) : (
              <form
                onSubmit={submit}
                key={dialog + String(editing?.id || "new")}
              >
                <div className="modal-body">
                  {dialog === "customer" && (
                    <>
                      <div className="form-grid">
                        <Field label="Nome completo">
                          <input
                            name="name"
                            maxLength={180}
                            defaultValue={editing?.name}
                            required
                            autoFocus
                          />
                        </Field>
                        <Field label="Telefone">
                          <input
                            name="phone"
                            type="tel"
                            maxLength={25}
                            defaultValue={editing?.phone}
                            required
                          />
                        </Field>
                        <Field label="E-mail">
                          <input
                            name="email"
                            type="email"
                            maxLength={254}
                            defaultValue={editing?.email}
                          />
                        </Field>
                        <Field label="Cidade">
                          <input
                            name="city"
                            maxLength={100}
                            defaultValue={editing?.city}
                          />
                        </Field>
                        <Field label="UF">
                          <input
                            name="state"
                            maxLength={2}
                            pattern="[A-Za-z]{2}"
                            defaultValue={editing?.state}
                          />
                        </Field>
                      </div>
                      <Field
                        label="Observações"
                        hint="Registre apenas informações necessárias ao atendimento."
                      >
                        <textarea
                          name="notes"
                          rows={3}
                          maxLength={2000}
                          defaultValue={editing?.notes}
                        />
                      </Field>
                      <p className="form-hint">
                        Cadastrar o cliente não autoriza contato comercial.
                        Registre a preferência separadamente.
                      </p>
                    </>
                  )}
                  {dialog === "consent" && (
                    <>
                      <Field label="Contato comercial">
                        <select
                          name="allowed"
                          defaultValue={
                            customer?.contact_permission ? "yes" : "no"
                          }
                        >
                          <option value="no">Não permitido / revogado</option>
                          <option value="yes">Permitido pelo cliente</option>
                        </select>
                      </Field>
                      <Field label="Evidência ou motivo">
                        <textarea
                          name="evidence"
                          minLength={3}
                          maxLength={500}
                          rows={3}
                          placeholder="Como e quando o cliente informou a preferência"
                          required
                        />
                      </Field>
                    </>
                  )}
                  {dialog === "state" && (
                    <>
                      <p>
                        O histórico de compras, serviços e atividades será
                        preservado. O cliente arquivado não pode ser escolhido
                        para novos atendimentos ou vendas.
                      </p>
                      <Field label="Motivo">
                        <textarea
                          name="reason"
                          minLength={3}
                          maxLength={500}
                          rows={3}
                          required
                        />
                      </Field>
                    </>
                  )}
                  {dialog === "interaction" && (
                    <>
                      <Field label="Canal">
                        <select name="channel" defaultValue="note">
                          {Object.entries(channels).map(([id, label]) => (
                            <option
                              key={id}
                              value={id}
                              disabled={
                                !customer?.contact_permission &&
                                ["phone", "email", "whatsapp"].includes(id)
                              }
                            >
                              {String(label)}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Resumo do atendimento">
                        <textarea
                          name="text"
                          rows={5}
                          minLength={3}
                          maxLength={2000}
                          required
                          autoFocus
                        />
                      </Field>
                    </>
                  )}
                  {(dialog === "task" || dialog === "opportunity") && (
                    <>
                      {!editing && customerField}
                      <Field
                        label={
                          dialog === "task"
                            ? "Assunto do lembrete"
                            : "Título da oportunidade"
                        }
                      >
                        <input
                          name="title"
                          required
                          maxLength={180}
                          defaultValue={editing?.title}
                        />
                      </Field>
                      {ownerField}
                      {dialog === "opportunity" ? (
                        <>
                          <div className="form-grid">
                            <Field label="Valor previsto (R$)">
                              <input
                                name="value"
                                type="number"
                                min="0"
                                step="0.01"
                                max="10000000"
                                defaultValue={(
                                  (editing?.value_cents || 0) / 100
                                ).toFixed(2)}
                                required
                              />
                            </Field>
                            <Field label="Previsão de fechamento">
                              <input
                                name="expected_on"
                                type="date"
                                defaultValue={editing?.expected_on || ""}
                              />
                            </Field>
                          </div>
                          {editing && (
                            <>
                              <Field label="Etapa">
                                <select
                                  name="stage"
                                  defaultValue={editing.stage}
                                >
                                  {Object.entries(stages).map(([id, label]) => (
                                    <option key={id} value={id}>
                                      {String(label)}
                                    </option>
                                  ))}
                                </select>
                              </Field>
                              <Field label="Motivo do encerramento ou reabertura">
                                <textarea
                                  name="reason"
                                  maxLength={500}
                                  rows={2}
                                  defaultValue={editing.close_reason}
                                />
                              </Field>
                            </>
                          )}
                        </>
                      ) : (
                        <>
                          <Field label="Data e hora (Fortaleza, UTC−3)">
                            <input
                              name="due"
                              type="datetime-local"
                              defaultValue={localDate(editing?.due_at)}
                              required
                            />
                          </Field>
                          {editing && (
                            <Field label="Situação">
                              <select
                                name="task_status"
                                defaultValue={editing.status}
                              >
                                {Object.entries(taskStates).map(
                                  ([id, label]) => (
                                    <option key={id} value={id}>
                                      {String(label)}
                                    </option>
                                  ),
                                )}
                              </select>
                            </Field>
                          )}
                        </>
                      )}
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
                    {busy ? "Salvando…" : "Salvar registro"}
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

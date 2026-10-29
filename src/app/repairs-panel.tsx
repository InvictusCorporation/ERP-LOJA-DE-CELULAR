"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useId,
  cloneElement,
  type ReactElement,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  Wrench,
  Plus,
  Search,
  ArrowLeft,
  Check,
  X,
  Camera,
  ClipboardList,
  UserRound,
  Package,
  History,
  Printer,
  Download,
  ArrowUpRight,
  ShieldCheck,
  Clock,
  FileCheck2,
  RotateCcw,
} from "lucide-react";
import { formatCents, toCents } from "../shared/money";
import "./repairs.css";
type Row = Record<string, any>;
type Props = {
  branch: string;
  permissions: string[];
  mutate: (path: string, body: unknown, method?: string) => Promise<any>;
  onNotice: (text: string, error?: boolean) => void;
};
type Dialog =
  | "intake"
  | "info"
  | "diagnosis"
  | "quote"
  | "approval"
  | "issue"
  | "return"
  | "finish"
  | "delivery"
  | "cancel"
  | null;
type QuoteLine = {
  product_id: string;
  name: string;
  quantity: number;
  price: string;
};
const statuses: Row = {
  received: "Recebida",
  diagnosis: "Em diagnóstico",
  awaiting_approval: "Aguardando aprovação",
  approved: "Aprovada",
  in_repair: "Em reparo",
  ready: "Pronta para retirada",
  declined: "Orçamento recusado",
  cancelled: "Serviço cancelado",
  delivered: "Entregue",
};
const actions: Row = {
  received: "Equipamento recebido",
  assigned: "Responsável atualizado",
  diagnosed: "Diagnóstico registrado",
  quoted: "Orçamento emitido",
  approved: "Cliente aprovou",
  declined: "Cliente recusou",
  part_used: "Peça utilizada",
  part_returned: "Peça devolvida ao estoque",
  started: "Reparo iniciado",
  ready: "Reparo concluído",
  cancelled: "Serviço cancelado",
  delivered: "Equipamento entregue",
  photo_added: "Foto adicionada",
};
const channels: Row = {
  in_person: "Presencial",
  phone: "Telefone",
  whatsapp: "WhatsApp",
  email: "E-mail",
};
const outcomes: Row = {
  ready: "Reparo realizado",
  declined: "Sem reparo: orçamento recusado",
  cancelled: "Sem reparo: serviço cancelado",
};
const when = (s: string) =>
  new Date(s).toLocaleString("pt-BR", { timeZone: "America/Fortaleza" });
const day = (s: string | null) =>
  s ? s.split("-").reverse().join("/") : "Não informada";
const decimal = (n: unknown) => (Number(n || 0) / 100).toFixed(2);
async function get(path: string) {
  const r = await fetch("/api" + path, { cache: "no-store" });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || "Falha ao consultar a assistência.");
  return data;
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
      {cloneElement(children as ReactElement<any>, {
        id,
        "aria-describedby": hint ? `${id}-hint` : undefined,
      })}
      {hint && <small id={`${id}-hint`}>{hint}</small>}
    </div>
  );
}
function Badge({ status }: { status: string }) {
  return (
    <span
      className={`badge ${["approved", "ready", "delivered"].includes(status) ? "green" : ["awaiting_approval", "declined", "cancelled"].includes(status) ? "yellow" : "neutral"}`}
    >
      {statuses[status] || status}
    </span>
  );
}
function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  return (
    <div className="service-overlay">
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`service-modal ${wide ? "wide" : ""}`}
      >
        <header className="modal-header no-print">
          <div>
            <span className="eyebrow">ASSISTÊNCIA TÉCNICA</span>
            <h2>{title}</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Fechar janela da assistência"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
function EventText({ event }: { event: Row }) {
  const d = event.details || {};
  return (
    <p>
      {d.diagnosis ||
        d.work_report ||
        d.reason ||
        (event.action === "quoted"
          ? `Revisão ${d.revision} · ${formatCents(d.total_cents)}`
          : event.action === "approved" || event.action === "declined"
            ? `${d.customer_representative} · ${channels[d.channel]} · ${d.reference}`
            : event.action === "part_used" || event.action === "part_returned"
              ? `${d.quantity} un. · ${d.product_name}`
              : event.action === "photo_added"
                ? d.filename
                : event.action === "delivered"
                  ? `Recebido por ${d.receiver_name} · ${d.notes || ""}`
                  : event.action === "received"
                    ? d.customer_name
                    : "Atualização registrada na ordem.")}
    </p>
  );
}
export default function RepairsPanel({
  branch,
  permissions,
  mutate,
  onNotice,
}: Props) {
  const can = (p: string) => permissions.includes(p),
    manage = can("service_manage");
  const [data, setData] = useState<Row>({}),
    [query, setQuery] = useState(""),
    [status, setStatus] = useState(""),
    [page, setPage] = useState(1),
    [selected, setSelected] = useState(""),
    [detail, setDetail] = useState<Row | null>(null),
    [tab, setTab] = useState("summary"),
    [dialog, setDialog] = useState<Dialog>(null),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [techs, setTechs] = useState<Row[]>([]),
    [customers, setCustomers] = useState<Row[]>([]),
    [customerMode, setCustomerMode] = useState("new"),
    [customerQuery, setCustomerQuery] = useState(""),
    [parts, setParts] = useState<Row[]>([]),
    [partQuery, setPartQuery] = useState(""),
    [quoteLines, setQuoteLines] = useState<QuoteLine[]>([]),
    [labor, setLabor] = useState("0.00"),
    [chosen, setChosen] = useState<Row | null>(null),
    [receipt, setReceipt] = useState(false);
  const sequence = useRef(0),
    busyRef = useRef(false);
  const o = detail?.order;
  const currentQuote = detail?.quotes.find(
    (q: Row) => q.id === o?.current_quote_id,
  );
  const currentItems =
    detail?.items.filter((p: Row) => p.quote_id === o?.current_quote_id) || [];
  const reload = useCallback(async () => {
    const seq = ++sequence.current;
    setLoading(true);
    try {
      const r = await get(
        `/repairs?branch_id=${branch}&q=${encodeURIComponent(query)}&status=${status}&page=${page}`,
      );
      if (seq !== sequence.current) return;
      setData(r);
      if (selected) {
        const d = await get(`/repairs/${selected}`);
        if (seq === sequence.current) setDetail(d);
      }
    } catch (e: any) {
      onNotice(e.message, true);
    } finally {
      if (seq === sequence.current) setLoading(false);
    }
  }, [branch, query, status, page, selected]);
  useEffect(() => {
    const t = setTimeout(() => void reload(), 180);
    return () => {
      clearTimeout(t);
      sequence.current++;
    };
  }, [reload]);
  useEffect(() => {
    if (!manage) return;
    get(`/repairs/technicians?branch_id=${branch}`)
      .then((r) => setTechs(r.items))
      .catch((e) => onNotice(e.message, true));
  }, [branch, manage]);
  useEffect(() => {
    if (dialog !== "intake" || !manage) return;
    let active = true;
    const t = setTimeout(
      () =>
        get(`/repairs/customers?q=${encodeURIComponent(customerQuery)}`)
          .then((r) => {
            if (active) setCustomers(r.items);
          })
          .catch((e) => onNotice(e.message, true)),
      180,
    );
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [dialog, customerQuery, manage]);
  useEffect(() => {
    if (dialog !== "quote") return;
    let active = true;
    const t = setTimeout(
      () =>
        get(`/products?branch_id=${branch}&q=${encodeURIComponent(partQuery)}`)
          .then((r) => {
            if (active)
              setParts(r.items.filter((p: Row) => !p.serialized && p.active));
          })
          .catch((e) => onNotice(e.message, true)),
      180,
    );
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [dialog, partQuery, branch]);
  const open = (kind: Dialog, item: Row | null = null) => {
    setChosen(item);
    setDialog(kind);
    if (kind === "intake") {
      setCustomerMode("new");
      setCustomerQuery("");
    }
    if (kind === "quote") {
      setPartQuery("");
      setQuoteLines(
        currentItems.map((p: Row) => ({
          product_id: p.product_id,
          name: p.product_name,
          quantity: p.quantity,
          price: decimal(p.unit_price_cents),
        })),
      );
      setLabor(decimal(currentQuote?.labor_price_cents));
    }
  };
  const loadOrder = (id: string) => {
    setLoading(true);
    setDetail(null);
    setSelected(id);
    setTab("summary");
  };
  const execute = async (action: string, body: Row) =>
    mutate(`/repairs/${selected}/${action}`, { version: o!.version, ...body });
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    const f = new FormData(e.currentTarget),
      value = (k: string) => String(f.get(k) || "").trim();
    try {
      if (dialog === "intake") {
        const r = await mutate("/repairs", {
          branch_id: branch,
          ...(customerMode === "existing"
            ? { customer_id: value("customer_id") }
            : {
                customer: {
                  name: value("customer_name"),
                  phone: value("customer_phone"),
                  email: value("customer_email"),
                  contact_permission: f.has("contact_permission"),
                },
              }),
          brand: value("brand"),
          model: value("model"),
          color: value("color"),
          imei: value("imei"),
          serial: value("serial"),
          reported_fault: value("reported_fault"),
          physical_state: value("physical_state"),
          accessories: value("accessories"),
          intake_notes: value("intake_notes"),
          technician_id: value("technician_id") || null,
          due_on: value("due_on") || null,
        });
        await loadOrder(r.id);
      }
      if (dialog === "info")
        await execute("info", {
          technician_id: value("technician_id") || null,
          due_on: value("due_on") || null,
          intake_notes: value("intake_notes"),
        });
      if (dialog === "diagnosis")
        await execute("diagnosis", { diagnosis: value("diagnosis") });
      if (dialog === "quote")
        await execute("quote", {
          labor_price_cents: toCents(labor),
          labor_cost_cents: toCents(value("labor_cost")),
          items: quoteLines.map((l) => ({
            product_id: l.product_id,
            quantity: l.quantity,
            unit_price_cents: toCents(l.price),
          })),
          warranty_days: Number(value("warranty_days")),
          warranty_terms: value("warranty_terms"),
          notes: value("notes"),
        });
      if (dialog === "approval")
        await execute("approval", {
          quote_id: o!.current_quote_id,
          decision: value("decision"),
          customer_representative: value("representative"),
          channel: value("channel"),
          reference: value("reference"),
        });
      if (dialog === "issue" || dialog === "return")
        await execute("parts", {
          kind: dialog,
          quantity: Number(value("quantity")),
          ...(dialog === "issue"
            ? { quote_item_id: chosen!.id }
            : { issue_id: chosen!.id }),
          reason: value("reason"),
        });
      if (dialog === "finish")
        await execute("work", {
          action: "finish",
          work_report: value("work_report"),
        });
      if (dialog === "cancel")
        await execute("cancel", { reason: value("reason") });
      if (dialog === "delivery")
        await execute("delivery", {
          receiver_name: value("receiver_name"),
          notes: value("delivery_notes"),
          confirmed: f.has("confirmed"),
        });
      await reload();
      setDialog(null);
      onNotice("Ordem de serviço atualizada.");
      if (dialog === "delivery") setReceipt(true);
    } catch (e: any) {
      onNotice(e.message, true);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const upload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget,
      files = [...(input.files || [])];
    if (!files.length || busyRef.current) return;
    setBusy(true);
    busyRef.current = true;
    try {
      for (const file of files) {
        if (file.size > 5 * 1024 * 1024)
          throw new Error("Cada foto deve ter até 5 MB.");
        const encoded = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result).split(",")[1]);
          r.onerror = () => reject(new Error("Falha ao ler a foto."));
          r.readAsDataURL(file);
        });
        await mutate(`/repairs/${selected}/photos`, {
          filename: file.name.slice(0, 120),
          data: encoded,
        });
      }
      await reload();
      onNotice("Fotos registradas na ordem.");
    } catch (err: any) {
      onNotice(err.message, true);
    } finally {
      setBusy(false);
      busyRef.current = false;
      input.value = "";
    }
  };
  const start = async () => {
    if (busyRef.current) return;
    setBusy(true);
    busyRef.current = true;
    try {
      await execute("work", { action: "start" });
      await reload();
      onNotice("Reparo iniciado.");
    } catch (e: any) {
      onNotice(e.message, true);
    } finally {
      setBusy(false);
      busyRef.current = false;
    }
  };
  const download = () => {
    if (!detail) return;
    const order = detail.order;
    const contents = [
      order.company_name,
      order.branch_name,
      "COMPROVANTE DE ENTREGA — NÃO FISCAL",
      order.code,
      `Cliente: ${order.customer_name}`,
      `Aparelho: ${order.brand} ${order.model} ${order.color}`,
      `IMEI: ${order.imei || "Não informado"} · Série: ${order.serial || "Não informada"}`,
      `Defeito relatado: ${order.reported_fault}`,
      `Diagnóstico: ${order.diagnosis}`,
      `Serviço realizado: ${order.work_report || "Sem reparo realizado"}`,
      `Resultado: ${outcomes[order.delivery_outcome]}`,
      `Valor do serviço: ${formatCents(detail.totals.actual_cents)}`,
      `Garantia: ${order.warranty_days} dias · Até ${day(order.warranty_expires_on)}`,
      order.warranty_terms,
      `Entregue em: ${when(order.delivered_at)}`,
      `Recebedor: ${order.receiver_name}`,
      order.delivery_notes,
      "Registro manual de entrega. Este documento não comprova pagamento.",
    ].join("\n");
    const url = URL.createObjectURL(
      new Blob([contents], { type: "text/plain;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `entrega-${order.id}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  let quoteTotal = 0;
  try {
    quoteTotal =
      toCents(labor) +
      quoteLines.reduce((n, l) => n + toCents(l.price) * l.quantity, 0);
  } catch {}
  const editable = o && o.status !== "delivered";
  const technicianSelect = (initial?: string) => (
    <select name="technician_id" defaultValue={initial || ""}>
      <option value="">Atribuir depois</option>
      {techs.map((t) => (
        <option key={t.id} value={t.id}>
          {t.name}
        </option>
      ))}
    </select>
  );
  return (
    <div className="service-module" aria-busy={loading}>
      {!selected ? (
        <>
          <div className="metrics service-metrics">
            {[
              { key: "open", label: "Ordens em aberto", icon: ClipboardList },
              { key: "approval", label: "Aguardando aprovação", icon: Clock },
              { key: "repairing", label: "Em reparo", icon: Wrench },
              { key: "pickup", label: "Aguardando retirada", icon: Package },
            ].map((m, index) => (
              <article
                className={`metric ${index === 0 ? "featured" : ""}`}
                key={m.key}
              >
                <div>
                  <span>{m.label}</span>
                  <m.icon size={20} />
                </div>
                <strong>{data.stats?.[m.key] ?? "—"}</strong>
                <small>
                  {manage ? "Filial selecionada" : "Ordens atribuídas a você"}
                </small>
              </article>
            ))}
          </div>
          <section className="panel">
            <div className="table-toolbar">
              <div className="search">
                <Search size={18} />
                <input
                  aria-label="Buscar ordem de serviço"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setPage(1);
                  }}
                  placeholder="Cliente, aparelho, IMEI, série ou código da OS"
                />
              </div>
              <select
                aria-label="Filtrar status da assistência"
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">Todos os status</option>
                {Object.entries(statuses).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
              {manage && (
                <button className="primary" onClick={() => open("intake")}>
                  <Plus size={17} />
                  Nova ordem de serviço
                </button>
              )}
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Cliente / aparelho</th>
                    <th>Situação</th>
                    <th>Técnico</th>
                    <th>Previsão</th>
                    <th>Orçamento</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.items?.map((r: Row) => (
                    <tr key={r.id}>
                      <td>
                        <strong>{r.customer_name}</strong>
                        <small>
                          {r.brand} {r.model} ·{" "}
                          {r.imei || r.serial || r.customer_phone}
                        </small>
                        <small className="mono service-code">{r.code}</small>
                      </td>
                      <td>
                        <Badge status={r.status} />
                      </td>
                      <td>{r.technician_name || "A atribuir"}</td>
                      <td>{day(r.due_on)}</td>
                      <td>
                        {r.total_cents === null
                          ? "—"
                          : formatCents(r.total_cents)}
                      </td>
                      <td>
                        <button
                          className="secondary small"
                          aria-label={`Abrir OS de ${r.customer_name}`}
                          onClick={() => void loadOrder(r.id)}
                        >
                          Abrir OS
                          <ArrowUpRight size={15} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!data.items?.length && (
              <div className="empty">
                <div className="empty-icon">
                  <Wrench size={30} />
                </div>
                <h3>Nenhuma ordem nesta consulta</h3>
                <p>Receba o aparelho e acompanhe cada etapa do atendimento.</p>
                {manage && (
                  <button className="primary" onClick={() => open("intake")}>
                    <Plus size={16} />
                    Receber aparelho
                  </button>
                )}
              </div>
            )}
            <div className="pagination">
              <span>
                Página {page} · {data.total || 0} registros
              </span>
              <div>
                <button
                  className="secondary small"
                  disabled={page === 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Anterior
                </button>
                <button
                  className="secondary small"
                  disabled={page * 30 >= (data.total || 0)}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Próxima
                </button>
              </div>
            </div>
          </section>
        </>
      ) : (
        detail && (
          <>
            <div className="service-order-header">
              <div>
                <button
                  className="text-button inline"
                  onClick={() => {
                    setSelected("");
                    setDetail(null);
                    setTab("summary");
                  }}
                >
                  <ArrowLeft size={16} />
                  Voltar às ordens
                </button>
                <h2>
                  {o!.brand} {o!.model}
                </h2>
                <p className="mono">{o!.code}</p>
              </div>
              <Badge status={o!.status} />
            </div>
            <div className="service-action-bar">
              {manage && editable && (
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => open("info")}
                >
                  <UserRound size={16} />
                  Responsável e previsão
                </button>
              )}
              {can("service_work") &&
                editable &&
                !["ready", "declined", "cancelled"].includes(o!.status) && (
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => open("diagnosis")}
                  >
                    Registrar diagnóstico
                  </button>
                )}
              {manage &&
                editable &&
                !["ready", "cancelled"].includes(o!.status) && (
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => open("quote")}
                  >
                    {currentQuote ? "Revisar orçamento" : "Preparar orçamento"}
                  </button>
                )}
              {can("service_approve") && o!.status === "awaiting_approval" && (
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => open("approval")}
                >
                  <FileCheck2 size={16} />
                  Registrar resposta do cliente
                </button>
              )}
              {can("service_work") && o!.status === "approved" && (
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => void start()}
                >
                  <Wrench size={16} />
                  Iniciar reparo
                </button>
              )}
              {can("service_work") &&
                ["approved", "in_repair"].includes(o!.status) && (
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() => open("finish")}
                  >
                    <Check size={16} />
                    Concluir reparo
                  </button>
                )}
              {can("service_deliver") &&
                ["ready", "declined", "cancelled"].includes(o!.status) && (
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() => open("delivery")}
                  >
                    Registrar entrega
                    <ArrowUpRight size={16} />
                  </button>
                )}
              {o!.status === "delivered" && (
                <button className="primary" onClick={() => setReceipt(true)}>
                  <Printer size={16} />
                  Comprovante de entrega
                </button>
              )}
            </div>
            <div className="service-tabs">
              {[
                { id: "summary", label: "Atendimento" },
                { id: "budget", label: "Orçamentos" },
                { id: "parts", label: "Peças e custos" },
                { id: "photos", label: "Fotos" },
                { id: "timeline", label: "Histórico" },
              ].map((t) => (
                <button
                  key={t.id}
                  className={tab === t.id ? "active" : ""}
                  onClick={() => setTab(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </div>
            {tab === "summary" && (
              <div className="service-detail-grid">
                <section className="panel">
                  <div className="panel-heading">
                    <h2>Cliente e equipamento</h2>
                    <UserRound size={20} />
                  </div>
                  <dl className="service-details">
                    <dt>Cliente</dt>
                    <dd>
                      {o!.customer_name}
                      <small>
                        {o!.customer_phone}
                        {o!.customer_email ? ` · ${o!.customer_email}` : ""}
                      </small>
                    </dd>
                    <dt>Aparelho</dt>
                    <dd>
                      {o!.brand} {o!.model} {o!.color}
                    </dd>
                    <dt>Identificação</dt>
                    <dd>
                      IMEI: {o!.imei || "Não informado"}
                      <small>Série: {o!.serial || "Não informada"}</small>
                    </dd>
                    <dt>Defeito relatado</dt>
                    <dd>{o!.reported_fault}</dd>
                    <dt>Estado físico</dt>
                    <dd>{o!.physical_state}</dd>
                    <dt>Acessórios recebidos</dt>
                    <dd>{o!.accessories || "Nenhum informado"}</dd>
                    <dt>Observações</dt>
                    <dd>{o!.intake_notes || "Sem observações"}</dd>
                  </dl>
                </section>
                <section className="panel">
                  <div className="panel-heading">
                    <h2>Acompanhamento técnico</h2>
                    <Wrench size={20} />
                  </div>
                  <dl className="service-details">
                    <dt>Técnico</dt>
                    <dd>{o!.technician_name || "A atribuir"}</dd>
                    <dt>Previsão de entrega</dt>
                    <dd>{day(o!.due_on)}</dd>
                    <dt>Diagnóstico</dt>
                    <dd>{o!.diagnosis || "Aguardando avaliação técnica"}</dd>
                    <dt>Serviço realizado</dt>
                    <dd>{o!.work_report || "Ainda não concluído"}</dd>
                    <dt>Garantia prevista</dt>
                    <dd>
                      {o!.warranty_days} dias<small>{o!.warranty_terms}</small>
                      {o!.warranty_expires_on && (
                        <small>Até {day(o!.warranty_expires_on)}</small>
                      )}
                    </dd>
                  </dl>
                  {manage && editable && o!.status !== "cancelled" && (
                    <div className="service-cancel">
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() => open("cancel")}
                      >
                        Cancelar serviço
                      </button>
                    </div>
                  )}
                </section>
                {!!detail.device_history.length && (
                  <section className="panel service-span">
                    <div className="panel-heading">
                      <h2>Histórico deste aparelho</h2>
                      <History size={20} />
                    </div>
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Ordem anterior</th>
                            <th>Situação</th>
                            <th>Recebida em</th>
                            <th />
                          </tr>
                        </thead>
                        <tbody>
                          {detail.device_history.map((h: Row) => (
                            <tr key={h.id}>
                              <td className="mono service-code">{h.code}</td>
                              <td>
                                <Badge status={h.status} />
                              </td>
                              <td>{when(h.created_at)}</td>
                              <td>
                                <button
                                  className="secondary small"
                                  onClick={() => void loadOrder(h.id)}
                                >
                                  Consultar
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                )}
              </div>
            )}
            {tab === "budget" && (
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <h2>Revisões do orçamento</h2>
                    <p>Propostas e respostas preservadas para conferência</p>
                  </div>
                </div>
                {detail.quotes.length ? (
                  detail.quotes.map((q: Row) => {
                    const reply = detail.approvals.find(
                        (a: Row) => a.quote_id === q.id,
                      ),
                      lines = detail.items.filter(
                        (p: Row) => p.quote_id === q.id,
                      );
                    return (
                      <article className="service-quote" key={q.id}>
                        <header>
                          <div>
                            <strong>Revisão {q.revision}</strong>
                            <small>
                              {when(q.created_at)} · {q.author_name}
                            </small>
                          </div>
                          <span className="badge">
                            {q.id === o!.current_quote_id
                              ? "Orçamento atual"
                              : "Revisão anterior"}
                          </span>
                          <b>{formatCents(q.total_cents)}</b>
                        </header>
                        <div className="table-wrap">
                          <table>
                            <thead>
                              <tr>
                                <th>Peça prevista</th>
                                <th>Qtd.</th>
                                <th>Preço unitário</th>
                                <th>Subtotal</th>
                              </tr>
                            </thead>
                            <tbody>
                              {lines.map((l: Row) => (
                                <tr key={l.id}>
                                  <td>{l.product_name}</td>
                                  <td>{l.quantity}</td>
                                  <td>{formatCents(l.unit_price_cents)}</td>
                                  <td>
                                    {formatCents(
                                      l.quantity * l.unit_price_cents,
                                    )}
                                  </td>
                                </tr>
                              ))}
                              <tr>
                                <td>Mão de obra</td>
                                <td>1</td>
                                <td>{formatCents(q.labor_price_cents)}</td>
                                <td>{formatCents(q.labor_price_cents)}</td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                        <p>
                          Garantia: {q.warranty_days} dias ·{" "}
                          {q.warranty_terms || "Condições não informadas"}
                        </p>
                        {q.notes && <p>{q.notes}</p>}
                        <div className="service-approval-record">
                          {reply ? (
                            <>
                              <Badge status={reply.decision} />
                              <span>
                                {reply.customer_representative} ·{" "}
                                {channels[reply.channel]} · {reply.reference}
                                <small>
                                  Registrado por {reply.recorder_name} em{" "}
                                  {when(reply.created_at)}
                                </small>
                              </span>
                            </>
                          ) : (
                            <span>
                              Aguardando registro da resposta do cliente.
                            </span>
                          )}
                        </div>
                      </article>
                    );
                  })
                ) : (
                  <div className="empty">
                    <ClipboardList size={30} />
                    <h3>O orçamento começa pelo diagnóstico</h3>
                    <p>
                      Defina o responsável e registre a avaliação técnica para
                      preparar a proposta.
                    </p>
                  </div>
                )}
              </section>
            )}
            {tab === "parts" && (
              <>
                <div className="metrics service-cost-metrics">
                  <article className="metric">
                    <div>
                      <span>Orçamento aprovado/proposto</span>
                    </div>
                    <strong className="money">
                      {formatCents(detail.totals.quoted_cents)}
                    </strong>
                    <small>Valor máximo da proposta atual</small>
                  </article>
                  <article className="metric featured">
                    <div>
                      <span>Valor apurado do serviço</span>
                    </div>
                    <strong className="money">
                      {formatCents(detail.totals.actual_cents)}
                    </strong>
                    <small>Mão de obra e peças efetivamente utilizadas</small>
                  </article>
                  {can("service_cost") && (
                    <article className="metric">
                      <div>
                        <span>Custo estimado/apurado</span>
                      </div>
                      <strong className="money">
                        {formatCents(detail.totals.cost_cents)}
                      </strong>
                      <small>
                        Peças ao custo de utilização e mão de obra informada
                      </small>
                    </article>
                  )}
                </div>
                <section className="panel">
                  <div className="panel-heading">
                    <h2>Peças do orçamento atual</h2>
                    <Package size={20} />
                  </div>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Peça</th>
                          <th>Aprovado</th>
                          <th>Utilizado líquido</th>
                          <th>Preço unitário</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {currentItems.map((p: Row) => (
                          <tr key={p.id}>
                            <td>
                              <strong>{p.product_name}</strong>
                              <small>{p.sku}</small>
                            </td>
                            <td>{p.quantity}</td>
                            <td>{p.used_quantity}</td>
                            <td>{formatCents(p.unit_price_cents)}</td>
                            <td>
                              {can("service_parts") &&
                                ["approved", "in_repair"].includes(o!.status) &&
                                p.used_quantity < p.quantity && (
                                  <button
                                    className="secondary small"
                                    disabled={busy}
                                    onClick={() => open("issue", p)}
                                  >
                                    Utilizar peça
                                  </button>
                                )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {!currentItems.length && (
                    <div className="compact-empty">
                      Nenhuma peça prevista na proposta atual.
                    </div>
                  )}
                </section>
                <section className="panel service-parts-history">
                  <div className="panel-heading">
                    <h2>Utilizações e devoluções</h2>
                  </div>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Peça / operação</th>
                          <th>Quantidade</th>
                          {can("service_cost") && <th>Custo unitário</th>}
                          <th>Motivo</th>
                          <th>Responsável</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {detail.parts.map((p: Row) => (
                          <tr key={p.id}>
                            <td>
                              <strong>{p.product_name}</strong>
                              <small>
                                {p.kind === "issue"
                                  ? "Utilização"
                                  : "Devolução ao estoque"}
                              </small>
                            </td>
                            <td>
                              {p.quantity}
                              {p.kind === "issue" &&
                                p.returned_quantity > 0 && (
                                  <small>
                                    Devolvido: {p.returned_quantity}
                                  </small>
                                )}
                            </td>
                            {can("service_cost") && (
                              <td>{formatCents(p.unit_cost_cents)}</td>
                            )}
                            <td className="reason">{p.reason}</td>
                            <td>{p.actor_name}</td>
                            <td>
                              {can("service_parts") &&
                                ["approved", "in_repair", "ready"].includes(
                                  o!.status,
                                ) &&
                                p.kind === "issue" &&
                                p.returned_quantity < p.quantity && (
                                  <button
                                    className="secondary small"
                                    disabled={busy}
                                    onClick={() => open("return", p)}
                                  >
                                    <RotateCcw size={14} />
                                    Devolver peça
                                  </button>
                                )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {!detail.parts.length && (
                    <div className="compact-empty">
                      As peças ainda não foram movimentadas.
                    </div>
                  )}
                </section>
              </>
            )}
            {tab === "photos" && (
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <h2>Fotos do equipamento</h2>
                    <p>
                      JPG, PNG ou WebP · até 5 MB por arquivo · máximo de 12
                      fotos
                    </p>
                  </div>
                  {can("service_work") &&
                    editable &&
                    o!.status !== "cancelled" && (
                      <label className="secondary service-upload">
                        <Camera size={16} />
                        {busy ? "Enviando…" : "Adicionar fotos"}
                        <input
                          aria-label="Adicionar fotos do aparelho"
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          multiple
                          disabled={busy || detail.photos.length >= 12}
                          onChange={(e) => void upload(e)}
                        />
                      </label>
                    )}
                </div>
                <div className="service-photo-grid">
                  {detail.photos.map((p: Row) => (
                    <a
                      key={p.id}
                      href={`/api/repairs/${selected}/photos/${p.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <img
                        src={`/api/repairs/${selected}/photos/${p.id}`}
                        alt={p.filename}
                      />
                      <strong>{p.filename}</strong>
                      <small>{when(p.created_at)}</small>
                    </a>
                  ))}
                </div>
                {!detail.photos.length && (
                  <div className="empty">
                    <Camera size={32} />
                    <h3>Documente o estado do aparelho</h3>
                    <p>
                      As fotos ficam vinculadas à ordem e protegidas pelas
                      permissões de acesso.
                    </p>
                  </div>
                )}
              </section>
            )}
            {tab === "timeline" && (
              <section className="panel">
                <div className="panel-heading">
                  <h2>Histórico auditável da ordem</h2>
                  <ShieldCheck size={20} />
                </div>
                <ol className="service-timeline">
                  {detail.timeline.map((e: Row) => (
                    <li key={e.id}>
                      <span className="service-timeline-dot" />
                      <div>
                        <strong>{actions[e.action] || e.action}</strong>
                        <EventText event={e} />
                        <small>
                          {e.actor_name} · {when(e.created_at)}
                        </small>
                      </div>
                    </li>
                  ))}
                </ol>
              </section>
            )}
          </>
        )
      )}
      <div className="info-strip">
        <ShieldCheck size={18} />
        <span>
          Peças são baixadas após aprovação. A entrega preserva o histórico do
          equipamento e inicia o prazo de garantia informado.
        </span>
      </div>
      {dialog && (
        <Modal
          title={
            (
              {
                intake: "Receber aparelho",
                info: "Responsável e previsão",
                diagnosis: "Registrar diagnóstico",
                quote: "Preparar orçamento",
                approval: "Registrar resposta do cliente",
                issue: "Utilizar peça no reparo",
                return: "Devolver peça ao estoque",
                finish: "Concluir reparo",
                delivery: "Registrar entrega do aparelho",
                cancel: "Cancelar serviço",
              } as Row
            )[dialog]
          }
          wide={dialog === "intake" || dialog === "quote"}
          onClose={() => {
            if (!busy) setDialog(null);
          }}
        >
          <form onSubmit={submit}>
            <div className="modal-body">
              {dialog === "intake" && (
                <>
                  <div className="form-section">CLIENTE</div>
                  <div className="service-customer-mode">
                    <button
                      type="button"
                      className={customerMode === "new" ? "selected" : ""}
                      onClick={() => setCustomerMode("new")}
                    >
                      Novo cliente
                    </button>
                    <button
                      type="button"
                      className={customerMode === "existing" ? "selected" : ""}
                      onClick={() => setCustomerMode("existing")}
                    >
                      Cliente existente
                    </button>
                  </div>
                  {customerMode === "existing" ? (
                    <>
                      <Field label="Buscar cliente">
                        <input
                          value={customerQuery}
                          onChange={(e) => setCustomerQuery(e.target.value)}
                          placeholder="Nome ou telefone"
                        />
                      </Field>
                      <Field label="Cliente do atendimento">
                        <select name="customer_id" required>
                          <option value="">Selecione o cliente</option>
                          {customers.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name} · {c.phone}
                            </option>
                          ))}
                        </select>
                      </Field>
                    </>
                  ) : (
                    <>
                      <div className="form-grid">
                        <Field label="Nome do cliente">
                          <input
                            name="customer_name"
                            required
                            maxLength={180}
                            autoFocus
                          />
                        </Field>
                        <Field label="Telefone do cliente">
                          <input
                            name="customer_phone"
                            type="tel"
                            required
                            maxLength={25}
                          />
                        </Field>
                        <Field label="E-mail do cliente">
                          <input
                            name="customer_email"
                            type="email"
                            maxLength={254}
                          />
                        </Field>
                      </div>
                      <label className="check-label service-consent">
                        <input name="contact_permission" type="checkbox" />
                        Cliente permite contato sobre o atendimento
                      </label>
                    </>
                  )}
                  <div className="form-section">EQUIPAMENTO RECEBIDO</div>
                  <div className="form-grid">
                    <Field label="Marca do aparelho">
                      <input name="brand" required maxLength={100} />
                    </Field>
                    <Field label="Modelo do aparelho">
                      <input name="model" required maxLength={150} />
                    </Field>
                    <Field label="Cor do aparelho">
                      <input name="color" maxLength={80} />
                    </Field>
                    <Field label="IMEI do aparelho">
                      <input name="imei" inputMode="numeric" maxLength={15} />
                    </Field>
                    <Field label="Número de série">
                      <input name="serial" maxLength={100} />
                    </Field>
                    <Field label="Técnico responsável">
                      {technicianSelect()}
                    </Field>
                    <Field label="Previsão de entrega">
                      <input name="due_on" type="date" />
                    </Field>
                  </div>
                  <Field label="Defeito relatado pelo cliente">
                    <textarea
                      name="reported_fault"
                      required
                      maxLength={2000}
                      rows={2}
                    />
                  </Field>
                  <Field label="Estado físico na entrada">
                    <textarea
                      name="physical_state"
                      required
                      maxLength={2000}
                      rows={2}
                    />
                  </Field>
                  <Field label="Acessórios recebidos">
                    <input name="accessories" maxLength={2000} />
                  </Field>
                  <Field label="Observações do recebimento">
                    <textarea name="intake_notes" maxLength={2000} rows={2} />
                  </Field>
                </>
              )}
              {dialog === "info" && (
                <>
                  <Field label="Técnico responsável">
                    {technicianSelect(o!.technician_id)}
                  </Field>
                  <Field label="Previsão de entrega">
                    <input
                      name="due_on"
                      type="date"
                      defaultValue={o!.due_on || ""}
                    />
                  </Field>
                  <Field label="Observações do recebimento">
                    <textarea
                      name="intake_notes"
                      maxLength={2000}
                      defaultValue={o!.intake_notes}
                    />
                  </Field>
                </>
              )}
              {dialog === "diagnosis" && (
                <Field label="Diagnóstico técnico">
                  <textarea
                    name="diagnosis"
                    rows={6}
                    required
                    maxLength={2000}
                    autoFocus
                    defaultValue={o!.diagnosis}
                  />
                </Field>
              )}
              {dialog === "quote" && (
                <>
                  <div className="form-grid">
                    <Field label="Mão de obra — preço (R$)">
                      <input
                        inputMode="decimal"
                        value={labor}
                        onChange={(e) => setLabor(e.target.value)}
                        required
                      />
                    </Field>
                    <Field label="Mão de obra — custo estimado (R$)">
                      <input
                        name="labor_cost"
                        inputMode="decimal"
                        defaultValue={decimal(currentQuote?.labor_cost_cents)}
                        required
                      />
                    </Field>
                  </div>
                  <Field label="Buscar peça para orçamento">
                    <input
                      value={partQuery}
                      onChange={(e) => setPartQuery(e.target.value)}
                      placeholder="Nome, SKU ou código"
                    />
                  </Field>
                  <Field label="Adicionar peça ao orçamento">
                    <select
                      value=""
                      onChange={(e) => {
                        const p = parts.find((p) => p.id === e.target.value);
                        if (p && !quoteLines.some((l) => l.product_id === p.id))
                          setQuoteLines((old) => [
                            ...old,
                            {
                              product_id: p.id,
                              name: p.name,
                              quantity: 1,
                              price: String(p.price),
                            },
                          ]);
                      }}
                    >
                      <option value="">Selecione uma peça</option>
                      {parts
                        .filter(
                          (p) => !quoteLines.some((l) => l.product_id === p.id),
                        )
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} · {p.sku}
                          </option>
                        ))}
                    </select>
                  </Field>
                  {quoteLines.map((l, index) => (
                    <div className="service-quote-line" key={l.product_id}>
                      <strong>{l.name}</strong>
                      <Field label={`Quantidade de ${l.name}`}>
                        <input
                          type="number"
                          min="1"
                          max="10000"
                          value={l.quantity}
                          onChange={(e) => {
                            const n = Number(e.target.value);
                            if (Number.isInteger(n) && n > 0)
                              setQuoteLines((old) =>
                                old.map((x, j) =>
                                  j === index ? { ...x, quantity: n } : x,
                                ),
                              );
                          }}
                        />
                      </Field>
                      <Field label={`Preço de ${l.name} (R$)`}>
                        <input
                          inputMode="decimal"
                          value={l.price}
                          required
                          onChange={(e) =>
                            setQuoteLines((old) =>
                              old.map((x, j) =>
                                j === index
                                  ? { ...x, price: e.target.value }
                                  : x,
                              ),
                            )
                          }
                        />
                      </Field>
                      <button
                        className="icon-button"
                        type="button"
                        aria-label={`Remover ${l.name} do orçamento`}
                        onClick={() =>
                          setQuoteLines((old) =>
                            old.filter((_, j) => j !== index),
                          )
                        }
                      >
                        <X size={16} />
                      </button>
                    </div>
                  ))}
                  <div className="service-quote-total">
                    <span>Valor máximo da proposta</span>
                    <strong>{formatCents(quoteTotal)}</strong>
                  </div>
                  <div className="form-grid">
                    <Field label="Garantia do serviço (dias)">
                      <input
                        name="warranty_days"
                        type="number"
                        min="0"
                        max="3650"
                        required
                        defaultValue={currentQuote?.warranty_days ?? 90}
                      />
                    </Field>
                    <Field label="Condições da garantia">
                      <textarea
                        name="warranty_terms"
                        maxLength={2000}
                        rows={2}
                        defaultValue={currentQuote?.warranty_terms || ""}
                      />
                    </Field>
                  </div>
                  <Field label="Observações da proposta">
                    <textarea
                      name="notes"
                      maxLength={2000}
                      rows={2}
                      defaultValue={currentQuote?.notes || ""}
                    />
                  </Field>
                  <p className="form-hint">
                    A proposta exige resposta do cliente. Alterar uma proposta
                    aprovada exige devolver as peças já utilizadas e obter nova
                    aprovação.
                  </p>
                </>
              )}
              {dialog === "approval" && (
                <>
                  <p className="service-quote-total">
                    Orçamento atual
                    <strong>{formatCents(currentQuote?.total_cents)}</strong>
                  </p>
                  <Field label="Resposta do cliente">
                    <select name="decision">
                      <option value="approved">Aprovou o orçamento</option>
                      <option value="declined">Recusou o orçamento</option>
                    </select>
                  </Field>
                  <Field label="Nome de quem respondeu">
                    <input
                      name="representative"
                      required
                      maxLength={180}
                      defaultValue={o!.customer_name}
                    />
                  </Field>
                  <Field label="Canal da confirmação">
                    <select name="channel">
                      {Object.entries(channels).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field
                    label="Referência da confirmação"
                    hint="Identifique a confirmação recebida do cliente para consulta posterior."
                  >
                    <textarea
                      name="reference"
                      required
                      maxLength={1000}
                      rows={3}
                    />
                  </Field>
                </>
              )}
              {(dialog === "issue" || dialog === "return") && (
                <>
                  <div className="service-selected-part">
                    <Package size={22} />
                    <strong>{chosen!.product_name}</strong>
                  </div>
                  <Field label="Quantidade da peça">
                    <input
                      name="quantity"
                      type="number"
                      min="1"
                      max={
                        dialog === "issue"
                          ? chosen!.quantity - chosen!.used_quantity
                          : chosen!.quantity - chosen!.returned_quantity
                      }
                      defaultValue="1"
                      required
                      autoFocus
                    />
                  </Field>
                  <Field label="Motivo da movimentação da peça">
                    <textarea
                      name="reason"
                      required
                      maxLength={1000}
                      rows={2}
                      defaultValue={
                        dialog === "issue"
                          ? "Peça utilizada no reparo aprovado"
                          : "Peça devolvida ao estoque após conferência"
                      }
                    />
                  </Field>
                  {o!.status === "ready" && (
                    <p className="form-hint">
                      A devolução reabre o reparo para uma nova conferência
                      antes da entrega.
                    </p>
                  )}
                </>
              )}
              {dialog === "finish" && (
                <>
                  <Field label="Serviço realizado e testes finais">
                    <textarea
                      name="work_report"
                      required
                      minLength={5}
                      maxLength={4000}
                      rows={6}
                      autoFocus
                      defaultValue={o!.work_report}
                    />
                  </Field>
                  <p className="form-hint">
                    Garantia prevista: {o!.warranty_days} dias, a partir da
                    entrega. O valor apurado considera a mão de obra e as peças
                    efetivamente utilizadas.
                  </p>
                </>
              )}
              {dialog === "delivery" && (
                <>
                  <div className="service-delivery-check">
                    <Check size={23} />
                    <span>
                      <strong>
                        {o!.brand} {o!.model}
                      </strong>
                      <small>{o!.imei || o!.serial || o!.code}</small>
                    </span>
                  </div>
                  <Field label="Nome do recebedor">
                    <input
                      name="receiver_name"
                      required
                      maxLength={180}
                      defaultValue={o!.customer_name}
                    />
                  </Field>
                  <Field label="Observações da entrega">
                    <textarea name="delivery_notes" maxLength={2000} rows={3} />
                  </Field>
                  <label className="check-box">
                    <input name="confirmed" type="checkbox" required />
                    <span>
                      <strong>
                        Conferi o aparelho e confirmei a entrega ao recebedor.
                      </strong>
                      <small>
                        O registro ficará vinculado ao usuário responsável.
                      </small>
                    </span>
                  </label>
                </>
              )}
              {dialog === "cancel" && (
                <>
                  <p className="form-hint">
                    Devolva as peças utilizadas antes de cancelar. O aparelho
                    continuará aguardando retirada até registrar a entrega.
                  </p>
                  <Field label="Motivo do cancelamento">
                    <textarea
                      name="reason"
                      required
                      maxLength={1000}
                      rows={4}
                      autoFocus
                    />
                  </Field>
                </>
              )}
            </div>
            <div className="modal-footer">
              <button
                className="secondary"
                type="button"
                disabled={busy}
                onClick={() => setDialog(null)}
              >
                Voltar
              </button>
              <button className="primary" disabled={busy}>
                {busy ? "Registrando…" : "Salvar e registrar"}
                <Check size={16} />
              </button>
            </div>
          </form>
        </Modal>
      )}
      {receipt && detail && (
        <Modal
          title="Comprovante de entrega"
          wide
          onClose={() => setReceipt(false)}
        >
          <div className="modal-body service-receipt">
            <header>
              <span className="eyebrow">ASSISTÊNCIA TÉCNICA</span>
              <h2>{o!.company_name}</h2>
              <p>{o!.branch_name}</p>
              <strong>COMPROVANTE DE ENTREGA · NÃO FISCAL</strong>
              <code>{o!.code}</code>
            </header>
            <dl className="service-details">
              <dt>Cliente</dt>
              <dd>{o!.customer_name}</dd>
              <dt>Equipamento</dt>
              <dd>
                {o!.brand} {o!.model} {o!.color}
                <small>
                  IMEI: {o!.imei || "Não informado"} · Série:{" "}
                  {o!.serial || "Não informada"}
                </small>
              </dd>
              <dt>Defeito relatado</dt>
              <dd>{o!.reported_fault}</dd>
              <dt>Diagnóstico</dt>
              <dd>{o!.diagnosis || "Não realizado"}</dd>
              <dt>Serviço realizado</dt>
              <dd>{o!.work_report || "Sem reparo realizado"}</dd>
              <dt>Resultado</dt>
              <dd>{outcomes[o!.delivery_outcome]}</dd>
              <dt>Valor do serviço</dt>
              <dd>{formatCents(detail.totals.actual_cents)}</dd>
              <dt>Garantia</dt>
              <dd>
                {o!.warranty_days} dias
                {o!.warranty_expires_on && (
                  <small>Até {day(o!.warranty_expires_on)}</small>
                )}
                <small>{o!.warranty_terms}</small>
              </dd>
              <dt>Recebedor</dt>
              <dd>{o!.receiver_name}</dd>
              <dt>Data de entrega</dt>
              <dd>{o!.delivered_at ? when(o!.delivered_at) : "—"}</dd>
              <dt>Observações</dt>
              <dd>{o!.delivery_notes || "Nenhuma"}</dd>
            </dl>
            <p className="form-hint">
              Registro manual da entrega. Este documento não comprova pagamento.
            </p>
          </div>
          <footer className="modal-footer no-print">
            <button className="secondary" onClick={() => window.print()}>
              <Printer size={16} />
              Imprimir
            </button>
            <button className="primary" onClick={download}>
              <Download size={16} />
              Baixar comprovante
            </button>
          </footer>
        </Modal>
      )}
    </div>
  );
}

"use client";
import {
  useEffect,
  useState,
  useRef,
  useId,
  cloneElement,
  type ReactElement,
  type ReactNode,
  type FormEvent,
} from "react";
import {
  Plus,
  Search,
  X,
  ArrowLeft,
  Download,
  Printer,
  RefreshCw,
  Truck,
  Trash2,
  FileText,
} from "lucide-react";
import { createPortal } from "react-dom";
import { toCents, formatCents } from "../shared/money";
import "./credit.css";
import "./purchases.css";
type Row = Record<string, any>;
type Props = {
  branch: string;
  branches: Row[];
  companyName: string;
  mutate: (path: string, body: unknown, method?: string) => Promise<any>;
  onNotice: (text: string, error?: boolean) => void;
};
const money = formatCents,
  decimal = (n: unknown) => (Number(n || 0) / 100).toFixed(2),
  day = (s: string) =>
    s ? s.slice(0, 10).split("-").reverse().join("/") : "—";
const states: Row = {
  draft: "Rascunho",
  ordered: "Aguardando entrega",
  partial: "Recebido parcialmente",
  received: "Recebido",
  cancelled: "Saldo cancelado",
};
const actions: Row = {
  draft_saved: "Rascunho salvo",
  order_issued: "Pedido confirmado",
  goods_received: "Mercadorias recebidas",
  remaining_cancelled: "Saldo pendente cancelado",
  receipt_reversed: "Recebimento estornado",
};
const now = () =>
  new Date().toLocaleDateString("sv-SE", { timeZone: "America/Fortaleza" });
async function get(path: string) {
  const r = await fetch("/api" + path, { cache: "no-store" }),
    b = await r.json();
  if (!r.ok) throw Error(b.error || "Não foi possível consultar as compras.");
  return b;
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {cloneElement(children as ReactElement<any>, { id })}
    </div>
  );
}
function csv(rows: any[][]) {
  const cell = (v: any) =>
    '"' +
    (/^[=+@\-\t\r]/.test(String(v)) ? "'" : "") +
    String(v ?? "").replace(/"/g, '""') +
    '"';
  const url = URL.createObjectURL(
    new Blob(["\uFEFF" + rows.map((r) => r.map(cell).join(";")).join("\r\n")], {
      type: "text/csv;charset=utf-8",
    }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = "compras-pagina.csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function PurchaseDocument({
  data,
  company,
  onClose,
}: {
  data: Row;
  company: string;
  onClose: () => void;
}) {
  const o = data.order,
    s = data.supplier,
    r = data.receipt;
  return createPortal(
    <div className="modal-backdrop">
      <section
        className="modal credit-document-modal"
        role="dialog"
        aria-modal="true"
        aria-label={r ? "Conferência do recebimento" : "Documento do pedido"}
      >
        <header className="modal-header no-print">
          <h2>{r ? "Conferência do recebimento" : "Pedido de compra"}</h2>
          <button
            className="icon-button"
            aria-label="Fechar documento de compra"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </header>
        <article className="credit-document">
          <header>
            <span>INVICTUS ERP MOBILE</span>
            <h1>{company}</h1>
            <h2>
              {r ? "Recebimento de mercadorias" : "Pedido interno de compra"}
            </h2>
            <p>
              {o.code} ·{" "}
              {r ? (r.reversed ? "Estornado" : "Recebido") : states[o.status]}
            </p>
          </header>
          <section>
            <h2>Fornecedor</h2>
            <p>
              <strong>{s.name}</strong> {s.document && "· " + s.document}
            </p>
            <p>
              {s.contact} {s.phone} {s.email}
            </p>
            <p>{s.address}</p>
            {r ? (
              <>
                <p>
                  Documento / entrega: <strong>{r.reference}</strong>
                </p>
                <p>
                  Recebido em {day(r.received_on)} · Vencimento {day(r.due_on)}
                </p>
              </>
            ) : (
              <p>Previsão de entrega: {day(o.expected_on)}</p>
            )}
          </section>
          <section>
            <table>
              <thead>
                <tr>
                  <th>Produto</th>
                  <th>Quantidade</th>
                  <th>Custo unitário</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {data.lines.map((l: Row) => (
                  <tr key={l.id || l.product_id}>
                    <td>
                      {l.product_name}
                      <small>{l.sku}</small>
                    </td>
                    <td>{l.quantity}</td>
                    <td>{money(l.unit_cost_cents)}</td>
                    <td>{money(l.quantity * l.unit_cost_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <h2>Total: {money(r?.total_cents || o.total_cents)}</h2>
            {data.lines.flatMap((l: Row) =>
              (l.units || []).map((u: Row) => (
                <p key={u.id}>
                  {l.product_name} · Série {u.serial || "—"} · IMEI{" "}
                  {u.imeis.join(" / ") || "—"} · {u.provenance}
                </p>
              )),
            )}
          </section>
          <section>
            <p>{o.note}</p>
            <p>
              Documento interno de conferência. Não comprova pagamento nem
              substitui documento fiscal. Confirmação do pedido não envia
              mensagem ao fornecedor.
            </p>
          </section>
        </article>
        <footer className="modal-footer no-print">
          <button className="btn primary" onClick={() => window.print()}>
            <Printer size={16} /> Imprimir documento
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
export default function PurchasesPanel({
  branch,
  branches,
  companyName,
  mutate,
  onNotice,
}: Props) {
  const [tab, setTab] = useState("orders"),
    [scope, setScope] = useState(branch),
    [query, setQuery] = useState(""),
    [status, setStatus] = useState("all"),
    [page, setPage] = useState(1),
    [rows, setRows] = useState<Row[]>([]),
    [selected, setSelected] = useState(""),
    [detail, setDetail] = useState<Row | null>(null),
    [loading, setLoading] = useState(true),
    [failed, setFailed] = useState(false),
    [revision, setRevision] = useState(0);
  const [dialog, setDialog] = useState(""),
    [editing, setEditing] = useState<Row | null>(null),
    [busy, setBusy] = useState(false),
    [doc, setDoc] = useState<Row | null>(null),
    [supplierHistory, setSupplierHistory] = useState<Row[]>([]);
  const [supplierQuery, setSupplierQuery] = useState(""),
    [suppliers, setSuppliers] = useState<Row[]>([]),
    [supplierId, setSupplierId] = useState(""),
    [orderBranch, setOrderBranch] = useState(branch),
    [productQuery, setProductQuery] = useState(""),
    [products, setProducts] = useState<Row[]>([]),
    [cart, setCart] = useState<Row[]>([]);
  const [quantities, setQuantities] = useState<Record<string, string>>({}),
    [devices, setDevices] = useState<Record<string, Row[]>>({});
  const busyRef = useRef(false);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setFailed(false);
    const timer = setTimeout(() => {
      get(
        selected
          ? `/purchases/orders/${selected}`
          : tab === "suppliers"
            ? `/purchases/suppliers?q=${encodeURIComponent(query)}&page=${page}`
            : `/purchases/orders?branch_id=${scope}&q=${encodeURIComponent(query)}&status=${status}&page=${page}`,
      )
        .then((r) => {
          if (!alive) return;
          if (selected) setDetail(r);
          else setRows(r.items);
        })
        .catch((e) => {
          if (alive) {
            setFailed(true);
            onNotice(e.message, true);
          }
        })
        .finally(() => {
          if (alive) setLoading(false);
        });
    }, 150);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [selected, tab, scope, query, status, page, revision]);
  useEffect(() => {
    if (dialog !== "order") return;
    let alive = true;
    const timer = setTimeout(() => {
      get(`/purchases/suppliers?q=${encodeURIComponent(supplierQuery)}&page=1`)
        .then((r) => {
          if (alive) setSuppliers(r.items);
        })
        .catch((e) => {
          if (alive) onNotice(e.message, true);
        });
    }, 180);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [dialog, supplierQuery]);
  useEffect(() => {
    if (dialog !== "order") return;
    let alive = true;
    const timer = setTimeout(() => {
      get(
        `/products?branch_id=${orderBranch}&q=${encodeURIComponent(productQuery)}`,
      )
        .then((r) => {
          if (alive) setProducts(r.items.filter((p: Row) => p.active));
        })
        .catch((e) => {
          if (alive) onNotice(e.message, true);
        });
    }, 180);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [dialog, productQuery, orderBranch]);
  function navigate(t: string) {
    setTab(t);
    setSelected("");
    setDetail(null);
    setQuery("");
    setRows([]);
    setPage(1);
  }
  function open(type: string, value: Row | null = null) {
    setEditing(value);
    if (type === "order") {
      setCart(
        value?.lines.map((l: Row) => ({
          ...l,
          quantity: String(l.quantity),
          cost: decimal(l.unit_cost_cents),
        })) || [],
      );
      setOrderBranch(
        value?.order.branch_id || (scope === "all" ? branch : scope),
      );
      setSupplierId(value?.order.supplier_id || "");
      setSupplierQuery("");
      setProductQuery("");
    }
    if (type === "receive") {
      setQuantities({});
      setDevices({});
    }
    setDialog(type);
  }
  async function editSupplier(id: string) {
    try {
      const r = await get(`/purchases/suppliers/${id}?branch_id=${scope}`);
      setSupplierHistory(r.orders);
      open("supplier", r.supplier);
    } catch (e: any) {
      onNotice(e.message, true);
    }
  }
  async function showReceipt(r: Row) {
    try {
      setDoc(await get(`/purchases/orders/${selected}/receipts/${r.id}`));
    } catch (e: any) {
      onNotice(e.message, true);
    }
  }
  let cartTotal = 0;
  try {
    cartTotal = cart.reduce(
      (n, l) => n + Number(l.quantity) * toCents(l.cost),
      0,
    );
  } catch {}
  const receiptTotal =
    detail?.lines.reduce(
      (n: number, l: Row) =>
        n + Number(quantities[l.id] || 0) * l.unit_cost_cents,
      0,
    ) || 0;
  function changeQuantity(l: Row, value: string) {
    setQuantities((q) => ({ ...q, [l.id]: value }));
    if (l.serialized) {
      const count = Math.max(0, Math.min(200, Number(value) || 0));
      setDevices((all) => ({
        ...all,
        [l.id]: Array.from(
          { length: count },
          (_, j) =>
            all[l.id]?.[j] || {
              serial: "",
              imeis: "",
              provenance: "Compra " + detail!.order.code,
            },
        ),
      }));
    }
  }
  function changeDevice(
    line: string,
    index: number,
    name: string,
    value: string,
  ) {
    setDevices((all) => ({
      ...all,
      [line]: all[line].map((d, j) =>
        j === index ? { ...d, [name]: value } : d,
      ),
    }));
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    const f = new FormData(e.currentTarget),
      v = (n: string) => String(f.get(n) || "").trim();
    try {
      if (dialog === "supplier")
        await mutate(
          "/purchases/suppliers" + (editing ? "/" + editing.id : ""),
          {
            name: v("name"),
            contact: v("contact"),
            document: v("document"),
            phone: v("phone"),
            email: v("email"),
            address: v("address"),
            notes: v("notes"),
            active: f.has("active"),
            version: editing?.version || 0,
          },
        );
      if (dialog === "order") {
        if (!supplierId || !cart.length)
          throw Error("Selecione fornecedor e produtos do pedido.");
        const r = await mutate(
          "/purchases/orders" + (editing ? "/" + editing.order.id : ""),
          {
            branch_id: orderBranch,
            supplier_id: supplierId,
            expected_on: v("expected_on") || null,
            note: v("note"),
            version: editing?.order.version || 0,
            lines: cart.map((l) => ({
              product_id: l.product_id,
              quantity: Number(l.quantity),
              unit_cost_cents: toCents(l.cost),
            })),
          },
        );
        setSelected(r.id);
        setTab("orders");
      }
      if (dialog === "issue")
        await mutate(`/purchases/orders/${selected}/issue`, {
          version: detail!.order.version,
        });
      if (dialog === "cancel")
        await mutate(`/purchases/orders/${selected}/cancel`, {
          version: detail!.order.version,
          reason: v("reason"),
        });
      if (dialog === "reverse")
        await mutate(
          `/purchases/orders/${selected}/receipts/${editing!.id}/reverse`,
          { version: detail!.order.version, reason: v("reason") },
        );
      if (dialog === "receive") {
        const lines = detail!.lines
          .filter((l: Row) => Number(quantities[l.id] || 0) > 0)
          .map((l: Row) => ({
            order_line_id: l.id,
            quantity: Number(quantities[l.id]),
            devices: l.serialized
              ? (devices[l.id] || []).map((d) => ({
                  serial: d.serial,
                  imeis: d.imeis.split(/[,;\s]+/).filter(Boolean),
                  provenance: d.provenance,
                }))
              : [],
          }));
        if (!lines.length)
          throw Error("Informe as quantidades conferidas nesta entrega.");
        await mutate(`/purchases/orders/${selected}/receive`, {
          version: detail!.order.version,
          reference: v("reference"),
          due_on: v("due_on"),
          expected_total_cents: receiptTotal,
          update_cost: f.has("update_cost"),
          lines,
        });
      }
      setDialog("");
      setDetail(null);
      setLoading(true);
      setRevision((r) => r + 1);
      onNotice("Compra atualizada com sucesso.");
    } catch (e: any) {
      onNotice(e.message, true);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  const o = detail?.order,
    canReceive = !loading && o && ["ordered", "partial"].includes(o.status);
  const pager = (
    <div className="finance-pagination">
      <span>
        Página {page} · {rows[0]?.total_count || 0} registro(s)
      </span>
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
  );
  return (
    <div className="purchases-panel crm-panel" aria-busy={loading}>
      <div className="crm-tabs">
        {[
          ["orders", "Pedidos e recebimentos"],
          ["suppliers", "Fornecedores"],
        ].map(([id, name]) => (
          <button
            key={id}
            className={tab === id ? "active" : ""}
            onClick={() => navigate(id)}
          >
            {name}
          </button>
        ))}
      </div>
      <div className="purchase-toolbar">
        <Field label="Filiais das compras">
          <select
            value={scope}
            onChange={(e) => {
              setScope(e.target.value);
              setSelected("");
              setPage(1);
            }}
          >
            {branches.length > 1 && (
              <option value="all">Consolidado autorizado</option>
            )}
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </Field>
        <button
          className="btn secondary"
          onClick={() => setRevision((r) => r + 1)}
        >
          <RefreshCw size={16} /> Atualizar compras
        </button>
      </div>
      {failed && (
        <div className="info-strip">
          Não foi possível atualizar os dados. Use Atualizar compras para tentar
          novamente.
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
            <ArrowLeft size={16} /> Voltar aos pedidos
          </button>
          <section className="panel purchase-order-heading">
            <div>
              <span className="eyebrow">PEDIDO DE COMPRA</span>
              <h2>{detail.supplier.name}</h2>
              <p>{o.code}</p>
              <p>Previsão de entrega: {day(o.expected_on)}</p>
            </div>
            <span className="badge">{states[o.status]}</span>
          </section>
          <div className="finance-row-actions">
            <button className="btn secondary" onClick={() => setDoc(detail)}>
              <FileText size={16} /> Documento do pedido
            </button>
            {o.status === "draft" && (
              <>
                <button
                  className="btn secondary"
                  onClick={() => open("order", detail)}
                >
                  Editar rascunho
                </button>
                <button
                  className="btn primary"
                  disabled={loading}
                  onClick={() => open("issue")}
                >
                  Confirmar pedido
                </button>
              </>
            )}
            {canReceive && (
              <button className="btn primary" onClick={() => open("receive")}>
                <Truck size={16} /> Conferir recebimento
              </button>
            )}
            {["draft", "ordered", "partial"].includes(o.status) && (
              <button className="btn secondary" onClick={() => open("cancel")}>
                Cancelar saldo pendente
              </button>
            )}
          </div>
          <div className="credit-metrics">
            <article>
              <span>Total do pedido</span>
              <strong>{money(o.total_cents)}</strong>
            </article>
            <article>
              <span>Mercadorias recebidas</span>
              <strong>
                {money(
                  detail.lines.reduce(
                    (n: number, l: Row) =>
                      n + l.received_quantity * l.unit_cost_cents,
                    0,
                  ),
                )}
              </strong>
            </article>
            <article>
              <span>
                {o.status === "cancelled"
                  ? "Saldo cancelado"
                  : "Ainda não recebido"}
              </span>
              <strong>
                {money(
                  detail.lines.reduce(
                    (n: number, l: Row) =>
                      n +
                      (l.quantity - l.received_quantity) * l.unit_cost_cents,
                    0,
                  ),
                )}
              </strong>
            </article>
          </div>
          <section className="panel">
            <div className="panel-heading">
              <h2>Itens do pedido</h2>
              <p>{o.note}</p>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Produto</th>
                    <th>Pedido</th>
                    <th>Recebido</th>
                    <th>Saldo</th>
                    <th>Custo unitário</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.lines.map((l: Row) => (
                    <tr key={l.id || l.product_id}>
                      <td>
                        <strong>{l.product_name}</strong>
                        <small>
                          {l.sku} · {l.serialized ? "Individual" : "Quantidade"}
                        </small>
                      </td>
                      <td>{l.quantity}</td>
                      <td>{l.received_quantity}</td>
                      <td>{l.quantity - l.received_quantity}</td>
                      <td>{money(l.unit_cost_cents)}</td>
                      <td>{money(l.quantity * l.unit_cost_cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>Histórico de recebimentos</h2>
                <p>
                  Últimos 100 registros. Cada entrega gera sua própria conta a
                  pagar.
                </p>
              </div>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Referência / data</th>
                    <th>Valor recebido</th>
                    <th>Vencimento</th>
                    <th>Financeiro</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.receipts.map((r: Row) => (
                    <tr key={r.id}>
                      <td>
                        <strong>{r.reference}</strong>
                        <small>
                          {day(r.received_on)} ·{" "}
                          {r.reversed ? "Estornado" : "Confirmado"}
                        </small>
                      </td>
                      <td>{money(r.total_cents)}</td>
                      <td>{day(r.due_on)}</td>
                      <td>
                        <strong>
                          {r.title_cancelled
                            ? "Título cancelado"
                            : Number(r.paid_cents) >= Number(r.total_cents)
                              ? "Pago"
                              : Number(r.paid_cents) > 0
                                ? "Pagamento parcial"
                                : "A pagar"}
                        </strong>
                        <small>Pago: {money(r.paid_cents)}</small>
                      </td>
                      <td>
                        <div className="finance-row-actions">
                          <button
                            className="btn secondary small"
                            onClick={() => showReceipt(r)}
                          >
                            Conferir entrega
                          </button>
                          {!r.reversed && (
                            <button
                              className="btn secondary small"
                              onClick={() => open("reverse", r)}
                            >
                              Estornar recebimento
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!detail.receipts.length && (
              <div className="crm-empty">
                Nenhuma mercadoria recebida neste pedido.
              </div>
            )}
          </section>
          <section className="panel">
            <div className="panel-heading">
              <h2>Trilha de operações</h2>
            </div>
            <div className="credit-history">
              {detail.events.map((e: Row) => (
                <article key={e.id}>
                  <strong>{actions[e.action] || e.action}</strong>
                  <small>
                    {new Date(e.created_at).toLocaleString("pt-BR", {
                      timeZone: "America/Fortaleza",
                    })}{" "}
                    · {e.actor_name}
                  </small>
                  <p>{e.details.reason || e.details.reference}</p>
                </article>
              ))}
            </div>
          </section>
        </>
      ) : !selected ? (
        <>
          <div className="purchase-list-toolbar">
            <div className="search">
              <Search size={17} />
              <input
                aria-label="Pesquisar compras"
                value={query}
                placeholder={
                  tab === "suppliers"
                    ? "Fornecedor ou documento"
                    : "Fornecedor ou pedido"
                }
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(1);
                }}
              />
            </div>
            {tab === "orders" && (
              <select
                aria-label="Situação dos pedidos"
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setPage(1);
                }}
              >
                <option value="all">Todos os pedidos</option>
                {Object.entries(states).map(([id, name]) => (
                  <option key={id} value={id}>
                    {String(name)}
                  </option>
                ))}
              </select>
            )}
            <button
              className="btn primary"
              onClick={() => {
                setSupplierHistory([]);
                open(tab === "suppliers" ? "supplier" : "order");
              }}
            >
              <Plus size={16} />
              {tab === "suppliers"
                ? "Novo fornecedor"
                : "Novo pedido de compra"}
            </button>
            <button
              className="btn secondary"
              disabled={!rows.length}
              onClick={() =>
                csv(
                  tab === "suppliers"
                    ? [
                        [
                          "Fornecedor",
                          "Contato",
                          "Telefone",
                          "E-mail",
                          "Ativo",
                        ],
                        ...rows.map((r) => [
                          r.name,
                          r.contact,
                          r.phone,
                          r.email,
                          r.active ? "Sim" : "Não",
                        ]),
                      ]
                    : [
                        [
                          "Pedido",
                          "Fornecedor",
                          "Filial",
                          "Situação",
                          "Previsão",
                          "Valor (R$)",
                        ],
                        ...rows.map((r) => [
                          r.code,
                          r.supplier_name,
                          r.branch_name,
                          states[r.status],
                          r.expected_on,
                          decimal(r.total_cents),
                        ]),
                      ],
                )
              }
            >
              <Download size={16} /> Exportar página CSV
            </button>
          </div>
          <section className="panel">
            <div className="panel-heading">
              <h2>
                {tab === "suppliers"
                  ? "Fornecedores da empresa"
                  : "Pedidos e entregas da filial"}
              </h2>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    {(tab === "suppliers"
                      ? ["Fornecedor", "Contato", "Situação", "Ações"]
                      : [
                          "Pedido / fornecedor",
                          "Filial",
                          "Previsão",
                          "Valor",
                          "Situação",
                          "Ações",
                        ]
                    ).map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      {tab === "suppliers" ? (
                        <>
                          <td>
                            <strong>{r.name}</strong>
                          </td>
                          <td>
                            {r.contact}
                            <small>
                              {r.phone} · {r.email}
                            </small>
                          </td>
                          <td>{r.active ? "Ativo" : "Inativo"}</td>
                          <td>
                            <button
                              className="btn secondary small"
                              onClick={() => editSupplier(r.id)}
                            >
                              Abrir fornecedor
                            </button>
                          </td>
                        </>
                      ) : (
                        <>
                          <td>
                            <strong>{r.supplier_name}</strong>
                            <small>{r.code}</small>
                          </td>
                          <td>{r.branch_name}</td>
                          <td>
                            {day(r.expected_on)}
                            {["ordered", "partial"].includes(r.status) &&
                              r.expected_on &&
                              r.expected_on < now() && (
                                <small className="purchase-overdue">
                                  Entrega atrasada
                                </small>
                              )}
                          </td>
                          <td>{money(r.total_cents)}</td>
                          <td>{states[r.status]}</td>
                          <td>
                            <button
                              className="btn secondary small"
                              onClick={() => {
                                setDetail(null);
                                setSelected(r.id);
                              }}
                            >
                              Abrir pedido
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
            {pager}
          </section>
        </>
      ) : (
        <p>Carregando pedido…</p>
      )}
      <div className="info-strip">
        <Truck size={18} />
        <span>
          Pedidos não movimentam estoque nem registram pagamento. A conferência
          da entrega gera entrada e conta a pagar; os pagamentos são feitos em
          Gestão financeira.
        </span>
      </div>
      {dialog && (
        <div className="modal-backdrop">
          <section
            className="modal purchase-modal"
            role="dialog"
            aria-modal="true"
            aria-label={
              {
                supplier: "Cadastro do fornecedor",
                order: "Pedido de compra",
                issue: "Confirmar pedido",
                receive: "Conferir recebimento",
                cancel: "Cancelar saldo pendente",
                reverse: "Estornar recebimento",
              }[dialog]
            }
          >
            <header className="modal-header">
              <h2>
                {
                  {
                    supplier: editing
                      ? "Revisar fornecedor"
                      : "Novo fornecedor",
                    order: editing
                      ? "Editar pedido de compra"
                      : "Novo pedido de compra",
                    issue: "Confirmar pedido",
                    receive: "Conferir recebimento",
                    cancel: "Cancelar saldo pendente",
                    reverse: "Estornar recebimento",
                  }[dialog]
                }
              </h2>
              <button
                className="icon-button"
                aria-label="Fechar formulário de compras"
                disabled={busy}
                onClick={() => setDialog("")}
              >
                <X size={20} />
              </button>
            </header>
            <form
              onSubmit={submit}
              key={dialog + (editing?.id || editing?.order?.id || "new")}
            >
              <div className="modal-body">
                {dialog === "supplier" && (
                  <>
                    <Field label="Nome do fornecedor">
                      <input
                        name="name"
                        required
                        maxLength={180}
                        defaultValue={editing?.name}
                        autoFocus
                      />
                    </Field>
                    <div className="form-grid">
                      <Field label="Contato do fornecedor">
                        <input
                          name="contact"
                          maxLength={500}
                          defaultValue={editing?.contact}
                        />
                      </Field>
                      <Field label="Documento do fornecedor (opcional)">
                        <input
                          name="document"
                          maxLength={30}
                          defaultValue={editing?.document}
                        />
                      </Field>
                      <Field label="Telefone do fornecedor">
                        <input
                          name="phone"
                          maxLength={30}
                          defaultValue={editing?.phone}
                        />
                      </Field>
                      <Field label="E-mail do fornecedor">
                        <input
                          name="email"
                          type="email"
                          maxLength={254}
                          defaultValue={editing?.email}
                        />
                      </Field>
                    </div>
                    <Field label="Endereço do fornecedor">
                      <textarea
                        name="address"
                        maxLength={1000}
                        defaultValue={editing?.address}
                      />
                    </Field>
                    <Field label="Observações do fornecedor">
                      <textarea
                        name="notes"
                        maxLength={2000}
                        defaultValue={editing?.notes}
                      />
                    </Field>
                    <label className="credit-check">
                      <input
                        name="active"
                        type="checkbox"
                        defaultChecked={editing?.active ?? true}
                      />{" "}
                      Fornecedor ativo para novos pedidos
                    </label>
                    {editing && (
                      <div className="purchase-supplier-history">
                        <h3>Últimos pedidos nas filiais selecionadas</h3>
                        {supplierHistory.length ? (
                          supplierHistory.map((o) => (
                            <button
                              key={o.id}
                              type="button"
                              className="btn secondary small"
                              onClick={() => {
                                setDialog("");
                                setSelected(o.id);
                                setTab("orders");
                              }}
                            >
                              {o.code} · {states[o.status]} ·{" "}
                              {money(o.total_cents)}
                            </button>
                          ))
                        ) : (
                          <p>Nenhum pedido registrado.</p>
                        )}
                      </div>
                    )}
                  </>
                )}
                {dialog === "order" && (
                  <>
                    <div className="form-grid">
                      <Field label="Filial do pedido">
                        <select
                          disabled={!!editing}
                          value={orderBranch}
                          onChange={(e) => setOrderBranch(e.target.value)}
                        >
                          {branches.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.name}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Previsão de entrega">
                        <input
                          name="expected_on"
                          type="date"
                          defaultValue={editing?.order.expected_on || ""}
                        />
                      </Field>
                    </div>
                    <Field label="Pesquisar fornecedor">
                      <input
                        value={supplierQuery}
                        onChange={(e) => setSupplierQuery(e.target.value)}
                        placeholder="Nome do fornecedor"
                      />
                    </Field>
                    <Field label="Fornecedor do pedido">
                      <select
                        required
                        value={supplierId}
                        onChange={(e) => setSupplierId(e.target.value)}
                      >
                        <option value="">
                          Selecione um fornecedor cadastrado
                        </option>
                        {editing &&
                          !suppliers.some((s) => s.id === supplierId) && (
                            <option value={supplierId}>
                              {editing.supplier.name}
                            </option>
                          )}
                        {suppliers
                          .filter((s) => s.active)
                          .map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                      </select>
                    </Field>
                    <Field label="Buscar produto para compra">
                      <input
                        value={productQuery}
                        onChange={(e) => setProductQuery(e.target.value)}
                        placeholder="Nome, SKU ou código de barras"
                      />
                    </Field>
                    <div className="purchase-product-matches">
                      {products.map((p) => (
                        <button
                          className="btn secondary small"
                          type="button"
                          key={p.id}
                          disabled={cart.some((l) => l.product_id === p.id)}
                          onClick={() =>
                            setCart((c) => [
                              ...c,
                              {
                                product_id: p.id,
                                product_name: p.name,
                                sku: p.sku,
                                quantity: "1",
                                cost: String(p.cost),
                              },
                            ])
                          }
                        >
                          <Plus size={15} />
                          {p.name} · {p.sku}
                        </button>
                      ))}
                    </div>
                    <div className="purchase-cart">
                      {cart.map((l, index) => (
                        <article key={l.product_id}>
                          <strong>
                            {l.product_name}
                            <small>{l.sku}</small>
                          </strong>
                          <Field
                            label={`Quantidade de compra de ${l.product_name}`}
                          >
                            <input
                              type="number"
                              min="1"
                              max="1000000"
                              step="1"
                              required
                              value={l.quantity}
                              onChange={(e) =>
                                setCart((c) =>
                                  c.map((x, j) =>
                                    j === index
                                      ? { ...x, quantity: e.target.value }
                                      : x,
                                  ),
                                )
                              }
                            />
                          </Field>
                          <Field
                            label={`Custo unitário de ${l.product_name} (R$)`}
                          >
                            <input
                              type="number"
                              min="0.01"
                              max="10000000"
                              step="0.01"
                              required
                              value={l.cost}
                              onChange={(e) =>
                                setCart((c) =>
                                  c.map((x, j) =>
                                    j === index
                                      ? { ...x, cost: e.target.value }
                                      : x,
                                  ),
                                )
                              }
                            />
                          </Field>
                          <button
                            type="button"
                            className="icon-button"
                            aria-label={"Remover " + l.product_name}
                            onClick={() =>
                              setCart((c) => c.filter((_, j) => j !== index))
                            }
                          >
                            <Trash2 size={17} />
                          </button>
                        </article>
                      ))}
                    </div>
                    <p className="purchase-total">
                      Total do pedido <strong>{money(cartTotal)}</strong>
                    </p>
                    <Field label="Observação do pedido">
                      <textarea
                        name="note"
                        maxLength={2000}
                        defaultValue={editing?.order.note}
                      />
                    </Field>
                    <p className="form-hint">
                      Salva um rascunho. Confira os itens e confirme o pedido
                      antes de registrar entregas.
                    </p>
                  </>
                )}
                {dialog === "issue" && (
                  <>
                    <p>
                      Confirme fornecedor, quantidades e custos do pedido:{" "}
                      <strong>{money(o.total_cents)}</strong>.
                    </p>
                    <p>
                      Os itens ficam preservados após a confirmação. As entradas
                      no estoque e as contas a pagar serão geradas somente ao
                      receber a mercadoria. O pedido não é enviado
                      automaticamente ao fornecedor.
                    </p>
                  </>
                )}
                {dialog === "receive" && (
                  <>
                    <div className="form-grid">
                      <Field label="Referência do documento ou entrega">
                        <input
                          name="reference"
                          required
                          minLength={3}
                          maxLength={120}
                          autoFocus
                        />
                      </Field>
                      <Field label="Vencimento da conta a pagar">
                        <input
                          name="due_on"
                          type="date"
                          required
                          defaultValue={now()}
                        />
                      </Field>
                    </div>
                    <p>
                      Informe somente as quantidades fisicamente conferidas
                      nesta entrega. O saldo restante pode ser recebido depois.
                    </p>
                    {detail!.lines
                      .filter((l: Row) => l.quantity > l.received_quantity)
                      .map((l: Row) => (
                        <section className="purchase-receive-line" key={l.id}>
                          <h3>{l.product_name}</h3>
                          <p>
                            {l.sku} · Saldo do pedido:{" "}
                            {l.quantity - l.received_quantity} · Custo unitário:{" "}
                            {money(l.unit_cost_cents)}
                          </p>
                          <Field
                            label={"Quantidade recebida de " + l.product_name}
                          >
                            <input
                              type="number"
                              min="0"
                              max={
                                l.serialized
                                  ? Math.min(
                                      200,
                                      l.quantity - l.received_quantity,
                                    )
                                  : l.quantity - l.received_quantity
                              }
                              step="1"
                              value={quantities[l.id] || "0"}
                              onChange={(e) =>
                                changeQuantity(l, e.target.value)
                              }
                            />
                          </Field>
                          {(devices[l.id] || []).map((d, index) => (
                            <article className="purchase-unit" key={index}>
                              <h4>Unidade {index + 1}</h4>
                              <div className="form-grid">
                                <Field
                                  label={`Série de ${l.product_name} unidade ${index + 1}`}
                                >
                                  <input
                                    value={d.serial}
                                    maxLength={100}
                                    onChange={(e) =>
                                      changeDevice(
                                        l.id,
                                        index,
                                        "serial",
                                        e.target.value,
                                      )
                                    }
                                  />
                                </Field>
                                <Field
                                  label={`IMEIs de ${l.product_name} unidade ${index + 1}`}
                                >
                                  <input
                                    value={d.imeis}
                                    maxLength={50}
                                    placeholder="IMEIs separados por vírgula"
                                    onChange={(e) =>
                                      changeDevice(
                                        l.id,
                                        index,
                                        "imeis",
                                        e.target.value,
                                      )
                                    }
                                  />
                                </Field>
                              </div>
                              <Field
                                label={`Procedência de ${l.product_name} unidade ${index + 1}`}
                              >
                                <input
                                  required
                                  minLength={3}
                                  maxLength={2000}
                                  value={d.provenance}
                                  onChange={(e) =>
                                    changeDevice(
                                      l.id,
                                      index,
                                      "provenance",
                                      e.target.value,
                                    )
                                  }
                                />
                              </Field>
                            </article>
                          ))}
                        </section>
                      ))}
                    <label className="credit-check">
                      <input
                        type="checkbox"
                        name="update_cost"
                        defaultChecked
                      />{" "}
                      Atualizar custo cadastrado e fornecedor dos produtos com o
                      último custo desta compra.
                    </label>
                    <p className="form-hint">
                      O custo cadastrado utiliza o último recebimento confirmado
                      quando esta opção está marcada; não calcula média
                      ponderada. Custos históricos de vendas permanecem
                      preservados.
                    </p>
                    <p className="purchase-total">
                      Mercadoria desta entrega{" "}
                      <strong>{money(receiptTotal)}</strong>
                    </p>
                    <p>
                      Será criada uma conta a pagar deste valor. Nenhum
                      pagamento será registrado agora.
                    </p>
                  </>
                )}
                {(dialog === "cancel" || dialog === "reverse") && (
                  <>
                    <p>
                      {dialog === "cancel"
                        ? "Cancela somente o saldo ainda não recebido; entregas e contas a pagar existentes permanecem."
                        : "Compensa as quantidades recebidas e cancela a conta a pagar desta entrega. Estorne antes os pagamentos no financeiro. Unidades já movimentadas impedem a operação."}
                    </p>
                    {dialog === "reverse" && (
                      <p>
                        O custo de catálogo não é restaurado automaticamente.
                        Revise-o no cadastro do produto, se necessário.
                      </p>
                    )}
                    <Field label="Motivo da correção">
                      <textarea
                        name="reason"
                        required
                        minLength={5}
                        maxLength={1000}
                        rows={4}
                      />
                    </Field>
                  </>
                )}
              </div>
              <footer className="modal-footer">
                <button
                  className="btn secondary"
                  type="button"
                  disabled={busy}
                  onClick={() => setDialog("")}
                >
                  Voltar
                </button>
                <button className="btn primary" disabled={busy}>
                  {busy
                    ? "Registrando…"
                    : dialog === "order"
                      ? "Salvar rascunho"
                      : "Confirmar registro"}
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}
      {doc && (
        <PurchaseDocument
          data={doc}
          company={companyName}
          onClose={() => setDoc(null)}
        />
      )}
    </div>
  );
}

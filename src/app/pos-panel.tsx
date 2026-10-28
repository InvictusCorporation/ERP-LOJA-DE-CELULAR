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
  ShoppingCart,
  Search,
  Plus,
  Minus,
  Trash2,
  ScanBarcode,
  Wallet,
  ArrowDownLeft,
  ArrowUpRight,
  ReceiptText,
  Printer,
  Download,
  X,
  Check,
  RefreshCw,
  LockKeyhole,
  History,
  ChartNoAxesCombined,
} from "lucide-react";
import { toCents, formatCents } from "../shared/money";
import "./pos.css";

type Row = Record<string, any>;
type CartLine = {
  product_id: string;
  quantity: number;
  unit_id?: string;
  name: string;
  sku: string;
  price: number;
  stock: number;
  identifiers?: string;
};
type Pay = { method: string; amount: string; reference: string };
type Props = {
  branch: string;
  permissions: string[];
  mutate: (path: string, body: unknown, method?: string) => Promise<any>;
  onNotice: (text: string, error?: boolean) => void;
};
type Dialog =
  | "open"
  | "close"
  | "supply"
  | "withdrawal"
  | "checkout"
  | "register"
  | "return"
  | "cancel"
  | null;
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
  open: "Aberto",
  closed: "Fechado",
};
const cashNames: Row = {
  opening: "Abertura",
  sale: "Venda",
  refund: "Devolução",
  supply: "Suprimento",
  withdrawal: "Sangria",
};
const when = (s: string) =>
  new Date(s).toLocaleString("pt-BR", { timeZone: "America/Fortaleza" });
const decimal = (n: number) => (n / 100).toFixed(2);
async function get(path: string) {
  const res = await fetch(`/api${path}`, { cache: "no-store" });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Falha ao consultar o PDV.");
  return data;
}
function amountOf(text: string) {
  return toCents(text || "0");
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
function DialogBox({
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
    <div className="pos-overlay">
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`pos-dialog ${wide ? "wide" : ""}`}
      >
        <header className="modal-header no-print">
          <h2>{title}</h2>
          <button
            type="button"
            className="icon-button"
            aria-label="Fechar janela do PDV"
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
function DownloadReceipt({ receipt }: { receipt: Row }) {
  const r = receipt;
  const download = () => {
    const text = [
      r.sale.company_name,
      r.sale.branch_name,
      "COMPROVANTE NÃO FISCAL",
      r.sale.receipt_code,
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
      ...r.returns.map(
        (x: Row) =>
          `${x.kind === "cancel" ? "Cancelamento" : "Devolução"} ${when(x.created_at)}: ${formatCents(x.total_cents)} · ${x.reason}`,
      ),
      "",
      "Pagamentos Pix/cartão registrados manualmente. Este comprovante não substitui documento fiscal.",
    ].join("\n");
    const url = URL.createObjectURL(
      new Blob([text], { type: "text/plain;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `comprovante-${r.sale.id}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <>
      <button
        type="button"
        className="secondary"
        onClick={() => window.print()}
      >
        <Printer size={16} />
        Imprimir
      </button>
      <button type="button" className="secondary" onClick={download}>
        <Download size={16} />
        Baixar comprovante
      </button>
    </>
  );
}
export default function PosPanel({
  branch,
  permissions,
  mutate,
  onNotice,
}: Props) {
  const can = (p: string) => permissions.includes(p);
  const [tab, setTab] = useState("sale"),
    [state, setState] = useState<Row>({}),
    [register, setRegister] = useState(""),
    [cart, setCart] = useState<CartLine[]>([]),
    [query, setQuery] = useState(""),
    [items, setItems] = useState<Row[]>([]),
    [discount, setDiscount] = useState("0"),
    [payments, setPayments] = useState<Pay[]>([]),
    [dialog, setDialog] = useState<Dialog>(null),
    [busy, setBusy] = useState(false),
    [receipt, setReceipt] = useState<Row | null>(null),
    [unitProduct, setUnitProduct] = useState<Row | null>(null),
    [units, setUnits] = useState<Row[]>([]),
    [history, setHistory] = useState<Row[]>([]),
    [report, setReport] = useState<Row>({}),
    [page, setPage] = useState(1),
    [historyQuery, setHistoryQuery] = useState(""),
    [quantities, setQuantities] = useState<Record<string, number>>({}),
    [loading, setLoading] = useState(true);
  const busyRef = useRef(false),
    loadId = useRef(0);
  const scanRef = useRef<HTMLInputElement>(null);
  const subtotal = cart.reduce((n, l) => n + l.price * l.quantity, 0);
  let discountValue = 0;
  try {
    discountValue = amountOf(discount);
  } catch {}
  const total = subtotal - discountValue;
  const refresh = useCallback(async () => {
    const id = ++loadId.current;
    setLoading(true);
    try {
      const r = await get(
        `/pos/state?branch_id=${branch}${register ? `&register_id=${register}` : ""}`,
      );
      if (id !== loadId.current) return;
      setState(r);
      if (!register) setRegister(r.register_id || "");
      if (tab === "history") {
        const h = await get(
          `/pos/sales?branch_id=${branch}&page=${page}&q=${encodeURIComponent(historyQuery)}`,
        );
        if (id === loadId.current) setHistory(h.items);
      }
      if (tab === "report") {
        const r = await get(`/pos/report?branch_id=${branch}`);
        if (id === loadId.current) setReport(r);
      }
    } catch (e: any) {
      onNotice(e.message, true);
    } finally {
      if (id === loadId.current) setLoading(false);
    }
  }, [branch, register, tab, page, historyQuery]);
  useEffect(() => {
    const timer = setTimeout(() => void refresh(), 150);
    return () => {
      clearTimeout(timer);
      loadId.current++;
    };
  }, [refresh]);
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      get(`/products?branch_id=${branch}&q=${encodeURIComponent(query)}`)
        .then((r) => {
          if (active) setItems(r.items.filter((p: Row) => p.active));
        })
        .catch((e) => onNotice(e.message, true));
    }, 180);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [branch, query]);
  const addLine = (product: Row, unit?: Row) => {
    if (!can("pos_sell")) return;
    const exists = cart.find(
      (l) =>
        l.product_id === product.id &&
        (l.unit_id || null) === (unit?.id || null),
    );
    if (unit && exists) {
      onNotice("Este aparelho já está no carrinho.", true);
      return;
    }
    const needed =
      cart
        .filter((l) => l.product_id === product.id)
        .reduce((n, l) => n + l.quantity, 0) + 1;
    if (needed > product.quantity) {
      onNotice("Quantidade acima do estoque disponível.", true);
      return;
    }
    let unitPrice: number;
    try {
      unitPrice = toCents(product.price);
    } catch {
      onNotice(
        "Preço acima do limite do PDV (R$ 10 milhões por operação).",
        true,
      );
      return;
    }
    const line: CartLine = {
      product_id: product.id,
      quantity: 1,
      unit_id: unit?.id,
      name: product.name,
      sku: product.sku,
      price: unitPrice,
      stock: product.quantity,
      identifiers: unit
        ? [...(unit.imeis || []), unit.serial].filter(Boolean).join(" · ")
        : undefined,
    };
    setCart((old) => {
      const current = old.find(
        (l) =>
          l.product_id === product.id &&
          (l.unit_id || null) === (unit?.id || null),
      );
      const count = old
        .filter((l) => l.product_id === product.id)
        .reduce((n, l) => n + l.quantity, 0);
      if (count >= product.quantity || (unit && current)) return old;
      return current
        ? old.map((l) =>
            l === current ? { ...l, quantity: l.quantity + 1 } : l,
          )
        : [...old, line];
    });
    setUnitProduct(null);
    scanRef.current?.focus();
  };
  const add = async (product: Row) => {
    if (product.serialized) {
      try {
        const r = await get(
          `/units?branch_id=${branch}&product_id=${product.id}`,
        );
        setUnits(r.items.filter((u: Row) => u.status === "in_stock"));
        setUnitProduct(product);
      } catch (e: any) {
        onNotice(e.message, true);
      }
    } else addLine(product);
  };
  const scan = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const r = await get(
        `/products?branch_id=${branch}&q=${encodeURIComponent(query)}`,
      );
      const exact = r.items.find(
        (p: Row) =>
          p.barcode === query.trim() ||
          p.sku.toLowerCase() === query.trim().toLowerCase(),
      );
      if (!exact) {
        onNotice(
          "Código não encontrado. Selecione o produto nos resultados.",
          true,
        );
        return;
      }
      await add(exact);
      setQuery("");
    } catch (e: any) {
      onNotice(e.message, true);
    }
  };
  const updatePrices = async () => {
    try {
      const updated = await Promise.all(
        cart.map(async (l) => {
          const r = await get(
            `/products?branch_id=${branch}&q=${encodeURIComponent(l.sku)}`,
          );
          const p = r.items.find((p: Row) => p.id === l.product_id);
          if (!p) throw new Error(`Produto indisponível: ${l.name}`);
          return { ...l, price: toCents(p.price), stock: p.quantity };
        }),
      );
      setCart(updated);
      onNotice("Preços e disponibilidade atualizados.");
    } catch (e: any) {
      onNotice(e.message, true);
    }
  };
  const viewReceipt = async (id: string) => {
    try {
      setReceipt(await get(`/pos/sales/${id}`));
    } catch (e: any) {
      onNotice(e.message, true);
    }
  };
  const returnTotal = receipt
    ? receipt.items.reduce((n: number, l: Row) => {
        const qty = quantities[l.id] || 0;
        return (
          n +
          Number(
            (BigInt(l.net_cents) * BigInt(l.returned_quantity + qty)) /
              BigInt(l.quantity),
          ) -
          l.refunded_cents
        );
      }, 0)
    : 0;
  const allocateRefund = (target: number) => {
    let remaining = target;
    return receipt!.payments.map((p: Row) => {
      const limit =
        p.amount_cents -
        receipt!.refunds
          .filter((r: Row) => r.method === p.method)
          .reduce((n: number, r: Row) => n + r.amount_cents, 0);
      const take = Math.min(remaining, limit);
      remaining -= take;
      return { method: p.method, amount: decimal(take), reference: "" };
    });
  };
  const beginReturn = (kind: "return" | "cancel") => {
    const qty: Record<string, number> = {};
    for (const l of receipt!.items)
      qty[l.id] = l.quantity - l.returned_quantity;
    setQuantities(qty);
    const value = receipt!.items.reduce(
      (n: number, l: Row) => n + l.net_cents - l.refunded_cents,
      0,
    );
    setPayments(allocateRefund(value));
    setDialog(kind);
  };
  const beginCheckout = () => {
    try {
      const d = amountOf(discount);
      if (!cart.length || subtotal - d <= 0)
        throw new Error("Adicione produtos e confira o total da venda.");
      setPayments([
        { method: "cash", amount: decimal(subtotal - d), reference: "" },
      ]);
      setDialog("checkout");
    } catch (e: any) {
      onNotice(e.message, true);
    }
  };
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    const form = new FormData(e.currentTarget),
      value = (n: string) => String(form.get(n) || "").trim();
    try {
      if (dialog === "open")
        await mutate("/pos/open", {
          register_id: register,
          opening_cents: amountOf(value("opening")),
        });
      if (dialog === "register") {
        const r = await mutate("/pos/registers", {
          branch_id: branch,
          name: value("name"),
        });
        setRegister(r.id);
      }
      if (dialog === "supply" || dialog === "withdrawal")
        await mutate("/pos/cash", {
          session_id: state.session.id,
          type: dialog,
          amount_cents: amountOf(value("amount")),
          reason: value("reason"),
        });
      if (dialog === "close") {
        const r = await mutate("/pos/close", {
          session_id: state.session.id,
          counted_cents: amountOf(value("counted")),
          note: value("note"),
        });
        onNotice(
          `Caixa fechado. Diferença: ${formatCents(r.difference_cents)}.`,
        );
      }
      if (dialog === "checkout") {
        const r = await mutate("/pos/sales", {
          session_id: state.session.id,
          items: cart.map((l) => ({
            product_id: l.product_id,
            quantity: l.quantity,
            ...(l.unit_id ? { unit_id: l.unit_id } : {}),
          })),
          discount_cents: amountOf(discount),
          expected_total_cents: total,
          payments: payments.map((p) => ({
            method: p.method,
            amount_cents: amountOf(p.amount),
            reference: p.reference,
          })),
          note: value("note"),
        });
        setCart([]);
        setDiscount("0");
        await viewReceipt(r.id);
        onNotice(`Venda registrada. Troco: ${formatCents(r.change_cents)}.`);
      }
      if (dialog === "return" || dialog === "cancel") {
        await mutate(`/pos/sales/${receipt!.sale.id}/return`, {
          session_id: state.session.id,
          kind: dialog,
          items: receipt!.items
            .filter((l: Row) => (quantities[l.id] || 0) > 0)
            .map((l: Row) => ({
              sale_item_id: l.id,
              quantity: quantities[l.id],
            })),
          payments: payments
            .filter((p) => amountOf(p.amount) > 0)
            .map((p) => ({
              method: p.method,
              amount_cents: amountOf(p.amount),
              reference: p.reference,
            })),
          reason: value("reason"),
        });
        await viewReceipt(receipt!.sale.id);
        onNotice(
          dialog === "cancel"
            ? "Venda cancelada com registros compensatórios."
            : "Devolução registrada.",
        );
      }
      setDialog(null);
      await refresh();
    } catch (e: any) {
      onNotice(e.message, true);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const session = state.session;
  const maySell = session?.own && can("pos_sell");
  const paymentFields = (refund = false) => (
    <div className="pos-payments">
      {payments.map((p, index) => (
        <div className="pos-payment-row" key={index}>
          <Field label={`Forma ${index + 1}`}>
            <select
              value={p.method}
              disabled={refund}
              onChange={(e) =>
                setPayments((old) =>
                  old.map((x, j) =>
                    j === index ? { ...x, method: e.target.value } : x,
                  ),
                )
              }
            >
              {Object.entries(methodNames).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <Field label={`Valor ${index + 1} (R$)`}>
            <input
              inputMode="decimal"
              value={p.amount}
              required
              onChange={(e) =>
                setPayments((old) =>
                  old.map((x, j) =>
                    j === index ? { ...x, amount: e.target.value } : x,
                  ),
                )
              }
            />
          </Field>
          {p.method !== "cash" && (
            <Field label={`Referência externa ${index + 1}`}>
              <input
                value={p.reference}
                maxLength={120}
                required={!refund || !!Number(p.amount.replace(",", "."))}
                onChange={(e) =>
                  setPayments((old) =>
                    old.map((x, j) =>
                      j === index ? { ...x, reference: e.target.value } : x,
                    ),
                  )
                }
              />
            </Field>
          )}
          {!refund && payments.length > 1 && (
            <button
              className="icon-button"
              type="button"
              aria-label={`Remover pagamento ${index + 1}`}
              onClick={() =>
                setPayments((old) => old.filter((_, j) => j !== index))
              }
            >
              <Trash2 size={16} />
            </button>
          )}
        </div>
      ))}
      {!refund && payments.length < 4 && (
        <button
          className="secondary small"
          type="button"
          onClick={() => {
            const used = new Set(payments.map((p) => p.method));
            const method = Object.keys(methodNames).find((m) => !used.has(m))!;
            setPayments((old) => [
              ...old,
              { method, amount: "0.00", reference: "" },
            ]);
          }}
        >
          <Plus size={15} />
          Dividir pagamento
        </button>
      )}
    </div>
  );
  return (
    <div className="pos-module" aria-busy={loading}>
      <div className="pos-toolbar">
        <div className="pos-tabs">
          {[
            { id: "sale", name: "Nova venda", icon: ShoppingCart },
            { id: "cash", name: "Meu caixa", icon: Wallet },
            { id: "history", name: "Histórico", icon: History },
            { id: "report", name: "Por operador", icon: ChartNoAxesCombined },
          ].map((t) => (
            <button
              key={t.id}
              className={tab === t.id ? "active" : ""}
              onClick={() => setTab(t.id)}
            >
              <t.icon size={16} />
              {t.name}
            </button>
          ))}
        </div>
        <div className="pos-register-picker">
          <select
            aria-label="Caixa do PDV"
            value={register}
            onChange={(e) => setRegister(e.target.value)}
          >
            {state.registers?.map((r: Row) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          {can("pos_manage") && (
            <button
              className="icon-button"
              aria-label="Cadastrar caixa"
              onClick={() => setDialog("register")}
            >
              <Plus size={17} />
            </button>
          )}
        </div>
      </div>
      <div className={`pos-session-bar ${session ? "open" : ""}`}>
        <div>
          <span className="status-dot" />
          <strong>
            {session
              ? "Caixa aberto"
              : state.occupied
                ? "Caixa em uso"
                : "Caixa fechado"}
          </strong>
          <span>
            {session
              ? `${session.operator_name} · ${when(session.opened_at)}`
              : state.occupied
                ? `Operador: ${state.operator_name}`
                : "Abra uma sessão para registrar vendas e movimentações."}
          </span>
        </div>
        {!session && !state.occupied && can("pos_cash") && (
          <button
            className="primary small"
            disabled={!register}
            onClick={() => setDialog("open")}
          >
            <Wallet size={15} />
            Abrir caixa
          </button>
        )}
        {session && (
          <span className="badge green">
            {session.own ? "Sua sessão" : "Supervisão"}
          </span>
        )}
      </div>
      {tab === "sale" && (
        <div className="pos-sale-layout">
          <section className="panel pos-catalog">
            <div className="panel-heading">
              <div>
                <h2>Adicionar produtos</h2>
                <p>
                  Busque no catálogo ou utilize um leitor de código de barras
                </p>
              </div>
              <ScanBarcode size={22} />
            </div>
            <form className="pos-search" onSubmit={scan}>
              <Search size={18} />
              <input
                ref={scanRef}
                aria-label="Buscar ou ler código de barras"
                placeholder="Nome, SKU ou código de barras + Enter"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <button className="secondary small">Adicionar código</button>
            </form>
            <div className="pos-product-list">
              {items.length ? (
                items.map((p) => (
                  <button
                    className="pos-product"
                    key={p.id}
                    disabled={p.quantity <= 0 || !can("pos_sell")}
                    onClick={() => void add(p)}
                  >
                    <div className="product-avatar">
                      {p.serialized ? (
                        <ScanBarcode size={22} />
                      ) : (
                        <ShoppingCart size={22} />
                      )}
                    </div>
                    <span>
                      <strong>{p.name}</strong>
                      <small>
                        {p.sku} · {p.quantity} un. disponíveis
                        {p.serialized ? " · Selecionar aparelho" : ""}
                      </small>
                    </span>
                    <b>{formatCents(Number(p.price) * 100)}</b>
                    <Plus size={17} />
                  </button>
                ))
              ) : (
                <div className="pos-empty">
                  <Search size={28} />
                  <h3>Nenhum produto disponível</h3>
                  <p>
                    Confira a busca ou cadastre produtos e entradas no estoque.
                  </p>
                </div>
              )}
            </div>
            <p className="pos-caption">
              Até 30 resultados por busca. O preço e a disponibilidade são
              conferidos novamente ao finalizar.
            </p>
          </section>
          <section className="panel pos-cart">
            <div className="panel-heading">
              <div>
                <h2>Carrinho da venda</h2>
                <p>
                  {cart.reduce((n, l) => n + l.quantity, 0)} unidades
                  selecionadas
                </p>
              </div>
              {!!cart.length && (
                <button
                  className="icon-button"
                  title="Atualizar preços"
                  aria-label="Atualizar preços do carrinho"
                  onClick={() => void updatePrices()}
                >
                  <RefreshCw size={17} />
                </button>
              )}
            </div>
            <div className="pos-cart-lines">
              {cart.length ? (
                cart.map((l, index) => (
                  <article
                    className="pos-cart-line"
                    key={`${l.product_id}-${l.unit_id || ""}`}
                  >
                    <div>
                      <strong>{l.name}</strong>
                      <small>{l.identifiers || l.sku}</small>
                      <span>{formatCents(l.price)} / un.</span>
                    </div>
                    <button
                      className="icon-button"
                      aria-label={`Remover ${l.name}`}
                      onClick={() =>
                        setCart((old) => old.filter((_, j) => j !== index))
                      }
                    >
                      <Trash2 size={15} />
                    </button>
                    <div className="pos-quantity">
                      {!l.unit_id && (
                        <>
                          <button
                            aria-label={`Diminuir ${l.name}`}
                            disabled={l.quantity <= 1}
                            onClick={() =>
                              setCart((old) =>
                                old.map((x, j) =>
                                  j === index
                                    ? { ...x, quantity: x.quantity - 1 }
                                    : x,
                                ),
                              )
                            }
                          >
                            <Minus size={12} />
                          </button>
                          <input
                            aria-label={`Quantidade de ${l.name}`}
                            type="number"
                            min="1"
                            max={l.stock}
                            value={l.quantity}
                            onChange={(e) => {
                              const qty = Number(e.target.value);
                              if (
                                Number.isInteger(qty) &&
                                qty > 0 &&
                                qty <= l.stock
                              )
                                setCart((old) =>
                                  old.map((x, j) =>
                                    j === index ? { ...x, quantity: qty } : x,
                                  ),
                                );
                            }}
                          />
                          <button
                            aria-label={`Aumentar ${l.name}`}
                            disabled={l.quantity >= l.stock}
                            onClick={() =>
                              setCart((old) =>
                                old.map((x, j) =>
                                  j === index
                                    ? { ...x, quantity: x.quantity + 1 }
                                    : x,
                                ),
                              )
                            }
                          >
                            <Plus size={12} />
                          </button>
                        </>
                      )}
                      {l.unit_id && <span>1 aparelho</span>}
                    </div>
                    <b>{formatCents(l.price * l.quantity)}</b>
                  </article>
                ))
              ) : (
                <div className="pos-empty">
                  <ShoppingCart size={35} />
                  <h3>Pronto para a próxima venda</h3>
                  <p>Selecione um produto para começar.</p>
                </div>
              )}
            </div>
            <div className="pos-cart-total">
              <div>
                <span>Subtotal</span>
                <strong>{formatCents(subtotal)}</strong>
              </div>
              <div>
                <label htmlFor="pos-discount">Desconto (R$)</label>
                <input
                  id="pos-discount"
                  inputMode="decimal"
                  value={discount}
                  disabled={!can("pos_discount")}
                  onChange={(e) => setDiscount(e.target.value)}
                />
              </div>
              {!can("pos_discount") && (
                <small>
                  <LockKeyhole size={12} />
                  Descontos exigem perfil autorizado.
                </small>
              )}
              <div className="grand-total">
                <span>Total da venda</span>
                <strong>{formatCents(total)}</strong>
              </div>
              <button
                className="primary full"
                disabled={!cart.length || !maySell || total <= 0}
                onClick={beginCheckout}
              >
                Receber e finalizar
                <ArrowUpRight size={17} />
              </button>
              {session && !session.own && (
                <small>
                  Vendas exigem uma sessão aberta em seu próprio nome.
                </small>
              )}
            </div>
          </section>
        </div>
      )}
      {tab === "cash" && (
        <>
          <div className="metrics pos-metrics">
            <article className="metric featured">
              <div>
                <span>Dinheiro esperado</span>
                <Wallet size={20} />
              </div>
              <strong className="money">
                {formatCents(session?.expected_cents)}
              </strong>
              <small>Somente movimentos físicos de dinheiro</small>
            </article>
            <article className="metric">
              <div>
                <span>Saldo de abertura</span>
              </div>
              <strong className="money">
                {formatCents(session?.opening_cents)}
              </strong>
              <small>Valor informado pelo operador</small>
            </article>
            <article className="metric">
              <div>
                <span>Pix e cartões líquidos</span>
              </div>
              <strong className="money">
                {formatCents(
                  state.totals
                    ?.filter((r: Row) => r.method !== "cash")
                    .reduce(
                      (n: number, r: Row) => n + Number(r.amount_cents),
                      0,
                    ),
                )}
              </strong>
              <small>Registros manuais · sem efeito no dinheiro físico</small>
            </article>
          </div>
          {session && (
            <div className="pos-cash-actions">
              <button className="secondary" onClick={() => setDialog("supply")}>
                <ArrowDownLeft size={16} />
                Registrar suprimento
              </button>
              <button
                className="secondary"
                onClick={() => setDialog("withdrawal")}
              >
                <ArrowUpRight size={16} />
                Registrar sangria
              </button>
              <button className="primary" onClick={() => setDialog("close")}>
                <LockKeyhole size={16} />
                Conferir e fechar caixa
              </button>
            </div>
          )}
          <section className="panel">
            <div className="panel-heading">
              <h2>Movimentação física da sessão</h2>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Operação</th>
                    <th>Valor</th>
                    <th>Motivo</th>
                    <th>Responsável</th>
                    <th>Data</th>
                  </tr>
                </thead>
                <tbody>
                  {state.entries?.map((e: Row) => (
                    <tr key={e.id}>
                      <td>{cashNames[e.type]}</td>
                      <td
                        className={e.amount_cents < 0 ? "negative" : "positive"}
                      >
                        {formatCents(e.amount_cents)}
                      </td>
                      <td className="reason">{e.reason}</td>
                      <td>{e.actor_name}</td>
                      <td>{when(e.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!state.entries?.length && (
              <div className="compact-empty">
                Sem movimentações disponíveis nesta sessão.
              </div>
            )}
          </section>
        </>
      )}
      {tab === "history" && (
        <section className="panel">
          <div className="table-toolbar">
            <div className="search">
              <Search size={17} />
              <input
                aria-label="Buscar comprovante de venda"
                value={historyQuery}
                onChange={(e) => {
                  setHistoryQuery(e.target.value);
                  setPage(1);
                }}
                placeholder="Buscar pelo código do comprovante"
              />
            </div>
            <span className="badge">
              {can("pos_manage") ? "Vendas da filial" : "Suas vendas"}
            </span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Comprovante</th>
                  <th>Total</th>
                  <th>Situação</th>
                  <th>Operador</th>
                  <th>Data</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {history.map((s) => (
                  <tr key={s.id}>
                    <td className="mono pos-code">{s.receipt_code}</td>
                    <td>{formatCents(s.total_cents)}</td>
                    <td>
                      <span
                        className={`badge ${s.status === "completed" ? "green" : "yellow"}`}
                      >
                        {statusNames[s.status]}
                      </span>
                    </td>
                    <td>{s.operator_name}</td>
                    <td>{when(s.created_at)}</td>
                    <td>
                      <button
                        className="secondary small"
                        onClick={() => void viewReceipt(s.id)}
                      >
                        <ReceiptText size={15} />
                        Detalhes
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!history.length && (
            <div className="compact-empty">
              Nenhuma venda registrada nesta consulta.
            </div>
          )}
          <div className="pagination">
            <span>Página {page}</span>
            <div>
              <button
                className="secondary small"
                disabled={page === 1}
                onClick={() => setPage((n) => n - 1)}
              >
                Anterior
              </button>
              <button
                className="secondary small"
                disabled={history.length < 30}
                onClick={() => setPage((n) => n + 1)}
              >
                Próxima
              </button>
            </div>
          </div>
        </section>
      )}
      {tab === "report" && (
        <>
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>Operações por operador</h2>
                <p>
                  Histórico da filial · devoluções atribuídas ao caixa que
                  realizou o ressarcimento
                </p>
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Operador</th>
                    <th>Sessões</th>
                    <th>Vendas</th>
                    <th>Total vendido</th>
                    <th>Descontos</th>
                    <th>Devolvido</th>
                    <th>Recebimento líquido</th>
                  </tr>
                </thead>
                <tbody>
                  {report.operators?.map((o: Row) => (
                    <tr key={o.id}>
                      <td>
                        <strong>{o.name}</strong>
                      </td>
                      <td>{o.sessions}</td>
                      <td>{o.sales_count}</td>
                      <td>{formatCents(o.sold_cents)}</td>
                      <td>{formatCents(o.discount_cents)}</td>
                      <td>{formatCents(o.refunded_cents)}</td>
                      <td>
                        <strong>
                          {formatCents(
                            Number(o.sold_cents) - Number(o.refunded_cents),
                          )}
                        </strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!report.operators?.length && (
              <div className="compact-empty">
                Os relatórios serão preenchidos pelas operações registradas.
              </div>
            )}
          </section>
          <section className="panel pos-session-report">
            <div className="panel-heading">
              <h2>Conferência das sessões</h2>
              <span className="badge">Últimas 100 sessões</span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Caixa / operador</th>
                    <th>Abertura</th>
                    <th>Situação</th>
                    <th>Esperado em dinheiro</th>
                    <th>Contado</th>
                    <th>Diferença</th>
                    <th>Observação</th>
                  </tr>
                </thead>
                <tbody>
                  {report.sessions?.map((s: Row) => (
                    <tr key={s.id}>
                      <td>
                        <strong>{s.register_name}</strong>
                        <small>{s.operator_name}</small>
                      </td>
                      <td>{when(s.opened_at)}</td>
                      <td>
                        <span className="badge">{statusNames[s.status]}</span>
                      </td>
                      <td>{formatCents(s.expected_cents ?? s.ledger_cents)}</td>
                      <td>
                        {s.counted_cents === null
                          ? "—"
                          : formatCents(s.counted_cents)}
                      </td>
                      <td>
                        {s.difference_cents === null
                          ? "—"
                          : formatCents(s.difference_cents)}
                      </td>
                      <td className="reason">{s.closing_note || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
      <div className="info-strip">
        <ReceiptText size={18} />
        <span>
          Comprovante não fiscal. Pix e cartões são registrados após conferência
          externa. Integração fiscal, TEF, crediário e gestão financeira
          avançada pertencem às etapas correspondentes.
        </span>
      </div>
      {unitProduct && (
        <DialogBox
          title="Selecionar aparelho"
          onClose={() => setUnitProduct(null)}
        >
          <div className="modal-body">
            <p className="form-hint">
              {unitProduct.name} · escolha uma unidade disponível.
            </p>
            {units.map((u) => (
              <button
                className="pos-unit-option"
                key={u.id}
                disabled={cart.some((l) => l.unit_id === u.id)}
                onClick={() => addLine(unitProduct, u)}
              >
                <ScanBarcode size={19} />
                <span>
                  {u.imeis.join(" / ") || u.serial}
                  <small>{u.serial || "Sem série cadastrada"}</small>
                </span>
                <Plus size={17} />
              </button>
            ))}
            {!units.length && (
              <p className="form-hint">
                Nenhum aparelho disponível nesta filial.
              </p>
            )}
          </div>
        </DialogBox>
      )}
      {receipt && !dialog && (
        <DialogBox
          title="Comprovante de venda"
          onClose={() => setReceipt(null)}
          wide
        >
          <div className="modal-body pos-receipt">
            <div className="pos-receipt-heading">
              <span className="eyebrow">INVICTUS ERP MOBILE</span>
              <h2>{receipt.sale.company_name}</h2>
              <p>{receipt.sale.branch_name}</p>
              <strong>COMPROVANTE NÃO FISCAL</strong>
              <code>{receipt.sale.receipt_code}</code>
              <p>
                {when(receipt.sale.created_at)} · {receipt.sale.operator_name}
              </p>
              <span className="badge">{statusNames[receipt.sale.status]}</span>
            </div>
            {receipt.items.map((l: Row) => (
              <div key={l.id} className="pos-receipt-line">
                <div>
                  <strong>
                    {l.quantity} × {l.product_name}
                  </strong>
                  <small>
                    {l.sku} {l.identifiers}
                  </small>
                  <small>
                    Garantia: {l.warranty_days} dias
                    {l.warranty_terms ? ` · ${l.warranty_terms}` : ""}
                  </small>
                  {l.returned_quantity > 0 && (
                    <small>Devolvido: {l.returned_quantity} un.</small>
                  )}
                </div>
                <b>{formatCents(l.net_cents)}</b>
              </div>
            ))}
            <div className="pos-receipt-totals">
              <p>
                <span>Subtotal</span>
                <b>{formatCents(receipt.sale.subtotal_cents)}</b>
              </p>
              <p>
                <span>Desconto</span>
                <b>{formatCents(receipt.sale.discount_cents)}</b>
              </p>
              <p className="total">
                <span>Total original</span>
                <b>{formatCents(receipt.sale.total_cents)}</b>
              </p>
              {receipt.payments.map((p: Row) => (
                <p key={p.method}>
                  <span>
                    {methodNames[p.method]}
                    {p.reference && <small>Ref.: {p.reference}</small>}
                  </span>
                  <b>{formatCents(p.tendered_cents)}</b>
                </p>
              ))}
              <p>
                <span>Troco</span>
                <b>{formatCents(receipt.sale.change_cents)}</b>
              </p>
            </div>
            {receipt.returns.map((r: Row) => (
              <div key={r.id} className="pos-return-note">
                <strong>
                  {r.kind === "cancel" ? "Cancelamento" : "Devolução"} ·{" "}
                  {formatCents(r.total_cents)}
                </strong>
                <p>{r.reason}</p>
                <small>
                  {when(r.created_at)} · {r.actor_name}
                </small>
              </div>
            ))}
            <p className="form-hint">
              Pagamentos externos registrados manualmente. Este comprovante não
              substitui documento fiscal. {receipt.sale.note}
            </p>
          </div>
          <div className="modal-footer pos-receipt-actions no-print">
            <DownloadReceipt receipt={receipt} />
            {can("pos_refund") &&
              receipt.sale.status !== "returned" &&
              receipt.sale.status !== "cancelled" && (
                <>
                  <button
                    className="secondary"
                    disabled={!session?.own}
                    onClick={() => beginReturn("return")}
                  >
                    Devolver itens
                  </button>
                  {receipt.sale.status === "completed" && (
                    <button
                      className="secondary"
                      disabled={!session?.own}
                      onClick={() => beginReturn("cancel")}
                    >
                      Cancelar venda
                    </button>
                  )}
                </>
              )}
          </div>
        </DialogBox>
      )}
      {dialog && (
        <DialogBox
          title={
            (
              {
                open: "Abrir caixa",
                close: "Conferir e fechar caixa",
                supply: "Registrar suprimento",
                withdrawal: "Registrar sangria",
                checkout: "Receber pagamento",
                register: "Cadastrar caixa",
                return: "Devolver itens",
                cancel: "Cancelar venda",
              } as Row
            )[dialog]
          }
          onClose={() => {
            if (!busy) setDialog(null);
          }}
          wide={
            dialog === "checkout" || dialog === "return" || dialog === "cancel"
          }
        >
          <form onSubmit={submit}>
            <div className="modal-body">
              {dialog === "register" && (
                <Field label="Nome do caixa">
                  <input name="name" required maxLength={100} autoFocus />
                </Field>
              )}
              {dialog === "open" && (
                <>
                  <p className="form-hint">
                    Informe o dinheiro físico disponível para iniciar sua
                    sessão.
                  </p>
                  <Field label="Saldo inicial (R$)">
                    <input
                      name="opening"
                      inputMode="decimal"
                      required
                      defaultValue="0.00"
                      autoFocus
                    />
                  </Field>
                </>
              )}
              {(dialog === "supply" || dialog === "withdrawal") && (
                <>
                  <p className="form-hint">
                    Dinheiro esperado: {formatCents(session?.expected_cents)}
                  </p>
                  <Field label="Valor da movimentação (R$)">
                    <input
                      name="amount"
                      inputMode="decimal"
                      required
                      autoFocus
                    />
                  </Field>
                  <Field label="Motivo">
                    <textarea
                      name="reason"
                      minLength={3}
                      maxLength={1000}
                      required
                    />
                  </Field>
                </>
              )}
              {dialog === "close" && (
                <>
                  <p className="pos-total-banner">
                    Esperado em dinheiro
                    <strong>{formatCents(session?.expected_cents)}</strong>
                  </p>
                  <Field label="Dinheiro contado (R$)">
                    <input
                      name="counted"
                      inputMode="decimal"
                      required
                      autoFocus
                    />
                  </Field>
                  <Field label="Observação da conferência">
                    <textarea
                      name="note"
                      maxLength={1000}
                      placeholder="Obrigatória se houver diferença"
                    />
                  </Field>
                  <p className="form-hint">
                    Pix e cartões ficam registrados separadamente e não entram
                    na contagem física.
                  </p>
                </>
              )}
              {dialog === "checkout" && (
                <>
                  <p className="pos-total-banner">
                    Total a receber<strong>{formatCents(total)}</strong>
                  </p>
                  <p className="form-hint">
                    Confira Pix/cartão no aplicativo ou terminal externo antes
                    de registrar a referência. Este sistema não realiza cobrança
                    automática.
                  </p>
                  {paymentFields()}
                  <div className="pos-change">
                    <span>Troco em dinheiro</span>
                    <strong>
                      {(() => {
                        try {
                          return formatCents(
                            Math.max(
                              0,
                              payments.reduce(
                                (n, p) => n + amountOf(p.amount),
                                0,
                              ) - total,
                            ),
                          );
                        } catch {
                          return "Confira os valores";
                        }
                      })()}
                    </strong>
                  </div>
                  <Field label="Observação da venda">
                    <textarea name="note" maxLength={1000} rows={2} />
                  </Field>
                </>
              )}
              {(dialog === "return" || dialog === "cancel") && receipt && (
                <>
                  <p className="form-hint">
                    Os itens retornam ao estoque. O ressarcimento deve usar as
                    formas originais e ser conferido externamente quando não for
                    dinheiro.
                  </p>
                  {receipt.items.map((l: Row) => (
                    <div className="pos-return-quantity" key={l.id}>
                      <span>
                        <strong>{l.product_name}</strong>
                        <small>
                          Disponível para devolver:{" "}
                          {l.quantity - l.returned_quantity}
                        </small>
                      </span>
                      <input
                        type="number"
                        aria-label={`Devolver ${l.product_name}`}
                        min="0"
                        max={l.quantity - l.returned_quantity}
                        disabled={dialog === "cancel"}
                        value={quantities[l.id] || 0}
                        onChange={(e) => {
                          const n = Number(e.target.value);
                          if (
                            Number.isInteger(n) &&
                            n >= 0 &&
                            n <= l.quantity - l.returned_quantity
                          )
                            setQuantities((q) => ({ ...q, [l.id]: n }));
                        }}
                      />
                    </div>
                  ))}
                  <p className="pos-total-banner">
                    Valor a devolver<strong>{formatCents(returnTotal)}</strong>
                  </p>
                  <button
                    className="secondary small"
                    type="button"
                    onClick={() => setPayments(allocateRefund(returnTotal))}
                  >
                    Distribuir conforme pagamentos originais
                  </button>
                  {paymentFields(true)}
                  <Field label="Motivo da devolução ou cancelamento">
                    <textarea
                      name="reason"
                      minLength={3}
                      maxLength={1000}
                      required
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
                {busy
                  ? "Registrando…"
                  : dialog === "checkout"
                    ? "Confirmar venda"
                    : "Confirmar operação"}
                <Check size={17} />
              </button>
            </div>
          </form>
        </DialogBox>
      )}
    </div>
  );
}

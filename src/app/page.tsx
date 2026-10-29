"use client";
import {
  useCallback,
  useEffect,
  useState,
  useId,
  useRef,
  cloneElement,
  type ReactElement,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  LayoutDashboard,
  Package,
  ArrowDownUp,
  Smartphone,
  ClipboardCheck,
  Settings,
  ShieldCheck,
  Search,
  Plus,
  X,
  ArrowUpRight,
  ArrowDownLeft,
  LogOut,
  ChevronRight,
  Menu,
  AlertTriangle,
  Building2,
  Check,
  Pencil,
  Archive,
  RotateCcw,
  SlidersHorizontal,
  Boxes,
  CircleHelp,
  ShoppingCart,
  Wrench,
  UsersRound,
  ChartNoAxesCombined,
} from "lucide-react";
import PosPanel from "./pos-panel";
import RepairsPanel from "./repairs-panel";
import CrmPanel from "./crm-panel";
import FinancePanel from "./finance-panel";

type Row = Record<string, any>;
type Me = {
  user: { name: string; email: string; role: string };
  tenant: { id: string; name: string };
  branches: Row[];
  permissions: string[];
  csrf: string;
  mode: string;
};
type Modal =
  | "product"
  | "move"
  | "count"
  | "minimum"
  | "catalog"
  | "branch"
  | "user"
  | "reverse"
  | null;
const brl = (n: any) =>
  Number(n || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
const date = (v: string) => new Date(v).toLocaleString("pt-BR");
const labels: Row = {
  entry: "Entrada",
  exit: "Saída",
  adjustment: "Ajuste",
  reversal: "Estorno",
  new: "Novo",
  refurbished: "Seminovo",
  used: "Usado",
  category: "Categoria",
  brand: "Marca",
  model: "Modelo",
  supplier: "Fornecedor",
  owner: "Proprietário",
  manager: "Gerente",
  stock: "Estoquista",
  viewer: "Consulta",
  cashier: "Operador de caixa",
  technician: "Técnico",
  in_stock: "Em estoque",
  out: "Fora do estoque",
};
const nav = [
  { id: "overview", label: "Visão geral", icon: LayoutDashboard },
  { id: "pos", label: "Frente de caixa", icon: ShoppingCart },
  { id: "repairs", label: "Assistência técnica", icon: Wrench },
  { id: "crm", label: "CRM e clientes", icon: UsersRound },
  { id: "finance", label: "Gestão financeira", icon: ChartNoAxesCombined },
  { id: "products", label: "Produtos", icon: Package },
  { id: "units", label: "Aparelhos e IMEIs", icon: Smartphone },
  { id: "movements", label: "Movimentações", icon: ArrowDownUp },
  { id: "inventory", label: "Inventário", icon: ClipboardCheck },
  { id: "catalog", label: "Cadastros auxiliares", icon: Boxes },
  { id: "audit", label: "Auditoria", icon: ShieldCheck },
  { id: "settings", label: "Configurações", icon: Settings },
];
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
function Empty({
  icon: Icon = Package,
  title,
  description,
  action,
}: {
  icon?: typeof Package;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon size={30} />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
async function request(path: string, options: RequestInit = {}) {
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
    cache: "no-store",
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Falha na conexão.");
  return data;
}

export default function App() {
  const loadSequence = useRef(0);
  const retryKeys = useRef(new Map<string, string>());
  const [me, setMe] = useState<Me | null>(null),
    [loading, setLoading] = useState(true),
    [local, setLocal] = useState(false),
    [authMode, setAuthMode] = useState<"login" | "setup">("login");
  const [view, setView] = useState("overview"),
    [branch, setBranch] = useState(""),
    [data, setData] = useState<Row>({}),
    [catalog, setCatalog] = useState<Row[]>([]),
    [products, setProducts] = useState<Row[]>([]);
  const [search, setSearch] = useState(""),
    [page, setPage] = useState(1),
    [archived, setArchived] = useState(false),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState(false),
    [notice, setNotice] = useState<{ text: string; error: boolean } | null>(
      null,
    ),
    [modal, setModal] = useState<Modal>(null),
    [selected, setSelected] = useState<Row | null>(null),
    [menu, setMenu] = useState(false),
    [units, setUnits] = useState<Row[]>([]),
    [moveType, setMoveType] = useState("entry"),
    [moveProduct, setMoveProduct] = useState(""),
    [deviceExisting, setDeviceExisting] = useState(false);
  const can = (right: string) => !!me?.permissions.includes(right);
  const show = (text: string, error = false) => setNotice({ text, error });
  const refreshMe = async () => {
    const value = await request("/me");
    setMe(value);
    setBranch((old) =>
      value.branches.some((b: Row) => b.id === old)
        ? old
        : value.branches[0]?.id || "",
    );
  };
  useEffect(() => {
    request("/public/config")
      .then((c) => setLocal(c.localProvisioning))
      .catch(() => {});
    refreshMe()
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    if (notice) {
      const t = setTimeout(() => setNotice(null), 8000);
      return () => clearTimeout(t);
    }
  }, [notice]);
  const load = useCallback(async () => {
    if (!me || !branch) return;
    const sequence = ++loadSequence.current;
    setPending(true);
    try {
      const suffix = `branch_id=${branch}`;
      const cat = await request("/catalog");
      let result: Row = {};
      if (view === "overview") result = await request(`/overview?${suffix}`);
      else if (view === "products" || view === "inventory") {
        const r = await request(
          `/products?${suffix}&q=${encodeURIComponent(search)}&archived=${archived}&page=${page}`,
        );
        result = r;
      } else if (view === "units" || view === "movements")
        result = await request(`/${view}?${suffix}&page=${page}`);
      else if (view === "audit") result = await request("/audit");
      else if (view === "settings" && me.permissions.includes("users"))
        result = await request("/users");
      if (loadSequence.current !== sequence) return;
      setCatalog(cat.items);
      setData(result);
      if (view === "products" || view === "inventory")
        setProducts(result.items);
    } catch (e: any) {
      if (loadSequence.current === sequence) show(e.message, true);
    } finally {
      if (loadSequence.current === sequence) setPending(false);
    }
  }, [me, branch, view, search, archived, page]);
  useEffect(() => {
    const t = setTimeout(() => {
      void load();
    }, 180);
    return () => {
      clearTimeout(t);
      loadSequence.current++;
    };
  }, [load]);
  useEffect(() => {
    if (!modal || !branch || !moveProduct) return;
    request(`/units?branch_id=${branch}&product_id=${moveProduct}`)
      .then((r) => setUnits(r.items))
      .catch((e) => show(e.message, true));
  }, [modal, branch, moveProduct]);
  const navigate = (id: string) => {
    if (id === view) {
      setMenu(false);
      return;
    }
    setView(id);
    setSearch("");
    setPage(1);
    setArchived(false);
    setData({});
    setMenu(false);
  };
  const open = async (kind: Modal, item: Row | null = null) => {
    setSelected(item);
    setModal(kind);
    setMoveProduct(item?.id || "");
    setMoveType("entry");
    setDeviceExisting(false);
    if (kind === "move" && !item) {
      try {
        const r = await request(`/products?branch_id=${branch}`);
        setProducts(r.items);
      } catch (e: any) {
        show(e.message, true);
      }
    }
  };
  const mutate = async (path: string, body: unknown, method = "POST") => {
    const fingerprint = JSON.stringify({
      tenant: me!.tenant.id,
      user: me!.user.email,
      path,
      method,
      body,
    });
    const key = retryKeys.current.get(fingerprint) || crypto.randomUUID();
    retryKeys.current.set(fingerprint, key);
    const result = await request(path, {
      method,
      headers: {
        "X-CSRF-Token": me!.csrf,
        "Idempotency-Key": key,
      },
      body: JSON.stringify(body),
    });
    retryKeys.current.delete(fingerprint);
    return result;
  };
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;
    const f = new FormData(e.currentTarget);
    const value = (k: string) => String(f.get(k) || "").trim();
    setBusy(true);
    try {
      if (modal === "product") {
        const b: Row = {
          name: value("name"),
          sku: value("sku"),
          barcode: value("barcode"),
          category_id: value("category_id") || null,
          brand_id: value("brand_id") || null,
          model_id: value("model_id") || null,
          supplier_id: value("supplier_id") || null,
          color: value("color"),
          capacity: value("capacity"),
          condition: value("condition"),
          serialized: f.has("serialized"),
          cost: Number(value("cost")),
          price: Number(value("price")),
          warranty_days: Number(value("warranty_days")),
          warranty_terms: value("warranty_terms"),
        };
        if (selected) b.version = selected.version;
        await mutate(
          selected ? `/products/${selected.id}` : "/products",
          b,
          selected ? "PUT" : "POST",
        );
      } else if (modal === "catalog")
        await mutate("/catalog", {
          kind: value("kind"),
          name: value("name"),
          contact: value("contact"),
        });
      else if (modal === "branch") {
        await mutate("/branches", { name: value("name") });
        await refreshMe();
      } else if (modal === "user")
        await mutate("/users", {
          name: value("name"),
          email: value("email"),
          password: value("password"),
          role: value("role"),
          branch_ids: f.getAll("branch_ids"),
        });
      else if (modal === "minimum")
        await mutate(
          "/minimum",
          {
            product_id: selected!.id,
            branch_id: branch,
            minimum: Number(value("minimum")),
          },
          "PUT",
        );
      else if (modal === "count")
        await mutate("/inventory", {
          product_id: selected!.id,
          branch_id: branch,
          expected: selected!.quantity,
          counted: Number(value("counted")),
          reason: value("reason"),
        });
      else if (modal === "reverse")
        await mutate(`/movements/${selected!.id}/reverse`, {
          reason: value("reason"),
        });
      else if (modal === "move") {
        const p = products.find((p) => p.id === moveProduct) || selected;
        if (!p) throw new Error("Selecione um produto.");
        const b: Row = {
          product_id: p.id,
          branch_id: branch,
          type: moveType,
          quantity: p.serialized ? 1 : Number(value("quantity")),
          reason: value("reason"),
        };
        if (p.serialized) {
          if (moveType === "exit" || deviceExisting)
            b.unit_id = value("unit_id");
          else
            b.device = {
              imeis: value("imeis")
                .split(/[\s,;]+/)
                .filter(Boolean),
              serial: value("serial"),
              provenance: value("provenance"),
              acquisition_cost: Number(value("acquisition_cost")),
              supplier_id: value("supplier_id") || null,
            };
        }
        await mutate("/movements", b);
      }
      setModal(null);
      show("Operação registrada com sucesso.");
      await load();
    } catch (e: any) {
      show(e.message, true);
    } finally {
      setBusy(false);
    }
  };
  const auth = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    try {
      if (authMode === "setup") {
        await request("/setup", {
          method: "POST",
          body: JSON.stringify(Object.fromEntries(f)),
        });
        show("Empresa criada. Entre com seu e-mail e senha.");
        setAuthMode("login");
      } else {
        await request("/login", {
          method: "POST",
          body: JSON.stringify(Object.fromEntries(f)),
        });
        await refreshMe();
        setNotice(null);
      }
    } catch (e: any) {
      show(e.message, true);
    } finally {
      setBusy(false);
    }
  };
  const toast = notice && (
    <div
      className={`toast ${notice.error ? "error" : "success"}`}
      role={notice.error ? "alert" : "status"}
    >
      {notice.error ? <AlertTriangle size={20} /> : <Check size={20} />}
      <span>{notice.text}</span>
      <button aria-label="Fechar aviso" onClick={() => setNotice(null)}>
        <X size={18} />
      </button>
    </div>
  );
  if (loading)
    return (
      <div className="loading">
        <div className="brand-mark">i</div>
        <p>Carregando seu ambiente…</p>
      </div>
    );
  if (!me)
    return (
      <main className="auth">
        <section className="auth-story">
          <div className="wordmark">
            <div className="brand-mark">i</div>INVICTUS <span>SYSTEMS</span>
          </div>
          <div>
            <span className="eyebrow">ERP MOBILE</span>
            <h1>
              Seu estoque.
              <br />
              Sob controle.
            </h1>
            <p>
              Uma operação organizada começa com informação confiável. Produtos,
              aparelhos e estoque em um só lugar.
            </p>
            <div className="auth-pills">
              <span>
                <ShieldCheck size={16} /> Acesso por perfil
              </span>
              <span>
                <Building2 size={16} /> Estoque por filial
              </span>
            </div>
          </div>
          <small>INVICTUS SYSTEMS · Gestão que acompanha seu negócio.</small>
        </section>
        <section className="auth-panel">
          <div className="auth-form">
            <Badge tone="yellow">ESTOQUE E FRENTE DE CAIXA</Badge>
            <h2>
              {authMode === "login"
                ? "Bem-vindo de volta"
                : "Crie seu ambiente local"}
            </h2>
            <p>
              {authMode === "login"
                ? "Entre para acompanhar sua operação."
                : "Cadastre sua empresa. O estoque começará vazio."}
            </p>
            <form onSubmit={auth} key={authMode}>
              {authMode === "setup" && (
                <>
                  <Field label="Nome da empresa">
                    <input name="company" required maxLength={180} />
                  </Field>
                  <Field label="Seu nome">
                    <input name="name" required maxLength={180} />
                  </Field>
                  <Field label="Nome da primeira filial">
                    <input
                      name="branch"
                      required
                      placeholder="Ex.: Loja Centro"
                      maxLength={180}
                    />
                  </Field>
                </>
              )}
              <Field label="E-mail">
                <input
                  name="email"
                  type="email"
                  autoComplete="username"
                  required
                />
              </Field>
              <Field
                label="Senha"
                hint={
                  authMode === "setup"
                    ? "Use pelo menos 12 caracteres."
                    : undefined
                }
              >
                <input
                  name="password"
                  type="password"
                  minLength={authMode === "setup" ? 12 : 1}
                  maxLength={128}
                  autoComplete={
                    authMode === "setup" ? "new-password" : "current-password"
                  }
                  required
                />
              </Field>
              <button className="primary full" disabled={busy}>
                {busy
                  ? "Aguarde…"
                  : authMode === "login"
                    ? "Entrar no sistema"
                    : "Criar empresa"}
                <ArrowUpRight size={18} />
              </button>
            </form>
            {local && (
              <>
                <button
                  className="text-button"
                  onClick={() =>
                    setAuthMode(authMode === "login" ? "setup" : "login")
                  }
                >
                  {authMode === "login"
                    ? "Primeiro acesso? Criar empresa local"
                    : "Já tem uma conta? Entrar"}
                </button>
                <div className="local-note">
                  <CircleHelp size={17} />
                  <span>
                    Ambiente local persistente. Para produção, conecte o
                    PostgreSQL e o provisionamento da central.
                  </span>
                </div>
              </>
            )}
          </div>
        </section>
        {toast}
      </main>
    );
  const current = nav.find((n) => n.id === view)!;
  const p = products.find((p) => p.id === moveProduct) || selected;
  const entries = (kind: string) => catalog.filter((c) => c.kind === kind);
  const catalogSelect = (kind: string, name: string, defaultValue?: string) => (
    <select name={name} defaultValue={defaultValue || ""}>
      <option value="">Não informado</option>
      {entries(kind).map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </select>
  );
  const movementTable = (items: Row[], compact = false) => (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Produto / operação</th>
            <th>Quantidade</th>
            <th>Saldo após</th>
            <th>Responsável</th>
            <th>Data</th>
            {!compact && (
              <>
                <th>Motivo</th>
                <th />
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {items.map((m) => (
            <tr key={m.id}>
              <td>
                <strong>{m.product_name}</strong>
                <Badge tone={m.quantity > 0 ? "green" : "red"}>
                  {labels[m.type]}
                </Badge>
              </td>
              <td>
                <span className={m.quantity > 0 ? "positive" : "negative"}>
                  {m.quantity > 0 ? "+" : ""}
                  {m.quantity}
                </span>
              </td>
              <td>{m.balance_after}</td>
              <td>{m.actor_name}</td>
              <td className="muted nowrap">{date(m.created_at)}</td>
              {!compact && (
                <>
                  <td className="reason">{m.reason}</td>
                  <td>
                    {can("adjust") &&
                    !m.sale_item_id &&
                    !m.return_item_id &&
                    !m.repair_part_event_id &&
                    m.type !== "reversal" &&
                    !m.reversal_id ? (
                      <button
                        className="icon-button"
                        title="Estornar movimentação"
                        aria-label={`Estornar ${m.product_name}`}
                        onClick={() => open("reverse", m)}
                      >
                        <RotateCcw size={17} />
                      </button>
                    ) : m.reversal_id ? (
                      <Badge>Estornada</Badge>
                    ) : null}
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
  return (
    <div className="app-shell">
      {menu && (
        <button
          className="scrim"
          aria-label="Fechar menu"
          onClick={() => setMenu(false)}
        />
      )}
      <aside className={menu ? "sidebar open" : "sidebar"}>
        <div className="wordmark">
          <div className="brand-mark">i</div>
          <div>
            INVICTUS<span>SYSTEMS</span>
          </div>
        </div>
        <div className="workspace">
          <div className="workspace-avatar">
            {me.tenant.name[0]?.toUpperCase()}
          </div>
          <div>
            <strong>{me.tenant.name}</strong>
            <small>ERP Mobile</small>
          </div>
        </div>
        <div className="nav-label">GESTÃO DA OPERAÇÃO</div>
        <nav>
          {nav
            .filter(
              (n) =>
                (n.id !== "audit" || can("audit")) &&
                (n.id !== "pos" || can("pos_read")) &&
                (n.id !== "repairs" || can("service_read")) &&
                (n.id !== "crm" || can("crm_read")) &&
                (n.id !== "finance" || can("finance_read")),
            )
            .map((n) => (
              <button
                key={n.id}
                className={view === n.id ? "active" : ""}
                onClick={() => navigate(n.id)}
              >
                <n.icon size={19} />
                {n.label}
                {view === n.id && <span className="nav-dot" />}
              </button>
            ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="module-status">
            <span className="status-dot" /> Módulos 1 a 5 ativos
            <small>Estoque, PDV, Assistência, CRM e Financeiro</small>
          </div>
          <button
            className="profile"
            onClick={async () => {
              try {
                await mutate("/logout", {});
                setMe(null);
                setData({});
              } catch (e: any) {
                show(e.message, true);
              }
            }}
            title="Sair da conta"
          >
            <div className="avatar">{me.user.name[0]?.toUpperCase()}</div>
            <span>
              <strong>{me.user.name}</strong>
              <small>{labels[me.user.role]}</small>
            </span>
            <LogOut size={17} />
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <button
            className="mobile-menu icon-button"
            aria-label="Abrir menu"
            onClick={() => setMenu(true)}
          >
            <Menu />
          </button>
          <div className="breadcrumb">
            Workspace <ChevronRight size={14} />
            <strong>{current.label}</strong>
          </div>
          <div className="topbar-right">
            <Badge tone={me.mode === "local" ? "yellow" : "green"}>
              {me.mode === "local" ? "AMBIENTE LOCAL" : "PRODUÇÃO"}
            </Badge>
            <Building2 size={17} />
            <select
              aria-label="Filial ativa"
              value={branch}
              onChange={(e) => {
                setBranch(e.target.value);
                setPage(1);
                setData({});
              }}
            >
              {me.branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
        </header>
        <main className="content" aria-busy={pending}>
          <div className="page-heading">
            <div>
              <div className="eyebrow">INVICTUS ERP MOBILE</div>
              <h1>{current.label}</h1>
              <p>
                {
                  {
                    overview: "Uma visão clara do seu estoque, em tempo real.",
                    pos: "Vendas, pagamentos e caixa integrados ao seu estoque.",
                    crm: "Clientes, históricos e próximos passos do atendimento.",
                    finance:
                      "Recebimentos, pagamentos e resultados da sua operação.",
                    repairs:
                      "Do recebimento à entrega, acompanhe cada etapa do reparo.",
                    products: "Organize seu catálogo e acompanhe cada produto.",
                    units:
                      "Identificação individual, procedência e rastreabilidade.",
                    movements:
                      "Cada entrada e saída, com seu histórico preservado.",
                    inventory:
                      "Confira o estoque físico e registre as divergências.",
                    catalog:
                      "Organize categorias, marcas, modelos e fornecedores.",
                    audit:
                      "Rastreabilidade das operações realizadas na empresa.",
                    settings: "Informações do ambiente e acesso da equipe.",
                  }[view]
                }
              </p>
            </div>
            <div className="heading-actions">
              {can("stock") &&
                ["overview", "movements", "units"].includes(view) && (
                  <button className="secondary" onClick={() => open("move")}>
                    <ArrowDownUp size={17} />
                    Movimentar estoque
                  </button>
                )}
              {can("catalog") && ["overview", "products"].includes(view) && (
                <button className="primary" onClick={() => open("product")}>
                  <Plus size={18} />
                  Novo produto
                </button>
              )}
              {can("catalog") && view === "catalog" && (
                <button className="primary" onClick={() => open("catalog")}>
                  <Plus size={18} />
                  Novo cadastro
                </button>
              )}
            </div>
          </div>
          {!branch ? (
            <Empty
              title="Nenhuma filial autorizada"
              description="Solicite ao administrador o vínculo com uma filial."
            />
          ) : (
            <>
              {view === "pos" && can("pos_read") && (
                <PosPanel
                  key={branch}
                  branch={branch}
                  permissions={me.permissions}
                  mutate={mutate}
                  onNotice={show}
                />
              )}
              {view === "repairs" && can("service_read") && (
                <RepairsPanel
                  key={branch}
                  branch={branch}
                  permissions={me.permissions}
                  mutate={mutate}
                  onNotice={show}
                />
              )}
              {view === "crm" && can("crm_read") && (
                <CrmPanel
                  key={branch}
                  branch={branch}
                  mutate={mutate}
                  onNotice={show}
                />
              )}
              {view === "finance" && can("finance_read") && (
                <FinancePanel
                  key={branch}
                  branch={branch}
                  branches={me.branches}
                  mutate={mutate}
                  onNotice={show}
                />
              )}
              {view === "overview" && (
                <>
                  <div className="metrics">
                    <article className="metric featured">
                      <div>
                        <span>Unidades em estoque</span>
                        <Boxes size={20} />
                      </div>
                      <strong>{data.metrics?.units ?? "—"}</strong>
                      <small>Saldo físico da filial selecionada</small>
                    </article>
                    <article className="metric">
                      <div>
                        <span>Produtos ativos</span>
                        <Package size={20} />
                      </div>
                      <strong>{data.metrics?.products ?? "—"}</strong>
                      <small>Itens cadastrados no catálogo</small>
                    </article>
                    <article className="metric">
                      <div>
                        <span>Reposição necessária</span>
                        <AlertTriangle size={20} />
                      </div>
                      <strong>{data.metrics?.low ?? "—"}</strong>
                      <small>No mínimo definido ou abaixo dele</small>
                    </article>
                    <article className="metric">
                      <div>
                        <span>
                          {can("cost")
                            ? "Valor de custo"
                            : "Filial selecionada"}
                        </span>
                        <Building2 size={20} />
                      </div>
                      <strong
                        className={can("cost") ? "money" : "branch-value"}
                      >
                        {can("cost")
                          ? data.metrics
                            ? brl(data.metrics.cost_value)
                            : "—"
                          : me.branches.find((b) => b.id === branch)?.name}
                      </strong>
                      <small>
                        {can("cost")
                          ? "Estimativa pelo custo cadastrado"
                          : "Estoque independente por unidade"}
                      </small>
                    </article>
                  </div>
                  <div className="overview-grid">
                    <section className="panel">
                      <div className="panel-heading">
                        <div>
                          <h2>Últimas movimentações</h2>
                          <p>O que aconteceu no seu estoque</p>
                        </div>
                        <button
                          className="text-button inline"
                          onClick={() => navigate("movements")}
                        >
                          Ver histórico
                          <ArrowUpRight size={16} />
                        </button>
                      </div>
                      {data.movements?.length ? (
                        movementTable(data.movements, true)
                      ) : (
                        <Empty
                          icon={ArrowDownUp}
                          title="Seu histórico começa aqui"
                          description="As entradas, saídas e ajustes aparecerão aqui assim que forem registrados."
                          action={
                            can("stock") ? (
                              <button
                                className="secondary"
                                onClick={() => open("move")}
                              >
                                Registrar movimentação
                                <ArrowUpRight size={16} />
                              </button>
                            ) : undefined
                          }
                        />
                      )}
                    </section>
                    <section className="panel quickstart">
                      <Badge tone="yellow">OPERAÇÃO ORGANIZADA</Badge>
                      <h2>Controle em cada detalhe.</h2>
                      <p>
                        Da entrada da mercadoria à conferência física, mantenha
                        seu estoque rastreável.
                      </p>
                      <button onClick={() => navigate("products")}>
                        <Package size={19} />
                        <span>
                          <strong>Catálogo de produtos</strong>
                          <small>SKU, preços e garantias</small>
                        </span>
                        <ChevronRight size={18} />
                      </button>
                      <button onClick={() => navigate("units")}>
                        <Smartphone size={19} />
                        <span>
                          <strong>Aparelhos individualizados</strong>
                          <small>IMEI, série e procedência</small>
                        </span>
                        <ChevronRight size={18} />
                      </button>
                      <button onClick={() => navigate("inventory")}>
                        <ClipboardCheck size={19} />
                        <span>
                          <strong>Conferência de estoque</strong>
                          <small>Contagens e ajustes auditados</small>
                        </span>
                        <ChevronRight size={18} />
                      </button>
                    </section>
                  </div>
                  <div className="info-strip">
                    <ShieldCheck size={19} />
                    <span>
                      Os indicadores refletem os registros da filial
                      selecionada. Os demais módulos serão disponibilizados em
                      etapas futuras.
                    </span>
                  </div>
                </>
              )}
              {["products", "inventory"].includes(view) && (
                <section className="panel">
                  <div className="table-toolbar">
                    <div className="search">
                      <Search size={18} />
                      <input
                        aria-label="Buscar produto"
                        placeholder="Buscar por nome, SKU ou código de barras…"
                        value={search}
                        onChange={(e) => {
                          setSearch(e.target.value);
                          setPage(1);
                        }}
                      />
                    </div>
                    {view === "products" && (
                      <label className="check-label">
                        <input
                          type="checkbox"
                          checked={archived}
                          onChange={(e) => {
                            setArchived(e.target.checked);
                            setPage(1);
                          }}
                        />
                        Incluir arquivados
                      </label>
                    )}
                    <Badge>{data.total || 0} produtos</Badge>
                  </div>
                  {data.items?.length ? (
                    <>
                      <div className="table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>Produto</th>
                              <th>SKU / código</th>
                              <th>Estoque</th>
                              {view === "products" && (
                                <>
                                  <th>Preço de venda</th>
                                  {can("cost") && <th>Margem bruta</th>}
                                </>
                              )}
                              <th>Situação</th>
                              <th className="align-right">Ações</th>
                            </tr>
                          </thead>
                          <tbody>
                            {data.items.map((item: Row) => (
                              <tr key={item.id}>
                                <td>
                                  <div className="product-cell">
                                    <div
                                      className={`product-avatar ${item.serialized ? "phone" : ""}`}
                                    >
                                      {item.serialized ? (
                                        <Smartphone size={22} />
                                      ) : (
                                        <Package size={22} />
                                      )}
                                    </div>
                                    <div>
                                      <strong>{item.name}</strong>
                                      <small>
                                        {[
                                          item.brand_name,
                                          item.color,
                                          item.capacity,
                                        ]
                                          .filter(Boolean)
                                          .join(" · ") ||
                                          labels[item.condition]}
                                      </small>
                                    </div>
                                  </div>
                                </td>
                                <td>
                                  <span className="mono">{item.sku}</span>
                                  <small>
                                    {item.barcode || "Sem código de barras"}
                                  </small>
                                </td>
                                <td>
                                  <strong>
                                    {item.quantity}{" "}
                                    <span className="muted weight-normal">
                                      un.
                                    </span>
                                  </strong>
                                  <small>Mínimo: {item.minimum}</small>
                                </td>
                                {view === "products" && (
                                  <>
                                    <td className="nowrap">
                                      {brl(item.price)}
                                    </td>
                                    {can("cost") && (
                                      <td>
                                        {brl(
                                          Number(item.price) -
                                            Number(item.cost),
                                        )}
                                        <small>
                                          {Number(item.price) > 0
                                            ? `${(((Number(item.price) - Number(item.cost)) / Number(item.price)) * 100).toFixed(1)}% sobre a venda`
                                            : "Sem preço de venda"}
                                        </small>
                                      </td>
                                    )}
                                  </>
                                )}
                                <td>
                                  {!item.active ? (
                                    <Badge>Arquivado</Badge>
                                  ) : item.minimum > 0 &&
                                    item.quantity <= item.minimum ? (
                                    <Badge tone="yellow">Repor estoque</Badge>
                                  ) : (
                                    <Badge tone="green">Ativo</Badge>
                                  )}
                                </td>
                                <td>
                                  <div className="row-actions">
                                    {view === "inventory" ? (
                                      <>
                                        {can("adjust") && item.active && (
                                          <>
                                            <button
                                              className="secondary small"
                                              onClick={() =>
                                                open("count", item)
                                              }
                                            >
                                              Conferir
                                            </button>
                                            <button
                                              className="icon-button"
                                              title="Definir estoque mínimo"
                                              aria-label={`Definir mínimo de ${item.name}`}
                                              onClick={() =>
                                                open("minimum", item)
                                              }
                                            >
                                              <SlidersHorizontal size={17} />
                                            </button>
                                          </>
                                        )}
                                      </>
                                    ) : (
                                      <>
                                        {can("stock") && item.active && (
                                          <button
                                            className="icon-button"
                                            title="Movimentar"
                                            aria-label={`Movimentar ${item.name}`}
                                            onClick={() => open("move", item)}
                                          >
                                            <ArrowDownUp size={17} />
                                          </button>
                                        )}
                                        {can("catalog") && (
                                          <>
                                            <button
                                              className="icon-button"
                                              title="Editar"
                                              aria-label={`Editar ${item.name}`}
                                              onClick={() =>
                                                open("product", item)
                                              }
                                            >
                                              <Pencil size={16} />
                                            </button>
                                            {item.active && (
                                              <button
                                                className="icon-button"
                                                title="Arquivar produto sem estoque"
                                                aria-label={`Arquivar ${item.name}`}
                                                onClick={async () => {
                                                  if (
                                                    !confirm(
                                                      `Arquivar ${item.name}? O histórico será preservado.`,
                                                    )
                                                  )
                                                    return;
                                                  try {
                                                    await mutate(
                                                      `/products/${item.id}`,
                                                      {},
                                                      "DELETE",
                                                    );
                                                    show("Produto arquivado.");
                                                    await load();
                                                  } catch (e: any) {
                                                    show(e.message, true);
                                                  }
                                                }}
                                              >
                                                <Archive size={16} />
                                              </button>
                                            )}
                                          </>
                                        )}
                                      </>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className="pagination">
                        <span>
                          Página {page} · {data.total} resultados
                        </span>
                        <div>
                          <button
                            className="secondary small"
                            disabled={page === 1}
                            onClick={() => setPage((v) => v - 1)}
                          >
                            Anterior
                          </button>
                          <button
                            className="secondary small"
                            disabled={page * 30 >= data.total}
                            onClick={() => setPage((v) => v + 1)}
                          >
                            Próxima
                          </button>
                        </div>
                      </div>
                    </>
                  ) : (
                    <Empty
                      title={
                        search
                          ? "Nenhum produto encontrado"
                          : "Seu catálogo está pronto para começar"
                      }
                      description={
                        search
                          ? "Experimente outro nome, SKU ou código."
                          : "Cadastre o primeiro produto e depois registre a entrada no estoque."
                      }
                      action={
                        can("catalog") && !search ? (
                          <button
                            className="primary"
                            onClick={() => open("product")}
                          >
                            <Plus size={17} />
                            Cadastrar produto
                          </button>
                        ) : undefined
                      }
                    />
                  )}
                </section>
              )}
              {view === "movements" && (
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Histórico do estoque</h2>
                      <p>Registros preservados · correções por estorno</p>
                    </div>
                    <Badge>
                      {me.branches.find((b) => b.id === branch)?.name}
                    </Badge>
                  </div>
                  {data.items?.length ? (
                    <>
                      {movementTable(data.items)}
                      <div className="pagination">
                        <span>Página {page}</span>
                        <div>
                          <button
                            className="secondary small"
                            disabled={page === 1}
                            onClick={() => setPage((v) => v - 1)}
                          >
                            Anterior
                          </button>
                          <button
                            className="secondary small"
                            disabled={data.items.length < 50}
                            onClick={() => setPage((v) => v + 1)}
                          >
                            Próxima
                          </button>
                        </div>
                      </div>
                    </>
                  ) : (
                    <Empty
                      icon={ArrowDownUp}
                      title="Nenhuma movimentação registrada"
                      description="Registre a entrada de produtos para iniciar o controle do estoque."
                    />
                  )}
                </section>
              )}
              {view === "units" && (
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Rastreabilidade de aparelhos</h2>
                      <p>Até 500 unidades mais recentes da filial</p>
                    </div>
                    <Badge>{data.items?.length || 0} aparelhos</Badge>
                  </div>
                  {data.items?.length ? (
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Aparelho</th>
                            <th>IMEIs / série</th>
                            <th>Procedência</th>
                            {can("cost") && <th>Custo individual</th>}
                            <th>Situação</th>
                            <th>Recebido em</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.items.map((u: Row) => (
                            <tr key={u.id}>
                              <td>
                                <strong>{u.product_name}</strong>
                              </td>
                              <td className="mono">
                                {u.imeis.map((s: string) => (
                                  <div key={s}>{s}</div>
                                ))}
                                <small>Série: {u.serial || "—"}</small>
                              </td>
                              <td className="reason">{u.provenance}</td>
                              {can("cost") && (
                                <td>{brl(u.acquisition_cost)}</td>
                              )}
                              <td>
                                <Badge
                                  tone={
                                    u.status === "in_stock"
                                      ? "green"
                                      : "neutral"
                                  }
                                >
                                  {labels[u.status]}
                                </Badge>
                              </td>
                              <td className="muted">{date(u.created_at)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <Empty
                      icon={Smartphone}
                      title="Cada aparelho tem sua história"
                      description="Cadastre um produto com controle individual e registre sua entrada com IMEI ou número de série."
                    />
                  )}
                </section>
              )}
              {view === "catalog" && (
                <div className="catalog-grid">
                  {["category", "brand", "model", "supplier"].map((kind) => (
                    <section className="panel" key={kind}>
                      <div className="panel-heading">
                        <h2>
                          {
                            (
                              {
                                category: "Categorias",
                                brand: "Marcas",
                                model: "Modelos",
                                supplier: "Fornecedores",
                              } as Row
                            )[kind]
                          }
                        </h2>
                        <Badge>{entries(kind).length}</Badge>
                      </div>
                      {entries(kind).length ? (
                        <ul className="catalog-list">
                          {entries(kind).map((c) => (
                            <li key={c.id}>
                              <span>
                                <strong>{c.name}</strong>
                                {c.contact && <small>{c.contact}</small>}
                              </span>
                              <Check size={16} />
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <div className="compact-empty">
                          Nenhum cadastro nesta categoria.
                        </div>
                      )}
                    </section>
                  ))}
                </div>
              )}
              {view === "audit" && (
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Registro de auditoria</h2>
                      <p>Até 200 eventos mais recentes autorizados</p>
                    </div>
                    <ShieldCheck size={21} />
                  </div>
                  {data.items?.length ? (
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Operação</th>
                            <th>Responsável</th>
                            <th>Registro</th>
                            <th>Data</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.items.map((a: Row) => (
                            <tr key={a.id}>
                              <td>
                                <Badge>{a.action}</Badge>
                              </td>
                              <td>{a.actor_name || "Sistema"}</td>
                              <td className="mono audit-id">{a.entity_id}</td>
                              <td>{date(a.created_at)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <Empty
                      icon={ShieldCheck}
                      title="Nenhum evento disponível"
                      description="As operações autorizadas serão registradas automaticamente."
                    />
                  )}
                </section>
              )}
              {view === "settings" && (
                <>
                  <div className="catalog-grid">
                    <section className="panel">
                      <div className="panel-heading">
                        <h2>Seu ambiente</h2>
                        <Building2 size={20} />
                      </div>
                      <dl className="details">
                        <dt>Empresa</dt>
                        <dd>{me.tenant.name}</dd>
                        <dt>Identificador</dt>
                        <dd className="mono">{me.tenant.id}</dd>
                        <dt>Modo</dt>
                        <dd>
                          {me.mode === "local"
                            ? "Local persistente · PostgreSQL embarcado"
                            : "PostgreSQL de produção"}
                        </dd>
                        <dt>Módulos disponíveis</dt>
                        <dd>
                          1 · Estoque / 2 · PDV / 3 · Assistência / 4 · CRM / 5
                          · Financeiro
                        </dd>
                      </dl>
                    </section>
                    <section className="panel">
                      <div className="panel-heading">
                        <h2>Filiais autorizadas</h2>
                        {local && can("branches") && (
                          <button
                            className="secondary small"
                            onClick={() => open("branch")}
                          >
                            <Plus size={16} />
                            Adicionar
                          </button>
                        )}
                      </div>
                      <ul className="catalog-list">
                        {me.branches.map((b) => (
                          <li key={b.id}>
                            <Building2 size={18} />
                            <strong>{b.name}</strong>
                            {b.id === branch && (
                              <Badge tone="green">Selecionada</Badge>
                            )}
                          </li>
                        ))}
                      </ul>
                    </section>
                  </div>
                  {can("users") && (
                    <section className="panel team-panel">
                      <div className="panel-heading">
                        <div>
                          <h2>Acesso ao estoque</h2>
                          <p>Perfis mínimos desta etapa</p>
                        </div>
                        {local && (
                          <button
                            className="primary small"
                            onClick={() => open("user")}
                          >
                            <Plus size={16} />
                            Novo acesso
                          </button>
                        )}
                      </div>
                      <div className="table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>Nome</th>
                              <th>E-mail</th>
                              <th>Perfil</th>
                              <th>Filiais</th>
                            </tr>
                          </thead>
                          <tbody>
                            {data.items?.map((u: Row) => (
                              <tr key={u.id}>
                                <td>
                                  <strong>{u.name}</strong>
                                </td>
                                <td>{u.email}</td>
                                <td>
                                  <Badge>{labels[u.role]}</Badge>
                                </td>
                                <td>
                                  {u.branch_ids
                                    .map(
                                      (id: string) =>
                                        me.branches.find((b) => b.id === id)
                                          ?.name || "Filial",
                                    )
                                    .join(", ")}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  )}
                  <div className="info-strip">
                    <CircleHelp size={18} />
                    <span>
                      A identidade visual inicial é Invictus Systems. A conexão
                      com a central, o provisionamento de produção e a
                      personalização white label aguardam a análise dos projetos
                      existentes.
                    </span>
                  </div>
                </>
              )}
            </>
          )}
          {pending && (
            <div className="loading-line" role="status">
              Atualizando dados…
            </div>
          )}
          <footer className="footer">
            <span>INVICTUS SYSTEMS</span>
            <span>Invictus ERP Mobile</span>
          </footer>
        </main>
      </div>
      {modal && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget && !busy) setModal(null);
          }}
        >
          <section
            className={`modal ${modal === "product" ? "wide" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
          >
            <div className="modal-header">
              <div>
                <span className="eyebrow">PRODUTOS E ESTOQUE</span>
                <h2 id="modal-title">
                  {
                    {
                      product: selected ? "Editar produto" : "Novo produto",
                      move: "Movimentar estoque",
                      count: "Conferir inventário",
                      minimum: "Estoque mínimo",
                      catalog: "Novo cadastro auxiliar",
                      branch: "Adicionar filial",
                      user: "Novo acesso",
                      reverse: "Estornar movimentação",
                    }[modal]
                  }
                </h2>
              </div>
              <button
                className="icon-button"
                aria-label="Fechar formulário"
                disabled={busy}
                onClick={() => setModal(null)}
              >
                <X />
              </button>
            </div>
            <form onSubmit={submit} key={`${modal}-${selected?.id || "new"}`}>
              <div className="modal-body">
                {modal === "product" && (
                  <>
                    <div className="form-section">INFORMAÇÕES DO PRODUTO</div>
                    <div className="form-grid">
                      <Field label="Nome do produto">
                        <input
                          name="name"
                          defaultValue={selected?.name}
                          required
                          maxLength={180}
                          autoFocus
                        />
                      </Field>
                      <Field label="SKU">
                        <input
                          name="sku"
                          defaultValue={selected?.sku}
                          required
                          maxLength={80}
                        />
                      </Field>
                      <Field label="Código de barras">
                        <input
                          name="barcode"
                          defaultValue={selected?.barcode}
                          maxLength={80}
                        />
                      </Field>
                      <Field label="Condição">
                        <select
                          name="condition"
                          defaultValue={selected?.condition || "new"}
                        >
                          {["new", "refurbished", "used"].map((v) => (
                            <option key={v} value={v}>
                              {labels[v]}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Categoria">
                        {catalogSelect(
                          "category",
                          "category_id",
                          selected?.category_id,
                        )}
                      </Field>
                      <Field label="Marca">
                        {catalogSelect("brand", "brand_id", selected?.brand_id)}
                      </Field>
                      <Field label="Modelo">
                        {catalogSelect("model", "model_id", selected?.model_id)}
                      </Field>
                      <Field label="Fornecedor">
                        {catalogSelect(
                          "supplier",
                          "supplier_id",
                          selected?.supplier_id,
                        )}
                      </Field>
                      <Field label="Cor">
                        <input
                          name="color"
                          defaultValue={selected?.color}
                          maxLength={80}
                        />
                      </Field>
                      <Field label="Capacidade">
                        <input
                          name="capacity"
                          defaultValue={selected?.capacity}
                          placeholder="Ex.: 128 GB"
                          maxLength={80}
                        />
                      </Field>
                    </div>
                    <p className="form-hint">
                      Cada combinação de modelo, cor e capacidade tem seu
                      próprio SKU e saldo. Crie marcas, modelos e categorias em
                      Cadastros auxiliares.
                    </p>
                    <label className="check-box">
                      <input
                        type="checkbox"
                        name="serialized"
                        defaultChecked={selected?.serialized}
                      />
                      <span>
                        <strong>Controlar cada aparelho individualmente</strong>
                        <small>
                          Exige IMEI ou série e procedência em cada entrada.
                        </small>
                      </span>
                    </label>
                    <div className="form-section">PREÇOS E GARANTIA</div>
                    <div className="form-grid">
                      <Field label="Preço de custo (R$)">
                        <input
                          type="number"
                          name="cost"
                          min="0"
                          max="999999999"
                          step="0.01"
                          defaultValue={selected?.cost || "0"}
                          required
                        />
                      </Field>
                      <Field label="Preço de venda (R$)">
                        <input
                          type="number"
                          name="price"
                          min="0"
                          max="999999999"
                          step="0.01"
                          defaultValue={selected?.price || "0"}
                          required
                        />
                      </Field>
                      <Field label="Garantia (dias)">
                        <input
                          type="number"
                          name="warranty_days"
                          min="0"
                          max="3650"
                          defaultValue={selected?.warranty_days || 0}
                          required
                        />
                      </Field>
                      <Field label="Condições de garantia">
                        <textarea
                          name="warranty_terms"
                          maxLength={2000}
                          defaultValue={selected?.warranty_terms}
                          rows={2}
                        />
                      </Field>
                    </div>
                  </>
                )}
                {modal === "catalog" && (
                  <>
                    <Field label="Tipo">
                      <select name="kind">
                        {["category", "brand", "model", "supplier"].map((v) => (
                          <option value={v} key={v}>
                            {labels[v]}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Nome">
                      <input name="name" required maxLength={180} autoFocus />
                    </Field>
                    <Field label="Contato ou observação">
                      <input name="contact" maxLength={300} />
                    </Field>
                  </>
                )}
                {modal === "branch" && (
                  <>
                    <p className="form-hint">
                      Cadastro básico de filial para separar saldos.
                      Transferências e gestão comercial serão implementadas em
                      outra etapa.
                    </p>
                    <Field label="Nome da filial">
                      <input name="name" required maxLength={180} autoFocus />
                    </Field>
                  </>
                )}
                {modal === "user" && (
                  <>
                    <Field label="Nome">
                      <input name="name" required maxLength={180} autoFocus />
                    </Field>
                    <Field label="E-mail">
                      <input name="email" type="email" required />
                    </Field>
                    <Field
                      label="Senha inicial"
                      hint="Pelo menos 12 caracteres. Compartilhe por um canal seguro."
                    >
                      <input
                        name="password"
                        type="password"
                        minLength={12}
                        maxLength={128}
                        required
                        autoComplete="new-password"
                      />
                    </Field>
                    <Field label="Perfil">
                      <select name="role">
                        <option value="viewer">
                          Consulta · leitura, sem custos
                        </option>
                        <option value="stock">
                          Estoquista · leitura e movimentações, sem custos
                        </option>
                        <option value="cashier">
                          Operador de caixa · vendas e caixa, sem descontos
                        </option>
                        <option value="technician">
                          Técnico · ordens atribuídas e peças, sem aprovação
                          comercial
                        </option>
                        <option value="manager">
                          Gerente · catálogo, custos, inventário e auditoria
                        </option>
                      </select>
                    </Field>
                    <fieldset className="branch-checks">
                      <legend>Filiais autorizadas</legend>
                      {me.branches.map((b) => (
                        <label key={b.id} className="check-label">
                          <input
                            name="branch_ids"
                            value={b.id}
                            type="checkbox"
                            defaultChecked={b.id === branch}
                          />
                          {b.name}
                        </label>
                      ))}
                    </fieldset>
                  </>
                )}
                {modal === "minimum" && (
                  <>
                    <div className="selected-product">
                      <Package size={22} />
                      <strong>{selected?.name}</strong>
                    </div>
                    <Field
                      label="Quantidade mínima"
                      hint="O alerta aparece quando o saldo for igual ou inferior ao mínimo. Zero desativa o alerta."
                    >
                      <input
                        name="minimum"
                        type="number"
                        min="0"
                        max="1000000"
                        defaultValue={selected?.minimum}
                        required
                        autoFocus
                      />
                    </Field>
                  </>
                )}
                {modal === "count" && (
                  <>
                    <div className="selected-product">
                      <Package size={22} />
                      <strong>{selected?.name}</strong>
                      <Badge>{selected?.quantity} un. no sistema</Badge>
                    </div>
                    <Field label="Quantidade contada">
                      <input
                        name="counted"
                        type="number"
                        min="0"
                        max="1000000"
                        defaultValue={selected?.quantity}
                        required
                        autoFocus
                      />
                    </Field>
                    <Field label="Justificativa da contagem">
                      <textarea
                        name="reason"
                        required
                        maxLength={2000}
                        rows={3}
                      />
                    </Field>
                    <p className="form-hint">
                      A diferença será registrada como ajuste auditado.{" "}
                      {selected?.serialized
                        ? "Aparelhos divergentes devem ser reconciliados por entradas ou saídas individuais antes da contagem."
                        : "O histórico anterior será preservado."}
                    </p>
                  </>
                )}
                {modal === "reverse" && (
                  <>
                    <div className="selected-product">
                      <RotateCcw size={22} />
                      <strong>{selected?.product_name}</strong>
                      <Badge>
                        {labels[selected?.type]} · {selected?.quantity} un.
                      </Badge>
                    </div>
                    <p className="form-hint">
                      Será criada uma movimentação compensatória. O registro
                      original será preservado.
                    </p>
                    <Field label="Motivo do estorno">
                      <textarea
                        name="reason"
                        required
                        maxLength={2000}
                        rows={3}
                        autoFocus
                      />
                    </Field>
                  </>
                )}
                {modal === "move" && (
                  <>
                    <Field label="Produto">
                      {selected ? (
                        <input
                          value={`${selected.name} · ${selected.sku}`}
                          readOnly
                        />
                      ) : (
                        <select
                          value={moveProduct}
                          required
                          onChange={(e) => {
                            setMoveProduct(e.target.value);
                            setDeviceExisting(false);
                          }}
                        >
                          <option value="">Selecione um produto</option>
                          {products
                            .filter((p) => p.active)
                            .map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name} · {p.sku}
                              </option>
                            ))}
                        </select>
                      )}
                    </Field>
                    {!selected && products.length >= 30 && (
                      <p className="form-hint">
                        Exibindo os primeiros 30 produtos. Para outros itens,
                        use a busca em Produtos e movimente pela linha
                        correspondente.
                      </p>
                    )}
                    <div className="segmented">
                      <button
                        type="button"
                        className={moveType === "entry" ? "selected" : ""}
                        onClick={() => setMoveType("entry")}
                      >
                        <ArrowDownLeft size={16} />
                        Entrada
                      </button>
                      <button
                        type="button"
                        className={moveType === "exit" ? "selected" : ""}
                        onClick={() => setMoveType("exit")}
                      >
                        <ArrowUpRight size={16} />
                        Saída
                      </button>
                    </div>
                    {!p?.serialized && (
                      <Field label="Quantidade">
                        <input
                          name="quantity"
                          type="number"
                          min="1"
                          max="1000000"
                          defaultValue="1"
                          required
                        />
                      </Field>
                    )}
                    {p?.serialized && (
                      <>
                        <p className="form-hint">
                          Este produto é movimentado uma unidade por vez.
                        </p>
                        {moveType === "entry" && (
                          <label className="check-label">
                            <input
                              type="checkbox"
                              checked={deviceExisting}
                              onChange={(e) =>
                                setDeviceExisting(e.target.checked)
                              }
                            />
                            Reentrada de aparelho já cadastrado
                          </label>
                        )}
                        {moveType === "exit" || deviceExisting ? (
                          <Field label="Unidade física">
                            <select name="unit_id" required>
                              <option value="">Selecione o aparelho</option>
                              {units
                                .filter(
                                  (u) =>
                                    u.status ===
                                    (moveType === "exit" ? "in_stock" : "out"),
                                )
                                .map((u) => (
                                  <option key={u.id} value={u.id}>
                                    {u.imeis.join(" / ") || u.serial}
                                  </option>
                                ))}
                            </select>
                          </Field>
                        ) : (
                          <>
                            <Field
                              label="IMEIs"
                              hint="15 dígitos por IMEI. Separe múltiplos identificadores por vírgula."
                            >
                              <input
                                name="imeis"
                                inputMode="numeric"
                                placeholder="IMEI 1, IMEI 2"
                              />
                            </Field>
                            <Field
                              label="Número de série"
                              hint="Informe ao menos um IMEI ou número de série."
                            >
                              <input name="serial" maxLength={100} />
                            </Field>
                            <Field label="Procedência do aparelho">
                              <textarea
                                name="provenance"
                                required
                                rows={2}
                                maxLength={2000}
                                placeholder="Origem e referência da aquisição"
                              />
                            </Field>
                            <Field label="Custo desta unidade (R$)">
                              <input
                                name="acquisition_cost"
                                type="number"
                                min="0"
                                max="999999999"
                                step="0.01"
                                defaultValue={p.cost || 0}
                                required
                              />
                            </Field>
                            <Field label="Fornecedor">
                              {catalogSelect(
                                "supplier",
                                "supplier_id",
                                p.supplier_id,
                              )}
                            </Field>
                          </>
                        )}
                      </>
                    )}
                    <Field label="Motivo da movimentação">
                      <textarea
                        name="reason"
                        rows={2}
                        required
                        maxLength={2000}
                        placeholder={
                          moveType === "entry"
                            ? "Ex.: recebimento de mercadoria"
                            : "Ex.: avaria ou baixa autorizada"
                        }
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
                  onClick={() => setModal(null)}
                >
                  Cancelar
                </button>
                <button className="primary" disabled={busy}>
                  {busy ? "Registrando…" : "Salvar e registrar"}
                  <Check size={17} />
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
      {toast}
    </div>
  );
}

"use client";
import {
  useEffect,
  useState,
  useId,
  cloneElement,
  type ReactElement,
  type ReactNode,
  type FormEvent,
} from "react";
import {
  Plus,
  ArrowLeft,
  RefreshCw,
  Printer,
  X,
  Trash2,
  ArrowRightLeft,
  Download,
} from "lucide-react";
import { createPortal } from "react-dom";
import ReportsPanel from "./reports-panel";
import "./employees.css";
import "./credit.css";
import "./branches.css";
type Row = Record<string, any>;
type Props = {
  branch: string;
  branches: Row[];
  permissions: string[];
  companyName: string;
  mutate: (path: string, body: unknown, method?: string) => Promise<any>;
  onNotice: (text: string, error?: boolean) => void;
  onRefresh: () => Promise<void>;
  onOpen: (branch: string, view: string) => void;
};
function useQuery(path: string | null, reload = 0) {
  const key = JSON.stringify([path, reload]),
    [response, setResponse] = useState<{
      key: string;
      data?: any;
      error?: string;
    } | null>(null);
  useEffect(() => {
    let alive = true;
    if (path)
      fetch("/api" + path, { cache: "no-store" })
        .then(async (r) => {
          const b = await r.json();
          if (!r.ok) throw Error(b.error || "Não foi possível consultar.");
          if (alive) setResponse({ key, data: b });
        })
        .catch((e) => {
          if (alive) setResponse({ key, error: e.message });
        });
    return () => {
      alive = false;
    };
  }, [key]);
  return {
    data: response?.key === key ? response.data : null,
    error: response?.key === key ? response.error : null,
    loading: !!path && response?.key !== key,
  };
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
function Load({
  query,
  retry,
}: {
  query: { loading: boolean; error?: string | null };
  retry: () => void;
}) {
  return query.loading ? (
    <p role="status">Consultando…</p>
  ) : query.error ? (
    <div role="alert">
      <p>{query.error}</p>
      <button className="secondary" type="button" onClick={retry}>
        Tentar novamente
      </button>
    </div>
  ) : null;
}
function Pager({
  page,
  total,
  onPage,
}: {
  page: number;
  total: number;
  onPage: (n: number) => void;
}) {
  return (
    <div className="employee-pagination">
      <span>
        {total} registros · página {page}
      </span>
      <button
        className="secondary"
        type="button"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
      >
        Anterior
      </button>
      <button
        className="secondary"
        type="button"
        disabled={page * 30 >= total}
        onClick={() => onPage(page + 1)}
      >
        Próxima
      </button>
    </div>
  );
}
const at = (s: string) =>
  new Date(s).toLocaleString("pt-BR", { timeZone: "America/Fortaleza" });
export default function BranchesPanel(props: Props) {
  const [tab, setTab] = useState("branches"),
    [selected, setSelected] = useState<string | null>(null),
    [reload, setReload] = useState(0),
    [page, setPage] = useState(1),
    [search, setSearch] = useState(""),
    [status, setStatus] = useState("all"),
    [filters, setFilters] = useState({ q: "", status: "all" });
  const list = useQuery(
      !selected
        ? tab === "branches"
          ? "/branches?" +
            new URLSearchParams({ ...filters, page: String(page) })
          : "/branch-transfers?" +
            new URLSearchParams({ q: filters.q, page: String(page) })
        : null,
      reload,
    ),
    can = (r: string) => props.permissions.includes(r);
  const refresh = () => setReload((v) => v + 1);
  const changed = async () => {
    await props.onRefresh();
    refresh();
  };
  if (selected)
    return (
      <div className="employees-panel branches-panel">
        <div className="employee-heading">
          <button className="secondary" onClick={() => setSelected(null)}>
            <ArrowLeft size={16} />
            Voltar às filiais
          </button>
          <button className="secondary" onClick={refresh}>
            <RefreshCw size={16} />
            Atualizar consulta
          </button>
        </div>
        {tab === "branches" ? (
          <BranchDetail
            {...props}
            id={selected}
            reload={reload}
            onChanged={changed}
            onSelect={setSelected}
          />
        ) : selected === "new" ? (
          <TransferEditor
            {...props}
            onSaved={(id) => {
              setSelected(id);
              refresh();
            }}
          />
        ) : (
          <TransferDetail
            {...props}
            id={selected}
            reload={reload}
            onChanged={refresh}
          />
        )}
      </div>
    );
  return (
    <div className="employees-panel branches-panel">
      <div className="employee-heading">
        <div
          className="employee-tabs"
          role="tablist"
          aria-label="Gestão de filiais"
        >
          <button
            role="tab"
            aria-selected={tab === "branches"}
            onClick={() => {
              setTab("branches");
              setPage(1);
            }}
          >
            Filiais
          </button>
          <button
            role="tab"
            aria-selected={tab === "transfers"}
            onClick={() => {
              setTab("transfers");
              setPage(1);
            }}
          >
            Transferências
          </button>
        </div>
        <div className="employee-actions">
          <button className="secondary" onClick={refresh}>
            <RefreshCw size={16} />
            Atualizar
          </button>
          {tab === "branches" && can("branches") && (
            <button className="primary" onClick={() => setSelected("new")}>
              <Plus size={16} />
              Nova filial
            </button>
          )}
          {tab === "transfers" && can("branch_transfer") && (
            <button
              className="primary"
              disabled={props.branches.length < 2}
              onClick={() => setSelected("new")}
            >
              <ArrowRightLeft size={16} />
              Nova transferência
            </button>
          )}
        </div>
      </div>
      <form
        className="employee-filters"
        onSubmit={(e) => {
          e.preventDefault();
          setFilters({ q: search, status });
          setPage(1);
          refresh();
        }}
      >
        <Field
          label={tab === "branches" ? "Buscar filial" : "Buscar transferência"}
        >
          <input
            value={search}
            maxLength={100}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={
              tab === "branches"
                ? "Nome, código ou cidade"
                : "Código, origem ou destino"
            }
          />
        </Field>
        {tab === "branches" && (
          <Field label="Situação da filial">
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="all">Todas</option>
              <option value="active">Ativas</option>
              <option value="inactive">Inativas</option>
            </select>
          </Field>
        )}
        <button className="primary" type="submit">
          Aplicar filtros
        </button>
      </form>
      <p className="employee-note">
        {tab === "branches"
          ? "Cada unidade mantém seu estoque, seus caixas e seus resultados. Filiais inativas preservam o histórico."
          : "A transferência é concluída somente após conferir a saída e o recebimento. O histórico exibe operações entre duas filiais do seu acesso."}
      </p>
      <Load query={list} retry={refresh} />
      {list.data && (
        <>
          <div className="employee-table">
            <table>
              <thead>
                <tr>
                  {(tab === "branches"
                    ? ["Filial", "Código", "Localidade", "Situação", ""]
                    : [
                        "Código",
                        "Origem",
                        "Destino",
                        "Quantidade",
                        "Data",
                        "Situação",
                        "",
                      ]
                  ).map((s, n) => (
                    <th key={n}>{s}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((e: Row) => (
                  <tr key={e.id}>
                    {tab === "branches" ? (
                      <>
                        <td>
                          <strong>{e.name}</strong>
                        </td>
                        <td>{e.code || "—"}</td>
                        <td>
                          {[e.city, e.state].filter(Boolean).join(" / ") || "—"}
                        </td>
                        <td>
                          <span
                            className={
                              e.active ? "employee-active" : "employee-inactive"
                            }
                          >
                            {e.active ? "Ativa" : "Inativa"}
                          </span>
                        </td>
                      </>
                    ) : (
                      <>
                        <td>{e.code}</td>
                        <td>{e.source_name}</td>
                        <td>{e.destination_name}</td>
                        <td>{e.quantity}</td>
                        <td>{at(e.created_at)}</td>
                        <td>{e.reversed ? "Corrigida" : "Concluída"}</td>
                      </>
                    )}
                    <td>
                      <button
                        className="secondary small"
                        onClick={() => setSelected(e.id)}
                      >
                        {tab === "branches"
                          ? "Abrir filial"
                          : "Abrir transferência"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!list.data.items.length && (
              <p className="employee-empty">Nenhum registro encontrado.</p>
            )}
          </div>
          <Pager page={page} total={list.data.total} onPage={setPage} />
        </>
      )}
    </div>
  );
}
function BranchDetail(
  props: Props & {
    id: string;
    reload: number;
    onChanged: () => Promise<void>;
    onSelect: (id: string) => void;
  },
) {
  const query = useQuery(
      props.id === "new" ? null : "/branches/" + props.id,
      props.reload,
    ),
    [tab, setTab] = useState("overview");
  const can = (r: string) => props.permissions.includes(r),
    b = query.data?.branch;
  if (props.id === "new")
    return (
      <BranchEditor
        {...props}
        record={null}
        onSaved={async (id) => {
          await props.onChanged();
          props.onSelect(id);
        }}
      />
    );
  return (
    <>
      <Load query={query} retry={() => props.onChanged()} />
      {b && (
        <>
          <div>
            <h2>{b.name}</h2>
            <p className="employee-note">
              {b.code || "Sem código"} ·{" "}
              {b.active ? "Ativa" : "Inativa — consultas preservadas"}
            </p>
          </div>
          <div
            className="employee-tabs"
            role="tablist"
            aria-label="Detalhes da filial"
          >
            {[
              ["overview", "Visão da unidade"],
              ["stock", "Estoque da unidade"],
              ["profile", "Cadastro da filial"],
              ...(can("reports_read")
                ? [["reports", "Resultados e comparativos"]]
                : []),
            ].map(([id, label]) => (
              <button
                key={id}
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </div>
          {tab === "overview" && (
            <>
              <div className="branch-metrics">
                {[
                  ["Quantidade em estoque", query.data.summary.stock_units],
                  [
                    "Unidades identificadas em estoque",
                    query.data.summary.identified_units,
                  ],
                  ["Caixas cadastrados", query.data.summary.registers],
                  ["Caixas abertos", query.data.summary.open_sessions],
                  [
                    "Funcionários ativos com acesso",
                    query.data.summary.assigned_staff,
                  ],
                ].map(([label, value]) => (
                  <article key={label}>
                    <span>{label}</span>
                    <strong>{value}</strong>
                  </article>
                ))}
              </div>
              <p className="employee-note">
                Unidades identificadas fazem parte do estoque total. A equipe
                indica acesso à filial; não indica presença ou jornada.
              </p>
              <div className="employee-actions">
                <button
                  className="secondary"
                  disabled={!b.active}
                  onClick={() => props.onOpen(b.id, "inventory")}
                >
                  Abrir inventário
                </button>
                {can("pos_read") && (
                  <button
                    className="secondary"
                    disabled={!b.active}
                    onClick={() => props.onOpen(b.id, "pos")}
                  >
                    Abrir caixas e vendas
                  </button>
                )}
                {can("users") && (
                  <button
                    className="secondary"
                    onClick={() =>
                      props.onOpen(b.active ? b.id : props.branch, "employees")
                    }
                  >
                    Gerir equipe
                  </button>
                )}
              </div>
            </>
          )}
          {tab === "stock" && <BranchStock id={b.id} reload={props.reload} />}
          {tab === "profile" && (
            <BranchEditor
              key={b.id + ":" + b.version}
              {...props}
              record={b}
              onSaved={async () => props.onChanged()}
            />
          )}
          {tab === "reports" && (
            <ReportsPanel
              key={b.id}
              branch={b.id}
              branches={
                props.branches.some((x) => x.id === b.id)
                  ? props.branches
                  : [...props.branches, b]
              }
              companyName={props.companyName}
            />
          )}
        </>
      )}
    </>
  );
}
function BranchStock({ id, reload }: { id: string; reload: number }) {
  const [q, setQ] = useState(""),
    [applied, setApplied] = useState(""),
    [page, setPage] = useState(1),
    [retry, setRetry] = useState(0);
  const r = useQuery(
    `/branches/${id}/stock?` +
      new URLSearchParams({ q: applied, page: String(page) }),
    reload + retry,
  );
  return (
    <>
      <form
        className="employee-filters"
        onSubmit={(e) => {
          e.preventDefault();
          setApplied(q);
          setPage(1);
          setRetry((n) => n + 1);
        }}
      >
        <Field label="Buscar no estoque da filial">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            maxLength={100}
          />
        </Field>
        <button className="primary">Buscar estoque</button>
      </form>
      <Load query={r} retry={() => setRetry((n) => n + 1)} />
      {r.data && (
        <>
          <div className="employee-table">
            <table>
              <thead>
                <tr>
                  <th>Produto</th>
                  <th>SKU</th>
                  <th>Controle</th>
                  <th>Quantidade</th>
                  <th>Mínimo</th>
                </tr>
              </thead>
              <tbody>
                {r.data.items.map((x: Row) => (
                  <tr key={x.id}>
                    <td>{x.name}</td>
                    <td>{x.sku}</td>
                    <td>{x.serialized ? "Individual" : "Quantidade"}</td>
                    <td>{x.quantity}</td>
                    <td>{x.minimum}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!r.data.items.length && (
              <p className="employee-empty">
                Nenhum produto com saldo disponível.
              </p>
            )}
          </div>
          <Pager page={page} total={r.data.total} onPage={setPage} />
        </>
      )}
    </>
  );
}
function BranchEditor(
  props: Props & { record: Row | null; onSaved: (id: string) => Promise<void> },
) {
  const [d, setD] = useState<Row>(
      props.record || {
        name: "",
        code: "",
        phone: "",
        email: "",
        address: "",
        city: "",
        state: "",
        notes: "",
      },
    ),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false);
  const can = props.permissions.includes("branches"),
    set = (key: string, v: string) => setD((old) => ({ ...old, [key]: v }));
  async function save(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const body: Row = {};
      for (const field of [
        "name",
        "code",
        "phone",
        "email",
        "address",
        "city",
        "state",
        "notes",
      ])
        body[field] = d[field];
      if (props.record) {
        body.version = props.record.version;
        body.reason = reason;
      }
      const r = await props.mutate(
        props.record ? "/branches/" + d.id : "/branches",
        body,
        props.record ? "PUT" : "POST",
      );
      props.onNotice("Cadastro da filial salvo.");
      await props.onSaved(r.id);
    } catch (e: any) {
      props.onNotice(e.message, true);
    } finally {
      setBusy(false);
    }
  }
  async function state() {
    if (busy) return;
    if (reason.trim().length < 5) {
      props.onNotice("Informe o motivo da mudança de situação.", true);
      return;
    }
    setBusy(true);
    try {
      await props.mutate(`/branches/${d.id}/state`, {
        version: props.record!.version,
        active: !props.record!.active,
        reason,
      });
      props.onNotice(
        props.record!.active
          ? "Filial inativada. Histórico preservado."
          : "Filial reativada.",
      );
      await props.onSaved(d.id);
    } catch (e: any) {
      props.onNotice(e.message, true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="employee-editor" onSubmit={save}>
      <fieldset disabled={busy || !can}>
        <legend>{props.record ? "Dados da unidade" : "Nova filial"}</legend>
        <div className="employee-grid">
          {[
            ["name", "Nome da filial", 180],
            ["code", "Código da filial", 40],
            ["phone", "Telefone da filial", 40],
            ["email", "E-mail da filial", 254],
            ["address", "Endereço", 300],
            ["city", "Cidade", 120],
            ["state", "UF", 2],
          ].map(([key, label, max]) => (
            <Field key={key} label={String(label)}>
              <input
                required={key === "name"}
                type={key === "email" ? "email" : "text"}
                maxLength={Number(max)}
                value={d[key]}
                onChange={(e) =>
                  set(
                    String(key),
                    key === "state"
                      ? e.target.value.toUpperCase()
                      : e.target.value,
                  )
                }
              />
            </Field>
          ))}
          <Field label="Observações da filial">
            <textarea
              value={d.notes}
              maxLength={1000}
              onChange={(e) => set("notes", e.target.value)}
            />
          </Field>
        </div>
      </fieldset>
      {can && (
        <>
          {props.record && (
            <>
              <Field label="Motivo da alteração da filial">
                <textarea
                  value={reason}
                  required
                  minLength={5}
                  maxLength={500}
                  onChange={(e) => setReason(e.target.value)}
                  disabled={busy}
                />
              </Field>
              <p className="employee-note">
                Antes de inativar, esvazie o estoque, feche caixas e resolva
                ordens, compras, CRM, títulos, contas e vínculos da equipe. Os
                dados anteriores continuam consultáveis. Não é possível inativar
                a última filial ativa.
              </p>
            </>
          )}
          <div className="employee-actions">
            <button className="primary" disabled={busy}>
              Salvar filial
            </button>
            {props.record && (
              <button
                className="secondary"
                disabled={busy}
                type="button"
                onClick={state}
              >
                {props.record.active ? "Inativar filial" : "Reativar filial"}
              </button>
            )}
          </div>
        </>
      )}
    </form>
  );
}
function UnitPicker({
  branch,
  line,
  onChange,
}: {
  branch: string;
  line: Row;
  onChange: (ids: string[]) => void;
}) {
  const [q, setQ] = useState(""),
    [page, setPage] = useState(1),
    [retry, setRetry] = useState(0);
  const r = useQuery(
    "/branch-transfers/units?" +
      new URLSearchParams({
        branch_id: branch,
        product_id: line.product_id,
        q,
        page: String(page),
      }),
    retry,
  );
  return (
    <>
      <Field label={"Buscar IMEI ou série de " + line.name}>
        <input
          onKeyDown={(e) => {
            if (e.key === "Enter") e.preventDefault();
          }}
          value={q}
          maxLength={100}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
      </Field>
      <Load query={r} retry={() => setRetry((n) => n + 1)} />
      {r.data && (
        <>
          <div className="branch-units">
            {r.data.items.map((u: Row) => (
              <label key={u.id}>
                <input
                  type="checkbox"
                  aria-label={"Selecionar " + (u.serial || u.imeis)}
                  checked={line.unit_ids.includes(u.id)}
                  onChange={(e) =>
                    onChange(
                      e.target.checked
                        ? [...line.unit_ids, u.id]
                        : line.unit_ids.filter((id: string) => id !== u.id),
                    )
                  }
                />
                <span>
                  {u.serial || "Sem série"}
                  <small>{u.imeis}</small>
                </span>
              </label>
            ))}
            {!r.data.items.length && <p>Nenhuma unidade disponível.</p>}
          </div>
          <Pager page={page} total={r.data.total} onPage={setPage} />
        </>
      )}
      <p className="employee-note">
        {line.unit_ids.length} unidades selecionadas; até 200 por transferência.
      </p>
    </>
  );
}
function TransferEditor(props: Props & { onSaved: (id: string) => void }) {
  const [src, setSrc] = useState(props.branch),
    [dst, setDst] = useState(
      props.branches.find((b) => b.id !== props.branch)?.id || "",
    ),
    [q, setQ] = useState(""),
    [pick, setPick] = useState(""),
    [items, setItems] = useState<Row[]>([]),
    [reason, setReason] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [retry, setRetry] = useState(0);
  const products = useQuery(
    src ? "/products?" + new URLSearchParams({ branch_id: src, q }) : null,
    retry,
  );
  const change = (id: string, values: Row) =>
    setItems((old) =>
      old.map((x) => (x.product_id === id ? { ...x, ...values } : x)),
    );
  function add() {
    const p = products.data?.items.find((x: Row) => x.id === pick);
    if (p && !items.some((x) => x.product_id === p.id)) {
      setItems((old) => [
        ...old,
        {
          product_id: p.id,
          name: p.name,
          sku: p.sku,
          serialized: p.serialized,
          quantity: p.serialized ? 0 : 1,
          unit_ids: [],
        },
      ]);
      setPick("");
    }
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const r = await props.mutate("/branch-transfers", {
        source_branch_id: src,
        destination_branch_id: dst,
        reason,
        confirmed,
        items: items.map((x) => ({
          product_id: x.product_id,
          quantity: Number(x.quantity),
          unit_ids: x.unit_ids,
        })),
      });
      props.onNotice("Transferência concluída nas duas filiais.");
      props.onSaved(r.id);
    } catch (e: any) {
      props.onNotice(e.message, true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="employee-editor" onSubmit={submit}>
      <fieldset disabled={busy}>
        <legend>Nova transferência</legend>
        <p className="employee-note">
          Registre após conferir a saída e o recebimento. A operação atualiza as
          duas filiais juntas; não representa mercadoria em trânsito nem gera
          faturamento. Trocar a origem limpa os produtos selecionados.
        </p>
        <div className="employee-grid">
          <Field label="Filial de origem">
            <select
              value={src}
              onChange={(e) => {
                setSrc(e.target.value);
                setItems([]);
                setPick("");
                setQ("");
                if (dst === e.target.value)
                  setDst(
                    props.branches.find((b) => b.id !== e.target.value)?.id ||
                      "",
                  );
              }}
            >
              {props.branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Filial de destino">
            <select
              value={dst}
              required
              onChange={(e) => setDst(e.target.value)}
            >
              <option value="">Selecione</option>
              {props.branches
                .filter((b) => b.id !== src)
                .map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Buscar produto para transferência">
            <input
              onKeyDown={(e) => {
                if (e.key === "Enter") e.preventDefault();
              }}
              maxLength={100}
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPick("");
              }}
            />
          </Field>
          <Field label="Produto para adicionar">
            <select value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">Selecione um produto</option>
              {products.data?.items
                .filter(
                  (p: Row) =>
                    Number(p.quantity) > 0 &&
                    !items.some((x) => x.product_id === p.id),
                )
                .map((p: Row) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {p.sku} · saldo {p.quantity}
                  </option>
                ))}
            </select>
          </Field>
        </div>
        <Load query={products} retry={() => setRetry((n) => n + 1)} />
        <button
          className="secondary"
          type="button"
          disabled={!pick || items.length >= 30}
          onClick={add}
        >
          <Plus size={16} />
          Adicionar produto
        </button>
      </fieldset>
      {items.map((line) => (
        <fieldset key={line.product_id} disabled={busy}>
          <legend>
            {line.name} · {line.sku}
          </legend>
          <button
            className="secondary small"
            type="button"
            onClick={() =>
              setItems((old) =>
                old.filter((x) => x.product_id !== line.product_id),
              )
            }
          >
            <Trash2 size={15} />
            Remover produto
          </button>
          {line.serialized ? (
            <UnitPicker
              key={src + line.product_id}
              branch={src}
              line={line}
              onChange={(ids) =>
                change(line.product_id, { unit_ids: ids, quantity: ids.length })
              }
            />
          ) : (
            <Field label={"Quantidade de " + line.name}>
              <input
                type="number"
                min="1"
                max="1000000"
                required
                value={line.quantity}
                onChange={(e) =>
                  change(line.product_id, { quantity: e.target.value })
                }
              />
            </Field>
          )}
        </fieldset>
      ))}
      <fieldset disabled={busy}>
        <legend>Conferência</legend>
        <Field label="Motivo da transferência">
          <textarea
            required
            minLength={5}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        <label className="branch-confirm">
          <input
            type="checkbox"
            required
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          Conferi a saída na origem e o recebimento no destino.
        </label>
      </fieldset>
      <button
        className="primary"
        disabled={
          busy ||
          !confirmed ||
          !items.length ||
          items.some((x) => Number(x.quantity) < 1) ||
          items.reduce((n, x) => n + x.unit_ids.length, 0) > 200
        }
      >
        {busy ? "Concluindo…" : "Concluir transferência"}
      </button>
    </form>
  );
}
function TransferDetail(
  props: Props & { id: string; reload: number; onChanged: () => void },
) {
  const query = useQuery("/branch-transfers/" + props.id, props.reload),
    [print, setPrint] = useState(false),
    [reason, setReason] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false);
  const data = query.data;
  async function reverse(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await props.mutate(`/branch-transfers/${props.id}/reverse`, {
        reason,
        confirmed,
      });
      props.onNotice("Correção integral registrada nas duas filiais.");
      props.onChanged();
    } catch (e: any) {
      props.onNotice(e.message, true);
    } finally {
      setBusy(false);
    }
  }
  const document = data && (
    <>
      <h2>
        {data.transfer.code} · {data.reversal ? "Corrigida" : "Concluída"}
      </h2>
      <p>
        Origem: {data.transfer.source_name} → Destino:{" "}
        {data.transfer.destination_name}
      </p>
      <p>
        {at(data.transfer.created_at)} · {data.transfer.actor_name}
      </p>
      <p>{data.transfer.reason}</p>
      <div className="employee-table">
        <table>
          <thead>
            <tr>
              <th>Produto</th>
              <th>SKU</th>
              <th>Quantidade</th>
              <th>Série / IMEI</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((x: Row) => (
              <tr key={x.id}>
                <td>{x.product_name}</td>
                <td>{x.sku}</td>
                <td>{x.quantity}</td>
                <td>
                  {[x.serial, x.imeis].filter(Boolean).join(" / ") ||
                    "Por quantidade"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.reversal && (
        <p>
          Correção: {at(data.reversal.created_at)} · {data.reversal.actor_name}{" "}
          · {data.reversal.reason}
        </p>
      )}
      <p className="employee-note">
        Documento interno de conferência, não fiscal. Confirmação manual de
        saída e recebimento. Não registra venda, receita ou pagamento.
      </p>
    </>
  );
  return (
    <>
      <Load query={query} retry={props.onChanged} />
      {data && (
        <>
          <div className="employee-actions">
            <button className="secondary" onClick={() => setPrint(true)}>
              <Printer size={16} />
              Imprimir transferência
            </button>
          </div>
          {document}
          {!data.reversal && props.permissions.includes("branch_transfer") && (
            <form className="employee-editor" onSubmit={reverse}>
              <fieldset disabled={busy}>
                <legend>Corrigir transferência inteira</legend>
                <p className="employee-note">
                  Reverte os dois estoques com registros compensatórios. Exige
                  saldo no destino e nenhuma movimentação posterior das unidades
                  identificadas. Para devolução comercial ou movimentação
                  posterior, use nova transferência de retorno.
                </p>
                <Field label="Motivo da correção">
                  <textarea
                    required
                    minLength={5}
                    maxLength={500}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </Field>
                <label className="branch-confirm">
                  <input
                    type="checkbox"
                    required
                    checked={confirmed}
                    onChange={(e) => setConfirmed(e.target.checked)}
                  />
                  Conferi o retorno de toda a mercadoria para a origem.
                </label>
                <button className="secondary" disabled={busy || !confirmed}>
                  Corrigir transferência
                </button>
              </fieldset>
            </form>
          )}
        </>
      )}
      {print &&
        data &&
        createPortal(
          <div
            className="modal-backdrop branch-print"
            role="dialog"
            aria-modal="true"
            aria-label="Documento de transferência"
          >
            <div className="modal credit-document-modal">
              <header className="modal-header no-print">
                <button className="primary" onClick={() => window.print()}>
                  Imprimir documento
                </button>
                <button
                  className="secondary"
                  autoFocus
                  onClick={() => setPrint(false)}
                >
                  <X size={16} />
                  Fechar documento
                </button>
              </header>
              <article className="credit-document">
                <h1>{props.companyName}</h1>
                {document}
              </article>
            </div>
          </div>,
          window.document.body,
        )}
    </>
  );
}

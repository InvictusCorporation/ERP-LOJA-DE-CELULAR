"use client";
import {
  useEffect,
  useId,
  useState,
  cloneElement,
  type ReactElement,
  type ReactNode,
  type FormEvent,
} from "react";
import { ArrowLeft, Download, RefreshCw, ShieldCheck } from "lucide-react";
import {
  fiscalModels,
  fiscalRegimes,
  fiscalSizes,
  fiscalStates,
} from "../shared/fiscal";
import "./employees.css";
import "./fiscal.css";
type Row = Record<string, any>;
type Props = {
  branch: string;
  permissions: string[];
  mutate: (path: string, body: unknown, method?: string) => Promise<any>;
  onNotice: (text: string, error?: boolean) => void;
};
async function get(path: string) {
  const r = await fetch("/api" + path, { cache: "no-store" }),
    b = await r.json();
  if (!r.ok) throw Error(b.error || "Falha na consulta.");
  return b;
}
function useQuery(path: string, revision: number) {
  const key = path + ":" + revision,
    [result, setResult] = useState<{
      key: string;
      data?: any;
      error?: string;
    }>();
  useEffect(() => {
    let alive = true;
    get(path)
      .then((data) => {
        if (alive) setResult({ key, data });
      })
      .catch((e) => {
        if (alive) setResult({ key, error: e.message });
      });
    return () => {
      alive = false;
    };
  }, [key]);
  return {
    data: result?.key === key ? result.data : null,
    error: result?.key === key ? result.error : null,
    loading: result?.key !== key,
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
function download(value: string, name: string, type = "application/json") {
  const url = URL.createObjectURL(new Blob([value], { type })),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const initialIssuer = {
  legal_name: "",
  cnpj: "",
  state_registration: "",
  municipal_registration: "",
  state: "",
  municipality_code: "",
  address: "",
  postal_code: "",
  size: "unknown",
  regime: "unknown",
  provider_name: "",
  accountant_notes: "",
};
export default function FiscalPanel(props: Props) {
  const [tab, setTab] = useState("settings"),
    [reload, setReload] = useState(0),
    [page, setPage] = useState(1),
    [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [selected, setSelected] = useState<string | null>(null),
    [product, setProduct] = useState<Row | null>(null),
    [status, setStatus] = useState("all");
  const refresh = () => setReload((n) => n + 1),
    can = (right: string) => props.permissions.includes(right),
    overview = useQuery("/fiscal/overview?branch_id=" + props.branch, reload);
  const path = selected
    ? "/fiscal/drafts/" + selected
    : tab === "products"
      ? "/fiscal/products"
      : tab === "sources"
        ? "/fiscal/sources"
        : tab === "files"
          ? "/fiscal/files"
          : "/fiscal/drafts";
  const list = useQuery(
    path +
      (selected
        ? ""
        : "?" +
          new URLSearchParams({
            branch_id: props.branch,
            page: String(page),
            q: query,
            status,
          })),
    reload,
  );
  const error = overview.error || list.error;
  const [busy, setBusy] = useState(false);
  async function run(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      refresh();
    } catch (e: any) {
      props.onNotice(e.message, true);
    } finally {
      setBusy(false);
    }
  }
  if (!props.branch) return <p>Selecione uma filial.</p>;
  return (
    <div className="employees-panel fiscal-panel">
      <div className="employee-heading">
        <div>
          <h2>Documentos e configuração</h2>
          <p>Cadastro, preparação de documentos e arquivo por filial.</p>
        </div>
        <button className="secondary" onClick={refresh}>
          <RefreshCw size={16} />
          Atualizar consulta
        </button>
      </div>
      <div className="fiscal-banner">
        <ShieldCheck size={24} />
        <div>
          <strong>Preparação fiscal · emissão ainda não configurada</strong>
          <p>
            As preparações não são notas fiscais. Emitir, consultar autorização
            e cancelar notas depende da integração homologada com o emissor.
          </p>
        </div>
      </div>
      <div
        className="employee-tabs fiscal-tabs"
        role="tablist"
        aria-label="Gestão fiscal"
      >
        {[
          ["settings", "Emitente e certificado"],
          ["products", "Classificação dos produtos"],
          ["sources", "Vendas e serviços"],
          ["drafts", "Documentos preparados"],
          ["files", "Arquivo XML"],
        ].map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => {
              setTab(id);
              setSelected(null);
              setProduct(null);
              setPage(1);
              setSearch("");
              setQuery("");
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert">
          {error}{" "}
          <button className="secondary" onClick={refresh}>
            Tentar novamente
          </button>
        </p>
      )}
      {overview.loading && <p role="status">Consultando cadastro fiscal…</p>}
      {tab === "settings" && overview.data && (
        <>
          <Issuer
            key={"issuer:" + reload}
            {...props}
            info={overview.data}
            editable={can("fiscal_settings")}
            onSaved={refresh}
          />
          <Certificate
            key={"certificate:" + reload}
            {...props}
            info={overview.data}
            editable={can("fiscal_settings")}
            onSaved={refresh}
          />
          <section className="fiscal-card">
            <h3>Antes de ativar a emissão</h3>
            <ul>
              {overview.data.integration.blockers.map((s: string) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </section>
        </>
      )}
      {tab !== "settings" && !selected && !product && (
        <>
          <form
            className="employee-filters"
            onSubmit={(e) => {
              e.preventDefault();
              setQuery(search);
              setPage(1);
            }}
          >
            <Field
              label={
                tab === "products"
                  ? "Buscar nome ou SKU"
                  : tab === "files"
                    ? "Buscar arquivo ou descrição"
                    : "Buscar código da origem"
              }
            >
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                maxLength={100}
              />
            </Field>
            {tab === "drafts" && (
              <Field label="Situação">
                <select
                  value={status}
                  onChange={(e) => {
                    setStatus(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="all">Todas</option>
                  <option value="prepared">Preparados</option>
                  <option value="archived">Arquivados</option>
                </select>
              </Field>
            )}
            <button className="secondary">Buscar</button>
          </form>
          {tab === "sources" && (
            <p>
              Vendas concluídas sem devolução e serviços reparados e entregues.
              A preparação da NFS-e contém somente mão de obra; peças precisam
              de tratamento fiscal próprio.
            </p>
          )}
          {tab === "products" && (
            <p>
              Dados compartilhados entre as filiais. Preencha com orientação
              contábil. O sistema confere o formato; não determina a tributação
              aplicável.
            </p>
          )}
          {tab === "files" && (
            <>
              <p>
                Arquivo de apoio, sem validação de assinatura, autenticidade,
                autorização ou cancelamento. Importar XML não altera a situação
                fiscal.
              </p>
              {can("fiscal_manage") && <Upload {...props} onSaved={refresh} />}
            </>
          )}
          {list.loading ? (
            <p role="status">Consultando registros…</p>
          ) : (
            list.data && (
              <>
                <div className="employee-table">
                  <table>
                    <thead>
                      <tr>
                        {(tab === "products"
                          ? ["Produto", "Classificação", "Ação"]
                          : tab === "sources"
                            ? ["Origem", "Valor", "Preparar"]
                            : tab === "files"
                              ? ["Arquivo", "Integridade", "Ação"]
                              : ["Origem", "Modelo", "Situação", "Ação"]
                        ).map((s) => (
                          <th key={s}>{s}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {list.data.items.map((r: Row) => (
                        <tr key={r.id}>
                          {tab === "products" ? (
                            <>
                              <td>
                                {r.name}
                                <small>
                                  {r.sku}
                                  {!r.active ? " · Inativo" : ""}
                                </small>
                              </td>
                              <td>
                                {r.profile?.ncm || "NCM pendente"}
                                <small>
                                  CFOP: {r.profile?.cfop || "A definir"}
                                </small>
                              </td>
                              <td>
                                <button
                                  className="secondary"
                                  onClick={() => setProduct(r)}
                                >
                                  {can("fiscal_manage")
                                    ? "Classificar"
                                    : "Consultar"}
                                </button>
                              </td>
                            </>
                          ) : tab === "sources" ? (
                            <>
                              <td>
                                {r.code}
                                <small>
                                  {r.kind === "sale"
                                    ? "Venda"
                                    : "Serviço · mão de obra"}
                                </small>
                              </td>
                              <td>{money(r.total_cents)}</td>
                              <td>
                                {can("fiscal_manage") && (
                                  <Prepare
                                    busy={busy}
                                    kind={r.kind}
                                    onPrepare={(model) =>
                                      run(async () => {
                                        const result = await props.mutate(
                                          "/fiscal/drafts",
                                          {
                                            branch_id: props.branch,
                                            source_id: r.id,
                                            source_kind: r.kind,
                                            model,
                                          },
                                        );
                                        setSelected(result.id);
                                        setTab("drafts");
                                        props.onNotice(
                                          "Preparação salva, sem emissão fiscal.",
                                        );
                                      })
                                    }
                                  />
                                )}
                              </td>
                            </>
                          ) : tab === "files" ? (
                            <>
                              <td>
                                {r.filename}
                                <small>{r.description}</small>
                                <small>
                                  {new Date(r.created_at).toLocaleString(
                                    "pt-BR",
                                  )}
                                </small>
                              </td>
                              <td>
                                Não verificado
                                <small>
                                  {r.byte_length} bytes · SHA-256{" "}
                                  {r.sha256.slice(0, 12)}…
                                </small>
                              </td>
                              <td>
                                <button
                                  className="secondary"
                                  disabled={busy}
                                  onClick={() =>
                                    run(async () => {
                                      const f = await get(
                                        "/fiscal/files/" + r.id,
                                      );
                                      download(
                                        f.content,
                                        f.filename,
                                        "application/octet-stream",
                                      );
                                    })
                                  }
                                >
                                  <Download size={16} />
                                  Baixar XML
                                </button>
                              </td>
                            </>
                          ) : (
                            <>
                              <td>
                                {r.code}
                                <small>
                                  {new Date(r.created_at).toLocaleString(
                                    "pt-BR",
                                  )}
                                </small>
                              </td>
                              <td>{fiscalModels[r.model]}</td>
                              <td>
                                {r.status === "archived"
                                  ? "Arquivado"
                                  : "Preparado · não emitido"}
                              </td>
                              <td>
                                <button
                                  className="secondary"
                                  onClick={() => setSelected(r.id)}
                                >
                                  Consultar preparação
                                </button>
                              </td>
                            </>
                          )}
                        </tr>
                      ))}
                      {!list.data.items.length && (
                        <tr>
                          <td colSpan={4}>Nenhum registro encontrado.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="employee-pagination">
                  <span>
                    {list.data.total} registros · página {page}
                  </span>
                  <button
                    className="secondary"
                    disabled={page === 1}
                    onClick={() => setPage((n) => n - 1)}
                  >
                    Anterior
                  </button>
                  <button
                    className="secondary"
                    disabled={page * 20 >= list.data.total}
                    onClick={() => setPage((n) => n + 1)}
                  >
                    Próxima
                  </button>
                </div>
              </>
            )
          )}
        </>
      )}
      {product && (
        <>
          <button className="secondary" onClick={() => setProduct(null)}>
            <ArrowLeft size={16} />
            Voltar aos produtos
          </button>
          <TaxProduct
            {...props}
            product={product}
            editable={can("fiscal_manage")}
            onSaved={() => {
              setProduct(null);
              refresh();
            }}
          />
        </>
      )}
      {selected && (
        <>
          <button className="secondary" onClick={() => setSelected(null)}>
            <ArrowLeft size={16} />
            Voltar aos documentos
          </button>
          {list.loading ? (
            <p>Consultando preparação…</p>
          ) : (
            list.data && (
              <Draft
                {...props}
                data={list.data}
                editable={can("fiscal_manage")}
                onSaved={refresh}
              />
            )
          )}
        </>
      )}
    </div>
  );
}
const money = (c: any) =>
  Number(c || 0) / 100
    ? (Number(c) / 100).toLocaleString("pt-BR", {
        style: "currency",
        currency: "BRL",
      })
    : "R$ 0,00";
function Issuer(
  props: Props & { info: Row; editable: boolean; onSaved: () => void },
) {
  const [form, setForm] = useState({
      ...initialIssuer,
      ...props.info.issuer.profile,
    }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const input = (key: string, max: number) => (
    <input
      value={form[key]}
      maxLength={max}
      onChange={(e) => setForm({ ...form, [key]: e.target.value })}
    />
  );
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await props.mutate("/fiscal/issuers/" + props.branch, {
        ...form,
        version: props.info.issuer.version,
      });
      props.onNotice("Cadastro fiscal salvo.");
      props.onSaved();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="fiscal-card">
      <h3>Dados do emitente · {props.info.branch.name}</h3>
      <p>
        Cadastre o estabelecimento que emitirá as notas. Nenhum dado abaixo
        ativa a emissão automaticamente.
      </p>
      <form onSubmit={save}>
        <fieldset
          disabled={!props.editable || busy || !props.info.branch.active}
        >
          <div className="fiscal-grid">
            <Field label="Razão social">{input("legal_name", 180)}</Field>
            <Field label="CNPJ">{input("cnpj", 24)}</Field>
            <Field label="Estado (UF)">
              <select
                value={form.state}
                onChange={(e) => setForm({ ...form, state: e.target.value })}
              >
                <option value="">Selecione o estado</option>
                {fiscalStates.map(([uf, name]) => (
                  <option key={uf} value={uf}>
                    {name} ({uf})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Código IBGE do município">
              {input("municipality_code", 7)}
            </Field>
            <Field label="Inscrição estadual">
              {input("state_registration", 30)}
            </Field>
            <Field label="Inscrição municipal">
              {input("municipal_registration", 30)}
            </Field>
            <Field label="Porte da empresa">
              <select
                value={form.size}
                onChange={(e) => setForm({ ...form, size: e.target.value })}
              >
                {Object.entries(fiscalSizes).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Regime tributário">
              <select
                value={form.regime}
                onChange={(e) => setForm({ ...form, regime: e.target.value })}
              >
                {Object.entries(fiscalRegimes).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Endereço do estabelecimento">
              {input("address", 300)}
            </Field>
            <Field label="CEP (somente números)">
              {input("postal_code", 8)}
            </Field>
            <Field label="Serviço emissor pretendido">
              {input("provider_name", 100)}
            </Field>
            <Field label="Orientações da contabilidade">
              <textarea
                value={form.accountant_notes}
                maxLength={2000}
                onChange={(e) =>
                  setForm({ ...form, accountant_notes: e.target.value })
                }
              />
            </Field>
          </div>
          {props.editable && (
            <button className="primary" disabled={busy}>
              {busy ? "Salvando…" : "Salvar dados fiscais"}
            </button>
          )}
        </fieldset>
        {error && <p role="alert">{error}</p>}
      </form>
    </section>
  );
}
function Certificate(
  props: Props & { info: Row; editable: boolean; onSaved: () => void },
) {
  const [file, setFile] = useState<File | null>(null),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [reason, setReason] = useState("");
  const cert = props.info.certificate;
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      if (file.size > 262144) throw Error("Certificado limitado a 256 KB.");
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (const n of bytes) binary += String.fromCharCode(n);
      await props.mutate("/fiscal/certificates/" + props.branch, {
        version: cert?.version || 0,
        filename: file.name,
        pfx: btoa(binary),
        password,
      });
      setPassword("");
      setFile(null);
      props.onNotice("Certificado A1 protegido no cofre fiscal.");
      props.onSaved();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setPassword("");
      setBusy(false);
    }
  }
  async function remove(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await props.mutate("/fiscal/certificates/" + props.branch + "/remove", {
        version: cert.version,
        reason,
      });
      props.onNotice("Certificado removido do cofre ativo.");
      props.onSaved();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="fiscal-card">
      <h3>Certificado digital A1</h3>
      <p>
        Importe o arquivo .pfx ou .p12 e a senha. Ambos são guardados
        criptografados no servidor. Certificado A3 em token/cartão requer
        integração própria.
      </p>
      {cert?.active ? (
        <p>
          <strong>Certificado guardado:</strong> {cert.filename} · atualizado em{" "}
          {new Date(cert.updated_at).toLocaleString("pt-BR")}
        </p>
      ) : (
        <p>Nenhum certificado guardado.</p>
      )}
      <p>
        A importação confere se o arquivo abre com a senha. Titular, validade,
        cadeia e habilitação fiscal ainda precisam de conferência antes da
        emissão. A senha não é exibida nem pode ser baixada.
      </p>
      {props.editable && (
        <>
          <form onSubmit={save}>
            <fieldset disabled={busy || !props.info.branch.active}>
              <div className="fiscal-grid">
                <Field label="Arquivo do certificado A1">
                  <input
                    type="file"
                    accept=".pfx,.p12"
                    required
                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                  />
                </Field>
                <Field label="Senha do certificado">
                  <input
                    type="password"
                    value={password}
                    maxLength={256}
                    autoComplete="new-password"
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </Field>
              </div>
              <button className="primary" disabled={!file || busy}>
                {busy
                  ? "Processando…"
                  : cert?.active
                    ? "Substituir certificado"
                    : "Guardar certificado"}
              </button>
            </fieldset>
          </form>
          {cert?.active && (
            <form className="employee-filters" onSubmit={remove}>
              <Field label="Motivo da remoção do certificado">
                <input
                  value={reason}
                  required
                  minLength={5}
                  maxLength={500}
                  onChange={(e) => setReason(e.target.value)}
                />
              </Field>
              <button className="secondary" disabled={busy}>
                Remover certificado
              </button>
            </form>
          )}
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
function TaxProduct(
  props: Props & { product: Row; editable: boolean; onSaved: () => void },
) {
  const [form, setForm] = useState<Row>({
      ncm: "",
      cest: "",
      cfop: "",
      origin: "",
      unit: "",
      icms_code: "",
      notes: "",
      ...props.product.profile,
    }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await props.mutate("/fiscal/products/" + props.product.id, {
        ...form,
        version: props.product.version,
      });
      props.onNotice("Classificação fiscal salva.");
      props.onSaved();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="fiscal-card">
      <h3>
        {props.product.name} · {props.product.sku}
      </h3>
      <p>
        Classificação preliminar. CFOP, CST/CSOSN e tributos dependem da
        operação, do destinatário e do regime. Não são calculados
        automaticamente.
      </p>
      <form onSubmit={save}>
        <fieldset disabled={!props.editable || busy}>
          <div className="fiscal-grid">
            {[
              ["ncm", "NCM", 8],
              ["cest", "CEST (quando aplicável)", 7],
              ["cfop", "CFOP de referência", 4],
              ["unit", "Unidade comercial", 6],
              ["icms_code", "CST ou CSOSN de referência", 3],
            ].map(([key, label, max]) => (
              <Field key={key} label={String(label)}>
                <input
                  value={form[key]}
                  maxLength={Number(max)}
                  onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                />
              </Field>
            ))}
            <Field label="Origem da mercadoria">
              <select
                value={form.origin}
                onChange={(e) => setForm({ ...form, origin: e.target.value })}
              >
                <option value="">A definir</option>
                {[
                  "0 · Nacional",
                  "1 · Estrangeira — importação direta",
                  "2 · Estrangeira — mercado interno",
                  "3 · Nacional — importação superior a 40% até 70%",
                  "4 · Nacional — processo produtivo básico",
                  "5 · Nacional — importação até 40%",
                  "6 · Estrangeira — importação direta sem similar",
                  "7 · Estrangeira — mercado interno sem similar",
                  "8 · Nacional — importação superior a 70%",
                ].map((label, n) => (
                  <option key={n} value={n}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Observações fiscais">
              <textarea
                value={form.notes}
                maxLength={1000}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </Field>
          </div>
          {props.editable && (
            <button className="primary" disabled={busy}>
              Salvar classificação
            </button>
          )}
        </fieldset>
        {error && <p role="alert">{error}</p>}
      </form>
    </section>
  );
}
function Prepare({
  kind,
  busy,
  onPrepare,
}: {
  kind: string;
  busy: boolean;
  onPrepare: (model: string) => void;
}) {
  const [model, setModel] = useState(kind === "repair" ? "nfse" : "nfce");
  return (
    <div className="employee-actions">
      <select
        aria-label="Modelo da preparação"
        value={model}
        onChange={(e) => setModel(e.target.value)}
      >
        {(kind === "repair" ? ["nfse"] : ["nfce", "nfe"]).map((m) => (
          <option key={m} value={m}>
            {fiscalModels[m]}
          </option>
        ))}
      </select>
      <button
        className="secondary"
        disabled={busy}
        onClick={() => onPrepare(model)}
      >
        Preparar
      </button>
    </div>
  );
}
function Draft(
  props: Props & { data: Row; editable: boolean; onSaved: () => void },
) {
  const d = props.data.draft,
    s = d.snapshot,
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function archive(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await props.mutate("/fiscal/drafts/" + d.id + "/archive", { reason });
      props.onNotice(
        "Preparação arquivada. Nenhuma nota fiscal foi cancelada.",
      );
      props.onSaved();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <section className="fiscal-card">
        <h3>
          {fiscalModels[d.model]} · {s.source.receipt_code || s.source.code}
        </h3>
        <p>
          <strong>
            {d.archived_at
              ? "Preparação arquivada"
              : "Preparação salva · não emitida"}
          </strong>
        </p>
        <ul>
          {s.limitations.map((l: string) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
        <p>
          Situação atual da origem:{" "}
          {props.data.source_now?.status || "Indisponível"}. Os dados abaixo
          preservam o momento da preparação.
        </p>
        <p>
          Emitente: {s.issuer?.profile?.legal_name || "Cadastro pendente"} ·
          CNPJ: {s.issuer?.profile?.cnpj || "Pendente"}
        </p>
        <div className="employee-table">
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>Quantidade</th>
                <th>Valor</th>
                <th>NCM</th>
              </tr>
            </thead>
            <tbody>
              {s.items.map((r: Row, n: number) => (
                <tr key={n}>
                  <td>{r.product_name || r.description || "Mão de obra"}</td>
                  <td>{r.quantity}</td>
                  <td>{money(r.net_cents)}</td>
                  <td>{r.tax_profile?.ncm || "A revisar"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button
          className="secondary"
          onClick={() =>
            download(
              JSON.stringify(
                { document_id: d.id, created_at: d.created_at, ...s },
                null,
                2,
              ),
              "preparacao-" + d.id + ".json",
            )
          }
        >
          <Download size={16} />
          Exportar preparação (JSON)
        </button>
        {d.archived_at ? (
          <p>Arquivado: {d.archive_reason}</p>
        ) : (
          props.editable && (
            <form className="employee-filters" onSubmit={archive}>
              <Field label="Motivo do arquivamento">
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  required
                  minLength={5}
                  maxLength={500}
                />
              </Field>
              <button className="secondary" disabled={busy}>
                Arquivar preparação
              </button>
            </form>
          )
        )}
        {error && <p role="alert">{error}</p>}
      </section>
      {props.editable && (
        <Upload {...props} draftId={d.id} onSaved={props.onSaved} />
      )}
      <section className="fiscal-card">
        <h3>Arquivos vinculados · não verificados</h3>
        {!props.data.files.length && <p>Nenhum arquivo vinculado.</p>}
        {props.data.files.map((f: Row) => (
          <FileButton key={f.id} file={f} onNotice={props.onNotice} />
        ))}
      </section>
    </>
  );
}
function FileButton({
  file,
  onNotice,
}: {
  file: Row;
  onNotice: Props["onNotice"];
}) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="secondary"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const r = await get("/fiscal/files/" + file.id);
          download(r.content, r.filename, "application/octet-stream");
        } catch (e: any) {
          onNotice(e.message, true);
        } finally {
          setBusy(false);
        }
      }}
    >
      {file.filename} · baixar XML
    </button>
  );
}
function Upload(props: Props & { draftId?: string; onSaved: () => void }) {
  const [file, setFile] = useState<File | null>(null),
    [description, setDescription] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [inputKey, setInputKey] = useState(0);
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      if (file.size > 65536) throw Error("XML limitado a 64 KB.");
      let content: string;
      try {
        content = new TextDecoder("utf-8", {
          fatal: true,
          ignoreBOM: true,
        }).decode(await file.arrayBuffer());
      } catch {
        throw Error("Use um arquivo XML codificado em UTF-8.");
      }
      await props.mutate("/fiscal/files", {
        branch_id: props.branch,
        draft_id: props.draftId || null,
        filename: file.name,
        content,
        description,
      });
      setFile(null);
      setInputKey((n) => n + 1);
      setDescription("");
      props.onNotice("XML guardado como arquivo não verificado.");
      props.onSaved();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="fiscal-card">
      <h3>Guardar XML{props.draftId ? " nesta preparação" : ""}</h3>
      <p>
        Arquivos em UTF-8, preservados para consulta. A importação não verifica
        validade fiscal.
      </p>
      <form onSubmit={save}>
        <fieldset disabled={busy}>
          <div className="fiscal-grid">
            <Field label="Arquivo XML (até 64 KB)">
              <input
                key={inputKey}
                type="file"
                accept=".xml"
                required
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
            </Field>
            <Field label="Descrição do arquivo">
              <input
                value={description}
                required
                minLength={5}
                maxLength={500}
                onChange={(e) => setDescription(e.target.value)}
              />
            </Field>
          </div>
          <button className="secondary" disabled={busy || !file}>
            Guardar XML não verificado
          </button>
        </fieldset>
        {error && <p role="alert">{error}</p>}
      </form>
    </section>
  );
}

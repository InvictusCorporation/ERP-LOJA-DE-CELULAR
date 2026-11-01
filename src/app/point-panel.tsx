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
import { RefreshCw, Download, UsersRound, Link2 } from "lucide-react";
import { canonicalPointJson } from "../shared/point";
import "./employees.css";
import "./point.css";
type Row = Record<string, any>;
type Props = {
  permissions: string[];
  mutate: (path: string, body: unknown, method?: string) => Promise<any>;
  onNotice: (text: string, error?: boolean) => void;
  onEmployees: () => void;
};
async function get(path: string) {
  const r = await fetch("/api" + path, { cache: "no-store" }),
    b = await r.json();
  if (!r.ok) throw Error(b.error || "Não foi possível consultar.");
  return b;
}
function useQuery(path: string | null, revision: number) {
  const key = path + ":" + revision,
    [result, setResult] = useState<{
      key: string;
      data?: any;
      error?: string;
    }>();
  useEffect(() => {
    let alive = true;
    if (path)
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
    loading: !!path && result?.key !== key,
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
export default function PointPanel(props: Props) {
  const [tab, setTab] = useState("settings"),
    [reload, setReload] = useState(0),
    [page, setPage] = useState(1),
    [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [historyPage, setHistoryPage] = useState(1),
    [busy, setBusy] = useState(false);
  const refresh = () => setReload((n) => n + 1),
    can = (right: string) => props.permissions.includes(right),
    overview = useQuery(
      "/point/overview?" +
        new URLSearchParams({ page: String(page), q: query }),
      reload,
    ),
    history = useQuery(
      tab === "exports" && can("point_export")
        ? "/point/exports?page=" + historyPage
        : null,
      reload,
    ),
    data = overview.data;
  async function prepare() {
    if (busy) return;
    setBusy(true);
    try {
      await props.mutate("/point/exports", {});
      setHistoryPage(1);
      refresh();
      props.onNotice("Pacote preparado para revisão. Nenhum dado foi enviado.");
    } catch (e: any) {
      props.onNotice(e.message, true);
    } finally {
      setBusy(false);
    }
  }
  async function download(id: string) {
    if (busy) return;
    setBusy(true);
    try {
      const r = await get("/point/exports/" + id),
        url = URL.createObjectURL(
          new Blob([canonicalPointJson(r.content)], {
            type: "application/json",
          }),
        ),
        a = document.createElement("a");
      a.href = url;
      a.download = "vinculos-ponto-" + id + ".json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e: any) {
      props.onNotice(e.message, true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="employees-panel point-panel">
      <div className="employee-heading">
        <div>
          <h2>Preparar conexão com o ponto</h2>
          <p>
            Reutilize funcionários e filiais da loja para integrar o sistema
            existente.
          </p>
        </div>
        <button className="secondary" onClick={refresh}>
          <RefreshCw size={16} />
          Atualizar consulta
        </button>
      </div>
      <div className="point-banner">
        <Link2 size={24} />
        <div>
          <strong>Integração não conectada</strong>
          <p>
            Este painel prepara cadastros e arquivos para revisão. Marcações,
            jornadas, frequência e banco de horas serão fornecidos pelo sistema
            de ponto após a integração.
          </p>
        </div>
      </div>
      {overview.error && (
        <p role="alert">
          {overview.error}{" "}
          <button className="secondary" onClick={refresh}>
            Tentar novamente
          </button>
        </p>
      )}
      {overview.loading && <p role="status">Consultando vínculos…</p>}
      {data && (
        <>
          <div className="point-metrics">
            <div>
              <small>Filiais no seu acesso</small>
              <strong>{data.branches.length}</strong>
            </div>
            <div>
              <small>Funcionários no seu acesso</small>
              <strong>{data.employee_total}</strong>
            </div>
            <div>
              <small>Filiais sem identificador</small>
              <strong>{data.blocking.branches_without_mapping}</strong>
            </div>
            <div>
              <small>Funcionários sem identificador</small>
              <strong>{data.blocking.employees_without_mapping}</strong>
            </div>
          </div>
          <section className="point-card">
            <strong>
              {data.local_mapping_complete
                ? "Cadastros preparados para revisão"
                : "Complete os dados para preparar a integração"}
            </strong>
            <p>
              {data.local_mapping_complete
                ? "Os identificadores locais estão preenchidos. Falta validar o contrato, a autenticação e a conexão com o projeto de ponto."
                : "Preencha o destino, associe as filiais e informe o identificador do ponto no cadastro de cada funcionário."}
            </p>
            <p>
              Habilitação comercial: pendente de confirmação pela central.
              Última sincronização: nenhuma.
            </p>
            {data.blocking.employees_without_home_branch > 0 && (
              <p>
                {data.blocking.employees_without_home_branch} funcionário(s) sem
                filial de trabalho definida. Complete o cadastro em Funcionários
                e permissões.
              </p>
            )}
            {data.blocking.over_export_limit && (
              <p role="alert">
                Mais de 500 funcionários no seu acesso. O envio em lotes depende
                do adaptador definitivo.
              </p>
            )}
          </section>
        </>
      )}
      <div
        className="employee-tabs point-tabs"
        role="tablist"
        aria-label="Preparação do ponto"
      >
        {[
          ["settings", "Destino da integração"],
          ["branches", "Vínculos das filiais"],
          ["employees", "Vínculos dos funcionários"],
          ...(can("point_export") ? [["exports", "Pacotes preparados"]] : []),
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
      {data && tab === "settings" && (
        <>
          <Settings
            key={data.settings.version + ":" + reload}
            {...props}
            settings={data.settings}
            editable={can("point_settings")}
            onSaved={refresh}
          />
          <section className="point-card">
            <h3>O que falta para conectar</h3>
            <ul>
              {data.integration.release_gates.map((text: string) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
            <p>
              A seleção de produção apenas documenta o ambiente pretendido. Não
              ativa a integração nem contrata o módulo.
            </p>
          </section>
        </>
      )}
      {data && tab === "branches" && (
        <section className="point-card">
          <h3>Filiais da empresa</h3>
          <p>
            Associe cada unidade ao identificador correspondente no sistema de
            ponto. A mesma identificação não pode representar duas filiais da
            empresa. Unidades inativas ficam visíveis para preservar o
            histórico.
          </p>
          <div className="point-branch-grid">
            {data.branches.map((b: Row) => (
              <BranchMapping
                key={b.id + ":" + b.version}
                {...props}
                branch={b}
                editable={can("point_settings")}
                onSaved={refresh}
              />
            ))}
          </div>
        </section>
      )}
      {data && tab === "employees" && (
        <>
          <div className="employee-heading">
            <p>
              O cadastro continua em Funcionários e permissões. Informe ali o
              identificador externo do ponto, sem criar outra pessoa.
            </p>
            <button className="secondary" onClick={props.onEmployees}>
              <UsersRound size={16} />
              Abrir cadastro de funcionários
            </button>
          </div>
          <form
            className="employee-filters"
            onSubmit={(e) => {
              e.preventDefault();
              setPage(1);
              setQuery(search);
            }}
          >
            <Field label="Buscar funcionário, matrícula ou identificador">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                maxLength={100}
              />
            </Field>
            <button className="secondary">Buscar</button>
          </form>
          <div className="employee-table">
            <table>
              <thead>
                <tr>
                  <th>Funcionário</th>
                  <th>Filial de trabalho</th>
                  <th>Identificador no ponto</th>
                  <th>Situação cadastral</th>
                </tr>
              </thead>
              <tbody>
                {data.employees.items.map((e: Row) => (
                  <tr key={e.id}>
                    <td>
                      {e.name}
                      <small>
                        {e.employee_code || "Sem matrícula"}
                        {e.job_title ? " · " + e.job_title : ""}
                      </small>
                    </td>
                    <td>
                      {data.branches.find((b: Row) => b.id === e.home_branch_id)
                        ?.name || "A revisar"}
                    </td>
                    <td>{e.point_external_id || "Pendente"}</td>
                    <td>{e.active ? "Ativo" : "Inativo"}</td>
                  </tr>
                ))}
                {!data.employees.items.length && (
                  <tr>
                    <td colSpan={4}>
                      Nenhum funcionário encontrado no seu acesso.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <Pager
            page={page}
            total={data.employees.total}
            size={30}
            onPage={setPage}
          />
        </>
      )}
      {tab === "exports" && can("point_export") && (
        <>
          <section className="point-card">
            <h3>Pacote cadastral para revisão</h3>
            <p>
              Salva os dados atuais dos funcionários e filiais dentro do seu
              acesso, incluindo cadastros inativos. Contém nomes e dados
              funcionais, sem e-mail, senha, permissões ou registros de jornada.
              O formato é uma proposta do ERP e ainda precisa ser aceito pelo
              sistema de ponto.
            </p>
            <p>
              Pacotes anteriores preservam seus dados e as pendências daquele
              momento. Um pacote com identificadores preenchidos ainda precisa
              de homologação.
            </p>
            <button
              className="primary"
              disabled={
                busy ||
                overview.loading ||
                !data ||
                data.blocking.over_export_limit
              }
              onClick={prepare}
            >
              {busy ? "Processando…" : "Preparar pacote cadastral"}
            </button>
          </section>
          {history.error && (
            <p role="alert">
              {history.error}{" "}
              <button className="secondary" onClick={refresh}>
                Tentar novamente
              </button>
            </p>
          )}
          {history.loading ? (
            <p role="status">Consultando pacotes…</p>
          ) : (
            history.data && (
              <>
                <div className="employee-table">
                  <table>
                    <thead>
                      <tr>
                        <th>Preparação</th>
                        <th>Funcionários</th>
                        <th>Cadastros</th>
                        <th>Ação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.data.items.map((r: Row) => (
                        <tr key={r.id}>
                          <td>
                            {new Date(r.created_at).toLocaleString("pt-BR")}
                            <small>
                              Não enviado · {r.branch_ids.length} filial(is)
                            </small>
                          </td>
                          <td>{r.employee_count}</td>
                          <td>
                            {r.local_mapping_complete
                              ? "Preenchidos para revisão"
                              : "Com pendências"}
                          </td>
                          <td>
                            <button
                              className="secondary"
                              disabled={busy}
                              onClick={() => download(r.id)}
                            >
                              <Download size={16} />
                              Baixar pacote
                            </button>
                          </td>
                        </tr>
                      ))}
                      {!history.data.items.length && (
                        <tr>
                          <td colSpan={4}>Nenhum pacote preparado.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <Pager
                  page={historyPage}
                  total={history.data.total}
                  size={20}
                  onPage={setHistoryPage}
                />
              </>
            )
          )}
        </>
      )}
    </div>
  );
}
function Pager({
  page,
  total,
  size,
  onPage,
}: {
  page: number;
  total: number;
  size: number;
  onPage: (page: number) => void;
}) {
  return (
    <div className="employee-pagination">
      <span>
        {total} registros · página {page}
      </span>
      <button
        className="secondary"
        disabled={page === 1}
        onClick={() => onPage(page - 1)}
      >
        Anterior
      </button>
      <button
        className="secondary"
        disabled={page * size >= total}
        onClick={() => onPage(page + 1)}
      >
        Próxima
      </button>
    </div>
  );
}
function Settings(
  props: Props & { settings: Row; editable: boolean; onSaved: () => void },
) {
  const [form, setForm] = useState<Row>({ ...props.settings.profile }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await props.mutate("/point/settings", {
        ...form,
        version: props.settings.version,
      });
      props.onNotice(
        "Destino da integração salvo. A conexão permanece desativada.",
      );
      props.onSaved();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="point-card">
      <h3>Destino pretendido</h3>
      <p>
        Registre o sistema que será conectado. O endereço não é acessado nesta
        etapa. Não informe tokens ou senhas nestes campos.
      </p>
      <form onSubmit={save}>
        <fieldset disabled={!props.editable || busy}>
          <div className="point-form-grid">
            <Field label="Nome do sistema de ponto">
              <input
                value={form.provider_name}
                maxLength={100}
                onChange={(e) =>
                  setForm({ ...form, provider_name: e.target.value })
                }
              />
            </Field>
            <Field label="Endereço base da integração (HTTPS)">
              <input
                type="url"
                value={form.base_url}
                maxLength={300}
                placeholder="https://"
                onChange={(e) => setForm({ ...form, base_url: e.target.value })}
              />
            </Field>
            <Field label="Identificador da empresa no ponto">
              <input
                value={form.external_tenant_id}
                maxLength={120}
                onChange={(e) =>
                  setForm({ ...form, external_tenant_id: e.target.value })
                }
              />
            </Field>
            <Field label="Ambiente pretendido">
              <select
                value={form.environment}
                onChange={(e) =>
                  setForm({ ...form, environment: e.target.value })
                }
              >
                <option value="sandbox">Testes / homologação</option>
                <option value="production">Produção (ativação pendente)</option>
              </select>
            </Field>
            <Field label="Observações para integração">
              <textarea
                value={form.notes}
                maxLength={1500}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </Field>
          </div>
          {props.editable && (
            <button className="primary" disabled={busy}>
              {busy ? "Salvando…" : "Salvar destino da integração"}
            </button>
          )}
        </fieldset>
        {error && <p role="alert">{error}</p>}
      </form>
    </section>
  );
}
function BranchMapping(
  props: Props & { branch: Row; editable: boolean; onSaved: () => void },
) {
  const [external, setExternal] = useState(
      props.branch.external_branch_id || "",
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await props.mutate("/point/branches/" + props.branch.id, {
        version: props.branch.version,
        external_branch_id: external,
      });
      props.onNotice("Vínculo da filial salvo.");
      props.onSaved();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="point-branch" onSubmit={save}>
      <h4>
        {props.branch.name} {!props.branch.active && <small>· Inativa</small>}
      </h4>
      <fieldset disabled={!props.editable || busy}>
        <Field label={"Identificador no ponto · " + props.branch.name}>
          <input
            value={external}
            maxLength={120}
            onChange={(e) => setExternal(e.target.value)}
          />
        </Field>
        {props.editable && (
          <button className="secondary" disabled={busy}>
            Salvar vínculo da filial
          </button>
        )}
      </fieldset>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}

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
import { Plus, ArrowLeft, RefreshCw, Download, Save } from "lucide-react";
import {
  effectivePermissions,
  permissionLabels,
  roleLabels,
  roleRights,
  reservedPermissions,
} from "../shared/access";
import "./employees.css";
type Row = Record<string, any>;
type Props = {
  branch: string;
  branches: Row[];
  userId: string;
  mutate: (path: string, body: unknown, method?: string) => Promise<any>;
  onNotice: (text: string, error?: boolean) => void;
  onRefreshIdentity: () => Promise<void>;
};
function useQuery(path: string | null, reload: number) {
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
function download(text: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function RosterCsv(items: Row[], branches: Row[], page: number) {
  const quote = (v: any) =>
    '"' +
    (/^[=+@\-\t\r\n]/.test(String(v ?? "").trimStart()) ? "'" : "") +
    String(v ?? "").replace(/"/g, '""') +
    '"';
  const rows = [
    ["Funcionários — página " + page],
    [
      "Nome",
      "E-mail da conta",
      "Matrícula",
      "Cargo",
      "Perfil",
      "Filial de trabalho",
      "Acesso",
    ],
    ...items.map((e) => [
      e.name,
      e.email,
      e.employee_code,
      e.job_title,
      roleLabels[e.role],
      branches.find((b) => b.id === e.home_branch_id)?.name || "Não definida",
      e.active && e.account_active ? "Ativo" : "Inativo",
    ]),
  ];
  download(
    "\uFEFF" + rows.map((r) => r.map(quote).join(";")).join("\r\n"),
    "funcionarios-pagina-" + page + ".csv",
    "text/csv;charset=utf-8",
  );
}
export default function EmployeesPanel(props: Props) {
  const [selected, setSelected] = useState<string | null>(null),
    [reload, setReload] = useState(0),
    [page, setPage] = useState(1),
    [q, setQ] = useState(""),
    [status, setStatus] = useState("all"),
    [scope, setScope] = useState(props.branch),
    [filters, setFilters] = useState({
      q: "",
      status: "all",
      branch_id: props.branch,
    });
  const config = useQuery("/employees/config", reload),
    list = useQuery(
      !selected
        ? "/employees?" +
            new URLSearchParams({ ...filters, page: String(page) })
        : null,
      reload,
    );
  const refresh = () => setReload((v) => v + 1);
  if (config.error)
    return (
      <div role="alert">
        <p>{config.error}</p>
        <button className="secondary" onClick={refresh}>
          Tentar novamente
        </button>
      </div>
    );
  if (!config.data)
    return <p role="status">Carregando gestão de funcionários…</p>;
  if (selected)
    return (
      <EmployeeDetail
        {...props}
        config={config.data}
        id={selected}
        onBack={() => setSelected(null)}
        onSaved={(id) => {
          setSelected(id);
          refresh();
        }}
        reload={reload}
        onReload={refresh}
      />
    );
  return (
    <div className="employees-panel">
      <div className="employee-heading">
        <div>
          <h2>Equipe e acessos</h2>
          <p>Organize a equipe, suas funções e seus acessos.</p>
        </div>
        <div className="employee-actions">
          <button className="secondary" onClick={refresh}>
            <RefreshCw size={16} />
            Atualizar
          </button>
          <button
            className="secondary"
            disabled={!list.data || list.loading}
            onClick={() => RosterCsv(list.data.items, props.branches, page)}
          >
            <Download size={16} />
            Exportar página
          </button>
          {config.data.can_create && (
            <button className="primary" onClick={() => setSelected("new")}>
              <Plus size={16} />
              Novo funcionário
            </button>
          )}
        </div>
      </div>
      {!config.data.can_create && (
        <p className="employee-note">
          Novas contas são vinculadas pela central. Aqui você gerencia os
          funcionários já provisionados.
        </p>
      )}
      <form
        className="employee-filters"
        onSubmit={(e) => {
          e.preventDefault();
          setFilters({ q, status, branch_id: scope });
          setPage(1);
          refresh();
        }}
      >
        <Field label="Buscar funcionário">
          <input
            value={q}
            maxLength={100}
            placeholder="Nome, e-mail, matrícula ou cargo"
            onChange={(e) => setQ(e.target.value)}
          />
        </Field>
        <Field label="Situação do funcionário">
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">Todos</option>
            <option value="active">Ativos</option>
            <option value="inactive">Inativos</option>
          </select>
        </Field>
        <Field label="Filial da equipe">
          <select value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="all">Todas as autorizadas</option>
            {props.branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </Field>
        <button className="primary" type="submit">
          Aplicar filtros
        </button>
      </form>
      <p className="employee-note">
        Somente funcionários cujas filiais estão integralmente no seu acesso.
        Exportação inclui a página atual.
      </p>
      {list.loading ? (
        <p role="status">Consultando equipe…</p>
      ) : list.error ? (
        <div role="alert">
          <p>{list.error}</p>
          <button className="secondary" onClick={refresh}>
            Tentar novamente
          </button>
        </div>
      ) : (
        list.data && (
          <>
            <div className="employee-table">
              <table>
                <thead>
                  <tr>
                    <th>Funcionário</th>
                    <th>Cargo / função</th>
                    <th>Perfil</th>
                    <th>Filial de trabalho</th>
                    <th>Situação</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {list.data.items.map((e: Row) => (
                    <tr key={e.id}>
                      <td>
                        <strong>{e.name}</strong>
                        <small>{e.email}</small>
                        <small>{e.employee_code || "Sem matrícula"}</small>
                      </td>
                      <td>
                        {e.job_title || "Não informado"}
                        <small>{e.job_function}</small>
                      </td>
                      <td>{roleLabels[e.role]}</td>
                      <td>
                        {props.branches.find((b) => b.id === e.home_branch_id)
                          ?.name || "Não definida"}
                      </td>
                      <td>
                        <span
                          className={
                            e.active && e.account_active
                              ? "employee-active"
                              : "employee-inactive"
                          }
                        >
                          {e.active && e.account_active ? "Ativo" : "Inativo"}
                        </span>
                      </td>
                      <td>
                        <button
                          className="secondary small"
                          onClick={() => setSelected(e.id)}
                        >
                          Abrir cadastro
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!list.data.items.length && (
                <p className="employee-empty">
                  Nenhum funcionário encontrado para estes filtros.
                </p>
              )}
            </div>
            <div className="employee-pagination">
              <span>
                {list.data.total} cadastros · página {page} de{" "}
                {Math.max(1, Math.ceil(list.data.total / 30))}
              </span>
              <button
                className="secondary"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Anterior
              </button>
              <button
                className="secondary"
                disabled={page * 30 >= list.data.total}
                onClick={() => setPage((p) => p + 1)}
              >
                Próxima
              </button>
            </div>
          </>
        )
      )}
    </div>
  );
}
function EmployeeDetail(
  props: Props & {
    config: Row;
    id: string;
    reload: number;
    onReload: () => void;
    onBack: () => void;
    onSaved: (id: string) => void;
  },
) {
  const detail = useQuery(
      props.id === "new" ? null : "/employees/" + props.id,
      props.reload,
    ),
    [tab, setTab] = useState("profile"),
    [historyPage, setHistoryPage] = useState(1),
    [busy, setBusy] = useState(false);
  const history = useQuery(
    props.id !== "new" && tab === "history"
      ? `/employees/${props.id}/history?page=${historyPage}`
      : null,
    props.reload,
  );
  const fresh = {
    name: "",
    email: "",
    password: "",
    job_title: "",
    job_function: "",
    employee_code: "",
    point_external_id: "",
    role: "cashier",
    branch_ids: [props.branch],
    home_branch_id: props.branch,
    active: true,
    permission_grants: [],
    permission_denials: [],
    editable: true,
  };
  const record = props.id === "new" ? fresh : detail.data;
  async function point() {
    if (busy) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/employees/${props.id}/point`, {
          cache: "no-store",
        }),
        b = await r.json();
      if (!r.ok) throw Error(b.error);
      download(
        JSON.stringify(b, null, 2),
        "vinculo-ponto-" + props.id + ".json",
        "application/json",
      );
    } catch (e: any) {
      props.onNotice(e.message, true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="employees-panel">
      <div className="employee-heading">
        <button className="secondary" onClick={props.onBack}>
          <ArrowLeft size={16} />
          Voltar à equipe
        </button>
        {props.id !== "new" && (
          <div className="employee-actions">
            <button
              className="secondary"
              disabled={busy}
              onClick={props.onReload}
            >
              <RefreshCw size={16} />
              Recarregar cadastro
            </button>
            <button
              className="secondary"
              disabled={busy || !record}
              onClick={point}
            >
              <Download size={16} />
              Exportar vínculo do ponto
            </button>
          </div>
        )}
      </div>
      {detail.error ? (
        <div role="alert">{detail.error}</div>
      ) : !record ? (
        <p role="status">Carregando cadastro…</p>
      ) : (
        <>
          <div>
            <h2>{props.id === "new" ? "Novo funcionário" : record.name}</h2>
            <p className="employee-note">
              {props.config.point_status} O vínculo exportado não contém
              registros de jornada.
            </p>
          </div>
          {props.id !== "new" && (
            <div
              className="employee-tabs"
              role="tablist"
              aria-label="Cadastro do funcionário"
            >
              <button
                role="tab"
                aria-selected={tab === "profile"}
                onClick={() => setTab("profile")}
              >
                Cadastro e permissões
              </button>
              <button
                role="tab"
                aria-selected={tab === "history"}
                onClick={() => setTab("history")}
              >
                Histórico de operações
              </button>
            </div>
          )}
          {tab === "profile" || props.id === "new" ? (
            <EmployeeEditor
              key={props.id + ":" + record.version + ":" + props.reload}
              {...props}
              record={record}
            />
          ) : history.loading ? (
            <p role="status">Consultando histórico…</p>
          ) : history.error ? (
            <div role="alert">{history.error}</div>
          ) : (
            history.data && (
              <>
                <p className="employee-note">
                  Operações realizadas pelo funcionário e alterações de seu
                  cadastro nas filiais autorizadas. O histórico permanece após
                  inativar o acesso.
                </p>
                <div className="employee-table">
                  <table>
                    <thead>
                      <tr>
                        <th>Operação</th>
                        <th>Responsável</th>
                        <th>Filial</th>
                        <th>Data</th>
                        <th>Referência</th>
                        <th>Motivo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.data.items.map((e: Row) => (
                        <tr key={e.id}>
                          <td>{e.action}</td>
                          <td>{e.actor_name || "Sistema"}</td>
                          <td>{e.branch || "Empresa"}</td>
                          <td>
                            {new Date(e.created_at).toLocaleString("pt-BR", {
                              timeZone: "America/Fortaleza",
                            })}
                          </td>
                          <td>{e.entity_id}</td>
                          <td>{e.reason || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!history.data.items.length && (
                    <p className="employee-empty">
                      Nenhuma operação registrada.
                    </p>
                  )}
                </div>
                <div className="employee-pagination">
                  <span>
                    {history.data.total} operações · página {historyPage}
                  </span>
                  <button
                    className="secondary"
                    disabled={historyPage <= 1}
                    onClick={() => setHistoryPage((p) => p - 1)}
                  >
                    Anterior
                  </button>
                  <button
                    className="secondary"
                    disabled={historyPage * 30 >= history.data.total}
                    onClick={() => setHistoryPage((p) => p + 1)}
                  >
                    Próxima
                  </button>
                </div>
              </>
            )
          )}
        </>
      )}
    </div>
  );
}
function EmployeeEditor(
  props: Props & {
    record: Row;
    config: Row;
    id: string;
    onSaved: (id: string) => void;
  },
) {
  const [draft, setDraft] = useState<Row>({
      ...props.record,
      home_branch_id: props.record.home_branch_id || props.record.branch_ids[0],
    }),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false);
  const update = (k: string, v: any) => setDraft((d) => ({ ...d, [k]: v })),
    isNew = props.id === "new",
    self = !isNew && draft.user_id === props.userId,
    locked = draft.role === "owner" || self || !draft.editable,
    rights = effectivePermissions(draft as any);
  const setPermission = (right: string, mode: string) =>
    setDraft((d) => ({
      ...d,
      permission_grants: [
        ...d.permission_grants.filter((r: string) => r !== right),
        ...(mode === "allow" ? [right] : []),
      ],
      permission_denials: [
        ...d.permission_denials.filter((r: string) => r !== right),
        ...(mode === "deny" ? [right] : []),
      ],
    }));
  async function save(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const body: Row = {};
      for (const k of [
        "name",
        "job_title",
        "job_function",
        "employee_code",
        "home_branch_id",
        "point_external_id",
        "role",
        "active",
        "branch_ids",
        "permission_grants",
        "permission_denials",
      ])
        body[k] = draft[k];
      if (isNew) {
        body.email = draft.email;
        body.password = draft.password;
      } else {
        body.version = draft.version;
        body.reason = reason;
      }
      const r = await props.mutate(
        isNew ? "/employees" : "/employees/" + props.id,
        body,
        isNew ? "POST" : "PUT",
      );
      setDraft((d) => ({ ...d, password: "" }));
      props.onNotice(
        isNew
          ? "Funcionário cadastrado."
          : self
            ? "Perfil pessoal atualizado."
            : "Cadastro atualizado. Sessões anteriores do funcionário foram encerradas.",
      );
      if (self) await props.onRefreshIdentity();
      props.onSaved(r.employee_id);
    } catch (e: any) {
      props.onNotice(e.message, true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="employee-editor" onSubmit={save}>
      <fieldset disabled={busy || !draft.editable}>
        <legend>Dados do funcionário</legend>
        <div className="employee-grid">
          <Field label="Nome na empresa">
            <input
              required
              maxLength={180}
              value={draft.name}
              onChange={(e) => update("name", e.target.value)}
            />
          </Field>
          <Field label="E-mail da conta">
            <input
              type="email"
              required
              maxLength={254}
              value={draft.email}
              disabled={!isNew}
              onChange={(e) => update("email", e.target.value)}
              autoComplete="off"
            />
          </Field>
          {isNew && (
            <Field label="Senha inicial">
              <input
                type="password"
                required
                minLength={12}
                maxLength={128}
                value={draft.password || ""}
                onChange={(e) => update("password", e.target.value)}
                autoComplete="new-password"
              />
            </Field>
          )}
          <Field label="Matrícula">
            <input
              maxLength={80}
              value={draft.employee_code}
              onChange={(e) => update("employee_code", e.target.value)}
            />
          </Field>
          <Field label="Cargo">
            <input
              maxLength={100}
              value={draft.job_title}
              onChange={(e) => update("job_title", e.target.value)}
            />
          </Field>
          <Field label="Função">
            <input
              maxLength={500}
              value={draft.job_function}
              onChange={(e) => update("job_function", e.target.value)}
            />
          </Field>
          <Field label="Filial de trabalho">
            <select
              value={draft.home_branch_id}
              onChange={(e) => update("home_branch_id", e.target.value)}
            >
              {props.branches
                .filter((b) => draft.branch_ids.includes(b.id))
                .map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Identificador no controle de ponto">
            <input
              maxLength={120}
              value={draft.point_external_id}
              onChange={(e) => update("point_external_id", e.target.value)}
            />
          </Field>
        </div>
        <p className="employee-note">
          Nome, cargo e função pertencem a esta empresa. E-mail e senha da conta
          existente são administrados pela central. Matrícula e identificador de
          ponto são opcionais e não podem se repetir nesta empresa.
        </p>
      </fieldset>
      <fieldset disabled={busy || locked}>
        <legend>Perfil e filiais autorizadas</legend>
        <div className="employee-grid">
          <Field label="Perfil de acesso">
            <select
              value={draft.role}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  role: e.target.value,
                  permission_grants: [],
                  permission_denials: [],
                }))
              }
            >
              {Object.entries(roleLabels)
                .filter(
                  ([role]) =>
                    role === draft.role ||
                    (role !== "owner" &&
                      (props.config.is_owner || role !== "administrator")),
                )
                .map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Situação do acesso">
            <select
              value={draft.active ? "active" : "inactive"}
              onChange={(e) => update("active", e.target.value === "active")}
            >
              <option value="active">Ativo</option>
              <option value="inactive">Inativo</option>
            </select>
          </Field>
        </div>
        <div
          className="employee-branches"
          role="group"
          aria-label="Filiais autorizadas do funcionário"
        >
          {props.branches.map((b) => (
            <label key={b.id}>
              <input
                type="checkbox"
                checked={draft.branch_ids.includes(b.id)}
                onChange={(e) => {
                  const ids = e.target.checked
                    ? [...draft.branch_ids, b.id]
                    : draft.branch_ids.filter((id: string) => id !== b.id);
                  setDraft((d) => ({
                    ...d,
                    branch_ids: ids,
                    home_branch_id: ids.includes(d.home_branch_id)
                      ? d.home_branch_id
                      : ids[0] || "",
                  }));
                }}
              />
              {b.name}
            </label>
          ))}
        </div>
        <p className="employee-note">
          Selecione pelo menos uma filial. A filial de trabalho deve fazer parte
          do acesso. Trocar o perfil restaura as permissões padrão; revise antes
          de salvar. Feche caixas e reatribua pendências antes de retirar
          acessos usados.
        </p>
      </fieldset>
      {locked && (
        <p className="employee-note">
          O próprio acesso e o perfil do proprietário são protegidos.
          Administradores não podem alterar outros administradores. Dados
          pessoais da empresa podem ser atualizados pelo proprietário.
        </p>
      )}
      <fieldset className="employee-permissions" disabled={busy || locked}>
        <legend>Permissões individuais</legend>
        <p className="employee-note">
          O padrão vem do perfil. Bloqueios retiram também ações que dependem
          daquela permissão. A coluna final mostra o acesso que será aplicado.
          Entrar, gestão de usuários, filiais e política de crédito são
          reservados ao perfil.
        </p>
        <div className="employee-table">
          <table>
            <thead>
              <tr>
                <th>Permissão</th>
                <th>Configuração</th>
                <th>Acesso efetivo</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(permissionLabels).map(([right, label]) => (
                <tr key={right}>
                  <td>{label}</td>
                  <td>
                    {reservedPermissions.includes(right) ? (
                      "Reservada ao perfil"
                    ) : (
                      <select
                        aria-label={"Configurar " + label}
                        value={
                          draft.permission_denials.includes(right)
                            ? "deny"
                            : draft.permission_grants.includes(right)
                              ? "allow"
                              : "default"
                        }
                        onChange={(e) => setPermission(right, e.target.value)}
                      >
                        <option value="default">
                          Padrão do perfil (
                          {roleRights[draft.role]?.includes(right)
                            ? "permitido"
                            : "bloqueado"}
                          )
                        </option>
                        <option value="allow">Permitir individualmente</option>
                        <option value="deny">Bloquear individualmente</option>
                      </select>
                    )}
                  </td>
                  <td>{rights.includes(right) ? "Permitido" : "Bloqueado"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </fieldset>
      {!isNew && (
        <Field label="Motivo da alteração">
          <textarea
            required
            minLength={5}
            maxLength={500}
            disabled={busy || !draft.editable}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
      )}
      <div className="employee-actions">
        <button
          className="primary"
          disabled={
            busy ||
            !draft.editable ||
            !draft.branch_ids.length ||
            !draft.home_branch_id
          }
          type="submit"
        >
          <Save size={16} />
          {busy ? "Salvando…" : "Salvar funcionário"}
        </button>
      </div>
    </form>
  );
}

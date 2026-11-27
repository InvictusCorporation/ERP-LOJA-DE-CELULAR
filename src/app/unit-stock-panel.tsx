"use client";
import { useEffect, useState } from "react";
import {
  Wrench,
  Search,
  Smartphone,
  CalendarDays,
  History,
  Pencil,
  Check,
  MapPin,
  Battery,
  Package,
} from "lucide-react";
import { ProductImage } from "./product-image";
type Row = Record<string, any>;
const conditions: Record<string, string> = {
  new: "Novo",
  refurbished: "Seminovo",
  used: "Usado",
};
const brl = (n: unknown) =>
  Number(n || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
export default function UnitStockPanel({
  items,
  canEdit,
  canCost,
  mutate,
  reload,
  onNotice,
}: {
  items: Row[];
  canEdit: boolean;
  canCost: boolean;
  mutate: (path: string, body: unknown) => Promise<any>;
  reload: () => Promise<void>;
  onNotice: (text: string, error?: boolean) => void;
}) {
  const [query, setQuery] = useState(""),
    [brand, setBrand] = useState(""),
    [condition, setCondition] = useState(""),
    [status, setStatus] = useState(""),
    [selected, setSelected] = useState(""),
    [editing, setEditing] = useState(false),
    [history, setHistory] = useState<Row[] | null>(null),
    [historyUnitId, setHistoryUnitId] = useState(""),
    [busy, setBusy] = useState(false);
  const brands = Array.from(
    new Set(items.map((u) => u.brand_name).filter(Boolean)),
  ).sort();
  const filtered = items.filter(
    (u) =>
      (!brand || u.brand_name === brand) &&
      (!condition || u.condition === condition) &&
      (!status ||
        (status === "reserved"
          ? u.reserved
          : status === "available"
            ? u.status === "in_stock" && !u.reserved
            : u.status === "out")) &&
      [u.product_name, u.serial, ...u.imeis, u.color, u.capacity]
        .join(" ")
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const unit = filtered.find((u) => u.id === selected) || filtered[0];
  useEffect(() => {
    setEditing(false);
    setHistory(null);
  }, [unit?.id]);
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!unit || busy) return;
    setBusy(true);
    const f = new FormData(e.currentTarget);
    try {
      await mutate(`/units/${unit.id}/details`, {
        version: unit.details_version,
        battery_health:
          f.get("battery") === "" ? null : Number(f.get("battery")),
        physical_condition: String(f.get("physical") || ""),
        location: String(f.get("location") || ""),
        reserved: f.get("reserved") === "on",
      });
      setEditing(false);
      await reload();
      onNotice("Ficha do aparelho atualizada.");
    } catch (e: any) {
      onNotice(e.message, true);
    } finally {
      setBusy(false);
    }
  }
  async function loadHistory() {
    if (!unit) return;
    try {
      const r = await fetch(`/api/units/${unit.id}/history`, {
        cache: "no-store",
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setHistoryUnitId(unit.id);
      setHistory(d.items);
    } catch (e: any) {
      onNotice(e.message, true);
    }
  }
  return (
    <div className="store-units">
      <div className="store-stock-kpis">
        <article>
          <span className="store-alert-icon green">
            <Smartphone size={25} />
          </span>
          <div>
            <span>Disponíveis</span>
            <strong>
              {
                items.filter((u) => u.status === "in_stock" && !u.reserved)
                  .length
              }
            </strong>
          </div>
        </article>
        <article>
          <span className="store-alert-icon gold">
            <CalendarDays size={25} />
          </span>
          <div>
            <span>Reservados</span>
            <strong>{items.filter((u) => u.reserved).length}</strong>
          </div>
        </article>
        <article>
          <span className="store-alert-icon blue">
            <Package size={25} />
          </span>
          <div>
            <span>Unidades consultadas</span>
            <strong>{items.length}</strong>
          </div>
        </article>
      </div>
      <div className="store-stock-filters">
        <div className="search">
          <Search size={18} />
          <input
            aria-label="Buscar aparelho por modelo ou IMEI"
            placeholder="Buscar por modelo, série ou IMEI"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <select
          aria-label="Filtrar marca"
          value={brand}
          onChange={(e) => setBrand(e.target.value)}
        >
          <option value="">Todas as marcas</option>
          {brands.map((b) => (
            <option key={b}>{b}</option>
          ))}
        </select>
        <select
          aria-label="Filtrar condição"
          value={condition}
          onChange={(e) => setCondition(e.target.value)}
        >
          <option value="">Todas as condições</option>
          {Object.entries(conditions).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <select
          aria-label="Filtrar status do aparelho"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">Todos os status</option>
          <option value="available">Disponível</option>
          <option value="reserved">Reservado</option>
          <option value="out">Fora do estoque</option>
        </select>
      </div>
      <div className="store-unit-layout">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Aparelhos da loja</h2>
              <p>Até 500 unidades mais recentes · indicadores desta lista</p>
            </div>
            <span className="badge">{filtered.length} unidades</span>
          </div>
          {filtered.length ? (
            <div className="table-wrap">
              <table className="store-unit-table">
                <thead>
                  <tr>
                    <th>Aparelho</th>
                    <th>IMEI / série</th>
                    <th>Condição</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((u) => (
                    <tr
                      key={u.id}
                      className={unit?.id === u.id ? "selected" : ""}
                    >
                      <td>
                        <button
                          className="store-unit-select"
                          aria-pressed={unit?.id === u.id}
                          onClick={() => setSelected(u.id)}
                        >
                          <ProductImage product={{ ...u, serialized: true }} />
                          <span>
                            <strong>{u.product_name}</strong>
                            <small>
                              {[u.capacity, u.color]
                                .filter(Boolean)
                                .join(" · ") || "Controle individual"}
                            </small>
                          </span>
                        </button>
                      </td>
                      <td className="mono">
                        {u.imeis[0]
                          ? "•••• " + u.imeis[0].slice(-4)
                          : u.serial || "—"}
                      </td>
                      <td>{conditions[u.condition]}</td>
                      <td>
                        <span
                          className={`store-status ${u.reserved ? "reserved" : u.status === "out" ? "muted" : ""}`}
                        >
                          {u.reserved
                            ? "Reservado"
                            : u.status === "in_stock"
                              ? "Disponível"
                              : "Fora do estoque"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="store-empty">
              <Smartphone size={35} />
              <h3>Nenhum aparelho nesta seleção</h3>
              <p>
                Cadastre um produto com controle individual e registre a entrada
                com IMEI ou série.
              </p>
            </div>
          )}
        </section>
        {unit && (
          <aside
            className="panel store-unit-detail"
            aria-label="Ficha do aparelho"
          >
            <div className="store-unit-hero">
              <ProductImage product={{ ...unit, serialized: true }} />
              <h2>{unit.product_name}</h2>
              <p>
                {[unit.capacity, unit.color, conditions[unit.condition]]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              <span
                className={`store-status ${unit.reserved ? "reserved" : unit.status === "out" ? "muted" : ""}`}
              >
                {unit.reserved
                  ? "Reservado"
                  : unit.status === "in_stock"
                    ? "Disponível"
                    : "Fora do estoque"}
              </span>
            </div>
            {editing ? (
              <form
                className="store-unit-edit"
                key={unit.id + "-" + unit.details_version}
                onSubmit={save}
              >
                <label>
                  Bateria (%)
                  <input
                    name="battery"
                    type="number"
                    min="0"
                    max="100"
                    defaultValue={unit.battery_health ?? ""}
                  />
                </label>
                <label>
                  Estado de conservação
                  <input
                    name="physical"
                    maxLength={300}
                    defaultValue={unit.physical_condition}
                  />
                </label>
                <label>
                  Localização
                  <input
                    name="location"
                    maxLength={180}
                    defaultValue={unit.location}
                  />
                </label>
                <label className="check-label">
                  <input
                    type="checkbox"
                    name="reserved"
                    defaultChecked={unit.reserved}
                    disabled={unit.status !== "in_stock"}
                  />{" "}
                  Reservar esta unidade
                </label>
                <p className="form-hint">
                  A reserva bloqueia a venda e a movimentação desta unidade até
                  ser liberada. Não cria cobrança nem vínculo com cliente.
                </p>
                <div className="store-detail-actions">
                  <button className="primary" disabled={busy}>
                    <Check size={16} /> Salvar ficha
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setEditing(false)}
                  >
                    Cancelar
                  </button>
                </div>
              </form>
            ) : (
              <>
                <dl className="store-unit-specs">
                  <div>
                    <dt>IMEI</dt>
                    <dd>{unit.imeis.join(" / ") || "Não informado"}</dd>
                  </div>
                  <div>
                    <dt>Série</dt>
                    <dd>{unit.serial || "Não informada"}</dd>
                  </div>
                  <div>
                    <dt>
                      <Battery size={14} /> Bateria
                    </dt>
                    <dd>
                      {unit.battery_health === null
                        ? "Não informada"
                        : `${unit.battery_health}%`}
                    </dd>
                  </div>
                  <div>
                    <dt>Estado</dt>
                    <dd>{unit.physical_condition || "Não informado"}</dd>
                  </div>
                  <div>
                    <dt>
                      <MapPin size={14} /> Localização
                    </dt>
                    <dd>{unit.location || "Não informada"}</dd>
                  </div>
                  <div>
                    <dt>Procedência</dt>
                    <dd>{unit.provenance}</dd>
                  </div>
                  {canCost && (
                    <div>
                      <dt>Custo individual</dt>
                      <dd>{brl(unit.acquisition_cost)}</dd>
                    </div>
                  )}
                  <div>
                    <dt>Preço de venda</dt>
                    <dd className="store-detail-price">{brl(unit.price)}</dd>
                  </div>
                </dl>
                <div className="store-detail-actions">
                  <button
                    className="secondary"
                    onClick={() => void loadHistory()}
                  >
                    <History size={16} /> Ver histórico
                  </button>
                  {canEdit && (
                    <button
                      className="primary"
                      onClick={() => setEditing(true)}
                    >
                      <Pencil size={16} /> Editar aparelho
                    </button>
                  )}
                </div>
              </>
            )}
            {history && historyUnitId === unit.id && (
              <div className="store-unit-history">
                <h3>Histórico da unidade</h3>
                <small>
                  Até 100 movimentações nas suas filiais autorizadas
                </small>
                {history.length ? (
                  history.map((h) => (
                    <article key={h.id}>
                      <strong>
                        {{
                          entry: "Entrada",
                          exit: "Saída",
                          adjustment: "Ajuste",
                          reversal: "Estorno",
                        }[h.type as string] || h.type}{" "}
                        · {new Date(h.created_at).toLocaleDateString("pt-BR")}
                      </strong>
                      <p>{h.reason}</p>
                    </article>
                  ))
                ) : (
                  <p>Nenhuma movimentação disponível.</p>
                )}
              </div>
            )}
          </aside>
        )}
      </div>
      <div className="store-service-note">
        <WrenchIcon />
        <span>
          <strong>Assistência técnica</strong>
          <small>
            Aparelhos de clientes ficam em controle separado, no módulo de
            assistência.
          </small>
        </span>
      </div>
    </div>
  );
}
function WrenchIcon() {
  return (
    <span className="store-alert-icon">
      <Wrench size={26} />
    </span>
  );
}

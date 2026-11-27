"use client";
import { useEffect, useId, useState } from "react";
import {
  ShoppingCart,
  CheckCircle2,
  Smartphone,
  Wrench,
  ChevronRight,
  Package,
  CalendarDays,
  ArrowUpRight,
} from "lucide-react";
import { ProductImage } from "./product-image";
import { formatCents } from "../shared/money";
type Row = Record<string, any>;
export default function StoreDashboard({
  branch,
  navigate,
}: {
  branch: string;
  navigate: (id: string, query?: string) => void;
}) {
  const [days, setDays] = useState("7"),
    [data, setData] = useState<Row | null>(null),
    [error, setError] = useState("");
  const gradient = "sales-" + useId().replace(/:/g, "");
  useEffect(() => {
    let alive = true;
    setData(null);
    setError("");
    fetch(`/api/dashboard?branch_id=${branch}&days=${days}`, {
      cache: "no-store",
    })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw Error(d.error);
        if (alive) setData(d);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [branch, days]);
  const values = (data?.evolution || []).map((p: Row) => Number(p.cents));
  const max = Math.max(100, ...values),
    min = Math.min(0, ...values),
    range = max - min;
  const points = values.map((v: number, i: number) => [
    52 + (i * 528) / Math.max(1, values.length - 1),
    190 - ((v - min) * 155) / range,
  ]);
  const path = points
    .map((p: number[], i: number) => `${i ? "L" : "M"}${p[0]},${p[1]}`)
    .join(" ");
  const metrics = [
    {
      label: "Vendas do dia",
      value: data?.sales ? formatCents(data.sales.net_cents) : "—",
      hint: "Valor líquido de vendas e devoluções de hoje",
      icon: ShoppingCart,
    },
    {
      label: "Vendas concluídas",
      value: data?.sales?.count ?? "—",
      hint: "Vendas de hoje com saldo não devolvido",
      icon: CheckCircle2,
    },
    {
      label: "Aparelhos disponíveis",
      value: data?.stock?.available ?? "—",
      hint: "Unidades em estoque, sem reserva",
      icon: Smartphone,
    },
    {
      label: "Serviços abertos",
      value: data?.services?.open ?? "—",
      hint: "Ordens em andamento na filial",
      icon: Wrench,
    },
  ];
  return (
    <div className="store-dashboard" aria-busy={!data && !error}>
      {error && (
        <p role="alert" className="store-inline-error">
          {error}
        </p>
      )}
      <div className="store-kpis">
        {metrics.map((m) => (
          <article className="store-kpi" key={m.label}>
            <span className="store-kpi-icon">
              <m.icon size={25} />
            </span>
            <div>
              <span>{m.label}</span>
              <strong>{m.value}</strong>
              <small>{m.hint}</small>
            </div>
          </article>
        ))}
      </div>
      <div className="store-dashboard-grid">
        <section className="panel store-chart">
          <div className="panel-heading">
            <div>
              <h2>Evolução das vendas</h2>
              <p>Vendas menos devoluções, pela data de cada operação</p>
            </div>
            <select
              aria-label="Período da evolução de vendas"
              value={days}
              onChange={(e) => setDays(e.target.value)}
            >
              <option value="7">Últimos 7 dias</option>
              <option value="30">Últimos 30 dias</option>
            </select>
          </div>
          {data?.sales ? (
            <>
              <svg
                viewBox="0 0 610 230"
                role="img"
                aria-label={`Evolução das vendas líquidas nos últimos ${days} dias`}
              >
                <defs>
                  <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#d2a329" stopOpacity=".35" />
                    <stop offset="100%" stopColor="#d2a329" stopOpacity=".02" />
                  </linearGradient>
                </defs>
                {[0, 1, 2, 3, 4].map((i) => (
                  <g key={i}>
                    <line
                      x1="52"
                      x2="580"
                      y1={35 + i * 38.75}
                      y2={35 + i * 38.75}
                      stroke="#eceef1"
                    />
                    <text
                      x="45"
                      y={39 + i * 38.75}
                      textAnchor="end"
                      fontSize="10"
                      fill="#858994"
                    >
                      {Math.round((max - (i * range) / 4) / 100).toLocaleString(
                        "pt-BR",
                      )}
                    </text>
                  </g>
                ))}
                {points.length > 0 && (
                  <>
                    <path
                      d={`${path} L580,190 L52,190 Z`}
                      fill={`url(#${gradient})`}
                    />
                    <path
                      d={path}
                      fill="none"
                      stroke="#bd901b"
                      strokeWidth="2.7"
                      strokeLinejoin="round"
                    />
                    {points.map((p: number[], i: number) => (
                      <g key={i}>
                        <circle
                          cx={p[0]}
                          cy={p[1]}
                          r={days === "7" ? 4 : 2}
                          fill="white"
                          stroke="#bd901b"
                          strokeWidth="2"
                        >
                          <title>
                            {data.evolution[i].day}: {formatCents(values[i])}
                          </title>
                        </circle>
                        {(days === "7" ||
                          i % 5 === 0 ||
                          i === points.length - 1) && (
                          <text
                            x={p[0]}
                            y="216"
                            textAnchor="middle"
                            fontSize="11"
                            fill="#747a85"
                          >
                            {data.evolution[i].day.slice(8)}/
                            {data.evolution[i].day.slice(5, 7)}
                          </text>
                        )}
                      </g>
                    ))}
                  </>
                )}
              </svg>
              <details className="store-chart-data">
                <summary>Ver valores por dia · R$</summary>
                <div>
                  {data.evolution.map((p: Row) => (
                    <p key={p.day}>
                      <span>{p.day.split("-").reverse().join("/")}</span>
                      <strong>{formatCents(p.cents)}</strong>
                    </p>
                  ))}
                </div>
              </details>
            </>
          ) : (
            <div className="store-empty">
              {data
                ? "Seu perfil não tem acesso aos indicadores de vendas."
                : error
                  ? "Indicadores indisponíveis. Atualize a página para tentar novamente."
                  : "Carregando indicadores…"}
            </div>
          )}
        </section>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Produtos em destaque</h2>
              <p>Produtos com maior saldo na filial</p>
            </div>
            <Package size={21} />
          </div>
          <div className="store-highlights">
            {data?.highlights?.length ? (
              data.highlights.map((p: Row) => (
                <button key={p.id} onClick={() => navigate("products", p.sku)}>
                  <ProductImage product={p} />
                  <span>
                    <strong>{p.name}</strong>
                    <small>
                      {p.quantity} em estoque ·{" "}
                      {Number(p.price).toLocaleString("pt-BR", {
                        style: "currency",
                        currency: "BRL",
                      })}
                    </small>
                  </span>
                  <span className="store-link">
                    Ver estoque <ChevronRight size={16} />
                  </span>
                </button>
              ))
            ) : (
              <p className="store-empty">
                Os produtos com saldo aparecerão aqui.
              </p>
            )}
          </div>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Vendas recentes</h2>
              <p>Últimas operações da filial</p>
            </div>
            {data?.sales && (
              <button className="text-button" onClick={() => navigate("pos")}>
                Abrir PDV <ArrowUpRight size={15} />
              </button>
            )}
          </div>
          {data?.recent?.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Venda / itens</th>
                    <th>Pagamento</th>
                    <th>Total</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent.map((s: Row) => (
                    <tr key={s.id}>
                      <td>
                        <strong title={s.receipt_code}>
                          {s.receipt_code.slice(0, 10)}
                        </strong>
                        <small>{s.items}</small>
                      </td>
                      <td>
                        {{
                          cash: "Dinheiro",
                          pix: "Pix",
                          debit: "Débito",
                          credit: "Crédito",
                        }[s.methods as string] ||
                          s.methods ||
                          "Crediário"}
                      </td>
                      <td>{formatCents(s.total_cents)}</td>
                      <td>
                        <span
                          className={`store-status ${["cancelled", "returned"].includes(s.status) ? "muted" : ""}`}
                        >
                          {
                            {
                              completed: "Concluída",
                              partial_return: "Devolução parcial",
                              returned: "Devolvida",
                              cancelled: "Cancelada",
                            }[s.status as string]
                          }
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="store-empty">
              {data?.sales
                ? "Nenhuma venda registrada ainda."
                : "Indicadores de vendas restritos ao perfil de gestão."}
            </p>
          )}
        </section>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Atenção hoje</h2>
              <p>O que precisa de acompanhamento</p>
            </div>
          </div>
          <div className="store-alerts">
            <button onClick={() => navigate("inventory")}>
              <span className="store-alert-icon gold">
                <Package size={22} />
              </span>
              <span>
                <strong>
                  {data?.stock?.low ?? "—"} produtos com estoque baixo
                </strong>
                <small>No mínimo definido ou abaixo dele</small>
              </span>
              <ChevronRight size={18} />
            </button>
            <button onClick={() => navigate("units")}>
              <span className="store-alert-icon blue">
                <CalendarDays size={22} />
              </span>
              <span>
                <strong>
                  {data?.stock?.reserved ?? "—"} aparelhos reservados
                </strong>
                <small>Reservas manuais de unidades em estoque</small>
              </span>
              <ChevronRight size={18} />
            </button>
            {data?.services && (
              <button onClick={() => navigate("repairs")}>
                <span className="store-alert-icon purple">
                  <Wrench size={22} />
                </span>
                <span>
                  <strong>
                    {data.services.ready} serviços prontos para retirada
                  </strong>
                  <small>Assistência técnica da filial</small>
                </span>
                <ChevronRight size={18} />
              </button>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

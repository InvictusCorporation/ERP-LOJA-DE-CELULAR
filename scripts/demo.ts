// Disposable demonstration only. Never opens the store's persistent database.
import { Database } from "../src/server/db";
import { createApp } from "../src/server/app";
import { randomUUID, randomBytes } from "node:crypto";
async function main() {
  if (
    process.env.NODE_ENV === "production" ||
    process.env.DB_MODE === "postgres"
  )
    throw Error(
      "Demonstração disponível somente em ambiente local temporário.",
    );
  process.env.APP_ORIGIN = "http://localhost:3020";
  process.env.FISCAL_ENCRYPTION_KEY = randomBytes(32).toString("hex");
  const db = new Database();
  await db.open("memory://");
  const app = await createApp(db);
  await app.listen(4000, "127.0.0.1");
  const close = async () => {
    await app.close();
    await db.close();
  };
  process.once("SIGINT", () => void close());
  process.once("SIGTERM", () => void close());
  let cookie = "",
    csrf = "";
  async function api(path: string, body?: unknown): Promise<any> {
    const r = await fetch("http://127.0.0.1:4000/api" + path, {
      method: body ? "POST" : "GET",
      headers: {
        origin: process.env.APP_ORIGIN!,
        "content-type": "application/json",
        ...(cookie ? { cookie } : {}),
        ...(csrf
          ? { "x-csrf-token": csrf, "idempotency-key": randomUUID() }
          : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const d = await r.json();
    if (!r.ok) throw Error(path + ": " + JSON.stringify(d));
    if (r.headers.getSetCookie().length)
      cookie = r.headers.getSetCookie()[0].split(";")[0];
    return d;
  }
  await api("/setup", {
    company: "DEMONSTRAÇÃO · Invictus Celulares",
    name: "Operador demonstração",
    email: "caixa@demo.local",
    password: "Demonstracao-Caixa-2026!",
    branch: "Loja Centro · Demonstração",
  });
  await api("/login", {
    email: "caixa@demo.local",
    password: "Demonstracao-Caixa-2026!",
  });
  const me = await api("/me");
  csrf = me.csrf;
  const branch = me.branches[0].id;
  const categories: Record<string, string> = {};
  for (const name of [
    "Smartphones",
    "Capas",
    "Carregadores",
    "Fones",
    "Proteção de tela",
    "Outros produtos",
  ])
    categories[name] = (await api("/catalog", { kind: "category", name })).id;
  const brand = (
    await api("/catalog", { kind: "brand", name: "Invictus Demo" })
  ).id;
  const products: any[] = [];
  for (const [
    name,
    sku,
    category,
    image,
    cost,
    price,
    quantity,
    serialized,
    color,
    capacity,
    condition,
  ] of [
    [
      "Smartphone 128 GB",
      "DEMO-001",
      "Smartphones",
      "phone-blue",
      1800,
      2590,
      3,
      true,
      "Azul",
      "128 GB",
      "refurbished",
    ],
    [
      "Smartphone 256 GB",
      "DEMO-002",
      "Smartphones",
      "phone-violet",
      2000,
      3190,
      2,
      true,
      "Violeta",
      "256 GB",
      "new",
    ],
    [
      "Capa transparente",
      "DEMO-003",
      "Capas",
      "case",
      12,
      49.9,
      24,
      false,
      "Transparente",
      "",
      "new",
    ],
    [
      "Carregador USB-C 20W",
      "DEMO-004",
      "Carregadores",
      "charger",
      35,
      89.9,
      18,
      false,
      "Branco",
      "",
      "new",
    ],
    [
      "Fone Bluetooth",
      "DEMO-005",
      "Fones",
      "earbuds",
      60,
      149.9,
      12,
      false,
      "Branco",
      "",
      "new",
    ],
    [
      "Película de proteção",
      "DEMO-006",
      "Proteção de tela",
      "screen",
      5,
      29.9,
      32,
      false,
      "",
      "",
      "new",
    ],
    [
      "Cabo USB-C 1 metro",
      "DEMO-007",
      "Outros produtos",
      "cable",
      10,
      29.9,
      20,
      false,
      "Branco",
      "",
      "new",
    ],
    [
      "Suporte veicular",
      "DEMO-008",
      "Outros produtos",
      "holder",
      18,
      49.9,
      3,
      false,
      "Grafite",
      "",
      "new",
    ],
  ] as const) {
    const p = await api("/products", {
      name,
      sku,
      barcode: "78900000000" + String(products.length + 11),
      category_id: categories[category],
      brand_id: serialized ? brand : null,
      image_data: `/catalog/${image}.svg`,
      condition,
      serialized,
      cost,
      price,
      warranty_days: 90,
      color,
      capacity,
    });
    products.push({ ...p, price });
    if (serialized) {
      for (let n = 0; n < quantity; n++)
        await api("/movements", {
          product_id: p.id,
          branch_id: branch,
          type: "entry",
          quantity: 1,
          reason: "Entrada fictícia da demonstração",
          device: {
            serial: `DEMO-${sku}-${n + 1}`,
            provenance: "Dados ilustrativos, sem aparelho real",
            acquisition_cost: cost,
          },
        });
    } else
      await api("/movements", {
        product_id: p.id,
        branch_id: branch,
        type: "entry",
        quantity,
        reason: "Estoque fictício da demonstração",
      });
  }
  const units = (await api("/units?branch_id=" + branch)).items;
  for (let n = 0; n < units.length; n++)
    await api(`/units/${units[n].id}/details`, {
      version: units[n].details_version,
      battery_health: units[n].condition === "refurbished" ? 91 : null,
      physical_condition:
        units[n].condition === "refurbished"
          ? "Excelente · avaliação demonstrativa"
          : "Novo, na embalagem",
      location: n % 2 ? "Vitrine 02" : "Vitrine 01",
      reserved: n === units.length - 1,
    });
  await fetch("http://127.0.0.1:4000/api/minimum", {
    method: "PUT",
    headers: {
      origin: process.env.APP_ORIGIN!,
      "content-type": "application/json",
      cookie,
      "x-csrf-token": csrf,
      "idempotency-key": randomUUID(),
    },
    body: JSON.stringify({
      product_id: products[7].id,
      branch_id: branch,
      minimum: 5,
    }),
  }).then(async (r) => {
    if (!r.ok) throw Error(await r.text());
  });
  const register = await api("/pos/registers", {
    branch_id: branch,
    name: "Caixa 01 · Demonstração",
  });
  const session = await api("/pos/open", {
    register_id: register.id,
    opening_cents: 10000,
  });
  for (const [index, quantity] of [
    [2, 2],
    [3, 1],
    [4, 1],
  ]) {
    const p = products[index];
    await api("/pos/sales", {
      session_id: session.id,
      items: [{ product_id: p.id, quantity }],
      expected_total_cents: Math.round(p.price * 100) * quantity,
      payments: [
        { method: "cash", amount_cents: Math.round(p.price * 100) * quantity },
      ],
    });
  }
  console.log(
    "Demonstração pronta em http://localhost:3020 — banco temporário, produtos e vendas fictícios.",
  );
}
main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

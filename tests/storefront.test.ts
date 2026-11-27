import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { Database } from "../src/server/db";
import { createApp } from "../src/server/app";
import { StorefrontService } from "../src/server/storefront";
import { InventoryService } from "../src/server/domain";
import { Identity } from "../src/server/security";

test("Telas da loja: fotos, categorias, indicadores, fichas e reserva com isolamento", async (t) => {
  const db = new Database();
  await db.open("memory://");
  const app = await createApp(db);
  await app.listen(0, "127.0.0.1");
  const base = await app.getUrl();
  let cookie = "",
    csrf = "";
  async function api(
    path: string,
    body?: unknown,
    method = body ? "POST" : "GET",
    key: string = randomUUID(),
  ) {
    const r = await fetch(base + "/api" + path, {
      method,
      headers: {
        origin: "http://localhost:3000",
        "content-type": "application/json",
        cookie,
        "x-csrf-token": csrf,
        "idempotency-key": key,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return {
      status: r.status,
      data: await r.json(),
      cookie: r.headers.getSetCookie()[0]?.split(";")[0],
    };
  }
  async function ok(
    path: string,
    body?: unknown,
    method?: string,
    key?: string,
  ) {
    const r = await api(path, body, method, key);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    return r.data;
  }
  try {
    for (const n of ["a", "b"])
      await ok("/setup", {
        company: "Loja " + n,
        name: "Responsável",
        email: `visual-${n}@test.local`,
        password: "Visual-Testing-2026!",
        branch: "Filial " + n,
      });
    const login = await api("/login", {
      email: "visual-a@test.local",
      password: "Visual-Testing-2026!",
    });
    cookie = login.cookie!;
    const me = await ok("/me");
    csrf = me.csrf;
    const branch = me.branches[0].id;
    const category = await ok("/catalog", {
      kind: "category",
      name: "Categoria livre",
    });
    const input = {
      name: "Produto visual",
      sku: "VIS-01",
      condition: "refurbished",
      serialized: true,
      cost: 10,
      price: 25,
      warranty_days: 90,
      category_id: category.id,
    };
    const p = await ok("/products", {
      ...input,
      image_data: "/catalog/phone-blue.svg",
    });
    await ok("/movements", {
      product_id: p.id,
      branch_id: branch,
      type: "entry",
      quantity: 1,
      reason: "Entrada de teste",
      device: {
        serial: "VISUAL-UNIT-1",
        provenance: "Teste",
        acquisition_cost: 10,
      },
    });
    const unit = (await ok("/units?branch_id=" + branch)).items[0];
    const details = {
      version: 1,
      battery_health: 91,
      physical_condition: "Excelente",
      location: "Vitrine 01",
      reserved: true,
    };
    await t.test(
      "imagem validada e categoria aplicada no servidor",
      async () => {
        assert.equal(
          (
            await api("/products", {
              ...input,
              sku: "BAD",
              image_data: "https://external.invalid/photo.jpg",
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await api("/products", {
              ...input,
              sku: "BAD",
              image_data: "data:image/svg+xml;base64,PHN2Zz4=",
            })
          ).status,
          400,
        );
        const photo =
          "data:image/png;base64," +
          (
            await sharp({
              create: {
                width: 40,
                height: 40,
                channels: 3,
                background: "#abc",
              },
            })
              .png()
              .toBuffer()
          ).toString("base64");
        await ok("/products", {
          ...input,
          sku: "PHOTO",
          serialized: false,
          image_data: photo,
          category_id: null,
        });
        const list = await ok(
          `/products?branch_id=${branch}&category_id=${category.id}`,
        );
        assert.equal(list.total, 1);
        assert.equal(list.items[0].image_data, "/catalog/phone-blue.svg");
        assert.equal(
          (await ok(`/products?branch_id=${branch}&q=VISUAL-UNIT-1`)).items[0]
            .id,
          p.id,
        );
        const image = (await ok(`/products?branch_id=${branch}&q=PHOTO`))
          .items[0].image_data;
        assert.match(image, /^data:image\/webp;base64,/);
      },
    );
    await t.test(
      "ficha tem versão, idempotência e validação de bateria",
      async () => {
        const key = randomUUID();
        await ok(`/units/${unit.id}/details`, details, "POST", key);
        await ok(`/units/${unit.id}/details`, details, "POST", key);
        assert.equal(
          (await api(`/units/${unit.id}/details`, details)).status,
          409,
        );
        assert.equal(
          (
            await api(`/units/${unit.id}/details`, {
              ...details,
              version: 2,
              battery_health: 101,
            })
          ).status,
          400,
        );
        assert.equal(
          (await ok("/units?branch_id=" + branch)).items[0].details_version,
          2,
        );
      },
    );
    let session: any;
    await t.test(
      "reserva reduz disponibilidade e bloqueia venda e movimentação",
      async () => {
        const product = (await ok(`/products?branch_id=${branch}&q=VIS-01`))
          .items[0];
        assert.equal(product.quantity, 1);
        assert.equal(product.available_quantity, 0);
        const register = await ok("/pos/registers", {
          branch_id: branch,
          name: "Caixa visual",
        });
        session = await ok("/pos/open", {
          register_id: register.id,
          opening_cents: 0,
        });
        const sale = {
          session_id: session.id,
          items: [{ product_id: p.id, unit_id: unit.id, quantity: 1 }],
          expected_total_cents: 2500,
          payments: [{ method: "cash", amount_cents: 2500 }],
        };
        assert.equal((await api("/pos/sales", sale)).status, 409);
        assert.equal(
          (
            await api("/movements", {
              product_id: p.id,
              branch_id: branch,
              type: "exit",
              quantity: 1,
              unit_id: unit.id,
              reason: "Teste de reserva",
            })
          ).status,
          409,
        );
        const dashboard = await ok("/dashboard?branch_id=" + branch);
        assert.equal(dashboard.stock.reserved, 1);
        assert.equal(dashboard.stock.available, 0);
        assert.equal(dashboard.sales.net_cents, "0");
        await ok(`/units/${unit.id}/details`, {
          ...details,
          version: 2,
          reserved: false,
        });
        await ok("/pos/sales", sale);
        const after = await ok("/dashboard?branch_id=" + branch);
        assert.equal(after.sales.net_cents, "2500");
        assert.equal(after.sales.count, 1);
        assert.equal(after.recent.length, 1);
        assert.equal(after.evolution.length, 7);
        assert.equal(
          (await api(`/units/${unit.id}/details`, { ...details, version: 3 }))
            .status,
          409,
        );
      },
    );
    await t.test(
      "ficha e indicadores respeitam filial, tenant e direitos",
      async () => {
        const store = new StorefrontService(db, new InventoryService(db));
        const identity = {
          tenant_id: me.tenant.id,
          user_id: me.user.id,
          branch_ids: [branch],
          role: "viewer",
          permission_grants: [],
          permission_denials: [],
        } as unknown as Identity;
        const dashboard = await store.dashboard(identity, branch, 7);
        assert.equal(dashboard.sales, null);
        assert.equal(dashboard.services, null);
        assert.deepEqual(dashboard.recent, []);
        await assert.rejects(
          () =>
            store.saveUnit(
              identity,
              unit.id,
              { ...details, version: 3, reserved: false },
              randomUUID(),
            ),
          /permissão/,
        );
        await assert.rejects(
          () => store.dashboard({ ...identity, branch_ids: [] }, branch, 7),
          /Filial/,
        );
        assert.equal((await ok(`/units/${unit.id}/history`)).items.length, 2);
        const b = await api("/login", {
          email: "visual-b@test.local",
          password: "Visual-Testing-2026!",
        });
        cookie = b.cookie!;
        const mb = await ok("/me");
        csrf = mb.csrf;
        assert.equal((await api(`/units/${unit.id}/history`)).status, 404);
        assert.equal((await api("/dashboard?branch_id=" + branch)).status, 403);
        assert.equal(
          (
            await ok(
              `/products?branch_id=${mb.branches[0].id}&category_id=${category.id}`,
            )
          ).total,
          0,
        );
      },
    );
  } finally {
    await app.close();
    await db.close();
  }
});

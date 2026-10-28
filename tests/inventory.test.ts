import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { PGlite } from "@electric-sql/pglite";
import { Database } from "../src/server/db";
import { InventoryService } from "../src/server/domain";
import { createApp } from "../src/server/app";
import { Identity, passwordHash } from "../src/server/security";

test("Módulo 1: API, transações e isolamento real em PostgreSQL embarcado", async (t) => {
  const db = new Database();
  await db.open("memory://");
  const app = await createApp(db);
  await app.listen(0, "127.0.0.1");
  const url = await app.getUrl();
  const inventory = new InventoryService(db);
  const clients: Record<string, { cookie: string; csrf: string; me: any }> = {};
  async function api(
    path: string,
    method = "GET",
    body?: unknown,
    who = "a",
    key = randomUUID(),
    extra: Record<string, string> = {},
  ) {
    const c = clients[who];
    const res = await fetch(`${url}/api${path}`, {
      method,
      headers: {
        origin: "http://localhost:3000",
        "content-type": "application/json",
        ...(c ? { cookie: c.cookie, "x-csrf-token": c.csrf } : {}),
        "idempotency-key": key,
        ...extra,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return {
      status: res.status,
      body: await res.json(),
      cookie: res.headers.get("set-cookie"),
    };
  }
  async function login(email: string, password: string, who: string) {
    const r = await api("/login", "POST", { email, password }, "none");
    assert.equal(r.status, 200, JSON.stringify(r.body));
    clients[who] = { cookie: r.cookie!.split(";")[0], csrf: "", me: null };
    const me = await api("/me", "GET", undefined, who);
    clients[who].csrf = me.body.csrf;
    clients[who].me = me.body;
    return me.body;
  }
  const password = "Testing-Secure-Stock-2026!";
  let a: any,
    b: any,
    product: string,
    phone: string,
    movement: string,
    unit: string;
  try {
    await t.test(
      "cria duas empresas vazias e autentica com sessão HttpOnly",
      async () => {
        for (const name of ["a", "b"])
          assert.equal(
            (
              await api(
                "/setup",
                "POST",
                {
                  company: `Empresa ${name}`,
                  name: `Owner ${name}`,
                  branch: "Matriz",
                  email: `${name}@test.local`,
                  password,
                },
                "none",
              )
            ).status,
            200,
          );
        a = await login("a@test.local", password, "a");
        b = await login("b@test.local", password, "b");
        assert.notEqual(a.tenant.id, b.tenant.id);
        const r = await api(`/overview?branch_id=${a.branches[0].id}`);
        assert.equal(r.body.metrics.units, 0);
        assert.equal(r.body.metrics.products, 0);
      },
    );
    await t.test(
      "rejeita origem, sessão, CSRF e entrada inválida",
      async () => {
        assert.equal(
          (await api("/products", "GET", undefined, "none")).status,
          401,
        );
        assert.equal(
          (
            await api("/catalog", "POST", {}, "a", randomUUID(), {
              "x-csrf-token": "invalid",
            })
          ).status,
          403,
        );
        assert.equal(
          (
            await api("/catalog", "POST", {}, "a", randomUUID(), {
              origin: "https://evil.test",
            })
          ).status,
          403,
        );
        assert.equal(
          (await api("/catalog", "POST", { kind: "category", name: "" }))
            .status,
          400,
        );
      },
    );
    await t.test(
      "cadastro persistente, validação de dinheiro e SKU único",
      async () => {
        const category = await api("/catalog", "POST", {
          kind: "category",
          name: "Acessórios",
        });
        assert.equal(category.status, 200);
        const body = {
          name: "Cabo USB-C",
          sku: "CABO-01",
          condition: "new",
          serialized: false,
          cost: 10,
          price: 25,
          warranty_days: 90,
          category_id: category.body.id,
        };
        const r = await api("/products", "POST", body);
        assert.equal(r.status, 200, JSON.stringify(r.body));
        product = r.body.id;
        assert.equal((await api("/products", "POST", body)).status, 409);
        assert.equal(
          (
            await api("/products", "POST", {
              ...body,
              sku: "OTHER",
              cost: 1.234,
            })
          ).status,
          400,
        );
        const list = await api(`/products?branch_id=${a.branches[0].id}`);
        assert.equal(list.body.items[0].sku, "CABO-01");
      },
    );
    await t.test(
      "isolamento de empresa, referências e permissões de filial",
      async () => {
        assert.equal(
          (await api(`/products?branch_id=${b.branches[0].id}`)).status,
          403,
        );
        const list = await api(
          `/products?branch_id=${b.branches[0].id}`,
          "GET",
          undefined,
          "b",
        );
        assert.equal(list.body.total, 0);
        const r = await api(
          "/movements",
          "POST",
          {
            product_id: product,
            branch_id: b.branches[0].id,
            type: "entry",
            quantity: 1,
            reason: "Tentativa cruzada",
          },
          "b",
        );
        assert.equal(r.status, 404);
        const isolated = await db.transaction(b.tenant.id, (tx) =>
          tx.query("SELECT * FROM products WHERE id=$1", [product]),
        );
        assert.equal(isolated.length, 0);
        await assert.rejects(
          db.transaction(b.tenant.id, (tx) =>
            tx.query(
              "INSERT INTO products(id,tenant_id,name,sku,condition,serialized,cost,price,warranty_days) VALUES($1,$2,'bad','bad','new',false,0,0,0) RETURNING id",
              [randomUUID(), a.tenant.id],
            ),
          ),
        );
      },
    );
    await t.test(
      "entrada idempotente, conflito de chave e saída concorrente sem saldo negativo",
      async () => {
        const body = {
          product_id: product,
          branch_id: a.branches[0].id,
          type: "entry",
          quantity: 5,
          reason: "Recebimento",
        };
        const key = randomUUID();
        const [r, s] = await Promise.all([
          api("/movements", "POST", body, "a", key),
          api("/movements", "POST", body, "a", key),
        ]);
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.equal(s.status, 200);
        assert.equal(r.body.id, s.body.id);
        movement = r.body.id;
        assert.equal(
          (await api("/movements", "POST", { ...body, quantity: 9 }, "a", key))
            .status,
          409,
        );
        const exits = await Promise.all([
          api("/movements", "POST", { ...body, type: "exit", quantity: 4 }),
          api("/movements", "POST", { ...body, type: "exit", quantity: 4 }),
        ]);
        assert.deepEqual(exits.map((r) => r.status).sort(), [200, 409]);
        const [stock] = await db.transaction(a.tenant.id, (tx) =>
          tx.query("SELECT quantity FROM stock_balances WHERE product_id=$1", [
            product,
          ]),
        );
        assert.equal(stock.quantity, 1);
      },
    );
    await t.test(
      "inventário com proteção de saldo antigo e estoque mínimo",
      async () => {
        const r = await api("/inventory", "POST", {
          product_id: product,
          branch_id: a.branches[0].id,
          expected: 1,
          counted: 3,
          reason: "Conferência física",
        });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.equal(r.body.balance, 3);
        assert.equal(
          (
            await api("/inventory", "POST", {
              product_id: product,
              branch_id: a.branches[0].id,
              expected: 1,
              counted: 0,
              reason: "Contagem antiga",
            })
          ).status,
          409,
        );
        assert.equal(
          (
            await api("/minimum", "PUT", {
              product_id: product,
              branch_id: a.branches[0].id,
              minimum: 5,
            })
          ).status,
          200,
        );
        const r2 = await api(`/overview?branch_id=${a.branches[0].id}`);
        assert.equal(r2.body.metrics.low, 1);
      },
    );
    await t.test(
      "aparelhos, dois IMEIs, procedência e duplicidade com rollback",
      async () => {
        const r = await api("/products", "POST", {
          name: "Aparelho teste",
          sku: "PHONE-01",
          condition: "used",
          serialized: true,
          cost: 1000,
          price: 1500,
          warranty_days: 90,
        });
        assert.equal(r.status, 200);
        phone = r.body.id;
        const body = {
          product_id: phone,
          branch_id: a.branches[0].id,
          type: "entry",
          quantity: 1,
          reason: "Compra usada",
          device: {
            imeis: ["490154203237518", "356938035643809"],
            serial: "SN-001",
            provenance: "Documento de aquisição TESTE-001",
            acquisition_cost: 1000,
          },
        };
        const entry = await api("/movements", "POST", body);
        assert.equal(entry.status, 200, JSON.stringify(entry.body));
        assert.equal(
          (
            await api("/movements", "POST", {
              ...body,
              device: { ...body.device, serial: "SN-002" },
            })
          ).status,
          409,
        );
        assert.equal(
          (
            await api("/movements", "POST", {
              ...body,
              device: {
                ...body.device,
                imeis: ["490154203237519"],
                serial: "SN-003",
              },
            })
          ).status,
          400,
        );
        const list = await api(
          `/units?branch_id=${a.branches[0].id}&product_id=${phone}`,
        );
        assert.equal(list.body.items.length, 1);
        unit = list.body.items[0].id;
        assert.equal(list.body.items[0].imeis.length, 2);
        const exit = await api("/movements", "POST", {
          product_id: phone,
          branch_id: a.branches[0].id,
          type: "exit",
          quantity: 1,
          unit_id: unit,
          reason: "Baixa autorizada",
        });
        assert.equal(exit.status, 200);
        const reverse = await api(
          `/movements/${exit.body.id}/reverse`,
          "POST",
          { reason: "Correção de baixa" },
        );
        assert.equal(reverse.status, 200, JSON.stringify(reverse.body));
        assert.equal(
          (
            await api(`/movements/${exit.body.id}/reverse`, "POST", {
              reason: "Repetição",
            })
          ).status,
          409,
        );
      },
    );
    await t.test(
      "perfis de leitura e estoquista não expõem custos e bloqueiam escrita indevida",
      async () => {
        for (const [role, who] of [
          ["viewer", "v"],
          ["stock", "s"],
        ]) {
          const r = await api("/users", "POST", {
            name: role,
            email: `${who}@test.local`,
            password,
            role,
            branch_ids: [a.branches[0].id],
          });
          assert.equal(r.status, 200);
          await login(`${who}@test.local`, password, who);
          const list = await api(
            `/products?branch_id=${a.branches[0].id}`,
            "GET",
            undefined,
            who,
          );
          assert.equal("cost" in list.body.items[0], false);
          const units = await api(
            `/units?branch_id=${a.branches[0].id}`,
            "GET",
            undefined,
            who,
          );
          assert.equal("acquisition_cost" in units.body.items[0], false);
          assert.equal(
            (
              await api(
                "/catalog",
                "POST",
                { kind: "brand", name: "Não autorizado" },
                who,
              )
            ).status,
            403,
          );
          assert.equal(
            (await api("/audit", "GET", undefined, who)).status,
            403,
          );
        }
        assert.equal(
          (
            await api(
              "/movements",
              "POST",
              {
                product_id: product,
                branch_id: a.branches[0].id,
                type: "entry",
                quantity: 1,
                reason: "Não autorizado",
              },
              "v",
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await api(
              "/inventory",
              "POST",
              {
                product_id: product,
                branch_id: a.branches[0].id,
                expected: 3,
                counted: 0,
                reason: "Não autorizado",
              },
              "s",
            )
          ).status,
          403,
        );
      },
    );
    await t.test(
      "saldo por filial, edição concorrente e arquivamento protegido",
      async () => {
        const branch = await api("/branches", "POST", { name: "Segunda loja" });
        assert.equal(branch.status, 200);
        await login("a@test.local", password, "a");
        const list = await api(`/products?branch_id=${branch.body.id}`);
        const item = list.body.items.find((p: any) => p.id === product);
        assert.equal(item.quantity, 0);
        const b = {
          name: item.name,
          sku: item.sku,
          condition: item.condition,
          serialized: item.serialized,
          cost: Number(item.cost),
          price: Number(item.price),
          warranty_days: item.warranty_days,
          version: item.version,
        };
        assert.equal((await api(`/products/${product}`, "PUT", b)).status, 200);
        assert.equal((await api(`/products/${product}`, "PUT", b)).status, 409);
        assert.equal(
          (await api(`/products/${product}`, "DELETE", {})).status,
          409,
        );
      },
    );
    await t.test(
      "auditoria e ledger não podem ser alterados pela role da aplicação",
      async () => {
        const events = await api("/audit");
        assert.ok(
          events.body.items.some((e: any) => e.action === "stock.entry"),
        );
        await assert.rejects(
          db.transaction(a.tenant.id, (tx) =>
            tx.query("DELETE FROM stock_movements WHERE id=$1 RETURNING id", [
              movement,
            ]),
          ),
        );
        await assert.rejects(
          db.transaction(a.tenant.id, (tx) =>
            tx.query("UPDATE audit_events SET action='tampered' RETURNING id"),
          ),
        );
      },
    );
    await t.test("sessão revogada deixa de acessar dados", async () => {
      assert.equal((await api("/logout", "POST", {}, "s")).status, 200);
      assert.equal((await api("/me", "GET", undefined, "s")).status, 401);
    });
  } finally {
    await app.close();
    await db.close();
  }
});

test("persistência e restauração de backup físico em diretório independente", async () => {
  const root = await mkdtemp(join(tmpdir(), "invictus-test-"));
  const dir = join(root, "original");
  const restored = join(root, "restored");
  let db = new Database();
  try {
    await db.open(dir);
    const service = new InventoryService(db);
    await service.bootstrap({
      company: "Persistência",
      name: "Owner",
      branch: "Loja",
      email: "persist@test.local",
      password: "Persistence-2026!",
    });
    const blob = await db.embedded!.dumpDataDir("gzip");
    await db.close();
    if (process.platform === "win32") await chmod(dir, 0o400);
    db = new Database();
    await db.open(dir);
    const second = new Database();
    await assert.rejects(second.open(dir), /já está aberto/);
    assert.equal(
      (await db.system<any>("SELECT name FROM tenants"))[0].name,
      "Persistência",
    );
    await db.close();
    const copy = new PGlite({ dataDir: restored, loadDataDir: blob });
    await copy.waitReady;
    assert.equal(
      (await copy.query<any>("SELECT name FROM tenants")).rows[0].name,
      "Persistência",
    );
    await copy.close();
  } finally {
    await db.close().catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});

test("recupera banco persistente após interrupção forçada de outro processo", async () => {
  const root = await mkdtemp(join(tmpdir(), "invictus-crash-"));
  const dir = join(root, "database");
  const fixture = `const {Database}=require(process.argv[1]);const {InventoryService}=require(process.argv[2]);(async()=>{const db=new Database();await db.open(process.argv[3]);await new InventoryService(db).bootstrap({company:'Recuperação após interrupção',name:'Owner',branch:'Matriz',email:'crash@test.local',password:'Crash-Test-2026!'});process.send('ready');})().catch(e=>{console.error(e.message);process.exit(1)});`;
  const child = spawn(
    process.execPath,
    [
      "-e",
      fixture,
      require.resolve("../src/server/db"),
      require.resolve("../src/server/domain"),
      dir,
    ],
    { stdio: ["ignore", "ignore", "pipe", "ipc"] },
  );
  const db = new Database();
  try {
    await Promise.race([
      once(child, "message"),
      once(child, "exit").then(() => {
        throw new Error("Processo de teste encerrou antes da gravação.");
      }),
    ]);
    const exited = once(child, "exit");
    child.kill("SIGKILL");
    await exited;
    await db.open(dir);
    const [tenant] = await db.system<any>("SELECT name FROM tenants");
    assert.equal(tenant.name, "Recuperação após interrupção");
  } finally {
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
    await db.close();
    await rm(root, { recursive: true, force: true });
  }
});

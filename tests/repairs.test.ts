import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { PGlite } from "@electric-sql/pglite";
import { Database } from "../src/server/db";
import { createApp } from "../src/server/app";

test("Assistência: atendimento, aprovação, peças, fotos, garantia e entrega segura", async (t) => {
  const db = new Database();
  await db.open("memory://");
  const app = await createApp(db);
  await app.listen(0, "127.0.0.1");
  const base = await app.getUrl();
  const clients: Record<string, any> = {};
  const password = "Repair-Testing-2026!";
  let a: any,
    b: any,
    tech: any,
    other: any,
    order: string,
    part: string,
    customerId: string,
    quoteId: string,
    quoteItem: string,
    issueId: string,
    photoId: string;
  async function api(
    path: string,
    method = "GET",
    body?: unknown,
    who = "a",
    key = randomUUID(),
  ) {
    const c = clients[who];
    const r = await fetch(base + "/api" + path, {
      method,
      headers: {
        origin: "http://localhost:3000",
        "content-type": "application/json",
        "idempotency-key": key,
        ...(c ? { cookie: c.cookie, "x-csrf-token": c.csrf } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const binary = r.headers.get("content-type")?.startsWith("image/");
    return {
      status: r.status,
      body: binary ? Buffer.from(await r.arrayBuffer()) : await r.json(),
      cookie: r.headers.get("set-cookie"),
      type: r.headers.get("content-type"),
    };
  }
  async function ok(
    path: string,
    method = "GET",
    body?: unknown,
    who = "a",
    key = randomUUID(),
  ) {
    const r = await api(path, method, body, who, key);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return r.body;
  }
  async function auth(who: string) {
    const r = await api(
      "/login",
      "POST",
      { email: `repair-${who}@test.local`, password },
      "none",
    );
    assert.equal(r.status, 200);
    clients[who] = { cookie: r.cookie!.split(";")[0] };
    const me = await ok("/me", "GET", undefined, who);
    clients[who].csrf = me.csrf;
    return me;
  }
  const detail = () => ok(`/repairs/${order}`);
  const version = async () => (await detail()).order.version;
  async function create(extra: Record<string, unknown> = {}) {
    return ok("/repairs", "POST", {
      branch_id: a.branches[0].id,
      customer: { name: "Cliente de teste", phone: "85999990000" },
      brand: "Marca teste",
      model: "Aparelho de teste",
      reported_fault: "Não carrega",
      physical_state: "Tela com riscos, carcaça íntegra",
      technician_id: tech.user.id,
      ...extra,
    });
  }
  const quoteBody = (v: number) => ({
    version: v,
    labor_price_cents: 10000,
    labor_cost_cents: 4000,
    items: [{ product_id: part, quantity: 2, unit_price_cents: 5000 }],
    warranty_days: 90,
    warranty_terms: "Garantia do reparo realizado",
    notes: "Proposta de teste",
  });
  const approvalBody = (v: number, q: string, decision = "approved") => ({
    version: v,
    quote_id: q,
    decision,
    customer_representative: "Cliente de teste",
    channel: "whatsapp",
    reference: "Confirmação manual TESTE-001",
  });
  try {
    await t.test(
      "prepara empresas, peças e perfis técnicos isolados",
      async () => {
        for (const who of ["a", "b"])
          await ok(
            "/setup",
            "POST",
            {
              company: `Assistência ${who}`,
              name: `Owner ${who}`,
              branch: "Matriz",
              email: `repair-${who}@test.local`,
              password,
            },
            "none",
          );
        a = await auth("a");
        b = await auth("b");
        for (const who of ["tech", "other"])
          await ok("/users", "POST", {
            name: `Técnico ${who}`,
            email: `repair-${who}@test.local`,
            password,
            role: "technician",
            branch_ids: [a.branches[0].id],
          });
        tech = await auth("tech");
        other = await auth("other");
        await ok("/users", "POST", {
          name: "Caixa",
          email: "repair-cash@test.local",
          password,
          role: "cashier",
          branch_ids: [a.branches[0].id],
        });
        await auth("cash");
        part = (
          await ok("/products", "POST", {
            name: "Conector de carga",
            sku: "REPAIR-PART",
            condition: "new",
            serialized: false,
            cost: 20,
            price: 50,
            warranty_days: 90,
          })
        ).id;
        await ok("/movements", "POST", {
          product_id: part,
          branch_id: a.branches[0].id,
          type: "entry",
          quantity: 3,
          reason: "Entrada para teste de assistência",
        });
      },
    );
    await t.test(
      "intake idempotente, IMEI ativo único e cliente sem duplicação no reenvio",
      async () => {
        const key = randomUUID();
        const body = {
          branch_id: a.branches[0].id,
          customer: { name: "Cliente principal", phone: "(85) 99999-0000" },
          brand: "Marca",
          model: "Modelo",
          imei: "490154203237518",
          serial: "SERIAL-REPAIR",
          reported_fault: "Falha na carga",
          physical_state: "Riscos na tela",
          accessories: "Capa",
          technician_id: tech.user.id,
        };
        const one = await ok("/repairs", "POST", body, "a", key);
        order = one.id;
        assert.equal((await ok("/repairs", "POST", body, "a", key)).id, order);
        assert.equal((await api("/repairs", "POST", body)).status, 409);
        assert.equal(
          (
            await api("/repairs", "POST", {
              ...body,
              imei: "490154203237519",
              serial: "OTHER",
            })
          ).status,
          400,
        );
        const d = await detail();
        customerId = d.order.customer_id;
        assert.equal(d.order.customer_phone, "85999990000");
        assert.equal((await ok("/repairs/customers")).items.length, 1);
      },
    );
    await t.test(
      "nega acesso cruzado, técnicos não atribuídos e perfis sem assistência",
      async () => {
        assert.equal(
          (await api(`/repairs/${order}`, "GET", undefined, "b")).status,
          404,
        );
        assert.equal(
          (await api(`/repairs/${order}`, "GET", undefined, "other")).status,
          403,
        );
        assert.equal(
          (await api(`/repairs/${order}`, "GET", undefined, "cash")).status,
          403,
        );
        assert.equal(
          (
            await ok(
              `/repairs?branch_id=${a.branches[0].id}`,
              "GET",
              undefined,
              "other",
            )
          ).total,
          0,
        );
        assert.equal(
          (
            await api(
              "/repairs/technicians?branch_id=" + a.branches[0].id,
              "GET",
              undefined,
              "tech",
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await api(
              `/repairs/${order}/info`,
              "POST",
              {
                version: await version(),
                technician_id: tech.user.id,
                due_on: null,
                intake_notes: "",
              },
              "tech",
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await db.transaction(b.tenant.id, (tx) =>
              tx.query("SELECT * FROM repair_orders"),
            )
          ).length,
          0,
        );
      },
    );
    await t.test(
      "diagnóstico concorrente usa versão e técnicos não aprovam orçamento",
      async () => {
        const v = await version();
        await ok(
          `/repairs/${order}/diagnosis`,
          "POST",
          {
            version: v,
            diagnosis: "Conector danificado, testes de alimentação realizados",
          },
          "tech",
        );
        assert.equal(
          (
            await api(
              `/repairs/${order}/diagnosis`,
              "POST",
              { version: v, diagnosis: "Alteração antiga" },
              "tech",
            )
          ).status,
          409,
        );
        assert.equal(
          (
            await api(
              `/repairs/${order}/quote`,
              "POST",
              quoteBody(await version()),
              "tech",
            )
          ).status,
          403,
        );
      },
    );
    await t.test(
      "fotos são reprocessadas, privadas e idempotentes; arquivos inválidos são recusados",
      async () => {
        const png = await sharp({
          create: { width: 8, height: 8, channels: 3, background: "#334455" },
        })
          .withExif({ IFD0: { Artist: "Metadado privado de teste" } })
          .png()
          .toBuffer();
        assert.ok((await sharp(png).metadata()).exif);
        const body = {
            filename: "aparelho-teste.png",
            data: png.toString("base64"),
          },
          key = randomUUID();
        const p = await ok(
          `/repairs/${order}/photos`,
          "POST",
          body,
          "tech",
          key,
        );
        photoId = p.id;
        assert.equal(
          (await ok(`/repairs/${order}/photos`, "POST", body, "tech", key)).id,
          p.id,
        );
        const photo = await api(`/repairs/${order}/photos/${p.id}`);
        assert.equal(photo.type, "image/jpeg");
        assert.equal(photo.body[0], 255);
        assert.equal(photo.body[1], 216);
        assert.equal((await sharp(photo.body).metadata()).exif, undefined);
        assert.equal(
          (
            await api(
              `/repairs/${order}/photos`,
              "POST",
              { filename: "test.jpg", data: "AAAA" },
              "other",
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await api(
              `/repairs/${order}/photos/${p.id}`,
              "GET",
              undefined,
              "none",
            )
          ).status,
          401,
        );
        assert.equal(
          (await api(`/repairs/${order}/photos/${p.id}`, "GET", undefined, "b"))
            .status,
          404,
        );
        assert.equal(
          (
            await api(
              `/repairs/${order}/photos/${p.id}`,
              "GET",
              undefined,
              "other",
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await api(`/repairs/${order}/photos`, "POST", {
              filename: "unsafe.svg",
              data: Buffer.from(
                '<svg xmlns="http://www.w3.org/2000/svg"><script>x</script></svg>',
              ).toString("base64"),
            })
          ).status,
          400,
        );
        assert.equal((await detail()).photos.length, 1);
        const dump = await db.embedded!.dumpDataDir("gzip"),
          copy = new PGlite({ loadDataDir: dump });
        await copy.waitReady;
        assert.equal(
          (
            await copy.query<any>(
              "SELECT count(*)::int AS n FROM repair_photos",
            )
          ).rows[0].n,
          1,
        );
        assert.equal(
          (
            await copy.query<any>(
              "SELECT octet_length(data)::int AS n FROM repair_photos",
            )
          ).rows[0].n,
          photo.body.length,
        );
        await copy.close();
      },
    );
    await t.test(
      "orçamento e aprovação são explícitos antes da baixa de peças",
      async () => {
        const q = await ok(
          `/repairs/${order}/quote`,
          "POST",
          quoteBody(await version()),
        );
        quoteId = q.id;
        assert.equal(q.total_cents, 20000);
        const d = await detail();
        quoteItem = d.items[0].id;
        assert.equal(
          (
            await api(
              `/repairs/${order}/parts`,
              "POST",
              {
                version: d.order.version,
                kind: "issue",
                quote_item_id: quoteItem,
                quantity: 1,
                reason: "Antes da aprovação",
              },
              "tech",
            )
          ).status,
          409,
        );
        assert.equal(
          (
            await api(
              `/repairs/${order}/approval`,
              "POST",
              approvalBody(await version(), quoteId),
              "tech",
            )
          ).status,
          403,
        );
        await ok(
          `/repairs/${order}/approval`,
          "POST",
          approvalBody(await version(), quoteId),
        );
        assert.equal(
          (
            await api(
              `/repairs/${order}/approval`,
              "POST",
              approvalBody(await version(), quoteId),
            )
          ).status,
          409,
        );
      },
    );
    await t.test(
      "consumo é transacional e idempotente, com limite e retorno rastreado",
      async () => {
        const key = randomUUID(),
          body = {
            version: await version(),
            kind: "issue",
            quote_item_id: quoteItem,
            quantity: 2,
            reason: "Peças utilizadas no diagnóstico aprovado",
          };
        const p = await ok(
          `/repairs/${order}/parts`,
          "POST",
          body,
          "tech",
          key,
        );
        issueId = p.id;
        assert.equal(
          (await ok(`/repairs/${order}/parts`, "POST", body, "tech", key)).id,
          p.id,
        );
        assert.equal(
          (await ok(`/products?branch_id=${a.branches[0].id}&q=REPAIR-PART`))
            .items[0].quantity,
          1,
        );
        assert.equal(
          (
            await api(
              `/repairs/${order}/parts`,
              "POST",
              { ...body, version: await version(), quantity: 1 },
              "tech",
            )
          ).status,
          409,
        );
        assert.equal(
          (
            await api(
              `/repairs/${order}/quote`,
              "POST",
              quoteBody(await version()),
            )
          ).status,
          409,
        );
        assert.equal(
          (
            await api(`/repairs/${order}/cancel`, "POST", {
              version: await version(),
              reason: "Tentativa com peças utilizadas",
            })
          ).status,
          409,
        );
        const moves = await ok(
          `/movements?branch_id=${a.branches[0].id}&product_id=${part}`,
        );
        const m = moves.items.find((x: any) => x.repair_part_event_id);
        assert.equal(
          (
            await api(`/movements/${m.id}/reverse`, "POST", {
              reason: "Contornar a ordem",
            })
          ).status,
          409,
        );
        await ok(
          `/repairs/${order}/parts`,
          "POST",
          {
            version: await version(),
            kind: "return",
            issue_id: issueId,
            quantity: 2,
            reason: "Peças devolvidas para revisar orçamento",
          },
          "tech",
        );
        assert.equal(
          (
            await api(
              `/repairs/${order}/parts`,
              "POST",
              {
                version: await version(),
                kind: "return",
                issue_id: issueId,
                quantity: 1,
                reason: "Devolução duplicada",
              },
              "tech",
            )
          ).status,
          409,
        );
      },
    );
    await t.test(
      "revisão exige nova resposta e recusa impede execução",
      async () => {
        const next = await ok(
          `/repairs/${order}/quote`,
          "POST",
          quoteBody(await version()),
        );
        assert.equal(
          (
            await api(
              `/repairs/${order}/approval`,
              "POST",
              approvalBody(await version(), quoteId),
            )
          ).status,
          409,
        );
        await ok(
          `/repairs/${order}/approval`,
          "POST",
          approvalBody(await version(), next.id, "declined"),
        );
        assert.equal(
          (
            await api(
              `/repairs/${order}/work`,
              "POST",
              { version: await version(), action: "start" },
              "tech",
            )
          ).status,
          409,
        );
        const last = await ok(
          `/repairs/${order}/quote`,
          "POST",
          quoteBody(await version()),
        );
        quoteId = last.id;
        await ok(
          `/repairs/${order}/approval`,
          "POST",
          approvalBody(await version(), quoteId),
        );
        const d = await detail();
        quoteItem = d.items.find((x: any) => x.quote_id === quoteId).id;
        const p = await ok(
          `/repairs/${order}/parts`,
          "POST",
          {
            version: await version(),
            kind: "issue",
            quote_item_id: quoteItem,
            quantity: 1,
            reason: "Uma peça efetivamente necessária",
          },
          "tech",
        );
        issueId = p.id;
        const after = await detail();
        assert.equal(after.totals.actual_cents, 15000);
        assert.equal(after.totals.cost_cents, 6000);
        assert.equal(after.totals.margin_cents, 9000);
        const hidden = await ok(`/repairs/${order}`, "GET", undefined, "tech");
        assert.equal("cost_cents" in hidden.totals, false);
        assert.equal("labor_cost_cents" in hidden.quotes[0], false);
        assert.equal("unit_cost_cents" in hidden.parts[0], false);
        assert.equal("unit_cost_cents" in hidden.items[0], false);
      },
    );
    await t.test(
      "conclusão, entrega e garantia preservam documento e encerram alterações",
      async () => {
        assert.equal(
          (
            await api(`/repairs/${order}/delivery`, "POST", {
              version: await version(),
              receiver_name: "Cliente",
              notes: "",
              confirmed: true,
            })
          ).status,
          409,
        );
        await ok(
          `/repairs/${order}/work`,
          "POST",
          {
            version: await version(),
            action: "finish",
            work_report: "Conector substituído, carga e transferência testadas",
          },
          "tech",
        );
        assert.equal(
          (
            await api(`/repairs/${order}/delivery`, "POST", {
              version: await version(),
              receiver_name: "Cliente",
              confirmed: false,
            })
          ).status,
          400,
        );
        const key = randomUUID(),
          body = {
            version: await version(),
            receiver_name: "Cliente de teste",
            notes: "Aparelho conferido na retirada",
            confirmed: true,
          };
        await ok(`/repairs/${order}/delivery`, "POST", body, "a", key);
        await ok(`/repairs/${order}/delivery`, "POST", body, "a", key);
        const d = await detail();
        assert.equal(d.order.status, "delivered");
        assert.match(d.order.warranty_expires_on, /^\d{4}-\d{2}-\d{2}$/);
        assert.equal(d.order.delivery_outcome, "ready");
        const [days] = await db.transaction(a.tenant.id, (tx) =>
          tx.query(
            "SELECT warranty_expires_on-(delivered_at AT TIME ZONE 'America/Fortaleza')::date AS days FROM repair_orders WHERE id=$1",
            [order],
          ),
        );
        assert.equal(days.days, 90);
        assert.equal(
          (
            await api(
              `/repairs/${order}/diagnosis`,
              "POST",
              { version: d.order.version, diagnosis: "Modificar histórico" },
              "tech",
            )
          ).status,
          409,
        );
        assert.equal(
          (
            await api(
              `/repairs/${order}/parts`,
              "POST",
              {
                version: d.order.version,
                kind: "return",
                issue_id: issueId,
                quantity: 1,
                reason: "Alterar entrega",
              },
              "tech",
            )
          ).status,
          409,
        );
      },
    );
    await t.test(
      "histórico do aparelho e cliente são reutilizados, cancelamento mantém controle de retirada",
      async () => {
        const r = await create({
          customer: undefined,
          customer_id: customerId,
          imei: "490154203237518",
          serial: "SERIAL-REPAIR",
        });
        const d = await ok(`/repairs/${r.id}`);
        assert.equal(d.device_history[0].id, order);
        assert.equal((await ok("/repairs/customers")).items.length, 1);
        await ok(`/repairs/${r.id}/cancel`, "POST", {
          version: d.order.version,
          reason: "Cliente desistiu antes da avaliação",
        });
        assert.equal(
          (
            await api("/repairs", "POST", {
              branch_id: a.branches[0].id,
              customer_id: customerId,
              brand: "Marca",
              model: "Modelo",
              imei: "490154203237518",
              reported_fault: "Outro teste",
              physical_state: "Íntegro",
            })
          ).status,
          409,
        );
        const cancelled = await ok(`/repairs/${r.id}`);
        await ok(`/repairs/${r.id}/delivery`, "POST", {
          version: cancelled.order.version,
          receiver_name: "Cliente",
          confirmed: true,
        });
        const delivered = await ok(`/repairs/${r.id}`);
        assert.equal(delivered.order.warranty_days, 0);
        assert.equal(delivered.order.warranty_expires_on, null);
        assert.equal(delivered.totals.actual_cents, 0);
      },
    );
    await t.test(
      "duas ordens não consomem simultaneamente a última peça",
      async () => {
        const stock = (
          await ok(`/products?branch_id=${a.branches[0].id}&q=REPAIR-PART`)
        ).items[0];
        await ok("/inventory", "POST", {
          product_id: part,
          branch_id: a.branches[0].id,
          expected: stock.quantity,
          counted: 1,
          reason: "Saldo controlado para teste concorrente",
        });
        const orders = [];
        for (const serial of ["CONCURRENT-A", "CONCURRENT-B"]) {
          const r = await create({
            customer: undefined,
            customer_id: customerId,
            serial,
          });
          let d = await ok(`/repairs/${r.id}`);
          await ok(`/repairs/${r.id}/diagnosis`, "POST", {
            version: d.order.version,
            diagnosis: "Peça necessária após diagnóstico",
          });
          d = await ok(`/repairs/${r.id}`);
          const q = await ok(`/repairs/${r.id}/quote`, "POST", {
            ...quoteBody(d.order.version),
            items: [{ product_id: part, quantity: 1, unit_price_cents: 5000 }],
          });
          d = await ok(`/repairs/${r.id}`);
          await ok(
            `/repairs/${r.id}/approval`,
            "POST",
            approvalBody(d.order.version, q.id),
          );
          d = await ok(`/repairs/${r.id}`);
          orders.push({
            id: r.id,
            version: d.order.version,
            item: d.items[0].id,
          });
        }
        const results = await Promise.all(
          orders.map((o) =>
            api(
              `/repairs/${o.id}/parts`,
              "POST",
              {
                version: o.version,
                kind: "issue",
                quote_item_id: o.item,
                quantity: 1,
                reason: "Disputa da última peça",
              },
              "tech",
            ),
          ),
        );
        assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
        assert.equal(
          (await ok(`/products?branch_id=${a.branches[0].id}&q=REPAIR-PART`))
            .items[0].quantity,
          0,
        );
      },
    );
    await t.test(
      "documentos, aprovações e movimentos são imutáveis na role de execução",
      async () => {
        await assert.rejects(
          db.transaction(a.tenant.id, (tx) =>
            tx.query(
              "UPDATE repair_approvals SET decision='declined' RETURNING id",
            ),
          ),
        );
        await assert.rejects(
          db.transaction(a.tenant.id, (tx) =>
            tx.query("DELETE FROM repair_part_events RETURNING id"),
          ),
        );
        await assert.rejects(
          db.transaction(a.tenant.id, (tx) =>
            tx.query("DELETE FROM repair_photos RETURNING id"),
          ),
        );
        const d = await detail();
        assert.ok(d.timeline.some((e: any) => e.action === "delivered"));
        assert.equal(d.approvals.length, 3);
        assert.equal(d.quotes.length, 3);
        assert.equal(d.photos[0].id, photoId);
      },
    );
  } finally {
    await app.close();
    await db.close();
  }
});

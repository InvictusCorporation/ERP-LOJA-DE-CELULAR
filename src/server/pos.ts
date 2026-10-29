import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Database, Tx } from "./db";
import {
  InventoryService,
  validate,
  uuid,
  permit,
  branchAccess,
  fail,
  audit,
} from "./domain";
import { Identity, permissions } from "./security";
import { toCents } from "../shared/money";

const amount = z.number().int().min(0).max(1000000000);
const reason = z.string().trim().min(3).max(1000);
const method = z.enum(["cash", "pix", "debit", "credit"]);
const payment = z
  .object({
    method,
    amount_cents: amount.refine((n) => n > 0),
    reference: z.string().trim().max(120).default(""),
  })
  .strict();
const checkoutSchema = z
  .object({
    session_id: uuid,
    customer_id: uuid.optional(),
    items: z
      .array(
        z
          .object({
            product_id: uuid,
            quantity: z.number().int().min(1).max(10000),
            unit_id: uuid.optional(),
          })
          .strict(),
      )
      .min(1)
      .max(100),
    discount_cents: amount.default(0),
    expected_total_cents: amount,
    payments: z.array(payment).min(1).max(4),
    note: z.string().trim().max(1000).default(""),
  })
  .strict();
const refundSchema = z
  .object({
    session_id: uuid,
    kind: z.enum(["return", "cancel"]),
    items: z
      .array(
        z
          .object({
            sale_item_id: uuid,
            quantity: z.number().int().min(1).max(10000),
          })
          .strict(),
      )
      .min(1)
      .max(100),
    payments: z.array(payment).max(4),
    reason,
  })
  .strict();
function unique(values: string[], message: string) {
  if (new Set(values).size !== values.length) fail(400, message);
}
function price(value: unknown) {
  try {
    return toCents(value);
  } catch {
    fail(400, "Preço fora do limite do PDV (R$ 10 milhões por operação).");
  }
}
export function distributeDiscount(discount: number, values: number[]) {
  const total = values.reduce((a, b) => a + b, 0);
  if (!total) return values.map(() => 0);
  const rows = values.map((n, index) => {
    const product = BigInt(n) * BigInt(discount);
    return {
      index,
      value: Number(product / BigInt(total)),
      remainder: product % BigInt(total),
    };
  });
  let residual = discount - rows.reduce((n, r) => n + r.value, 0);
  for (const row of [...rows].sort((a, b) =>
    a.remainder > b.remainder
      ? -1
      : a.remainder < b.remainder
        ? 1
        : a.index - b.index,
  ))
    if (residual > 0) {
      row.value++;
      residual--;
    }
  return rows.map((r) => r.value);
}
export class PosService {
  constructor(
    private db: Database,
    private inventory: InventoryService,
  ) {}
  private canManage(i: Identity) {
    return permissions(i.role).includes("pos_manage");
  }
  private async session(tx: Tx, i: Identity, id: string, own = false) {
    const [s] = await tx.query(
      "SELECT * FROM cash_sessions WHERE id=$1 FOR UPDATE",
      [id],
    );
    if (!s) fail(404, "Sessão de caixa não encontrada.");
    branchAccess(i, s.branch_id);
    if (s.status !== "open") fail(409, "O caixa está fechado.");
    if (s.operator_id !== i.user_id && (own || !this.canManage(i)))
      fail(403, "Este caixa está sob responsabilidade de outro operador.");
    return s;
  }
  private async balance(tx: Tx, sessionId: string) {
    const [r] = await tx.query(
      "SELECT coalesce(sum(amount_cents),0)::text AS amount FROM cash_entries WHERE session_id=$1",
      [sessionId],
    );
    return Number(r.amount);
  }
  private async cash(
    tx: Tx,
    i: Identity,
    s: any,
    type: string,
    value: number,
    text: string,
    sale: string | null = null,
    returned: string | null = null,
  ) {
    await tx.query(
      "INSERT INTO cash_entries(id,tenant_id,branch_id,session_id,actor_id,type,amount_cents,reason,sale_id,return_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id",
      [
        randomUUID(),
        i.tenant_id,
        s.branch_id,
        s.id,
        i.user_id,
        type,
        value,
        text,
        sale,
        returned,
      ],
    );
  }
  async state(i: Identity, branch: string, register?: string) {
    permit(i, "pos_read");
    branchAccess(i, branch);
    if (register) validate(uuid, register);
    return this.db.transaction(i.tenant_id, async (tx) => {
      const registers = await tx.query(
        "SELECT id,name FROM pos_registers WHERE branch_id=$1 AND active ORDER BY name",
        [branch],
      );
      if (register && !registers.some((r) => r.id === register))
        fail(404, "Caixa não encontrado nesta filial.");
      const [own] = await tx.query(
        "SELECT register_id FROM cash_sessions WHERE branch_id=$1 AND operator_id=$2 AND status='open'",
        [branch, i.user_id],
      );
      const active =
        registers.find((r) => r.id === register) ||
        registers.find((r) => r.id === own?.register_id) ||
        registers[0];
      const [s] = active
        ? await tx.query(
            "SELECT c.*,u.name AS operator_name FROM cash_sessions c JOIN users u ON u.id=c.operator_id WHERE c.register_id=$1 AND c.status='open'",
            [active.id],
          )
        : [];
      if (s && s.operator_id !== i.user_id && !this.canManage(i))
        return {
          registers,
          register_id: active?.id,
          session: null,
          occupied: true,
          operator_name: s.operator_name,
        };
      if (!s)
        return {
          registers,
          register_id: active?.id,
          session: null,
          occupied: false,
        };
      const totals = await tx.query(
        `SELECT method,sum(amount_cents)::text AS amount_cents FROM (
     SELECT p.method,p.amount_cents FROM pos_sale_payments p JOIN pos_sales v ON v.id=p.sale_id WHERE v.session_id=$1
     UNION ALL SELECT p.method,-p.amount_cents FROM pos_refund_payments p JOIN pos_returns r ON r.id=p.return_id WHERE r.session_id=$1
   ) v GROUP BY method`,
        [s.id],
      );
      return {
        registers,
        register_id: active.id,
        session: {
          ...s,
          expected_cents: await this.balance(tx, s.id),
          own: s.operator_id === i.user_id,
        },
        totals,
        entries: await tx.query(
          "SELECT e.*,u.name AS actor_name FROM cash_entries e JOIN users u ON u.id=e.actor_id WHERE e.session_id=$1 ORDER BY e.created_at DESC,e.id DESC LIMIT 100",
          [s.id],
        ),
      };
    });
  }
  async register(i: Identity, body: unknown, key: unknown) {
    permit(i, "pos_manage");
    const b = validate(
      z
        .object({ branch_id: uuid, name: z.string().trim().min(1).max(100) })
        .strict(),
      body,
    );
    branchAccess(i, b.branch_id);
    return this.inventory.write(
      i,
      key,
      { action: "pos.register", b },
      async (tx) => {
        const id = randomUUID();
        await tx.query(
          "INSERT INTO pos_registers(id,tenant_id,branch_id,name) VALUES($1,$2,$3,$4) RETURNING id",
          [id, i.tenant_id, b.branch_id, b.name],
        );
        await audit(
          tx,
          i,
          "pos.register.created",
          id,
          { name: b.name },
          b.branch_id,
        );
        return { id };
      },
    );
  }
  async open(i: Identity, body: unknown, key: unknown) {
    permit(i, "pos_cash");
    const b = validate(
      z.object({ register_id: uuid, opening_cents: amount }).strict(),
      body,
    );
    return this.inventory.write(
      i,
      key,
      { action: "pos.open", b },
      async (tx) => {
        const [r] = await tx.query(
          "SELECT * FROM pos_registers WHERE id=$1 AND active FOR UPDATE",
          [b.register_id],
        );
        if (!r) fail(404, "Caixa não encontrado.");
        branchAccess(i, r.branch_id);
        const [existing] = await tx.query(
          "SELECT id FROM cash_sessions WHERE status='open' AND (register_id=$1 OR (branch_id=$2 AND operator_id=$3))",
          [r.id, r.branch_id, i.user_id],
        );
        if (existing)
          fail(
            409,
            "O caixa ou o operador já possui uma sessão aberta nesta filial.",
          );
        const id = randomUUID();
        await tx.query(
          "INSERT INTO cash_sessions(id,tenant_id,branch_id,register_id,operator_id,status,opening_cents) VALUES($1,$2,$3,$4,$5,'open',$6) RETURNING id",
          [id, i.tenant_id, r.branch_id, r.id, i.user_id, b.opening_cents],
        );
        await this.cash(
          tx,
          i,
          { id, branch_id: r.branch_id },
          "opening",
          b.opening_cents,
          "Saldo inicial",
        );
        await audit(
          tx,
          i,
          "pos.cash.opened",
          id,
          { opening_cents: b.opening_cents },
          r.branch_id,
        );
        return { id };
      },
    );
  }
  async cashOperation(i: Identity, body: unknown, key: unknown) {
    permit(i, "pos_cash");
    const b = validate(
      z
        .object({
          session_id: uuid,
          type: z.enum(["supply", "withdrawal"]),
          amount_cents: amount.refine((n) => n > 0),
          reason,
        })
        .strict(),
      body,
    );
    return this.inventory.write(
      i,
      key,
      { action: "pos.cash.operation", b },
      async (tx) => {
        const s = await this.session(tx, i, b.session_id);
        const sign = b.type === "supply" ? 1 : -1;
        if ((await this.balance(tx, s.id)) + b.amount_cents * sign < 0)
          fail(409, "Dinheiro em caixa insuficiente para a sangria.");
        await this.cash(tx, i, s, b.type, b.amount_cents * sign, b.reason);
        await audit(tx, i, `pos.cash.${b.type}`, s.id, b, s.branch_id);
        return { ok: true };
      },
    );
  }
  async close(i: Identity, body: unknown, key: unknown) {
    permit(i, "pos_cash");
    const b = validate(
      z
        .object({
          session_id: uuid,
          counted_cents: amount,
          note: z.string().trim().max(1000).default(""),
        })
        .strict(),
      body,
    );
    return this.inventory.write(
      i,
      key,
      { action: "pos.close", b },
      async (tx) => {
        const s = await this.session(tx, i, b.session_id);
        const expected = await this.balance(tx, s.id),
          difference = b.counted_cents - expected;
        if (difference !== 0 && b.note.length < 3)
          fail(
            400,
            "Justifique a diferença entre o valor contado e o esperado.",
          );
        await tx.query(
          "UPDATE cash_sessions SET status='closed',counted_cents=$1,expected_cents=$2,difference_cents=$3,closing_note=$4,closed_by=$5,closed_at=now() WHERE id=$6 RETURNING id",
          [b.counted_cents, expected, difference, b.note, i.user_id, s.id],
        );
        await audit(
          tx,
          i,
          "pos.cash.closed",
          s.id,
          {
            expected_cents: expected,
            counted_cents: b.counted_cents,
            difference_cents: difference,
            note: b.note,
          },
          s.branch_id,
        );
        return {
          id: s.id,
          expected_cents: expected,
          counted_cents: b.counted_cents,
          difference_cents: difference,
        };
      },
    );
  }
  async checkout(i: Identity, body: unknown, key: unknown) {
    permit(i, "pos_sell");
    const b = validate(checkoutSchema, body);
    if (b.discount_cents) permit(i, "pos_discount");
    unique(
      b.items.map((x) => `${x.product_id}:${x.unit_id || "bulk"}`),
      "Agrupe os produtos repetidos no carrinho.",
    );
    unique(
      b.items.flatMap((x) => (x.unit_id ? [x.unit_id] : [])),
      "O aparelho foi informado mais de uma vez.",
    );
    unique(
      b.payments.map((p) => p.method),
      "Use apenas uma linha por forma de pagamento.",
    );
    for (const p of b.payments)
      if (p.method !== "cash" && !p.reference)
        fail(400, "Informe a referência externa dos pagamentos Pix e cartão.");
    return this.inventory.write(
      i,
      key,
      { action: "pos.checkout", b },
      async (tx) => {
        const s = await this.session(tx, i, b.session_id, true);
        let customerName = "";
        if (b.customer_id) {
          const [customer] = await tx.query(
            "SELECT name FROM customers WHERE id=$1 AND active FOR SHARE",
            [b.customer_id],
          );
          if (!customer)
            fail(
              400,
              "Cliente indisponível nesta empresa. Confira o cadastro.",
            );
          customerName = customer.name;
        }
        const locked = new Map<string, any>();
        for (const product of [
          ...new Set(b.items.map((x) => x.product_id)),
        ].sort())
          locked.set(
            product,
            await this.inventory.lockStock(tx, i, product, s.branch_id),
          );
        const lines: any[] = [];
        const needed = new Map<string, number>();
        for (const item of b.items) {
          const { p, stock } = locked.get(item.product_id);
          const value = price(p.price);
          let unitCost = price(p.cost),
            identifiers = "";
          if (p.serialized) {
            if (!item.unit_id || item.quantity !== 1)
              fail(400, "Selecione cada aparelho individualmente.");
            const [u] = await tx.query(
              "SELECT * FROM device_units WHERE id=$1 AND product_id=$2 AND branch_id=$3 AND status='in_stock' FOR UPDATE",
              [item.unit_id, p.id, s.branch_id],
            );
            if (!u) fail(409, "Aparelho indisponível nesta filial.");
            const ids = await tx.query(
              "SELECT imei FROM device_identifiers WHERE unit_id=$1 ORDER BY imei",
              [u.id],
            );
            identifiers = [
              ...ids.map((r) => `IMEI ${r.imei}`),
              u.serial ? `Série ${u.serial}` : "",
            ]
              .filter(Boolean)
              .join(" · ");
            unitCost = price(u.acquisition_cost);
          } else if (item.unit_id)
            fail(400, "Este produto não usa controle individual.");
          needed.set(p.id, (needed.get(p.id) || 0) + item.quantity);
          if (needed.get(p.id)! > stock.quantity)
            fail(409, `Estoque insuficiente: ${p.name}.`);
          lines.push({
            ...item,
            id: randomUUID(),
            p,
            unit_price_cents: value,
            unit_cost_cents: unitCost,
            identifiers,
            gross: value * item.quantity,
          });
        }
        const subtotal = lines.reduce((n, l) => n + l.gross, 0),
          total = subtotal - b.discount_cents;
        if (subtotal > 1000000000 || total <= 0)
          fail(400, "Total inválido ou acima do limite do PDV.");
        if (total !== b.expected_total_cents)
          fail(
            409,
            "Os preços mudaram. Atualize os produtos e confira o total antes de vender.",
          );
        const tendered = b.payments.reduce((n, p) => n + p.amount_cents, 0),
          change = tendered - total,
          cash = b.payments.find((p) => p.method === "cash");
        if (change < 0) fail(400, "Os pagamentos não cobrem o valor da venda.");
        if (change > (cash?.amount_cents || 0))
          fail(400, "Somente valores recebidos em dinheiro podem gerar troco.");
        const allocations = distributeDiscount(
          b.discount_cents,
          lines.map((l) => l.gross),
        );
        const id = randomUUID(),
          code = `V-${id.toUpperCase()}`;
        await tx.query(
          "INSERT INTO pos_sales(id,tenant_id,branch_id,session_id,operator_id,receipt_code,subtotal_cents,discount_cents,total_cents,change_cents,status,note,customer_id,customer_name) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'completed',$11,$12,$13) RETURNING id",
          [
            id,
            i.tenant_id,
            s.branch_id,
            s.id,
            i.user_id,
            code,
            subtotal,
            b.discount_cents,
            total,
            change,
            b.note,
            b.customer_id || null,
            customerName,
          ],
        );
        for (let index = 0; index < lines.length; index++) {
          const l = lines[index];
          await tx.query(
            "INSERT INTO pos_sale_items(id,tenant_id,sale_id,product_id,unit_id,product_name,sku,identifiers,quantity,unit_price_cents,unit_cost_cents,discount_cents,net_cents,warranty_days,warranty_terms) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id",
            [
              l.id,
              i.tenant_id,
              id,
              l.product_id,
              l.unit_id || null,
              l.p.name,
              l.p.sku,
              l.identifiers,
              l.quantity,
              l.unit_price_cents,
              l.unit_cost_cents,
              allocations[index],
              l.gross - allocations[index],
              l.p.warranty_days,
              l.p.warranty_terms,
            ],
          );
          const state = locked.get(l.product_id);
          state.stock.quantity -= l.quantity;
          if (l.unit_id)
            await tx.query(
              "UPDATE device_units SET status='out' WHERE id=$1 RETURNING id",
              [l.unit_id],
            );
          await this.inventory.ledger(
            tx,
            i,
            {
              product_id: l.product_id,
              branch_id: s.branch_id,
              reason: `Venda ${code}`,
            },
            -l.quantity,
            state.stock.quantity,
            "exit",
            l.unit_id || null,
            null,
            { saleItemId: l.id },
          );
        }
        for (const p of b.payments) {
          const net = p.amount_cents - (p.method === "cash" ? change : 0);
          await tx.query(
            "INSERT INTO pos_sale_payments(id,tenant_id,sale_id,method,amount_cents,tendered_cents,reference) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id",
            [
              randomUUID(),
              i.tenant_id,
              id,
              p.method,
              net,
              p.amount_cents,
              p.reference,
            ],
          );
          if (p.method === "cash" && net > 0)
            await this.cash(tx, i, s, "sale", net, `Recebimento ${code}`, id);
        }
        await audit(
          tx,
          i,
          "pos.sale.completed",
          id,
          {
            total_cents: total,
            discount_cents: b.discount_cents,
            change_cents: change,
          },
          s.branch_id,
        );
        return {
          id,
          receipt_code: code,
          total_cents: total,
          change_cents: change,
        };
      },
    );
  }
  async history(i: Identity, branch: string, page: number, q = "") {
    permit(i, "pos_read");
    branchAccess(i, branch);
    return this.db.transaction(i.tenant_id, async (tx) => ({
      items: await tx.query(
        `SELECT v.*,u.name AS operator_name,count(*) OVER()::int AS total_count FROM pos_sales v JOIN users u ON u.id=v.operator_id WHERE v.branch_id=$1 AND ($2::boolean OR v.operator_id=$3) AND v.receipt_code ILIKE $4 ORDER BY v.created_at DESC,v.id DESC LIMIT 30 OFFSET $5`,
        [
          branch,
          this.canManage(i),
          i.user_id,
          `%${q.slice(0, 100)}%`,
          (page - 1) * 30,
        ],
      ),
    }));
  }
  async receipt(i: Identity, id: string) {
    permit(i, "pos_read");
    validate(uuid, id);
    return this.db.transaction(i.tenant_id, async (tx) => {
      const [sale] = await tx.query(
        `SELECT v.*,u.name AS operator_name,b.name AS branch_name,t.name AS company_name FROM pos_sales v JOIN users u ON u.id=v.operator_id JOIN branches b ON b.id=v.branch_id JOIN tenants t ON t.id=v.tenant_id WHERE v.id=$1`,
        [id],
      );
      if (!sale) fail(404, "Venda não encontrada.");
      branchAccess(i, sale.branch_id);
      if (!this.canManage(i) && sale.operator_id !== i.user_id)
        fail(403, "Você só pode consultar suas próprias vendas.");
      const items = await tx.query(
        `SELECT x.id,x.product_id,x.unit_id,x.product_name,x.sku,x.identifiers,x.quantity,x.unit_price_cents,x.discount_cents,x.net_cents,x.warranty_days,x.warranty_terms,coalesce((SELECT sum(r.quantity) FROM pos_return_items r WHERE r.sale_item_id=x.id),0)::int AS returned_quantity,coalesce((SELECT sum(r.amount_cents) FROM pos_return_items r WHERE r.sale_item_id=x.id),0)::int AS refunded_cents FROM pos_sale_items x WHERE x.sale_id=$1 ORDER BY x.id`,
        [id],
      );
      const payments = await tx.query(
        "SELECT method,amount_cents,tendered_cents,reference FROM pos_sale_payments WHERE sale_id=$1 ORDER BY method",
        [id],
      );
      const returns = await tx.query(
        "SELECT r.*,u.name AS actor_name FROM pos_returns r JOIN users u ON u.id=r.actor_id WHERE r.sale_id=$1 ORDER BY r.created_at",
        [id],
      );
      const refunds = await tx.query(
        "SELECT p.return_id,p.method,p.amount_cents,p.reference FROM pos_refund_payments p JOIN pos_returns r ON r.id=p.return_id WHERE r.sale_id=$1",
        [id],
      );
      return { sale, items, payments, returns, refunds };
    });
  }
  async refund(i: Identity, saleId: string, body: unknown, key: unknown) {
    permit(i, "pos_refund");
    validate(uuid, saleId);
    const b = validate(refundSchema, body);
    unique(
      b.items.map((x) => x.sale_item_id),
      "Item repetido na devolução.",
    );
    unique(
      b.payments.map((x) => x.method),
      "Forma de devolução repetida.",
    );
    for (const p of b.payments)
      if (p.method !== "cash" && !p.reference)
        fail(400, "Informe a referência externa da devolução Pix/cartão.");
    return this.inventory.write(
      i,
      key,
      { action: "pos.refund", saleId, b },
      async (tx) => {
        const [sale] = await tx.query(
          "SELECT * FROM pos_sales WHERE id=$1 FOR UPDATE",
          [saleId],
        );
        if (!sale) fail(404, "Venda não encontrada.");
        branchAccess(i, sale.branch_id);
        if (sale.status === "cancelled" || sale.status === "returned")
          fail(409, "Venda já cancelada ou totalmente devolvida.");
        const s = await this.session(tx, i, b.session_id, true);
        if (s.branch_id !== sale.branch_id)
          fail(403, "A devolução deve ocorrer na filial da venda.");
        const all = await tx.query(
          `SELECT x.*,coalesce((SELECT sum(r.quantity) FROM pos_return_items r WHERE r.sale_item_id=x.id),0)::int AS returned_quantity,coalesce((SELECT sum(r.amount_cents) FROM pos_return_items r WHERE r.sale_item_id=x.id),0)::int AS refunded_cents FROM pos_sale_items x WHERE sale_id=$1`,
          [saleId],
        );
        if (
          b.kind === "cancel" &&
          (sale.status !== "completed" ||
            b.items.length !== all.length ||
            b.items.some(
              (x) =>
                all.find((l) => l.id === x.sale_item_id)?.quantity !==
                x.quantity,
            ))
        )
          fail(
            400,
            "Cancelamento exige todos os itens e nenhuma devolução anterior.",
          );
        const lines: any[] = b.items.map((item) => {
          const line = all.find((l) => l.id === item.sale_item_id);
          if (!line) fail(400, "Item não pertence à venda.");
          const cumulative = line.returned_quantity + item.quantity;
          if (cumulative > line.quantity)
            fail(409, "Quantidade já devolvida ou acima da venda.");
          const totalRefund = Number(
            (BigInt(line.net_cents) * BigInt(cumulative)) /
              BigInt(line.quantity),
          );
          return {
            ...line,
            return_quantity: item.quantity,
            return_cents: totalRefund - line.refunded_cents,
          };
        });
        const total = lines.reduce((n, l) => n + l.return_cents, 0);
        if (total !== b.payments.reduce((n, p) => n + p.amount_cents, 0))
          fail(
            400,
            "O valor da devolução deve corresponder exatamente aos itens, após o desconto original.",
          );
        const paid = await tx.query(
          `SELECT p.method,p.amount_cents-coalesce((SELECT sum(rp.amount_cents) FROM pos_refund_payments rp JOIN pos_returns r ON r.id=rp.return_id WHERE r.sale_id=p.sale_id AND rp.method=p.method),0)::int AS remaining FROM pos_sale_payments p WHERE p.sale_id=$1`,
          [saleId],
        );
        for (const p of b.payments)
          if (
            p.amount_cents >
            (paid.find((x) => x.method === p.method)?.remaining || 0)
          )
            fail(
              400,
              "Devolução acima do valor disponível na forma de pagamento original.",
            );
        const cash =
          b.payments.find((p) => p.method === "cash")?.amount_cents || 0;
        if (cash > (await this.balance(tx, s.id)))
          fail(
            409,
            "Dinheiro em caixa insuficiente para a devolução. Registre um suprimento ou utilize outro caixa próprio da filial.",
          );
        const locked = new Map<string, any>();
        // Returns remain possible for archived products; stock identity is preserved.
        for (const product of [
          ...new Set(lines.map((l) => l.product_id)),
        ].sort()) {
          const [p] = await tx.query(
            "SELECT * FROM products WHERE id=$1 FOR UPDATE",
            [product],
          );
          const [stock] = await tx.query(
            "SELECT * FROM stock_balances WHERE product_id=$1 AND branch_id=$2 FOR UPDATE",
            [product, s.branch_id],
          );
          if (!p || !stock) fail(409, "Saldo do produto não encontrado.");
          locked.set(product, { p, stock });
        }
        const id = randomUUID();
        await tx.query(
          "INSERT INTO pos_returns(id,tenant_id,branch_id,sale_id,session_id,actor_id,kind,reason,total_cents) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id",
          [
            id,
            i.tenant_id,
            s.branch_id,
            saleId,
            s.id,
            i.user_id,
            b.kind,
            b.reason,
            total,
          ],
        );
        for (const line of lines) {
          if (line.unit_id) {
            const [u] = await tx.query(
              "SELECT * FROM device_units WHERE id=$1 AND branch_id=$2 AND status='out' FOR UPDATE",
              [line.unit_id, s.branch_id],
            );
            if (!u) fail(409, "Aparelho não está disponível para retorno.");
            await tx.query(
              "UPDATE device_units SET status='in_stock' WHERE id=$1 RETURNING id",
              [line.unit_id],
            );
          }
          const itemId = randomUUID();
          await tx.query(
            "INSERT INTO pos_return_items(id,tenant_id,sale_id,return_id,sale_item_id,quantity,amount_cents) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id",
            [
              itemId,
              i.tenant_id,
              saleId,
              id,
              line.id,
              line.return_quantity,
              line.return_cents,
            ],
          );
          const state = locked.get(line.product_id);
          state.stock.quantity += line.return_quantity;
          await this.inventory.ledger(
            tx,
            i,
            {
              product_id: line.product_id,
              branch_id: s.branch_id,
              reason: `${b.kind === "cancel" ? "Cancelamento" : "Devolução"} ${sale.receipt_code}: ${b.reason}`,
            },
            line.return_quantity,
            state.stock.quantity,
            "entry",
            line.unit_id,
            null,
            { returnItemId: itemId },
          );
        }
        for (const p of b.payments)
          await tx.query(
            "INSERT INTO pos_refund_payments(id,tenant_id,return_id,method,amount_cents,reference) VALUES($1,$2,$3,$4,$5,$6) RETURNING id",
            [
              randomUUID(),
              i.tenant_id,
              id,
              p.method,
              p.amount_cents,
              p.reference,
            ],
          );
        if (cash)
          await this.cash(tx, i, s, "refund", -cash, b.reason, null, id);
        const returned = all.reduce(
          (n, l) =>
            n +
            l.returned_quantity +
            (b.items.find((x) => x.sale_item_id === l.id)?.quantity || 0),
          0,
        );
        const quantity = all.reduce((n, l) => n + l.quantity, 0);
        const status =
          b.kind === "cancel"
            ? "cancelled"
            : returned === quantity
              ? "returned"
              : "partial_return";
        await tx.query(
          "UPDATE pos_sales SET status=$1 WHERE id=$2 RETURNING id",
          [status, saleId],
        );
        await audit(
          tx,
          i,
          b.kind === "cancel" ? "pos.sale.cancelled" : "pos.sale.returned",
          saleId,
          { return_id: id, total_cents: total, reason: b.reason },
          s.branch_id,
        );
        return { id, sale_id: saleId, total_cents: total, status };
      },
    );
  }
  async report(i: Identity, branch: string) {
    permit(i, "pos_read");
    branchAccess(i, branch);
    return this.db.transaction(i.tenant_id, async (tx) => {
      const sessions = await tx.query(
        `SELECT c.*,c.expected_cents::text AS expected_cents,c.difference_cents::text AS difference_cents,r.name AS register_name,u.name AS operator_name,coalesce((SELECT sum(amount_cents) FROM cash_entries e WHERE e.session_id=c.id),0)::text AS ledger_cents FROM cash_sessions c JOIN pos_registers r ON r.id=c.register_id JOIN users u ON u.id=c.operator_id WHERE c.branch_id=$1 AND ($2::boolean OR c.operator_id=$3) ORDER BY c.opened_at DESC LIMIT 100`,
        [branch, this.canManage(i), i.user_id],
      );
      const operators = await tx.query(
        `SELECT u.id,u.name,count(DISTINCT c.id)::int AS sessions,
     coalesce(sum((SELECT count(*) FROM pos_sales v WHERE v.session_id=c.id)),0)::text AS sales_count,
     coalesce(sum((SELECT sum(v.total_cents) FROM pos_sales v WHERE v.session_id=c.id)),0)::text AS sold_cents,
     coalesce(sum((SELECT sum(v.discount_cents) FROM pos_sales v WHERE v.session_id=c.id)),0)::text AS discount_cents,
     coalesce(sum((SELECT sum(r.total_cents) FROM pos_returns r WHERE r.session_id=c.id)),0)::text AS refunded_cents
     FROM cash_sessions c JOIN users u ON u.id=c.operator_id WHERE c.branch_id=$1 AND ($2::boolean OR c.operator_id=$3) GROUP BY u.id,u.name ORDER BY u.name`,
        [branch, this.canManage(i), i.user_id],
      );
      return { sessions, operators };
    });
  }
}

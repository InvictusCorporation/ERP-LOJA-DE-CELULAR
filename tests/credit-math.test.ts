import { test } from "node:test";
import assert from "node:assert/strict";
import {
  simulateCredit,
  installmentQuote,
  allocateCreditPayment,
  validCpf,
  validCnpj,
  dueMonth,
} from "../src/shared/credit-math";
test("crediário: centavos, calendário e custo anual sem tarifas ocultas", () => {
  assert.ok(validCpf("52998224725"));
  assert.ok(validCnpj("11222333000181"));
  assert.equal(validCpf("11111111111"), false);
  assert.equal(validCnpj("11222333000180"), false);
  assert.equal(dueMonth("2028-01-31", 1), "2028-02-29");
  assert.equal(dueMonth("2028-01-31", 2), "2028-03-31");
  const q = simulateCredit(10001, 1000, 3, 100, "2026-01-01", "2026-01-31");
  assert.equal(
    q.lines.reduce((s, x) => s + x.principal_cents, 0),
    9001,
  );
  assert.equal(q.total_cents, q.purchase_cents + q.interest_cents);
  assert.ok(q.annual_percent > 0);
  assert.ok(q.effective_monthly_percent > 0);
  const zero = simulateCredit(10001, 0, 36, 0, "2026-01-01", "2026-01-31");
  assert.equal(zero.total_cents, 10001);
  assert.equal(zero.annual_percent, 0);
  assert.throws(() =>
    simulateCredit(100, 100, 1, 0, "2026-01-01", "2026-01-31"),
  );
});
test("crediário: antecipação total e parcial conserva principal, juros e desconto", () => {
  const s = simulateCredit(10000, 0, 1, 200, "2026-01-01", "2026-01-31"),
    line = s.lines[0];
  const q = installmentQuote(line, s.issued_on, "2026-01-16", [], 100, 200);
  assert.equal(q.earned_interest_cents, 100);
  assert.equal(q.discount_cents, 100);
  assert.equal(q.total_cents, 10100);
  const a = allocateCreditPayment(5050, q);
  assert.equal(a.principal_cents, 5000);
  assert.equal(a.interest_cents, 50);
  assert.equal(a.discount_cents, 50);
  const next = installmentQuote(
    line,
    s.issued_on,
    "2026-01-16",
    [{ ...a, posted_on: "2026-01-16" }],
    100,
    200,
  );
  assert.equal(next.total_cents, 5050);
  assert.equal(next.nominal_cents, 5100);
  assert.equal(next.discount_cents, 50);
  const rest = allocateCreditPayment(next.total_cents, next);
  assert.equal(a.principal_cents + rest.principal_cents, 10000);
  assert.equal(
    a.interest_cents +
      rest.interest_cents +
      a.discount_cents +
      rest.discount_cents,
    200,
  );
});
test("crediário: multa única e mora simples com abatimento do principal já pago", () => {
  const s = simulateCredit(10000, 0, 1, 0, "2026-01-01", "2026-01-31"),
    line = s.lines[0];
  const q = installmentQuote(line, s.issued_on, "2026-03-02", [], 100, 200);
  assert.equal(q.fine_cents, 200);
  assert.equal(q.late_cents, 100);
  const a = allocateCreditPayment(5300, q);
  assert.equal(a.fine_cents, 200);
  assert.equal(a.late_cents, 100);
  assert.equal(a.principal_cents, 5000);
  const next = installmentQuote(
    line,
    s.issued_on,
    "2026-04-01",
    [{ ...a, posted_on: "2026-03-02" }],
    100,
    200,
  );
  assert.equal(next.fine_cents, 0);
  assert.equal(next.late_cents, 50);
  assert.equal(next.total_cents, 5050);
});

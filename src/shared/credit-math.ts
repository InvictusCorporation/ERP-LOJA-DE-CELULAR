export type CreditLine = {
  number: number;
  due_on: string;
  principal_cents: number;
  interest_cents: number;
  amount_cents: number;
};
export const creditDay = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Fortaleza",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
export function days(a: string, b: string) {
  return Math.round(
    (Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 86400000,
  );
}
export function addDays(date: string, n: number) {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function dueMonth(first: string, n: number) {
  const [y, m, d] = first.split("-").map(Number);
  const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + n, Math.min(d, last), 12))
    .toISOString()
    .slice(0, 10);
}
export function roundRatio(a: number, b: number, c: number) {
  if (
    !Number.isSafeInteger(a) ||
    !Number.isSafeInteger(b) ||
    !Number.isSafeInteger(c) ||
    a < 0 ||
    b < 0 ||
    c <= 0
  )
    throw Error("Cálculo monetário inválido.");
  return Number(
    (BigInt(a) * BigInt(b) + BigInt(Math.floor(c / 2))) / BigInt(c),
  );
}
export function validCpf(value: string) {
  if (!/^\d{11}$/.test(value) || /^(\d)\1+$/.test(value)) return false;
  for (let j = 9; j < 11; j++) {
    let sum = 0;
    for (let k = 0; k < j; k++) sum += Number(value[k]) * (j + 1 - k);
    const digit = ((sum * 10) % 11) % 10;
    if (digit !== Number(value[j])) return false;
  }
  return true;
}
export function validCnpj(value: string) {
  if (!/^\d{14}$/.test(value) || /^(\d)\1+$/.test(value)) return false;
  for (let j = 12; j < 14; j++) {
    let weight = j - 7,
      sum = 0;
    for (let k = 0; k < j; k++) {
      sum += Number(value[k]) * weight--;
      if (weight === 1) weight = 9;
    }
    const rem = sum % 11;
    if (Number(value[j]) !== (rem < 2 ? 0 : 11 - rem)) return false;
  }
  return true;
}
export function simulateCredit(
  purchase: number,
  down: number,
  count: number,
  bps: number,
  issued: string,
  first: string,
) {
  if (
    ![purchase, down, count, bps].every(Number.isSafeInteger) ||
    purchase <= 0 ||
    purchase > 1000000000 ||
    down < 0 ||
    down >= purchase ||
    count < 1 ||
    count > 36 ||
    bps < 0 ||
    bps > 300 ||
    days(issued, first) < 1 ||
    days(issued, first) > 90
  )
    throw Error("Condições do parcelamento inválidas.");
  const principal = purchase - down;
  if (count > principal)
    throw Error("Cada parcela precisa ter pelo menos um centavo de principal.");
  const lines: CreditLine[] = Array.from({ length: count }, (_, i) => {
    const p = Math.floor(principal / count) + (i < principal % count ? 1 : 0),
      due = dueMonth(first, i),
      interest = roundRatio(p, bps * days(issued, due), 300000);
    return {
      number: i + 1,
      due_on: due,
      principal_cents: p,
      interest_cents: interest,
      amount_cents: p + interest,
    };
  });
  const interest = lines.reduce((s, l) => s + l.interest_cents, 0),
    total = purchase + interest;
  if (total > 1000000000) throw Error("Total a prazo acima de R$ 10 milhões.");
  let annual = 0;
  if (interest) {
    let low = 0,
      high = 1;
    const pv = (r: number) =>
      lines.reduce(
        (s, l) =>
          s + l.amount_cents / Math.pow(1 + r, days(issued, l.due_on) / 365),
        0,
      );
    while (pv(high) > principal && high < 1024) high *= 2;
    for (let i = 0; i < 100; i++) {
      const mid = (low + high) / 2;
      if (pv(mid) > principal) low = mid;
      else high = mid;
    }
    annual = (low + high) / 2;
  }
  return {
    purchase_cents: purchase,
    down_cents: down,
    principal_cents: principal,
    interest_cents: interest,
    total_cents: total,
    installment_total_cents: principal + interest,
    monthly_bps: bps,
    effective_monthly_percent: (Math.pow(1 + annual, 1 / 12) - 1) * 100,
    annual_percent: annual * 100,
    issued_on: issued,
    first_due_on: first,
    lines,
  };
}
type Receipt = {
  principal_cents: number;
  interest_cents: number;
  discount_cents: number;
  fine_cents: number;
  late_cents: number;
  posted_on: string;
};
export function installmentQuote(
  line: CreditLine,
  issued: string,
  asof: string,
  receipts: Receipt[],
  monthlyLate: number,
  fineBps: number,
) {
  const paid = receipts.reduce(
    (r, p) => ({
      principal: r.principal + p.principal_cents,
      interest: r.interest + p.interest_cents,
      discount: r.discount + p.discount_cents,
      fine: r.fine + p.fine_cents,
      late: r.late + p.late_cents,
    }),
    { principal: 0, interest: 0, discount: 0, fine: 0, late: 0 },
  );
  const principal = Math.max(0, line.principal_cents - paid.principal),
    interest = Math.max(0, line.interest_cents - paid.interest - paid.discount),
    duration = Math.max(1, days(issued, line.due_on)),
    elapsed = Math.min(duration, Math.max(0, days(issued, asof))),
    earned = roundRatio(interest, elapsed, duration),
    discount = interest - earned;
  const overdue = Math.max(0, days(line.due_on, asof));
  const dueFace = Math.max(
    0,
    line.amount_cents -
      receipts
        .filter((p) => p.posted_on <= line.due_on)
        .reduce(
          (n, p) => n + p.principal_cents + p.interest_cents + p.discount_cents,
          0,
        ),
  );
  const fine = overdue
    ? Math.max(0, roundRatio(dueFace, fineBps, 10000) - paid.fine)
    : 0;
  const principalDays = Math.max(
    0,
    line.principal_cents * overdue -
      receipts.reduce(
        (n, p) =>
          n +
          p.principal_cents *
            Math.max(
              0,
              days(p.posted_on > line.due_on ? p.posted_on : line.due_on, asof),
            ),
        0,
      ),
  );
  const late = Math.max(
    0,
    roundRatio(principalDays, monthlyLate, 300000) - paid.late,
  );
  return {
    asof,
    principal_cents: principal,
    interest_cents: interest,
    earned_interest_cents: earned,
    discount_cents: discount,
    fine_cents: fine,
    late_cents: late,
    nominal_cents: principal + interest,
    total_cents: principal + earned + fine + late,
    overdue_days: overdue,
  };
}
export function allocateCreditPayment(
  amount: number,
  q: ReturnType<typeof installmentQuote>,
) {
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > q.total_cents)
    throw Error("Recebimento acima do saldo disponível.");
  const fine = Math.min(amount, q.fine_cents),
    late = Math.min(amount - fine, q.late_cents);
  const core = amount - fine - late,
    weight = q.principal_cents + q.earned_interest_cents,
    principal =
      core === weight
        ? q.principal_cents
        : Math.min(
            q.principal_cents,
            roundRatio(core, q.principal_cents, Math.max(1, weight)),
          ),
    interest = core - principal;
  const allocated =
    principal === q.principal_cents
      ? q.interest_cents
      : roundRatio(q.interest_cents, principal, Math.max(1, q.principal_cents));
  const discount = Math.min(
    q.discount_cents,
    Math.max(0, allocated - interest),
  );
  return {
    principal_cents: principal,
    interest_cents: interest,
    discount_cents: discount,
    fine_cents: fine,
    late_cents: late,
  };
}

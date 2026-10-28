// All POS calculations use integer cents; parsing never rounds a floating input.
export function toCents(value: unknown): number {
  const text = String(value).trim().replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(text))
    throw new Error("Informe um valor positivo com até duas casas decimais.");
  const [whole, fraction = ""] = text.split(".");
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(result) || result > 1000000000)
    throw new Error("Valor fora do limite permitido.");
  return result;
}
export const formatCents = (value: unknown) =>
  (Number(value || 0) / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });

import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";
export const hashToken = (s: string) =>
  createHash("sha256").update(s).digest("hex");
export const token = () => randomBytes(32).toString("hex");
export function passwordHash(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}
export function passwordMatches(password: string, hash: string) {
  const [salt, value] = hash.split(":");
  const expected = Buffer.from(value, "hex");
  const actual = scryptSync(password, salt, 64);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export type Identity = {
  user_id: string;
  tenant_id: string;
  name: string;
  email: string;
  role: string;
  branch_ids: string[];
  csrf: string;
};
const rights: Record<string, string[]> = {
  owner: [
    "read",
    "catalog",
    "stock",
    "adjust",
    "branches",
    "users",
    "cost",
    "audit",
    "pos_read",
    "pos_sell",
    "pos_cash",
    "pos_manage",
    "pos_discount",
    "pos_refund",
    "service_read",
    "service_manage",
    "service_work",
    "service_parts",
    "service_cost",
    "service_approve",
    "service_deliver",
  ],
  manager: [
    "read",
    "catalog",
    "stock",
    "adjust",
    "cost",
    "audit",
    "pos_read",
    "pos_sell",
    "pos_cash",
    "pos_manage",
    "pos_discount",
    "pos_refund",
    "service_read",
    "service_manage",
    "service_work",
    "service_parts",
    "service_cost",
    "service_approve",
    "service_deliver",
  ],
  cashier: ["read", "pos_read", "pos_sell", "pos_cash"],
  technician: ["read", "service_read", "service_work", "service_parts"],
  stock: ["read", "stock"],
  viewer: ["read"],
};
export const permissions = (role: string) => rights[role] || [];

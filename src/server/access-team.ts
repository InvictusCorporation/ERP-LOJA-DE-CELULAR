import { Tx } from "./db";
import { permissions } from "./security";
// Assignment eligibility uses the same effective rights as request authorization.
export async function activeTeam(
  tx: Tx,
  tenant: string,
  branch: string,
  right: string,
  user: string | null = null,
) {
  const rows = await tx.query(
    "SELECT u.id,coalesce(nullif(m.employee_name,''),u.name) AS name,m.role,m.permission_grants,m.permission_denials FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.tenant_id=$1 AND m.active AND u.active AND $2::uuid=ANY(m.branch_ids) AND ($3::uuid IS NULL OR u.id=$3) ORDER BY name,u.id",
    [tenant, branch, user],
  );
  return rows
    .filter((row) => permissions(row as any).includes(right))
    .map(({ id, name, role }) => ({ id, name, role }));
}

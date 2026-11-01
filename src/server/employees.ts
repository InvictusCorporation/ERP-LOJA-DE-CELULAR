import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Database, Tx } from "./db";
import { Identity, permissions, passwordHash, hashToken } from "./security";
import { audit, branchAccess, fail, permit, uuid, validate } from "./domain";
import {
  roleLabels,
  roleRights,
  permissionLabels,
  reservedPermissions,
  dependencies,
} from "../shared/access";
type Row = Record<string, any>;
const roles = [
  "owner",
  "administrator",
  "manager",
  "seller",
  "cashier",
  "technician",
  "financial",
  "stock",
  "viewer",
] as const;
const text = (max = 180) => z.string().trim().max(max).default("");
const access = {
  name: z.string().trim().min(1).max(180),
  job_title: text(100),
  job_function: text(500),
  employee_code: text(80),
  point_external_id: text(120),
  home_branch_id: uuid.optional(),
  branch_ids: z
    .array(uuid)
    .min(1)
    .max(100)
    .refine((a) => new Set(a).size === a.length, "Não repita filiais."),
  role: z.enum(roles),
  active: z.boolean().default(true),
  permission_grants: z.array(z.string()).max(50).default([]),
  permission_denials: z.array(z.string()).max(50).default([]),
};
const createSchema = z
  .object({
    ...access,
    email: z
      .email()
      .max(254)
      .transform((s) => s.toLowerCase()),
    password: z.string().min(12).max(128),
  })
  .strict();
const updateSchema = z
  .object({
    ...access,
    version: z.number().int().positive(),
    reason: z.string().trim().min(5).max(500),
  })
  .strict();
const selection =
  "m.*,u.email,u.name AS account_name,u.active AS account_active,coalesce(nullif(m.employee_name,''),u.name) AS name";
export class EmployeesService {
  constructor(private db: Database) {}
  private visible(i: Identity, row: Row) {
    if (!row) fail(404, "Funcionário não encontrado.");
    if (!row.branch_ids.every((id: string) => i.branch_ids.includes(id)))
      fail(403, "Você precisa de acesso a todas as filiais desse funcionário.");
  }
  private present(i: Identity, row: Row): Row {
    return {
      ...row,
      permissions: permissions(row as any),
      editable:
        i.role === "owner" ||
        (i.role === "administrator" &&
          !["owner", "administrator"].includes(row.role)),
    };
  }
  config(i: Identity) {
    permit(i, "users");
    return {
      roles: roleLabels,
      defaults: roleRights,
      permissions: permissionLabels,
      reserved: reservedPermissions,
      dependencies,
      can_create: !!this.db.embedded,
      is_owner: i.role === "owner",
      point_status:
        "Vínculo cadastral disponível para exportação. O controle de ponto ainda não está conectado.",
    };
  }
  async list(i: Identity, query: Row) {
    permit(i, "users");
    const q = validate(z.string().trim().max(100).default(""), query.q),
      page = validate(
        z.coerce.number().int().min(1).max(100000).default(1),
        query.page,
      ),
      status = validate(
        z.enum(["all", "active", "inactive"]).default("all"),
        query.status,
      );
    const branch = String(query.branch_id || "all");
    if (branch !== "all") branchAccess(i, branch);
    return this.db.transaction(i.tenant_id, async (tx) => {
      const [r] = await tx.query(
        `WITH rows AS (SELECT ${selection} FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=$1 AND m.branch_ids<@$2::uuid[] AND ($3='all' OR (m.active AND u.active)=($3='active')) AND strpos(lower(coalesce(nullif(m.employee_name,''),u.name)||' '||u.email||' '||m.employee_code||' '||m.job_title),lower($4))>0 AND ($5='all' OR $5::text=ANY(m.branch_ids::text[]))) SELECT (SELECT count(*)::int FROM rows) AS total,coalesce((SELECT jsonb_agg(x) FROM (SELECT * FROM rows ORDER BY lower(name),id LIMIT 30 OFFSET $6) x),'[]'::jsonb) AS items`,
        [i.tenant_id, i.branch_ids, status, q, branch, (page - 1) * 30],
      );
      return {
        ...r,
        items: r.items.map((row: Row) => this.present(i, row)),
        page,
        page_size: 30,
      };
    });
  }
  async detail(i: Identity, id: string) {
    permit(i, "users");
    validate(uuid, id);
    return this.db.transaction(i.tenant_id, async (tx) => {
      const [row] = await tx.query(
        `SELECT ${selection} FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.id=$1 AND m.tenant_id=$2`,
        [id, i.tenant_id],
      );
      this.visible(i, row);
      return this.present(i, row);
    });
  }
  async history(i: Identity, id: string, pageValue: unknown) {
    const employee = await this.detail(i, id),
      page = validate(
        z.coerce.number().int().min(1).max(100000).default(1),
        pageValue,
      );
    return this.db.transaction(i.tenant_id, async (tx) => {
      const [r] = await tx.query(
        `WITH rows AS (SELECT a.id,a.action,a.entity_id,a.branch_id,b.name AS branch,a.created_at,u.name AS actor_name,CASE WHEN a.action LIKE 'employee.%' THEN a.details->>'reason' ELSE NULL END AS reason FROM audit_events a LEFT JOIN branches b ON b.id=a.branch_id LEFT JOIN users u ON u.id=a.actor_id WHERE (a.actor_id=$1 OR (a.entity_id=$2 AND a.action LIKE 'employee.%')) AND (a.branch_id IS NULL OR a.branch_id=ANY($3::uuid[]))) SELECT (SELECT count(*)::int FROM rows) AS total,coalesce((SELECT jsonb_agg(x) FROM (SELECT * FROM rows ORDER BY created_at DESC,id DESC LIMIT 30 OFFSET $4) x),'[]'::jsonb) AS items`,
        [employee.user_id, id, i.branch_ids, (page - 1) * 30],
      );
      return { ...r, page, page_size: 30 };
    });
  }
  async point(i: Identity, id: string) {
    const e = await this.detail(i, id);
    return {
      schema_version: 1,
      tenant_id: i.tenant_id,
      employee_id: e.id,
      user_id: e.user_id,
      external_employee_id: e.point_external_id || null,
      name: e.name,
      employee_code: e.employee_code || null,
      job_title: e.job_title,
      job_function: e.job_function,
      home_branch_id: e.home_branch_id,
      branch_ids: e.branch_ids,
      active: e.active && e.account_active,
      version: e.version,
      integration_status: "mapping_only",
      attendance: null,
    };
  }
  private checkAccess(actor: Identity, b: Row, old?: Row) {
    if (!["owner", "administrator"].includes(actor.role))
      fail(403, "Gestão de acesso restrita ao proprietário e administrador.");
    b.branch_ids.forEach((branch: string) => branchAccess(actor, branch));
    if (!b.branch_ids.includes(b.home_branch_id))
      fail(
        400,
        "A filial de trabalho deve estar entre as filiais autorizadas.",
      );
    const overrides = [...b.permission_grants, ...b.permission_denials];
    if (
      overrides.some(
        (r) =>
          !Object.hasOwn(permissionLabels, r) ||
          reservedPermissions.includes(r),
      )
    )
      fail(400, "Permissão desconhecida ou reservada ao perfil.");
    if (
      new Set(b.permission_grants).size !== b.permission_grants.length ||
      new Set(b.permission_denials).size !== b.permission_denials.length ||
      b.permission_grants.some((r: string) => b.permission_denials.includes(r))
    )
      fail(400, "Permissões repetidas ou conflitantes.");
    if (!old && b.role === "owner")
      fail(400, "Proprietários são provisionados pela central.");
    if (actor.role !== "owner") {
      if (
        ["owner", "administrator"].includes(b.role) ||
        (old && ["owner", "administrator"].includes(old.role))
      )
        fail(403, "Somente o proprietário pode gerir administradores.");
      if (permissions(b as any).some((r) => !permissions(actor).includes(r)))
        fail(403, "Você não pode conceder acesso que não possui.");
    }
    if (old && (old.role === "owner" || old.user_id === actor.user_id)) {
      const same = (a: string[], b: string[]) =>
        JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
      if (
        b.role !== old.role ||
        b.active !== old.active ||
        !same(b.branch_ids, old.branch_ids) ||
        !same(b.permission_grants, old.permission_grants) ||
        !same(b.permission_denials, old.permission_denials)
      )
        fail(
          403,
          "Não altere o próprio acesso nem o acesso do proprietário. O perfil pessoal pode ser atualizado.",
        );
    }
    if (b.role === "owner" && overrides.length)
      fail(400, "O proprietário mantém o perfil integral.");
  }
  private async pending(tx: Tx, user: string, b: Row) {
    const rights = permissions(b as any),
      keeps = (right: string) => b.active && rights.includes(right);
    const [cash] = await tx.query(
      "SELECT id FROM cash_sessions WHERE operator_id=$1 AND status='open' AND (NOT $2::boolean OR NOT branch_id=ANY($3::uuid[])) LIMIT 1",
      [user, keeps("pos_cash"), b.branch_ids],
    );
    if (cash)
      fail(409, "Feche o caixa aberto antes de retirar esse acesso ou filial.");
    const [repair] = await tx.query(
      "SELECT id FROM repair_orders WHERE technician_id=$1 AND status<>'delivered' AND (NOT $2::boolean OR NOT branch_id=ANY($3::uuid[])) LIMIT 1",
      [user, keeps("service_work"), b.branch_ids],
    );
    if (repair)
      fail(
        409,
        "Reatribua ou encerre as ordens do técnico antes de retirar esse acesso ou filial.",
      );
    const [crm] = await tx.query(
      "SELECT id FROM crm_tasks WHERE owner_id=$1 AND status='pending' AND (NOT $2::boolean OR NOT branch_id=ANY($3::uuid[])) UNION ALL SELECT id FROM crm_opportunities WHERE owner_id=$1 AND stage NOT IN ('won','lost') AND (NOT $2::boolean OR NOT branch_id=ANY($3::uuid[])) LIMIT 1",
      [user, keeps("crm_manage"), b.branch_ids],
    );
    if (crm)
      fail(
        409,
        "Reatribua ou encerre as pendências do CRM antes de retirar esse acesso ou filial.",
      );
  }
  async save(i: Identity, id: string | null, body: unknown, key: unknown) {
    permit(i, "users");
    if (id) validate(uuid, id);
    if (!id && !this.db.embedded)
      fail(
        403,
        "Novas contas são provisionadas pela central. Gerencie aqui os funcionários já vinculados.",
      );
    const b: Row = id
      ? validate(updateSchema, body)
      : validate(createSchema, body);
    b.home_branch_id ||= b.branch_ids[0];
    const k = validate(uuid, key),
      fingerprint = hashToken(JSON.stringify({ actor: i.user_id, id, body }));
    const operation = async (tx: Tx) => {
      // One lock order for all staff writes, including legacy local provisioning.
      await tx.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))::text",
        ["employees:" + i.tenant_id],
      );
      const [actor] = await tx.query(
        `SELECT m.role,m.branch_ids,m.permission_grants,m.permission_denials FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=$1 AND m.user_id=$2 AND m.active AND u.active FOR UPDATE OF m`,
        [i.tenant_id, i.user_id],
      );
      if (!actor) fail(401, "Acesso atualizado. Entre novamente.");
      const fresh = { ...i, ...actor } as Identity;
      permit(fresh, "users");
      const [replay] = await tx.query(
        "SELECT fingerprint,response FROM idempotency_keys WHERE tenant_id=$1 AND key=$2",
        [i.tenant_id, k],
      );
      if (replay) {
        if (replay.fingerprint !== fingerprint)
          fail(409, "Chave de operação já utilizada com outros dados.");
        return replay.response;
      }
      let old: Row | undefined;
      if (id) {
        [old] = await tx.query(
          `SELECT ${selection} FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.id=$1 AND m.tenant_id=$2 FOR UPDATE OF m`,
          [id, i.tenant_id],
        );
        this.visible(fresh, old!);
        if (old!.version !== b.version)
          fail(
            409,
            "Cadastro atualizado por outra pessoa. Recarregue os dados.",
          );
      }
      this.checkAccess(fresh, b, old);
      const valid = await tx.query(
        "SELECT id FROM branches WHERE tenant_id=$1 AND active AND id=ANY($2::uuid[])",
        [i.tenant_id, b.branch_ids],
      );
      if (valid.length !== b.branch_ids.length)
        fail(400, "Selecione somente filiais ativas desta empresa.");
      if (old && !old.account_active && b.active)
        fail(
          409,
          "A conta global está inativa. Solicite a liberação pela central.",
        );
      if (old) await this.pending(tx, old.user_id, b);
      const employee = id || randomUUID(),
        user = old?.user_id || randomUUID();
      if (!old) {
        await tx.query(
          "INSERT INTO users(id,name,email,password_hash) VALUES($1,$2,$3,$4) RETURNING id",
          [user, b.name, b.email, passwordHash(b.password)],
        );
        await tx.query(
          "INSERT INTO memberships(id,tenant_id,user_id,role,branch_ids,active) VALUES($1,$2,$3,$4,$5::uuid[],$6) RETURNING id",
          [employee, i.tenant_id, user, b.role, b.branch_ids, b.active],
        );
      }
      await tx.query(
        "UPDATE memberships SET employee_name=$3,job_title=$4,job_function=$5,employee_code=$6,home_branch_id=$7,point_external_id=$8,role=$9,branch_ids=$10::uuid[],active=$11,permission_grants=$12::text[],permission_denials=$13::text[],version=version+$14,updated_at=now() WHERE id=$1 AND tenant_id=$2 RETURNING id",
        [
          employee,
          i.tenant_id,
          b.name,
          b.job_title,
          b.job_function,
          b.employee_code,
          b.home_branch_id,
          b.point_external_id,
          b.role,
          b.branch_ids,
          b.active,
          b.permission_grants,
          b.permission_denials,
          old ? 1 : 0,
        ],
      );
      if (old && user !== i.user_id)
        await tx.query(
          "DELETE FROM sessions WHERE tenant_id=$1 AND user_id=$2 RETURNING token_hash",
          [i.tenant_id, user],
        );
      await audit(
        tx,
        fresh,
        old ? "employee.updated" : "employee.created",
        employee,
        {
          fields: Object.keys(access).filter(
            (k) =>
              !old ||
              JSON.stringify(old[k === "name" ? "employee_name" : k]) !==
                JSON.stringify(b[k]),
          ),
          role: b.role,
          active: b.active,
          branch_ids: b.branch_ids,
          grants: b.permission_grants,
          denials: b.permission_denials,
          reason: old ? b.reason : undefined,
        },
      );
      const response = {
        id: user,
        employee_id: employee,
        version: old ? old.version + 1 : 1,
      };
      await tx.query(
        "INSERT INTO idempotency_keys(tenant_id,key,fingerprint,response) VALUES($1,$2,$3,$4::jsonb) RETURNING key",
        [i.tenant_id, k, fingerprint, JSON.stringify(response)],
      );
      return response;
    };
    return id
      ? this.db.transaction(i.tenant_id, operation)
      : this.db.provision(operation);
  }
}

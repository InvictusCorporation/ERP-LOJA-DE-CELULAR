import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { Database, Tx } from "./db";
import { Identity } from "./security";
import {
  InventoryService,
  audit,
  branchAccess,
  fail,
  permit,
  uuid,
  validate,
} from "./domain";
import {
  pointEmployeeMapping,
  canonicalPointJson,
  pointReleaseGates,
} from "../shared/point";
type Row = Record<string, any>;
const text = (max: number) => z.string().trim().max(max).default("");
const profileSchema = z
  .object({
    version: z.number().int().min(0),
    provider_name: text(100),
    base_url: text(300).refine((s) => {
      if (!s) return true;
      try {
        const u = new URL(s);
        return (
          u.protocol === "https:" &&
          !u.username &&
          !u.password &&
          !u.search &&
          !u.hash
        );
      } catch {
        return false;
      }
    }, "Informe URL HTTPS sem usuário, senha, parâmetros ou fragmento."),
    external_tenant_id: text(120),
    environment: z.enum(["sandbox", "production"]).default("sandbox"),
    notes: text(1500),
  })
  .strict();
const defaults = {
  provider_name: "",
  base_url: "",
  external_tenant_id: "",
  environment: "sandbox",
  notes: "",
};
function digest(content: unknown) {
  return createHash("sha256")
    .update(canonicalPointJson(content), "utf8")
    .digest("hex");
}
export class PointService {
  constructor(
    private db: Database,
    private inventory: InventoryService,
  ) {}
  private async snapshot(tx: Tx, i: Identity) {
    // One statement gives config, mappings and the employee set the same MVCC snapshot.
    // Membership reads require an explicit tenant predicate (auth reads are global).
    const [s] = await tx.query(
      `SELECT
      (SELECT jsonb_build_object('profile',profile,'version',version,'updated_at',updated_at) FROM point_settings WHERE tenant_id=$1) AS settings,
      coalesce((SELECT jsonb_agg(v ORDER BY id) FROM (SELECT b.id,b.name,b.active,b.version AS branch_version,m.external_branch_id,coalesce(m.version,0) AS version FROM branches b LEFT JOIN point_branch_mappings m ON m.branch_id=b.id WHERE b.id=ANY($2::uuid[])) v),'[]'::jsonb) AS branches,
      (SELECT count(*)::int FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=$1 AND m.branch_ids<@$2::uuid[]) AS employee_total,
      (SELECT count(*)::int FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=$1 AND m.branch_ids<@$2::uuid[] AND m.point_external_id='') AS employee_missing,
      (SELECT count(*)::int FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=$1 AND m.branch_ids<@$2::uuid[] AND (m.home_branch_id IS NULL OR NOT(m.home_branch_id=ANY(m.branch_ids)))) AS employee_home_missing,
      coalesce((SELECT jsonb_agg(v ORDER BY id) FROM (SELECT m.id,m.user_id,coalesce(nullif(m.employee_name,''),u.name) AS name,m.employee_code,m.job_title,m.job_function,m.point_external_id,m.home_branch_id,m.branch_ids,m.active,u.active AS account_active,m.version FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=$1 AND m.branch_ids<@$2::uuid[] ORDER BY m.id LIMIT 501) v),'[]'::jsonb) AS employees`,
      [i.tenant_id, i.branch_ids],
    );
    const settings = s.settings || { profile: defaults, version: 0 },
      branches = s.branches as Row[],
      employees = s.employees as Row[];
    const missing_config = [
      "provider_name",
      "base_url",
      "external_tenant_id",
    ].filter((k) => !settings.profile[k]);
    const missing_branches = branches.filter(
        (b) => !b.external_branch_id,
      ).length,
      missing_employees = s.employee_missing;
    const blocking = {
      configuration_fields: missing_config,
      branches_without_mapping: missing_branches,
      employees_without_mapping: missing_employees,
      employees_without_home_branch: s.employee_home_missing,
      over_export_limit: s.employee_total > 500,
      no_branches: branches.length === 0,
    };
    return {
      settings,
      branches,
      employees,
      employee_total: s.employee_total,
      blocking,
      local_mapping_complete:
        !missing_config.length &&
        !missing_branches &&
        !missing_employees &&
        !s.employee_home_missing &&
        s.employee_total <= 500 &&
        branches.length > 0,
    };
  }
  async overview(i: Identity, q: Row) {
    permit(i, "point_read");
    const page = validate(
        z.coerce.number().int().min(1).max(100000).default(1),
        q.page,
      ),
      search = validate(text(100), q.q);
    return this.db.transaction(i.tenant_id, async (tx) => {
      const s = await this.snapshot(tx, i),
        [r] = await tx.query(
          `WITH rows AS (SELECT m.id,coalesce(nullif(m.employee_name,''),u.name) AS name,m.employee_code,m.job_title,m.point_external_id,m.home_branch_id,m.active AND u.active AS active,m.version FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=$1 AND m.branch_ids<@$2::uuid[] AND strpos(lower(coalesce(nullif(m.employee_name,''),u.name)||' '||m.employee_code||' '||m.point_external_id),lower($3))>0) SELECT (SELECT count(*)::int FROM rows) AS total,coalesce((SELECT jsonb_agg(v) FROM (SELECT * FROM rows ORDER BY name,id LIMIT 30 OFFSET $4) v),'[]'::jsonb) AS items`,
          [i.tenant_id, i.branch_ids, search, (page - 1) * 30],
        );
      const { employees, ...overview } = s;
      return {
        ...overview,
        employees: r,
        integration: {
          status: "not_connected",
          adapter_installed: false,
          provider_contract: "unverified",
          subscription_status: "not_verified",
          can_sync: false,
          last_sync_at: null,
          attendance: null,
          release_gates: pointReleaseGates,
        },
      };
    });
  }
  async settings(i: Identity, body: unknown, key: unknown) {
    permit(i, "point_settings");
    const b = validate(profileSchema, body),
      { version, ...profile } = b;
    return this.inventory.write(
      i,
      key,
      { op: "point.settings", b },
      async (tx) => {
        await tx.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1,0))::text",
          ["point-settings:" + i.tenant_id],
        );
        const [old] = await tx.query(
          "SELECT version FROM point_settings WHERE tenant_id=$1",
          [i.tenant_id],
        );
        if ((old?.version || 0) !== version)
          fail(409, "Configuração alterada. Atualize a tela.");
        await tx.query(
          "INSERT INTO point_settings(tenant_id,profile) VALUES($1,$2::jsonb) ON CONFLICT(tenant_id) DO UPDATE SET profile=excluded.profile,version=point_settings.version+1,updated_at=now() RETURNING version",
          [i.tenant_id, JSON.stringify(profile)],
        );
        await audit(tx, i, "point.settings.saved", i.tenant_id, {
          version: version + 1,
        });
        return { version: version + 1 };
      },
    );
  }
  async mapping(i: Identity, id: string, body: unknown, key: unknown) {
    permit(i, "point_settings");
    branchAccess(i, id);
    const b = validate(
      z
        .object({
          version: z.number().int().min(0),
          external_branch_id: text(120),
        })
        .strict(),
      body,
    );
    return this.inventory.write(
      i,
      key,
      { op: "point.branch.mapping", id, b },
      async (tx) => {
        await tx.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1,0))::text",
          ["point-settings:" + i.tenant_id],
        );
        const [branch] = await tx.query("SELECT id FROM branches WHERE id=$1", [
          id,
        ]);
        if (!branch) fail(404, "Filial não encontrada.");
        const [old] = await tx.query(
          "SELECT version FROM point_branch_mappings WHERE branch_id=$1",
          [id],
        );
        if ((old?.version || 0) !== b.version)
          fail(409, "Vínculo alterado. Atualize a tela.");
        if (b.external_branch_id) {
          const duplicate = await tx.query(
            "SELECT branch_id FROM point_branch_mappings WHERE external_branch_id=$1 AND branch_id<>$2",
            [b.external_branch_id, id],
          );
          if (duplicate.length)
            fail(
              409,
              "Este identificador do ponto já está associado a outra filial.",
            );
        }
        await tx.query(
          "INSERT INTO point_branch_mappings(tenant_id,branch_id,external_branch_id) VALUES($1,$2,$3) ON CONFLICT(tenant_id,branch_id) DO UPDATE SET external_branch_id=excluded.external_branch_id,version=point_branch_mappings.version+1,updated_at=now() RETURNING version",
          [i.tenant_id, id, b.external_branch_id || null],
        );
        await audit(
          tx,
          i,
          "point.branch.mapped",
          id,
          { version: b.version + 1 },
          id,
        );
        return { version: b.version + 1 };
      },
    );
  }
  async prepare(i: Identity, body: unknown, key: unknown) {
    permit(i, "point_export");
    validate(z.object({}).strict(), body);
    return this.inventory.write(
      i,
      key,
      { op: "point.export.prepare" },
      async (tx) => {
        const s = await this.snapshot(tx, i);
        if (!s.branches.length)
          fail(409, "Nenhuma filial autorizada para preparar o pacote.");
        if (s.employee_total > 500)
          fail(
            422,
            "O pacote de preparação é limitado a 500 funcionários. O adaptador definitivo deverá definir o envio em lotes.",
          );
        const id = randomUUID(),
          content = {
            schema_version: 1,
            purpose: "employee_mapping_review",
            source: "invictus_erp_mobile",
            tenant_id: i.tenant_id,
            generated_at: new Date().toISOString(),
            configuration_version: s.settings.version,
            target: {
              provider_name: s.settings.profile.provider_name,
              base_url: s.settings.profile.base_url,
              external_tenant_id: s.settings.profile.external_tenant_id,
              environment: s.settings.profile.environment,
            },
            scope_branch_ids: s.branches.map((b: Row) => b.id),
            branches: s.branches.map((b: Row) => ({
              branch_id: b.id,
              name: b.name,
              active: b.active,
              external_branch_id: b.external_branch_id || null,
              mapping_version: b.version,
              branch_version: b.branch_version,
            })),
            employees: s.employees.map((e: Row) =>
              pointEmployeeMapping(e, i.tenant_id),
            ),
            readiness: {
              local_mapping_complete: s.local_mapping_complete,
              blocking: s.blocking,
            },
            integration_status: "not_connected",
            provider_contract: "unverified",
            subscription_status: "not_verified",
            attendance: null,
          };
        const hash = digest(content);
        await tx.query(
          "INSERT INTO point_preparation_exports(id,tenant_id,branch_ids,content,sha256,employee_count,created_by) VALUES($1,$2,$3::uuid[],$4::jsonb,$5,$6,$7) RETURNING id",
          [
            id,
            i.tenant_id,
            content.scope_branch_ids,
            JSON.stringify(content),
            hash,
            s.employees.length,
            i.user_id,
          ],
        );
        await audit(tx, i, "point.export.prepared", id, {
          employee_count: s.employees.length,
          branch_count: s.branches.length,
          sha256: hash,
        });
        return { id, sha256: hash };
      },
    );
  }
  async exports(i: Identity, q: Row) {
    permit(i, "point_export");
    const page = validate(
      z.coerce.number().int().min(1).max(100000).default(1),
      q.page,
    );
    return this.db.transaction(i.tenant_id, async (tx) => {
      const [r] = await tx.query(
        `WITH rows AS (SELECT id,branch_ids,employee_count,sha256,created_at,(content->'readiness'->>'local_mapping_complete')::boolean AS local_mapping_complete FROM point_preparation_exports WHERE branch_ids<@$1::uuid[]) SELECT (SELECT count(*)::int FROM rows) AS total,coalesce((SELECT jsonb_agg(v) FROM (SELECT * FROM rows ORDER BY created_at DESC,id DESC LIMIT 20 OFFSET $2) v),'[]'::jsonb) AS items`,
        [i.branch_ids, (page - 1) * 20],
      );
      return r;
    });
  }
  async exported(i: Identity, id: string) {
    permit(i, "point_export");
    validate(uuid, id);
    return this.db.transaction(i.tenant_id, async (tx) => {
      const [r] = await tx.query(
        "SELECT id,branch_ids,employee_count,sha256,created_at,content FROM point_preparation_exports WHERE id=$1",
        [id],
      );
      if (!r) fail(404, "Pacote não encontrado.");
      for (const branch of r.branch_ids) branchAccess(i, branch);
      if (digest(r.content) !== r.sha256)
        fail(
          409,
          "O pacote armazenado não confere com o registro de integridade.",
        );
      await audit(tx, i, "point.export.downloaded", id, { sha256: r.sha256 });
      return r;
    });
  }
  unavailable(i: Identity) {
    permit(i, "point_settings");
    fail(
      409,
      "Integração ainda não conectada. O adaptador, a autenticação, a habilitação comercial e a homologação precisam ser validados com o projeto de ponto existente. Nenhum dado foi enviado.",
    );
  }
}

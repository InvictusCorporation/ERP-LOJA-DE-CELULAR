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
import { normalizeCnpj, validCnpj } from "../shared/fiscal";
import { fiscalKey, sealCertificate } from "./fiscal-vault";
type Row = Record<string, any>;
const optional = (max: number) => z.string().trim().max(max).default("");
const digits = (length: number) =>
  optional(length).refine(
    (s) => !s || new RegExp(`^\\d{${length}}$`).test(s),
    `Use ${length} dígitos.`,
  );
const version = z.number().int().min(0);
const issuerSchema = z
  .object({
    version,
    legal_name: optional(180),
    cnpj: optional(24)
      .transform(normalizeCnpj)
      .refine((s) => !s || validCnpj(s), "CNPJ inválido."),
    state_registration: optional(30),
    municipal_registration: optional(30),
    state: optional(2).refine(
      (s) =>
        !s ||
        "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO"
          .split(" ")
          .includes(s),
      "UF inválida.",
    ),
    municipality_code: digits(7),
    address: optional(300),
    postal_code: digits(8),
    regime: z
      .enum([
        "unknown",
        "mei",
        "simples",
        "presumed",
        "real",
        "excess",
        "other",
      ])
      .default("unknown"),
    size: z.enum(["unknown", "mei", "me", "epp", "other"]).default("unknown"),
    provider_name: optional(100),
    accountant_notes: optional(2000),
  })
  .strict();
const productSchema = z
  .object({
    version,
    ncm: digits(8),
    cest: digits(7),
    cfop: digits(4),
    origin: z
      .enum(["", "0", "1", "2", "3", "4", "5", "6", "7", "8"])
      .default(""),
    unit: z
      .string()
      .trim()
      .max(6)
      .regex(/^[A-Z0-9]{0,6}$/)
      .default(""),
    icms_code: optional(3).refine(
      (s) => !s || /^\d{2,3}$/.test(s),
      "Use CST de 2 ou CSOSN de 3 dígitos.",
    ),
    notes: optional(1000),
  })
  .strict();
function paging(q: Row) {
  return {
    page: validate(
      z.coerce.number().int().min(1).max(100000).default(1),
      q.page,
    ),
    q: validate(optional(100), q.q),
  };
}
export class FiscalService {
  constructor(
    private db: Database,
    private inventory: InventoryService,
  ) {}
  private async branch(tx: Tx, i: Identity, id: string) {
    branchAccess(i, id);
    const [b] = await tx.query(
      "SELECT id,name,active FROM branches WHERE id=$1",
      [id],
    );
    if (!b) fail(404, "Filial não encontrada.");
    return b;
  }
  async overview(i: Identity, q: Row) {
    permit(i, "fiscal_read");
    const id = validate(uuid, q.branch_id);
    return this.db.transaction(i.tenant_id, async (tx) => {
      const branch = await this.branch(tx, i, id);
      const [issuer] = await tx.query(
        "SELECT profile,version,updated_at FROM fiscal_issuers WHERE branch_id=$1",
        [id],
      );
      const [certificate] = await tx.query(
        "SELECT filename,sha256,active,version,updated_at FROM fiscal_certificates WHERE branch_id=$1",
        [id],
      );
      return {
        branch,
        issuer: issuer || { profile: {}, version: 0 },
        certificate: certificate || null,
        integration: {
          status: "not_configured",
          official_emission: false,
          environment: "preparation",
          blockers: [
            "Selecionar e integrar o emissor fiscal.",
            "Validar cadastro, tributos, credenciamento e certificado com a contabilidade.",
            "Homologar emissão, consulta, cancelamento e recuperação de XML antes da produção.",
          ],
        },
      };
    });
  }
  async saveIssuer(i: Identity, id: string, body: unknown, key: unknown) {
    permit(i, "fiscal_settings");
    branchAccess(i, id);
    const b = validate(issuerSchema, body),
      { version: expected, ...profile } = b;
    if (
      (b.size === "mei" && !["unknown", "mei"].includes(b.regime)) ||
      (b.regime === "mei" && !["unknown", "mei"].includes(b.size))
    )
      fail(
        400,
        "MEI / SIMEI deve usar o porte MEI. Confira o enquadramento com a contabilidade.",
      );
    return this.inventory.write(
      i,
      key,
      { op: "fiscal.issuer", id, b },
      async (tx) => {
        await this.branch(tx, i, id);
        await tx.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1,0))::text",
          ["fiscal-issuer:" + i.tenant_id + ":" + id],
        );
        const [old] = await tx.query(
          "SELECT version FROM fiscal_issuers WHERE branch_id=$1",
          [id],
        );
        if ((old?.version || 0) !== expected)
          fail(409, "Cadastro fiscal alterado. Atualize a tela.");
        await tx.query(
          "INSERT INTO fiscal_issuers(tenant_id,branch_id,profile) VALUES($1,$2,$3::jsonb) ON CONFLICT(tenant_id,branch_id) DO UPDATE SET profile=excluded.profile,version=fiscal_issuers.version+1,updated_at=now() RETURNING version",
          [i.tenant_id, id, JSON.stringify(profile)],
        );
        await audit(
          tx,
          i,
          "fiscal.issuer.saved",
          id,
          { version: expected + 1 },
          id,
        );
        return { version: expected + 1 };
      },
    );
  }
  async products(i: Identity, q: Row) {
    permit(i, "fiscal_read");
    const { page, q: search } = paging(q);
    return this.db.transaction(i.tenant_id, async (tx) => {
      const [r] = await tx.query(
        `WITH rows AS (SELECT p.id,p.name,p.sku,p.active,f.profile,coalesce(f.version,0) AS version FROM products p LEFT JOIN fiscal_products f ON f.product_id=p.id WHERE strpos(lower(p.name||' '||p.sku),lower($1))>0) SELECT (SELECT count(*)::int FROM rows) AS total,coalesce((SELECT jsonb_agg(v) FROM (SELECT * FROM rows ORDER BY name,id LIMIT 20 OFFSET $2) v),'[]'::jsonb) AS items`,
        [search, (page - 1) * 20],
      );
      return r;
    });
  }
  async saveProduct(i: Identity, id: string, body: unknown, key: unknown) {
    permit(i, "fiscal_manage");
    validate(uuid, id);
    const b = validate(productSchema, body),
      { version: expected, ...profile } = b;
    return this.inventory.write(
      i,
      key,
      { op: "fiscal.product", id, b },
      async (tx) => {
        const [p] = await tx.query(
          "SELECT id FROM products WHERE id=$1 FOR UPDATE",
          [id],
        );
        if (!p) fail(404, "Produto não encontrado.");
        const [old] = await tx.query(
          "SELECT version FROM fiscal_products WHERE product_id=$1",
          [id],
        );
        if ((old?.version || 0) !== expected)
          fail(409, "Classificação alterada. Atualize a tela.");
        await tx.query(
          "INSERT INTO fiscal_products(tenant_id,product_id,profile) VALUES($1,$2,$3::jsonb) ON CONFLICT(tenant_id,product_id) DO UPDATE SET profile=excluded.profile,version=fiscal_products.version+1,updated_at=now() RETURNING version",
          [i.tenant_id, id, JSON.stringify(profile)],
        );
        await audit(tx, i, "fiscal.product.saved", id, {
          version: expected + 1,
        });
        return { version: expected + 1 };
      },
    );
  }
  async sources(i: Identity, q: Row) {
    permit(i, "fiscal_read");
    const branch = validate(uuid, q.branch_id),
      { page, q: search } = paging(q);
    branchAccess(i, branch);
    return this.db.transaction(i.tenant_id, async (tx) => {
      const [r] = await tx.query(
        `WITH rows AS (
        SELECT s.id,'sale' AS kind,s.receipt_code AS code,s.total_cents::bigint AS total_cents,s.created_at FROM pos_sales s WHERE s.branch_id=$1 AND s.status='completed' AND NOT EXISTS(SELECT 1 FROM fiscal_drafts d WHERE d.sale_id=s.id)
        UNION ALL SELECT r.id,'repair',r.code,q.labor_price_cents::bigint,r.delivered_at FROM repair_orders r JOIN repair_quotes q ON q.id=r.current_quote_id WHERE r.branch_id=$1 AND r.status='delivered' AND r.delivery_outcome='ready' AND q.labor_price_cents>0 AND NOT EXISTS(SELECT 1 FROM fiscal_drafts d WHERE d.repair_id=r.id)
      ),filtered AS (SELECT * FROM rows WHERE strpos(lower(code),lower($2))>0) SELECT (SELECT count(*)::int FROM filtered) AS total,coalesce((SELECT jsonb_agg(v) FROM (SELECT * FROM filtered ORDER BY created_at DESC,id LIMIT 20 OFFSET $3) v),'[]'::jsonb) AS items`,
        [branch, search, (page - 1) * 20],
      );
      return r;
    });
  }
  async prepare(i: Identity, body: unknown, key: unknown) {
    permit(i, "fiscal_manage");
    const b = validate(
      z
        .object({
          branch_id: uuid,
          source_id: uuid,
          source_kind: z.enum(["sale", "repair"]),
          model: z.enum(["nfe", "nfce", "nfse"]),
        })
        .strict(),
      body,
    );
    branchAccess(i, b.branch_id);
    if ((b.source_kind === "repair") !== (b.model === "nfse"))
      fail(
        400,
        "NFS-e é preparada a partir do serviço; NF-e e NFC-e a partir da venda.",
      );
    return this.inventory.write(
      i,
      key,
      { op: "fiscal.prepare", b },
      async (tx) => {
        await this.branch(tx, i, b.branch_id);
        await tx.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1,0))::text",
          ["fiscal-source:" + i.tenant_id + ":" + b.source_id],
        );
        const [old] = await tx.query(
          "SELECT id FROM fiscal_drafts WHERE sale_id=$1 OR repair_id=$1",
          [b.source_id],
        );
        if (old)
          fail(
            409,
            "Esta origem já possui preparação fiscal. Consulte os documentos, inclusive os arquivados.",
          );
        const [issuer] = await tx.query(
          "SELECT profile,version FROM fiscal_issuers WHERE branch_id=$1",
          [b.branch_id],
        );
        let source: Row,
          items: Row[],
          payments: Row[] = [];
        if (b.source_kind === "sale") {
          const [s] = await tx.query(
            "SELECT id,receipt_code,status,subtotal_cents,discount_cents,total_cents,created_at FROM pos_sales WHERE id=$1 AND branch_id=$2 FOR SHARE",
            [b.source_id, b.branch_id],
          );
          if (!s) fail(404, "Venda não encontrada.");
          if (s.status !== "completed")
            fail(
              409,
              "Prepare apenas vendas concluídas sem devolução ou cancelamento.",
            );
          source = s;
          items = await tx.query(
            "SELECT s.product_id,s.product_name,s.sku,s.quantity,s.unit_price_cents,s.discount_cents,s.net_cents,f.profile AS tax_profile,coalesce(f.version,0) AS tax_version FROM pos_sale_items s LEFT JOIN fiscal_products f ON f.product_id=s.product_id WHERE s.sale_id=$1 ORDER BY s.id",
            [s.id],
          );
          payments = await tx.query(
            "SELECT method,amount_cents FROM pos_sale_payments WHERE sale_id=$1 ORDER BY method",
            [s.id],
          );
        } else {
          const [r] = await tx.query(
            "SELECT r.id,r.code,r.status,r.delivery_outcome,r.customer_id,r.customer_name,r.work_report,r.delivered_at,q.labor_price_cents,q.revision AS quote_revision FROM repair_orders r JOIN repair_quotes q ON q.id=r.current_quote_id WHERE r.id=$1 AND r.branch_id=$2 FOR SHARE OF r",
            [b.source_id, b.branch_id],
          );
          if (!r) fail(404, "Serviço não encontrado.");
          if (
            r.status !== "delivered" ||
            r.delivery_outcome !== "ready" ||
            !r.labor_price_cents
          )
            fail(
              409,
              "Prepare apenas serviços reparados e entregues com mão de obra cobrada.",
            );
          source = r;
          items = [
            {
              description: r.work_report,
              quantity: 1,
              net_cents: r.labor_price_cents,
              kind: "labor_only",
            },
          ];
        }
        const snapshot = {
          schema_version: 1,
          purpose: "fiscal_preparation_only",
          model: b.model,
          issuer: issuer || null,
          source,
          items,
          payments,
          limitations: [
            "Sem validade fiscal. Não enviado ao fisco.",
            "Destinatário, endereço, regras tributárias e campos exigidos pelo emissor ainda precisam de revisão.",
            ...(b.source_kind === "repair"
              ? [
                  "Contém somente mão de obra; peças exigem tratamento fiscal separado.",
                ]
              : []),
          ],
        };
        const id = randomUUID();
        await tx.query(
          "INSERT INTO fiscal_drafts(id,tenant_id,branch_id,model,source_kind,sale_id,repair_id,snapshot,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9) RETURNING id",
          [
            id,
            i.tenant_id,
            b.branch_id,
            b.model,
            b.source_kind,
            b.source_kind === "sale" ? b.source_id : null,
            b.source_kind === "repair" ? b.source_id : null,
            JSON.stringify(snapshot),
            i.user_id,
          ],
        );
        await audit(
          tx,
          i,
          "fiscal.draft.prepared",
          id,
          { model: b.model, source_id: b.source_id },
          b.branch_id,
        );
        return { id };
      },
    );
  }
  async drafts(i: Identity, q: Row) {
    permit(i, "fiscal_read");
    const branch = validate(uuid, q.branch_id),
      { page, q: search } = paging(q),
      status = validate(
        z.enum(["all", "prepared", "archived"]).default("all"),
        q.status,
      );
    branchAccess(i, branch);
    return this.db.transaction(i.tenant_id, async (tx) => {
      const [r] = await tx.query(
        `WITH rows AS (SELECT d.id,d.model,d.source_kind,d.created_at,coalesce(d.snapshot->'source'->>'receipt_code',d.snapshot->'source'->>'code') AS code,CASE WHEN a.draft_id IS NULL THEN 'prepared' ELSE 'archived' END AS status FROM fiscal_drafts d LEFT JOIN fiscal_draft_archives a ON a.draft_id=d.id WHERE d.branch_id=$1),filtered AS (SELECT * FROM rows WHERE ($2='all' OR status=$2) AND strpos(lower(code),lower($3))>0) SELECT (SELECT count(*)::int FROM filtered) AS total,coalesce((SELECT jsonb_agg(v) FROM (SELECT * FROM filtered ORDER BY created_at DESC,id LIMIT 20 OFFSET $4) v),'[]'::jsonb) AS items`,
        [branch, status, search, (page - 1) * 20],
      );
      return r;
    });
  }
  private async draft(tx: Tx, i: Identity, id: string) {
    const [r] = await tx.query(
      "SELECT d.*,a.reason AS archive_reason,a.created_at AS archived_at FROM fiscal_drafts d LEFT JOIN fiscal_draft_archives a ON a.draft_id=d.id WHERE d.id=$1",
      [id],
    );
    if (!r) fail(404, "Preparação não encontrada.");
    branchAccess(i, r.branch_id);
    return r;
  }
  async detail(i: Identity, id: string) {
    permit(i, "fiscal_read");
    validate(uuid, id);
    return this.db.transaction(i.tenant_id, async (tx) => {
      const draft = await this.draft(tx, i, id);
      const [live] = await tx.query(
        draft.source_kind === "sale"
          ? "SELECT status FROM pos_sales WHERE id=$1"
          : "SELECT status,version FROM repair_orders WHERE id=$1",
        [draft.sale_id || draft.repair_id],
      );
      const files = await tx.query(
        "SELECT id,filename,sha256,byte_length,description,created_at FROM fiscal_files WHERE draft_id=$1 ORDER BY created_at DESC,id",
        [id],
      );
      return { draft, source_now: live, files, official_emission: false };
    });
  }
  async archive(i: Identity, id: string, body: unknown, key: unknown) {
    permit(i, "fiscal_manage");
    validate(uuid, id);
    const b = validate(
      z.object({ reason: z.string().trim().min(5).max(500) }).strict(),
      body,
    );
    return this.inventory.write(
      i,
      key,
      { op: "fiscal.archive", id, b },
      async (tx) => {
        const d = await this.draft(tx, i, id);
        if (d.archived_at) fail(409, "Preparação já arquivada.");
        await tx.query(
          "INSERT INTO fiscal_draft_archives(tenant_id,draft_id,reason,created_by) VALUES($1,$2,$3,$4) RETURNING draft_id",
          [i.tenant_id, id, b.reason, i.user_id],
        );
        await audit(
          tx,
          i,
          "fiscal.draft.archived",
          id,
          { reason: b.reason },
          d.branch_id,
        );
        return { ok: true };
      },
    );
  }
  async files(i: Identity, q: Row) {
    permit(i, "fiscal_read");
    const branch = validate(uuid, q.branch_id),
      { page, q: search } = paging(q);
    branchAccess(i, branch);
    return this.db.transaction(i.tenant_id, async (tx) => {
      const [r] = await tx.query(
        `WITH rows AS (SELECT id,draft_id,filename,sha256,byte_length,description,created_at FROM fiscal_files WHERE branch_id=$1 AND strpos(lower(filename||' '||description),lower($2))>0) SELECT (SELECT count(*)::int FROM rows) AS total,coalesce((SELECT jsonb_agg(v) FROM (SELECT * FROM rows ORDER BY created_at DESC,id LIMIT 20 OFFSET $3) v),'[]'::jsonb) AS items`,
        [branch, search, (page - 1) * 20],
      );
      return r;
    });
  }
  async upload(i: Identity, body: unknown, key: unknown) {
    permit(i, "fiscal_manage");
    const b = validate(
      z
        .object({
          branch_id: uuid,
          draft_id: uuid.nullable().default(null),
          filename: z
            .string()
            .trim()
            .min(5)
            .max(120)
            .regex(/^[\p{L}\p{N}_. -]+\.xml$/iu),
          content: z.string().min(1).max(65536),
          description: z.string().trim().min(5).max(500),
        })
        .strict(),
      body,
    );
    branchAccess(i, b.branch_id);
    const length = Buffer.byteLength(b.content, "utf8");
    if (length > 65536) fail(400, "XML limitado a 64 KB.");
    // Never parse or render uploaded XML. This is an unverified, inert archive.
    if (
      !b.content.trimStart().startsWith("<") ||
      /<!DOCTYPE|<!ENTITY|\u0000/i.test(b.content)
    )
      fail(
        400,
        "Arquivo incompatível. DTD, entidades e caracteres nulos não são aceitos.",
      );
    const hash = createHash("sha256").update(b.content, "utf8").digest("hex");
    return this.inventory.write(
      i,
      key,
      { op: "fiscal.file", ...b, content: hash },
      async (tx) => {
        await this.branch(tx, i, b.branch_id);
        if (b.draft_id) {
          const d = await this.draft(tx, i, b.draft_id);
          if (d.branch_id !== b.branch_id)
            fail(400, "O documento pertence a outra filial.");
        }
        const [old] = await tx.query(
          "SELECT id FROM fiscal_files WHERE branch_id=$1 AND sha256=$2",
          [b.branch_id, hash],
        );
        if (old) fail(409, "Este arquivo já está guardado nesta filial.");
        const id = randomUUID();
        await tx.query(
          "INSERT INTO fiscal_files(id,tenant_id,branch_id,draft_id,filename,content,sha256,byte_length,description,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id",
          [
            id,
            i.tenant_id,
            b.branch_id,
            b.draft_id,
            b.filename,
            // Transport bytes as base64 through SQL text codecs; preserve UTF-8 BOM.
            Buffer.from(b.content, "utf8").toString("base64"),
            hash,
            length,
            b.description,
            i.user_id,
          ],
        );
        await audit(
          tx,
          i,
          "fiscal.file.archived",
          id,
          { sha256: hash, byte_length: length },
          b.branch_id,
        );
        return { id, sha256: hash };
      },
    );
  }
  async file(i: Identity, id: string) {
    permit(i, "fiscal_read");
    validate(uuid, id);
    return this.db.transaction(i.tenant_id, async (tx) => {
      const [r] = await tx.query("SELECT * FROM fiscal_files WHERE id=$1", [
        id,
      ]);
      if (!r) fail(404, "Arquivo não encontrado.");
      branchAccess(i, r.branch_id);
      const bytes = Buffer.from(r.content, "base64");
      if (
        bytes.length !== r.byte_length ||
        createHash("sha256").update(bytes).digest("hex") !== r.sha256
      )
        fail(
          409,
          "O arquivo armazenado não confere com o registro de integridade. Verifique o backup.",
        );
      await audit(
        tx,
        i,
        "fiscal.file.downloaded",
        id,
        { sha256: r.sha256 },
        r.branch_id,
      );
      return {
        ...r,
        content: bytes.toString("utf8"),
        verification: "unverified",
      };
    });
  }
  async unavailable(i: Identity, id: string) {
    permit(i, "fiscal_manage");
    validate(uuid, id);
    await this.db.transaction(i.tenant_id, (tx) => this.draft(tx, i, id));
    fail(
      409,
      "Emissão, consulta oficial e cancelamento fiscal ainda indisponíveis. Configure e homologue a integração com o emissor. Arquivar uma preparação não cancela uma nota.",
    );
  }
  async certificate(i: Identity, branch: string, body: unknown, key: unknown) {
    permit(i, "fiscal_settings");
    branchAccess(i, branch);
    const b = validate(
      z
        .object({
          version,
          filename: z
            .string()
            .min(5)
            .max(120)
            .regex(/^[\p{L}\p{N}_. -]+\.(pfx|p12)$/iu),
          pfx: z
            .string()
            .min(4)
            .max(350000)
            .regex(
              /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,
            ),
          password: z.string().max(256),
        })
        .strict(),
      body,
    );
    const pfx = Buffer.from(b.pfx, "base64");
    if (!pfx.length || pfx.length > 262144)
      fail(400, "Certificado limitado a 256 KB.");
    const hash = createHash("sha256").update(pfx).digest("hex");
    const existingLocalCertificates = this.db.embedded
      ? (
          await this.db.system<{ count: number }>(
            "SELECT count(*)::int AS count FROM fiscal_certificates WHERE active",
          )
        )[0].count > 0
      : false;
    const sealed = sealCertificate(
      await fiscalKey(existingLocalCertificates),
      i.tenant_id,
      branch,
      pfx,
      b.password,
    );
    const fingerprint = createHash("sha256")
      .update(b.pfx)
      .update("\0")
      .update(b.password)
      .digest("hex");
    return this.inventory.write(
      i,
      key,
      {
        op: "fiscal.certificate",
        branch,
        version: b.version,
        filename: b.filename,
        fingerprint,
      },
      async (tx) => {
        await this.branch(tx, i, branch);
        await tx.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1,0))::text",
          ["fiscal-issuer:" + i.tenant_id + ":" + branch],
        );
        const [old] = await tx.query(
          "SELECT version FROM fiscal_certificates WHERE branch_id=$1",
          [branch],
        );
        if ((old?.version || 0) !== b.version)
          fail(409, "Certificado alterado. Atualize a tela.");
        await tx.query(
          "INSERT INTO fiscal_certificates(tenant_id,branch_id,filename,sha256,sealed) VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT(tenant_id,branch_id) DO UPDATE SET filename=excluded.filename,sha256=excluded.sha256,sealed=excluded.sealed,active=true,version=fiscal_certificates.version+1,updated_at=now() RETURNING version",
          [i.tenant_id, branch, b.filename, hash, JSON.stringify(sealed)],
        );
        await audit(
          tx,
          i,
          "fiscal.certificate.imported",
          branch,
          { sha256: hash },
          branch,
        );
        return { version: b.version + 1 };
      },
    );
  }
  async removeCertificate(
    i: Identity,
    branch: string,
    body: unknown,
    key: unknown,
  ) {
    permit(i, "fiscal_settings");
    branchAccess(i, branch);
    const b = validate(
      z
        .object({
          version: z.number().int().positive(),
          reason: z.string().trim().min(5).max(500),
        })
        .strict(),
      body,
    );
    return this.inventory.write(
      i,
      key,
      { op: "fiscal.certificate.remove", branch, b },
      async (tx) => {
        await this.branch(tx, i, branch);
        await tx.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1,0))::text",
          ["fiscal-issuer:" + i.tenant_id + ":" + branch],
        );
        const rows = await tx.query(
          "UPDATE fiscal_certificates SET sealed=NULL,active=false,filename='',sha256='',version=version+1,updated_at=now() WHERE branch_id=$1 AND version=$2 AND active RETURNING branch_id",
          [branch, b.version],
        );
        if (!rows.length)
          fail(409, "Certificado alterado ou removido. Atualize a tela.");
        await audit(
          tx,
          i,
          "fiscal.certificate.removed",
          branch,
          { reason: b.reason },
          branch,
        );
        return { ok: true };
      },
    );
  }
}

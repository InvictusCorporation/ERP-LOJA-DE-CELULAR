import "reflect-metadata";
import {
  Controller,
  Module,
  All,
  Req,
  Res,
  Inject,
  HttpException,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { Request, Response } from "express";
import cookieParser from "cookie-parser";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { Database } from "./db";
import {
  InventoryService,
  validate,
  uuid,
  fail,
  permit,
  branchAccess,
  audit,
} from "./domain";
import {
  hashToken,
  token,
  passwordMatches,
  passwordHash,
  Identity,
  permissions,
} from "./security";

const limits = new Map<string, { count: number; until: number }>();
function rateLimit(key: string, max = 10) {
  const now = Date.now();
  if (limits.size > 10000)
    for (const [k, v] of limits) if (v.until < now) limits.delete(k);
  let value = limits.get(key);
  if (!value || value.until < now) {
    value = { count: 0, until: now + 15 * 60000 };
    limits.set(key, value);
  }
  if (++value.count > max) fail(429, "Muitas tentativas. Aguarde 15 minutos.");
}
const cookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
  path: "/",
  maxAge: 8 * 3600000,
});
@Controller("api")
class ApiController {
  constructor(
    @Inject(Database) private db: Database,
    @Inject(InventoryService) private inventory: InventoryService,
  ) {}
  @All("{*path}")
  async handle(@Req() req: Request, @Res() res: Response) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    try {
      const data = await this.route(req, res);
      if (!res.headersSent) res.json(data);
    } catch (error: any) {
      const code = error.meta?.code || error.code;
      if (error instanceof HttpException)
        res.status(error.getStatus()).json({ error: error.message });
      else if (code === "23505" || error.code === "P2002")
        res.status(409).json({
          error:
            "Já existe um cadastro com este SKU, código de barras, IMEI, série, nome ou e-mail.",
        });
      else if (code === "23503")
        res
          .status(400)
          .json({ error: "O registro relacionado não existe nesta empresa." });
      else if (code === "40001" || code === "40P01" || error.code === "P2034")
        res.status(409).json({
          error: "Conflito entre operações. Atualize e tente novamente.",
        });
      else {
        const reference = randomUUID();
        console.error(
          JSON.stringify({
            event: "request.failed",
            reference,
            path: req.path,
            code: code || "internal",
          }),
        );
        res.status(500).json({
          error: `Não foi possível concluir. Referência: ${reference}`,
        });
      }
    }
  }
  private async identity(req: Request): Promise<Identity> {
    const session = req.cookies?.invictus_session;
    if (typeof session !== "string" || session.length !== 64)
      fail(401, "Entre na sua conta.");
    const [i] = await this.db.system<Identity>(
      `SELECT s.user_id,s.tenant_id,s.csrf,u.name,u.email,m.role,m.branch_ids FROM sessions s
   JOIN users u ON u.id=s.user_id JOIN memberships m ON m.user_id=s.user_id AND m.tenant_id=s.tenant_id
   WHERE s.token_hash=$1 AND s.expires_at>now() AND u.active AND m.active`,
      [hashToken(session)],
    );
    if (!i) fail(401, "Sessão expirada. Entre novamente.");
    return i;
  }
  private async route(req: Request, res: Response): Promise<any> {
    const path = req.path.replace(/^\/api/, "").replace(/\/$/, "") || "/";
    const method = req.method;
    const body = req.body;
    const key = req.headers["idempotency-key"];
    if (method !== "GET" && method !== "HEAD") {
      if (
        !req.headers.origin ||
        req.headers.origin !==
          (process.env.APP_ORIGIN || "http://localhost:3000")
      )
        fail(403, "Origem da requisição não autorizada.");
      if (!req.is("application/json")) fail(415, "Envie os dados em JSON.");
    }
    if (path === "/health" && method === "GET") return { ok: true };
    if (path === "/public/config" && method === "GET")
      return {
        localProvisioning: !!this.db.embedded,
        mode: this.db.embedded ? "local" : "production",
      };
    if (path === "/setup" && method === "POST") {
      rateLimit(`setup:${req.ip}`, 5);
      if (!this.db.embedded)
        fail(403, "Provisionamento controlado pela central.");
      return this.inventory.bootstrap(body);
    }
    if (path === "/login" && method === "POST") {
      rateLimit(`login:${req.ip}`, 40);
      const b = validate(
        z
          .object({
            email: z
              .email()
              .max(254)
              .transform((v) => v.toLowerCase()),
            password: z.string().min(1).max(128),
            tenant_id: uuid.optional(),
          })
          .strict(),
        body,
      );
      rateLimit(`email:${b.email}`, 10);
      const [u] = await this.db.system<any>(
        "SELECT * FROM users WHERE email=$1 AND active",
        [b.email],
      );
      const valid = passwordMatches(
        b.password,
        u?.password_hash ||
          "00000000000000000000000000000000:" + "00".repeat(64),
      );
      if (!u || !valid) fail(401, "E-mail ou senha inválidos.");
      const memberships = await this.db.system<any>(
        "SELECT * FROM memberships WHERE user_id=$1 AND active",
        [u.id],
      );
      const m = b.tenant_id
        ? memberships.find((x) => x.tenant_id === b.tenant_id)
        : memberships[0];
      if (!m) fail(401, "Nenhuma empresa autorizada.");
      const raw = token(),
        csrf = token();
      await this.db.system(
        "INSERT INTO sessions(token_hash,user_id,tenant_id,csrf,expires_at) VALUES($1,$2,$3,$4,now()+interval '8 hours') RETURNING token_hash",
        [hashToken(raw), u.id, m.tenant_id, csrf],
      );
      await this.db.transaction(m.tenant_id, (tx) =>
        audit(
          tx,
          { user_id: u.id, tenant_id: m.tenant_id } as Identity,
          "auth.login",
          u.id,
        ),
      );
      res.cookie("invictus_session", raw, cookieOptions());
      return { ok: true };
    }
    const i = await this.identity(req);
    permit(i, "read");
    if (method !== "GET" && req.headers["x-csrf-token"] !== i.csrf)
      fail(403, "Token de segurança inválido. Atualize a página.");
    if (path === "/me" && method === "GET")
      return this.db.transaction(i.tenant_id, async (tx) => {
        const [tenant] = await tx.query("SELECT id,name,slug FROM tenants");
        const branches = await tx.query(
          "SELECT id,name FROM branches WHERE active AND id=ANY($1::uuid[]) ORDER BY name",
          [i.branch_ids],
        );
        return {
          user: { name: i.name, email: i.email, role: i.role },
          tenant,
          branches,
          permissions: permissions(i.role),
          csrf: i.csrf,
          mode: this.db.embedded ? "local" : "production",
        };
      });
    if (path === "/logout" && method === "POST") {
      await this.db.system(
        "DELETE FROM sessions WHERE token_hash=$1 RETURNING token_hash",
        [hashToken(req.cookies.invictus_session)],
      );
      res.clearCookie("invictus_session", cookieOptions());
      return { ok: true };
    }
    if (path === "/overview" && method === "GET")
      return this.inventory.overview(i, String(req.query.branch_id || ""));
    if (path === "/products" && method === "GET")
      return this.inventory.products(
        i,
        String(req.query.branch_id || ""),
        String(req.query.q || ""),
        req.query.archived === "true",
        validate(
          z.coerce.number().int().min(1).max(100000),
          req.query.page || 1,
        ),
      );
    if (path === "/products" && method === "POST")
      return this.inventory.saveProduct(i, body, key);
    const product = path.match(/^\/products\/([\w-]+)$/);
    if (product && method === "PUT")
      return this.inventory.saveProduct(i, body, key, product[1]);
    if (product && method === "DELETE")
      return this.inventory.archive(i, product[1], key);
    if (path === "/catalog" && method === "GET")
      return this.db.transaction(i.tenant_id, async (tx) => ({
        items: await tx.query(
          "SELECT * FROM catalog_entries ORDER BY kind,name",
        ),
      }));
    if (path === "/catalog" && method === "POST") {
      permit(i, "catalog");
      const b = validate(
        z
          .object({
            kind: z.enum(["category", "brand", "model", "supplier"]),
            name: z.string().trim().min(1).max(180),
            contact: z.string().trim().max(300).default(""),
          })
          .strict(),
        body,
      );
      return this.inventory.write(
        i,
        key,
        { action: "catalog", b },
        async (tx) => {
          const id = randomUUID();
          await tx.query(
            "INSERT INTO catalog_entries(id,tenant_id,kind,name,contact) VALUES($1,$2,$3,$4,$5) RETURNING id",
            [id, i.tenant_id, b.kind, b.name, b.contact],
          );
          await audit(tx, i, "catalog.created", id, {
            kind: b.kind,
            name: b.name,
          });
          return { id };
        },
      );
    }
    if (path === "/movements" && method === "POST")
      return this.inventory.move(i, body, key);
    if (path === "/inventory" && method === "POST")
      return this.inventory.count(i, body, key);
    if (path === "/minimum" && method === "PUT")
      return this.inventory.minimum(i, body, key);
    const reverse = path.match(/^\/movements\/([\w-]+)\/reverse$/);
    if (reverse && method === "POST")
      return this.inventory.reverse(i, reverse[1], body?.reason, key);
    if (path === "/movements" && method === "GET") {
      const branch = String(req.query.branch_id || "");
      branchAccess(i, branch);
      const productId = req.query.product_id
        ? validate(uuid, req.query.product_id)
        : null;
      const page = validate(
        z.coerce.number().int().min(1).max(100000),
        req.query.page || 1,
      );
      return this.db.transaction(i.tenant_id, async (tx) => ({
        items: await tx.query(
          `SELECT m.*,p.name AS product_name,p.sku,u.name AS actor_name,r.id AS reversal_id FROM stock_movements m JOIN products p ON p.id=m.product_id JOIN users u ON u.id=m.actor_id LEFT JOIN stock_movements r ON r.reverses_id=m.id WHERE m.branch_id=$1 AND ($2::uuid IS NULL OR m.product_id=$2) ORDER BY m.created_at DESC,m.id DESC LIMIT 50 OFFSET $3`,
          [branch, productId, (page - 1) * 50],
        ),
      }));
    }
    if (path === "/units" && method === "GET") {
      const branch = String(req.query.branch_id || "");
      branchAccess(i, branch);
      const productId = req.query.product_id
        ? validate(uuid, req.query.product_id)
        : null;
      return this.db.transaction(i.tenant_id, async (tx) => {
        const units = await tx.query(
          `SELECT d.*,p.name AS product_name,coalesce(array_agg(di.imei) FILTER(WHERE di.imei IS NOT NULL),'{}') AS imeis FROM device_units d JOIN products p ON p.id=d.product_id LEFT JOIN device_identifiers di ON di.unit_id=d.id WHERE d.branch_id=$1 AND ($2::uuid IS NULL OR d.product_id=$2) GROUP BY d.id,p.name ORDER BY d.created_at DESC LIMIT 500`,
          [branch, productId],
        );
        if (!permissions(i.role).includes("cost"))
          units.forEach((u) => delete u.acquisition_cost);
        return { items: units };
      });
    }
    if (path === "/audit" && method === "GET") {
      permit(i, "audit");
      return this.db.transaction(i.tenant_id, async (tx) => ({
        items: await tx.query(
          "SELECT a.*,u.name AS actor_name FROM audit_events a LEFT JOIN users u ON u.id=a.actor_id WHERE a.branch_id IS NULL OR a.branch_id=ANY($1::uuid[]) ORDER BY a.created_at DESC LIMIT 200",
          [i.branch_ids],
        ),
      }));
    }
    if (path === "/branches" && method === "POST") {
      permit(i, "branches");
      const b = validate(
        z.object({ name: z.string().trim().min(1).max(180) }).strict(),
        body,
      );
      // Local foundation only; commercial branch administration is a later module.
      if (!this.db.embedded)
        fail(403, "Cadastro de filial deve ser provisionado pela central.");
      const id = randomUUID();
      await this.db.provision(async (tx) => {
        await tx.query(
          "INSERT INTO branches(id,tenant_id,name) VALUES($1,$2,$3) RETURNING id",
          [id, i.tenant_id, b.name],
        );
        await tx.query(
          "UPDATE memberships SET branch_ids=array_append(branch_ids,$1::uuid) WHERE tenant_id=$2 AND role='owner' RETURNING id",
          [id, i.tenant_id],
        );
        await audit(tx, i, "branch.created", id, { name: b.name });
      });
      return { id };
    }
    if (path === "/users" && method === "GET") {
      permit(i, "users");
      return {
        items: await this.db.system(
          "SELECT u.id,u.name,u.email,m.role,m.branch_ids,m.active FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.tenant_id=$1 ORDER BY u.name",
          [i.tenant_id],
        ),
      };
    }
    if (path === "/users" && method === "POST") {
      permit(i, "users");
      if (!this.db.embedded)
        fail(403, "Usuários devem ser provisionados pela central.");
      const b = validate(
        z
          .object({
            name: z.string().trim().min(1).max(180),
            email: z
              .email()
              .max(254)
              .transform((v) => v.toLowerCase()),
            password: z.string().min(12).max(128),
            role: z.enum(["manager", "stock", "viewer"]),
            branch_ids: z.array(uuid).min(1).max(100),
          })
          .strict(),
        body,
      );
      b.branch_ids.forEach((branch) => branchAccess(i, branch));
      const id = randomUUID();
      await this.db.provision(async (tx) => {
        await tx.query(
          "INSERT INTO users(id,name,email,password_hash) VALUES($1,$2,$3,$4) RETURNING id",
          [id, b.name, b.email, passwordHash(b.password)],
        );
        await tx.query(
          "INSERT INTO memberships(id,tenant_id,user_id,role,branch_ids) VALUES($1,$2,$3,$4,$5::uuid[]) RETURNING id",
          [randomUUID(), i.tenant_id, id, b.role, b.branch_ids],
        );
        await audit(tx, i, "user.created", id, { role: b.role });
      });
      return { id };
    }
    fail(404, "Operação não encontrada.");
  }
}
export async function createApp(db: Database) {
  @Module({
    controllers: [ApiController],
    providers: [
      { provide: Database, useValue: db },
      { provide: InventoryService, useValue: new InventoryService(db) },
    ],
  })
  class AppModule {}
  const app = await NestFactory.create(AppModule, {
    logger: ["error", "warn"],
    bodyParser: false,
  });
  const express = await import("express");
  app.use(express.json({ limit: "128kb" }));
  app.use(cookieParser());
  return app;
}

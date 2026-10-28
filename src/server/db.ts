import "dotenv/config";
import { PGlite } from "@electric-sql/pglite";
import { PrismaClient } from "@prisma/client";
import {
  readFile,
  mkdir,
  readdir,
  chmod,
  open,
  unlink,
} from "node:fs/promises";
import { resolve, join } from "node:path";

// OneDrive marks Windows directories read-only as a presentation attribute.
// NODEFS maps that attribute to POSIX 0444, which PostgreSQL interprets as a
// real write restriction. Normalize directory attributes, never database files.
async function prepareWindowsDirectories(directory: string): Promise<void> {
  if (process.platform !== "win32") return;
  await chmod(directory, 0o700);
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && !entry.isSymbolicLink())
      await prepareWindowsDirectories(join(directory, entry.name));
  }
}

export interface Tx {
  query<T = Record<string, any>>(sql: string, params?: any[]): Promise<T[]>;
}
export class Database {
  embedded?: PGlite;
  prisma?: PrismaClient;
  private queue: Promise<unknown> = Promise.resolve();
  private lockFile?: string;
  private async acquireLock(directory: string) {
    const lock = directory + ".process.lock";
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const file = await open(lock, "wx");
        await file.writeFile(JSON.stringify({ pid: process.pid }));
        await file.close();
        this.lockFile = lock;
        return;
      } catch (error: any) {
        if (error.code !== "EEXIST") throw error;
        const { pid } = JSON.parse(await readFile(lock, "utf8"));
        if (!Number.isInteger(pid) || pid <= 0)
          throw new Error(
            "Arquivo de bloqueio local inválido. Verifique se a API está parada.",
          );
        let alive = true;
        try {
          process.kill(pid, 0);
        } catch (e: any) {
          if (e.code === "ESRCH") alive = false;
          else throw e;
        }
        if (alive)
          throw new Error(
            "O banco local já está aberto por outro processo. Pare a outra API.",
          );
        await unlink(lock);
      }
    }
    throw new Error("Não foi possível bloquear o banco local.");
  }
  async open(dataDir = process.env.DATA_DIR || ".data/invictus") {
    if (process.env.DB_MODE === "postgres") {
      this.prisma = new PrismaClient();
      await this.prisma.$connect();
      const roles = await this.prisma.$queryRawUnsafe<any[]>(
        "SELECT current_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user",
      );
      if (
        roles[0]?.current_user !== "invictus_app" ||
        roles[0]?.rolsuper ||
        roles[0]?.rolbypassrls
      )
        throw new Error(
          "Use DATABASE_URL com a role invictus_app sem privilégios de proprietário.",
        );
    } else {
      if (process.env.NODE_ENV === "production")
        throw new Error("Produção exige DB_MODE=postgres.");
      if (dataDir !== "memory://") {
        await mkdir(resolve(dataDir), { recursive: true });
        await this.acquireLock(resolve(dataDir));
        await prepareWindowsDirectories(resolve(dataDir));
      }
      this.embedded = new PGlite(
        dataDir === "memory://" ? undefined : resolve(dataDir),
      );
      await this.embedded.waitReady;
      const found = await this.embedded.query<{ name: string }>(
        "SELECT tablename AS name FROM pg_tables WHERE schemaname='public' AND tablename='tenants'",
      );
      if (!found.rows.length)
        await this.embedded.transaction(async (tx) => {
          await tx.exec(
            await readFile(
              resolve(
                "prisma/migrations/202610280001_foundation/migration.sql",
              ),
              "utf8",
            ),
          );
        });
    }
  }
  async system<T>(sql: string, params: any[] = []): Promise<T[]> {
    if (this.embedded)
      return this.serial(
        async () => (await this.embedded!.query<T>(sql, params)).rows,
      );
    return this.prisma!.$queryRawUnsafe<T[]>(sql, ...params);
  }
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.queue.then(fn);
    this.queue = p.catch(() => {});
    return p;
  }
  async transaction<T>(tenant: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    if (this.embedded)
      return this.serial(() =>
        this.embedded!.transaction(async (raw) => {
          await raw.exec("SET LOCAL ROLE invictus_app");
          await raw.query("SELECT set_config('app.tenant_id',$1,true)", [
            tenant,
          ]);
          return fn({
            query: async <R>(sql: string, params: any[] = []) =>
              (await raw.query<R>(sql, params)).rows,
          });
        }),
      );
    return this.prisma!.$transaction(
      async (raw) => {
        await raw.$queryRawUnsafe(
          "SELECT set_config('app.tenant_id',$1,true)",
          tenant,
        );
        return fn({
          query: <R>(sql: string, params: any[] = []) =>
            raw.$queryRawUnsafe<R[]>(sql, ...params),
        });
      },
      { timeout: 15000 },
    );
  }
  async provision<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    if (!this.embedded)
      throw new Error(
        "Provisionamento deve ser realizado pela central em produção.",
      );
    return this.serial(() =>
      this.embedded!.transaction(async (raw) =>
        fn({
          query: async <R>(sql: string, params: any[] = []) =>
            (await raw.query<R>(sql, params)).rows,
        }),
      ),
    );
  }
  async close() {
    await this.embedded?.close();
    this.embedded = undefined;
    await this.prisma?.$disconnect();
    if (this.lockFile) {
      await unlink(this.lockFile);
      this.lockFile = undefined;
    }
  }
}

import "dotenv/config";
import { Database } from "../src/server/db";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
async function main() {
  if (process.env.DB_MODE === "postgres")
    throw new Error(
      "Produção: utilize pg_dump e PITR conforme docs/OPERACAO.md.",
    );
  if (process.env.BACKUP_OFFLINE_ACK !== "yes")
    throw new Error(
      "Pare a API antes do backup. Confirme com BACKUP_OFFLINE_ACK=yes.",
    );
  const db = new Database();
  await db.open();
  try {
    await mkdir("backups", { recursive: true });
    const dump = await db.embedded!.dumpDataDir("gzip");
    const path = resolve(
      "backups",
      `invictus-${new Date().toISOString().replace(/[:.]/g, "-")}.tar.gz`,
    );
    await writeFile(path, Buffer.from(await dump.arrayBuffer()));
    // The local vault key is deliberately outside PostgreSQL and outside Git.
    // Keep a companion recovery copy; production env keys need a separate vault backup.
    if (!process.env.FISCAL_ENCRYPTION_KEY) {
      try {
        const key = await readFile(
          resolve((process.env.DATA_DIR || ".data/invictus") + ".fiscal-key"),
        );
        if (key.length !== 32) throw new Error("Chave fiscal local inválida.");
        await writeFile(path + ".fiscal-key", key, { mode: 0o600, flag: "wx" });
      } catch (e: any) {
        if (e.code !== "ENOENT") throw e;
        const active = await db.embedded!.query<{ count: number }>(
          "SELECT count(*)::int AS count FROM fiscal_certificates WHERE active",
        );
        if (active.rows[0].count)
          throw new Error(
            "Backup contém certificados, mas falta a chave fiscal local. Recupere a chave antes de concluir o backup.",
          );
      }
    }
    console.log(path);
  } finally {
    await db.close();
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});

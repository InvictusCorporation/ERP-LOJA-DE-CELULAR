import "dotenv/config";
import { Database } from "../src/server/db";
import { mkdir, writeFile } from "node:fs/promises";
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
    console.log(path);
  } finally {
    await db.close();
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});

import "dotenv/config";
import { PGlite } from "@electric-sql/pglite";
import { access, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { openCertificate } from "../src/server/fiscal-vault";
async function main() {
  const [file, target] = process.argv.slice(2);
  if (!file || !target)
    throw new Error("Uso: pnpm db:restore arquivo.tar.gz NOVO_DIRETORIO");
  const dir = resolve(target);
  let exists = false;
  try {
    await access(dir);
    exists = true;
  } catch {}
  if (exists)
    throw new Error("Restaure em um diretório novo. O destino já existe.");
  const data = await readFile(resolve(file));
  let fiscalKey: Buffer | undefined;
  try {
    fiscalKey = await readFile(resolve(file) + ".fiscal-key");
  } catch (e: any) {
    if (e.code !== "ENOENT") throw e;
  }
  if (fiscalKey && fiscalKey.length !== 32)
    throw new Error("Chave fiscal do backup inválida.");
  const db = new PGlite({ dataDir: dir, loadDataDir: new Blob([data]) });
  try {
    await db.waitReady;
    const r = await db.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM tenants",
    );
    const certificateCount = await db
      .query<{
        count: number;
      }>("SELECT count(*)::int AS count FROM fiscal_certificates WHERE active")
      .catch((e: any) => {
        if (e.code === "42P01") return { rows: [{ count: 0 }] };
        throw e;
      });
    if (
      certificateCount.rows[0].count &&
      !fiscalKey &&
      !process.env.FISCAL_ENCRYPTION_KEY
    )
      throw new Error(
        "Backup contém certificados. Restaure também a chave do cofre fiscal antes de usar este banco.",
      );
    if (certificateCount.rows[0].count) {
      const configured = process.env.FISCAL_ENCRYPTION_KEY;
      if (configured && !/^[a-f0-9]{64}$/i.test(configured))
        throw new Error("Chave fiscal configurada inválida.");
      const recoveryKey = configured
        ? Buffer.from(configured, "hex")
        : fiscalKey!;
      const certificates = await db.query<{
        tenant_id: string;
        branch_id: string;
        sealed: any;
      }>(
        "SELECT tenant_id,branch_id,sealed FROM fiscal_certificates WHERE active",
      );
      try {
        for (const certificate of certificates.rows)
          openCertificate(
            recoveryKey,
            certificate.tenant_id,
            certificate.branch_id,
            certificate.sealed,
          );
      } catch {
        throw new Error(
          "A chave fornecida não recupera os certificados do backup. Preserve o banco e restaure a chave original.",
        );
      }
    }
    if (fiscalKey)
      await writeFile(dir + ".fiscal-key", fiscalKey, {
        flag: "wx",
        mode: 0o600,
      });
    console.log(
      `Restauração verificada: ${r.rows[0].count} empresa(s). Destino: ${dir}`,
    );
  } finally {
    await db.close();
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});

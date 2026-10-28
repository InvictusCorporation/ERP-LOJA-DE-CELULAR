import { PGlite } from "@electric-sql/pglite";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
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
  const db = new PGlite({ dataDir: dir, loadDataDir: new Blob([data]) });
  try {
    await db.waitReady;
    const r = await db.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM tenants",
    );
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

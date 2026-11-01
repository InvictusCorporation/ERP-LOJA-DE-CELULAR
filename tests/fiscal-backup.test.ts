import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, writeFile, readFile, rm, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Database } from "../src/server/db";
import { InventoryService } from "../src/server/domain";
import { sealCertificate, openCertificate } from "../src/server/fiscal-vault";
import { testCertificate } from "./helpers/fiscal-certificate";
test("Backup e restauração recuperam certificado cifrado com chave companheira e recusam chave errada", async () => {
  const root = await mkdtemp(join(tmpdir(), "invictus-fiscal-recovery-")),
    data = join(root, "source"),
    restored = join(root, "restored"),
    db = new Database(),
    execute = promisify(execFile),
    key = randomBytes(32),
    password = "senha-ficticia-de-teste";
  let backup: string | undefined;
  try {
    await db.open(data);
    await new InventoryService(db).bootstrap({
      company: "Recuperação fiscal fictícia",
      name: "Teste",
      branch: "Matriz",
      email: "recovery-fiscal@test.local",
      password: "Recovery-Fiscal-Testing-2026!",
    });
    const [identity] = await db.system<any>(
        "SELECT m.tenant_id,m.user_id,m.branch_ids[1] AS branch_id FROM memberships m LIMIT 1",
      ),
      pfx = testCertificate(password),
      sealed = sealCertificate(
        key,
        identity.tenant_id,
        identity.branch_id,
        pfx,
        password,
      );
    await db.transaction(identity.tenant_id, (tx) =>
      tx.query(
        "INSERT INTO fiscal_certificates(tenant_id,branch_id,filename,sha256,sealed) VALUES($1,$2,'teste.pfx','hash-ficticio',$3::jsonb) RETURNING branch_id",
        [identity.tenant_id, identity.branch_id, JSON.stringify(sealed)],
      ),
    );
    await writeFile(data + ".fiscal-key", key, { mode: 0o600 });
    await db.close();
    const env = {
      ...process.env,
      DB_MODE: "embedded",
      DATA_DIR: data,
      BACKUP_OFFLINE_ACK: "yes",
      FISCAL_ENCRYPTION_KEY: "",
    };
    const run = await execute(
      process.execPath,
      [resolve("dist/scripts/backup.js")],
      { env, timeout: 60000 },
    );
    backup = run.stdout.trim().split(/\r?\n/).at(-1)!;
    assert.equal(
      (await readFile(backup + ".fiscal-key")).toString("hex"),
      key.toString("hex"),
    );
    await assert.rejects(
      execute(
        process.execPath,
        [resolve("dist/scripts/restore.js"), backup, join(root, "wrong-key")],
        {
          env: {
            ...env,
            FISCAL_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
          },
          timeout: 60000,
        },
      ),
      /A chave fornecida não recupera/,
    );
    await execute(
      process.execPath,
      [resolve("dist/scripts/restore.js"), backup, restored],
      { env, timeout: 60000 },
    );
    const recoveredKey = await readFile(restored + ".fiscal-key");
    await db.open(restored);
    const [certificate] = await db.system<any>(
      "SELECT tenant_id,branch_id,sealed FROM fiscal_certificates WHERE active",
    );
    assert.deepEqual(
      openCertificate(
        recoveredKey,
        certificate.tenant_id,
        certificate.branch_id,
        certificate.sealed,
      ),
      { pfx: pfx.toString("base64"), password },
    );
  } finally {
    await db.close();
    if (backup) {
      await unlink(backup).catch(() => {});
      await unlink(backup + ".fiscal-key").catch(() => {});
    }
    // Only the unique temporary directory created by this test is removed.
    if (resolve(root).startsWith(resolve(tmpdir()) + require("node:path").sep))
      await rm(root, { recursive: true, force: true });
  }
});

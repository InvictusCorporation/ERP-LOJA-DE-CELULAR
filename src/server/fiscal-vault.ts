import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createSecureContext } from "node:tls";
import { fail } from "./domain";

export async function fiscalKey(requireExisting = false): Promise<Buffer> {
  const configured = process.env.FISCAL_ENCRYPTION_KEY;
  if (configured) {
    if (!/^[a-f0-9]{64}$/i.test(configured))
      fail(
        503,
        "Chave do cofre fiscal inválida. Verifique a configuração do servidor.",
      );
    return Buffer.from(configured, "hex");
  }
  if (
    process.env.NODE_ENV === "production" ||
    process.env.DB_MODE === "postgres"
  )
    fail(
      503,
      "Configure o cofre fiscal no servidor antes de importar certificados.",
    );
  const path = resolve(
    (process.env.DATA_DIR || ".data/invictus") + ".fiscal-key",
  );
  await mkdir(dirname(path), { recursive: true });
  try {
    return checked(await readFile(path));
  } catch (e: any) {
    if (e.code !== "ENOENT") throw e;
  }
  if (requireExisting)
    fail(
      503,
      "A chave do cofre fiscal não foi encontrada. Restaure a chave original antes de alterar certificados.",
    );
  const key = randomBytes(32);
  try {
    await writeFile(path, key, { flag: "wx", mode: 0o600 });
    return key;
  } catch (e: any) {
    if (e.code !== "EEXIST") throw e;
    return checked(await readFile(path));
  }
}
function checked(key: Buffer) {
  if (key.length !== 32)
    fail(503, "Cofre fiscal indisponível. Verifique a chave do servidor.");
  return key;
}
export function sealCertificate(
  key: Buffer,
  tenant: string,
  branch: string,
  pfx: Buffer,
  password: string,
) {
  try {
    createSecureContext({ pfx, passphrase: password });
  } catch {
    fail(
      400,
      "Não foi possível abrir o certificado A1. Confira o arquivo PFX/P12, a senha e a compatibilidade do certificado.",
    );
  }
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(`invictus:fiscal:v1:${tenant}:${branch}`));
  const encrypted = Buffer.concat([
    cipher.update(
      JSON.stringify({ pfx: pfx.toString("base64"), password }),
      "utf8",
    ),
    cipher.final(),
  ]);
  return {
    v: 1,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: encrypted.toString("base64"),
  };
}
// Server-only primitive for a future issuer adapter. There is no HTTP secret retrieval route.
export function openCertificate(
  key: Buffer,
  tenant: string,
  branch: string,
  packet: ReturnType<typeof sealCertificate>,
) {
  if (packet.v !== 1) throw new Error("Versão de cofre fiscal desconhecida.");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(packet.iv, "base64"),
  );
  decipher.setAAD(Buffer.from(`invictus:fiscal:v1:${tenant}:${branch}`));
  decipher.setAuthTag(Buffer.from(packet.tag, "base64"));
  return JSON.parse(
    Buffer.concat([
      decipher.update(Buffer.from(packet.data, "base64")),
      decipher.final(),
    ]).toString("utf8"),
  ) as { pfx: string; password: string };
}

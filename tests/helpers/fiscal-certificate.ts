import forge from "node-forge";
// Generated on every run. No private certificate or password is checked into Git.
export function testCertificate(password: string) {
  const keys = forge.pki.rsa.generateKeyPair(2048),
    cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date(Date.now() - 60000);
  cert.validity.notAfter = new Date(Date.now() + 86400000);
  const attrs = [
    { name: "commonName", value: "CERTIFICADO FICTICIO TESTE ERP" },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], password, {
    algorithm: "aes256",
  });
  return Buffer.from(forge.asn1.toDer(p12).getBytes(), "binary");
}

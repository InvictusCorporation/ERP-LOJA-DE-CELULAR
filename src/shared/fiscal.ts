// Receita Federal's modulo 11, including alphanumeric registrations.
export function normalizeCnpj(value: string) {
  return value
    .trim()
    .toUpperCase()
    .replace(/[.\/\-\s]/g, "");
}
export function validCnpj(value: string) {
  const s = normalizeCnpj(value);
  if (!/^[A-Z0-9]{12}\d{2}$/.test(s) || /^(.)\1{13}$/.test(s)) return false;
  const digit = (base: string) => {
    let sum = 0,
      weight = 2;
    for (let j = base.length - 1; j >= 0; j--) {
      sum += (base.charCodeAt(j) - 48) * weight;
      weight = weight === 9 ? 2 : weight + 1;
    }
    const remainder = sum % 11;
    return remainder < 2 ? "0" : String(11 - remainder);
  };
  return digit(s.slice(0, 12)) === s[12] && digit(s.slice(0, 13)) === s[13];
}
export const fiscalModels: Record<string, string> = {
  nfe: "NF-e",
  nfce: "NFC-e",
  nfse: "NFS-e",
};
export const fiscalRegimes: Record<string, string> = {
  unknown: "A definir com a contabilidade",
  mei: "MEI / SIMEI",
  simples: "Simples Nacional",
  presumed: "Lucro Presumido",
  real: "Lucro Real",
  excess: "Simples com excesso de sublimite",
  other: "Outro",
};
export const fiscalSizes: Record<string, string> = {
  unknown: "A definir",
  mei: "Microempreendedor individual (MEI)",
  me: "Microempresa (ME)",
  epp: "Empresa de pequeno porte (EPP)",
  other: "Demais portes",
};
export const fiscalStates = [
  "AC|Acre",
  "AL|Alagoas",
  "AP|Amapá",
  "AM|Amazonas",
  "BA|Bahia",
  "CE|Ceará",
  "DF|Distrito Federal",
  "ES|Espírito Santo",
  "GO|Goiás",
  "MA|Maranhão",
  "MT|Mato Grosso",
  "MS|Mato Grosso do Sul",
  "MG|Minas Gerais",
  "PA|Pará",
  "PB|Paraíba",
  "PR|Paraná",
  "PE|Pernambuco",
  "PI|Piauí",
  "RJ|Rio de Janeiro",
  "RN|Rio Grande do Norte",
  "RS|Rio Grande do Sul",
  "RO|Rondônia",
  "RR|Roraima",
  "SC|Santa Catarina",
  "SP|São Paulo",
  "SE|Sergipe",
  "TO|Tocantins",
].map((s) => s.split("|"));

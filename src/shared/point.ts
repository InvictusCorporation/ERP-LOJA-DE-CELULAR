type Row = Record<string, any>;
// Existing module 9 contract: keep its shape and semantics stable.
export function pointEmployeeMapping(e: Row, tenantId: string) {
  return {
    schema_version: 1,
    tenant_id: tenantId,
    employee_id: e.id,
    user_id: e.user_id,
    external_employee_id: e.point_external_id || null,
    name: e.name,
    employee_code: e.employee_code || null,
    job_title: e.job_title,
    job_function: e.job_function,
    home_branch_id: e.home_branch_id,
    branch_ids: e.branch_ids,
    active: e.active && e.account_active,
    version: e.version,
    integration_status: "mapping_only",
    attendance: null,
  };
}
export function canonicalPointJson(value: unknown): string {
  if (Array.isArray(value))
    return "[" + value.map(canonicalPointJson).join(",") + "]";
  if (value !== null && typeof value === "object")
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map(
          (k) =>
            JSON.stringify(k) + ":" + canonicalPointJson((value as Row)[k]),
        )
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
export const pointReleaseGates = [
  "Analisar o projeto de ponto existente e validar o contrato de integração.",
  "Configurar autenticação entre sistemas e isolamento de empresa e filiais.",
  "Confirmar a habilitação do módulo na central de assinaturas.",
  "Homologar envio, respostas perdidas, reenvio e reconciliação.",
  "Validar requisitos legais, documentos do sistema, integridade e proteção dos dados antes do uso comercial.",
];

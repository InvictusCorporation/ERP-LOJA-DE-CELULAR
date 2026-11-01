// One access model for API checks, assignments and the employee editor.
export const roleLabels: Record<string, string> = {
  owner: "Proprietário",
  administrator: "Administrador",
  manager: "Gerente",
  seller: "Vendedor",
  cashier: "Operador de caixa",
  technician: "Técnico",
  financial: "Financeiro",
  stock: "Estoquista",
  viewer: "Consulta",
};
export const roleRights: Record<string, string[]> = {
  owner: [
    "point_read",
    "point_export",
    "point_settings",
    "fiscal_read",
    "fiscal_manage",
    "fiscal_settings",
    "branch_read",
    "branch_transfer",
    "reports_read",
    "purchase_read",
    "purchase_manage",
    "credit_read",
    "credit_manage",
    "credit_settings",
    "credit_sell",
    "finance_read",
    "finance_manage",
    "crm_read",
    "crm_manage",
    "customer_lookup",
    "read",
    "catalog",
    "stock",
    "adjust",
    "branches",
    "users",
    "cost",
    "audit",
    "pos_read",
    "pos_sell",
    "pos_cash",
    "pos_manage",
    "pos_discount",
    "pos_refund",
    "service_read",
    "service_manage",
    "service_work",
    "service_parts",
    "service_cost",
    "service_approve",
    "service_deliver",
  ],
  manager: [
    "fiscal_read",
    "fiscal_manage",
    "branch_read",
    "branch_transfer",
    "reports_read",
    "purchase_read",
    "purchase_manage",
    "credit_read",
    "credit_manage",
    "credit_sell",
    "finance_read",
    "finance_manage",
    "crm_read",
    "crm_manage",
    "customer_lookup",
    "read",
    "catalog",
    "stock",
    "adjust",
    "cost",
    "audit",
    "pos_read",
    "pos_sell",
    "pos_cash",
    "pos_manage",
    "pos_discount",
    "pos_refund",
    "service_read",
    "service_manage",
    "service_work",
    "service_parts",
    "service_cost",
    "service_approve",
    "service_deliver",
  ],
  cashier: [
    "read",
    "pos_read",
    "pos_sell",
    "pos_cash",
    "customer_lookup",
    "credit_sell",
  ],
  technician: ["read", "service_read", "service_work", "service_parts"],
  stock: ["read", "stock", "branch_read", "branch_transfer"],
  viewer: ["read"],
};

roleRights.administrator = roleRights.owner.filter(
  (r) =>
    ![
      "branches",
      "credit_settings",
      "fiscal_settings",
      "point_settings",
    ].includes(r),
);
roleRights.seller = [...roleRights.cashier, "crm_read", "crm_manage"];
roleRights.financial = [
  "fiscal_read",
  "fiscal_manage",
  "branch_read",
  "read",
  "cost",
  "finance_read",
  "finance_manage",
  "credit_read",
  "credit_manage",
];
export const permissionLabels: Record<string, string> = {
  point_read: "Consultar preparação da integração de ponto",
  point_export: "Preparar e baixar pacotes cadastrais do ponto",
  point_settings: "Configurar integração e vínculos de filiais do ponto",
  fiscal_read: "Consultar preparação fiscal e arquivos XML",
  fiscal_manage: "Preparar documentos, classificar produtos e guardar XML",
  fiscal_settings: "Configurar emitente e certificado fiscal",
  read: "Entrar e consultar estoque básico",
  cost: "Consultar custos do estoque",
  catalog: "Gerir produtos e cadastros",
  stock: "Entradas e saídas de estoque",
  adjust: "Inventário, mínimos e estornos de estoque",
  branches: "Gerir cadastro e situação das filiais",
  branch_read: "Consultar gestão das filiais autorizadas",
  branch_transfer: "Transferir mercadorias entre filiais autorizadas",
  users: "Gerir funcionários e acessos",
  audit: "Consultar auditoria geral",
  pos_read: "Consultar PDV",
  pos_sell: "Realizar vendas",
  pos_cash: "Abrir e movimentar o próprio caixa",
  pos_manage: "Gerir caixas, vendas de outros operadores e custos do PDV",
  pos_discount: "Conceder descontos no PDV",
  pos_refund: "Autorizar devoluções do PDV",
  customer_lookup: "Buscar cliente para venda",
  crm_read: "Consultar CRM e dados de clientes",
  crm_manage: "Gerir clientes, oportunidades e lembretes",
  service_read: "Consultar assistência",
  service_manage: "Gerir todas as ordens da filial",
  service_work: "Executar ordens atribuídas",
  service_parts: "Consumir e devolver peças em ordens atribuídas",
  service_cost: "Consultar custos da assistência",
  service_approve: "Registrar aprovação de orçamento",
  service_deliver: "Registrar entrega de serviço",
  finance_read: "Consultar financeiro, custos e DRE",
  finance_manage: "Gerir títulos, contas, baixas e conciliação",
  credit_read: "Consultar contratos e cobrança",
  credit_manage: "Gerir perfis, ofertas e pagamentos do crediário",
  credit_settings: "Definir política de crediário",
  credit_sell: "Vender com oferta de crediário aprovada",
  purchase_read: "Consultar fornecedores e compras",
  purchase_manage: "Gerir pedidos e recebimentos de compras",
  reports_read: "Consultar relatórios e margens gerenciais",
};
export const reservedPermissions = [
  "read",
  "users",
  "branches",
  "credit_settings",
  "fiscal_settings",
  "point_settings",
];
export const dependencies: Record<string, string[]> = {
  point_read: ["users"],
  point_export: ["point_read"],
  point_settings: ["point_read"],
  fiscal_manage: ["fiscal_read"],
  fiscal_settings: ["fiscal_read"],
  branch_transfer: ["branch_read", "stock"],
  catalog: ["cost"],
  adjust: ["stock"],
  pos_sell: ["pos_read", "pos_cash"],
  pos_manage: ["pos_read", "pos_cash"],
  pos_discount: ["pos_sell"],
  pos_refund: ["pos_manage"],
  credit_sell: ["pos_sell", "customer_lookup"],
  crm_manage: ["crm_read"],
  service_manage: ["service_read"],
  service_work: ["service_read"],
  service_parts: ["service_read"],
  service_cost: ["service_read"],
  service_approve: ["service_manage"],
  service_deliver: ["service_manage"],
  finance_manage: ["finance_read"],
  credit_manage: ["credit_read"],
  credit_settings: ["credit_read"],
  purchase_manage: ["purchase_read"],
  reports_read: ["cost", "service_cost", "finance_read"],
};
export type Access = {
  role: string;
  permission_grants?: string[];
  permission_denials?: string[];
};
export function effectivePermissions(value: string | Access): string[] {
  const i = typeof value === "string" ? { role: value } : value;
  const base = Object.hasOwn(roleRights, i.role) ? roleRights[i.role] : [];
  if (i.role === "owner") return [...base];
  const result = new Set(base);
  for (const r of i.permission_grants || [])
    if (Object.hasOwn(permissionLabels, r) && !reservedPermissions.includes(r))
      result.add(r);
  for (const r of i.permission_denials || [])
    if (!reservedPermissions.includes(r)) result.delete(r);
  let changed = true;
  while (changed) {
    changed = false;
    for (const right of result)
      if ((dependencies[right] || []).some((parent) => !result.has(parent))) {
        result.delete(right);
        changed = true;
      }
  }
  return [...result];
}

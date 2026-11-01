// ERP-owned port to be implemented after inspecting the existing point project.
// These are internal boundaries, not assertions about a provider's HTTP endpoints.
export type PointConnectorContext = {
  tenantId: string;
  externalTenantId: string;
  environment: "sandbox" | "production";
  correlationId: string;
};
export type PointConnectorCapabilities = {
  employeeMapping: boolean;
  attendanceRead: boolean;
  reconciliation: boolean;
};
export interface PointConnector {
  readonly id: string;
  readonly contractVersion: string;
  capabilities(
    context: PointConnectorContext,
  ): Promise<PointConnectorCapabilities>;
  // A real adapter must reconcile a lost response before attempting another delivery.
  deliverEmployeeMapping(
    context: PointConnectorContext,
    canonicalManifest: string,
    idempotencyKey: string,
  ): Promise<{
    reference: string;
    status: "accepted" | "pending" | "rejected";
  }>;
  deliveryStatus(
    context: PointConnectorContext,
    reference: string,
  ): Promise<{ status: "accepted" | "pending" | "rejected" }>;
}
// No adapter is registered or called by the preparation module.

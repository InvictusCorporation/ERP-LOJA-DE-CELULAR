-- Read-only reporting access paths; no business data changes.
CREATE INDEX returns_period ON pos_returns(tenant_id,branch_id,created_at DESC);
CREATE INDEX report_sale_product ON pos_sale_items(tenant_id,product_id,sale_id);
CREATE INDEX report_stock_activity ON stock_movements(tenant_id,branch_id,product_id,created_at DESC) WHERE quantity>0;
CREATE INDEX report_repair_delivery ON repair_orders(tenant_id,branch_id,delivered_at) WHERE status='delivered';
CREATE INDEX report_repair_ready ON repair_orders(tenant_id,branch_id,ready_at) WHERE ready_at IS NOT NULL;

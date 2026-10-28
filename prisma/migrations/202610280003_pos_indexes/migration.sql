-- Access paths for session summaries and partial-return reconciliation.
CREATE INDEX pos_sales_session ON pos_sales(tenant_id,session_id);
CREATE INDEX pos_returns_session ON pos_returns(tenant_id,session_id);
CREATE INDEX pos_return_item_history ON pos_return_items(tenant_id,sale_item_id);
CREATE INDEX cash_session_history ON cash_sessions(tenant_id,branch_id,opened_at DESC);

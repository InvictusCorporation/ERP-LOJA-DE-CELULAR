CREATE TABLE repair_notifications (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,branch_id uuid NOT NULL,order_id uuid NOT NULL,ready_at timestamptz NOT NULL,
 state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','sending','accepted','blocked','failed','uncertain','cancelled')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),provider_message_id text,
 last_error text NOT NULL DEFAULT '',claimed_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,order_id,ready_at),
 FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id),FOREIGN KEY(tenant_id,order_id) REFERENCES repair_orders(tenant_id,id)
);
CREATE INDEX repair_notifications_queue ON repair_notifications(tenant_id,state,created_at);
ALTER TABLE repair_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE repair_notifications FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON repair_notifications USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
GRANT SELECT,INSERT,UPDATE ON repair_notifications TO invictus_app;

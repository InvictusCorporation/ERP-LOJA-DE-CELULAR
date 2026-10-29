ALTER TABLE customers ADD COLUMN city text NOT NULL DEFAULT '', ADD COLUMN state text NOT NULL DEFAULT '', ADD COLUMN notes text NOT NULL DEFAULT '', ADD COLUMN active boolean NOT NULL DEFAULT true, ADD COLUMN version integer NOT NULL DEFAULT 1, ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
GRANT UPDATE ON customers TO invictus_app;
ALTER TABLE pos_sales ADD COLUMN customer_id uuid, ADD COLUMN customer_name text NOT NULL DEFAULT '';
ALTER TABLE pos_sales ADD FOREIGN KEY(tenant_id,customer_id) REFERENCES customers(tenant_id,id);
CREATE INDEX pos_customer_history ON pos_sales(tenant_id,customer_id,created_at DESC);
CREATE INDEX repair_customer_history ON repair_orders(tenant_id,customer_id,created_at DESC);
CREATE TABLE crm_opportunities (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, branch_id uuid NOT NULL, customer_id uuid NOT NULL,
 title text NOT NULL, stage text NOT NULL DEFAULT 'new' CHECK(stage IN ('new','contacted','proposal','won','lost')),
 value_cents integer NOT NULL CHECK(value_cents BETWEEN 0 AND 1000000000), owner_id uuid NOT NULL REFERENCES users(id),
 expected_on date, close_reason text NOT NULL DEFAULT '', version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id), FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id), FOREIGN KEY(tenant_id,customer_id) REFERENCES customers(tenant_id,id)
);
CREATE INDEX crm_pipeline ON crm_opportunities(tenant_id,branch_id,stage,updated_at DESC);
CREATE TABLE crm_tasks (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, branch_id uuid NOT NULL, customer_id uuid NOT NULL,
 title text NOT NULL, due_at timestamptz NOT NULL, owner_id uuid NOT NULL REFERENCES users(id),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','done','cancelled')), version integer NOT NULL DEFAULT 1,
 completed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id), FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id), FOREIGN KEY(tenant_id,customer_id) REFERENCES customers(tenant_id,id)
);
CREATE INDEX crm_agenda ON crm_tasks(tenant_id,branch_id,status,due_at);
CREATE TABLE crm_events (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, customer_id uuid NOT NULL, branch_id uuid,
 entity_id uuid NOT NULL, action text NOT NULL, details jsonb NOT NULL DEFAULT '{}',
 actor_id uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,customer_id) REFERENCES customers(tenant_id,id), FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id)
);
CREATE INDEX crm_events_history ON crm_events(tenant_id,customer_id,created_at DESC);
ALTER TABLE crm_opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON crm_opportunities USING(tenant_id=current_setting('app.tenant_id',true)::uuid) WITH CHECK(tenant_id=current_setting('app.tenant_id',true)::uuid);
CREATE POLICY tenant_isolation ON crm_tasks USING(tenant_id=current_setting('app.tenant_id',true)::uuid) WITH CHECK(tenant_id=current_setting('app.tenant_id',true)::uuid);
CREATE POLICY tenant_isolation ON crm_events USING(tenant_id=current_setting('app.tenant_id',true)::uuid) WITH CHECK(tenant_id=current_setting('app.tenant_id',true)::uuid);
GRANT SELECT,INSERT,UPDATE ON crm_opportunities,crm_tasks TO invictus_app;
GRANT SELECT,INSERT ON crm_events TO invictus_app;

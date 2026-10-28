CREATE ROLE invictus_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
CREATE TABLE tenants (id uuid PRIMARY KEY, name text NOT NULL, slug text UNIQUE NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE users (id uuid PRIMARY KEY, email text UNIQUE NOT NULL, name text NOT NULL, password_hash text NOT NULL, active boolean NOT NULL DEFAULT true);
CREATE TABLE memberships (id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), user_id uuid NOT NULL REFERENCES users(id), role text NOT NULL CHECK(role IN ('owner','manager','stock','viewer')), branch_ids uuid[] NOT NULL, active boolean NOT NULL DEFAULT true, UNIQUE(tenant_id,user_id));
CREATE TABLE sessions (token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), tenant_id uuid NOT NULL REFERENCES tenants(id), csrf text NOT NULL, expires_at timestamptz NOT NULL);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE branches (id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), name text NOT NULL, active boolean NOT NULL DEFAULT true, UNIQUE(tenant_id,id), UNIQUE(tenant_id,name));
CREATE TABLE catalog_entries (id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), kind text NOT NULL CHECK(kind IN ('category','brand','model','supplier')), name text NOT NULL, contact text NOT NULL DEFAULT '', UNIQUE(tenant_id,id), UNIQUE(tenant_id,kind,name));
CREATE TABLE products (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), name text NOT NULL, sku text NOT NULL, barcode text,
 category_id uuid, brand_id uuid, model_id uuid, supplier_id uuid, color text NOT NULL DEFAULT '', capacity text NOT NULL DEFAULT '',
 condition text NOT NULL CHECK(condition IN ('new','refurbished','used')), serialized boolean NOT NULL DEFAULT false,
 cost numeric(14,2) NOT NULL CHECK(cost>=0), price numeric(14,2) NOT NULL CHECK(price>=0),
 warranty_days integer NOT NULL CHECK(warranty_days BETWEEN 0 AND 3650), warranty_terms text NOT NULL DEFAULT '',
 active boolean NOT NULL DEFAULT true, version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,sku), UNIQUE(tenant_id,barcode),
 FOREIGN KEY(tenant_id,category_id) REFERENCES catalog_entries(tenant_id,id),
 FOREIGN KEY(tenant_id,brand_id) REFERENCES catalog_entries(tenant_id,id),
 FOREIGN KEY(tenant_id,model_id) REFERENCES catalog_entries(tenant_id,id),
 FOREIGN KEY(tenant_id,supplier_id) REFERENCES catalog_entries(tenant_id,id)
);
CREATE TABLE stock_balances (
 tenant_id uuid NOT NULL, branch_id uuid NOT NULL, product_id uuid NOT NULL, quantity integer NOT NULL DEFAULT 0 CHECK(quantity>=0),
 minimum integer NOT NULL DEFAULT 0 CHECK(minimum>=0), PRIMARY KEY(tenant_id,branch_id,product_id),
 FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id), FOREIGN KEY(tenant_id,product_id) REFERENCES products(tenant_id,id)
);
CREATE TABLE device_units (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, product_id uuid NOT NULL, branch_id uuid NOT NULL,
 serial text, provenance text NOT NULL, supplier_id uuid, acquisition_cost numeric(14,2) NOT NULL CHECK(acquisition_cost>=0),
 status text NOT NULL CHECK(status IN ('in_stock','out')), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,serial), FOREIGN KEY(tenant_id,product_id) REFERENCES products(tenant_id,id),
 FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id), FOREIGN KEY(tenant_id,supplier_id) REFERENCES catalog_entries(tenant_id,id)
);
CREATE TABLE device_identifiers (
 tenant_id uuid NOT NULL, unit_id uuid NOT NULL, imei text NOT NULL CHECK(imei ~ '^[0-9]{15}$'),
 PRIMARY KEY(tenant_id,imei), FOREIGN KEY(tenant_id,unit_id) REFERENCES device_units(tenant_id,id)
);
CREATE TABLE stock_movements (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, branch_id uuid NOT NULL, product_id uuid NOT NULL,
 type text NOT NULL CHECK(type IN ('entry','exit','adjustment','reversal')), quantity integer NOT NULL,
 balance_after integer NOT NULL CHECK(balance_after>=0), reason text NOT NULL, actor_id uuid NOT NULL REFERENCES users(id),
 unit_id uuid, reverses_id uuid, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), UNIQUE(tenant_id,reverses_id),
 FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id), FOREIGN KEY(tenant_id,product_id) REFERENCES products(tenant_id,id),
 FOREIGN KEY(tenant_id,unit_id) REFERENCES device_units(tenant_id,id), FOREIGN KEY(tenant_id,reverses_id) REFERENCES stock_movements(tenant_id,id)
);
CREATE INDEX movements_timeline ON stock_movements(tenant_id,branch_id,created_at DESC);
CREATE TABLE inventory_counts (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, branch_id uuid NOT NULL, product_id uuid NOT NULL,
 expected integer NOT NULL, counted integer NOT NULL CHECK(counted>=0), reason text NOT NULL, actor_id uuid NOT NULL REFERENCES users(id),
 movement_id uuid, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id), FOREIGN KEY(tenant_id,product_id) REFERENCES products(tenant_id,id),
 FOREIGN KEY(tenant_id,movement_id) REFERENCES stock_movements(tenant_id,id)
);
CREATE TABLE audit_events (id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), actor_id uuid REFERENCES users(id), branch_id uuid, action text NOT NULL, entity_id text NOT NULL, details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX audit_timeline ON audit_events(tenant_id,created_at DESC);
CREATE TABLE idempotency_keys (tenant_id uuid NOT NULL REFERENCES tenants(id), key uuid NOT NULL, fingerprint text NOT NULL, response jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,key));
-- Domain isolation applies to the runtime role; migration owner is separate.
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['tenants','branches','catalog_entries','products','stock_balances','device_units','device_identifiers','stock_movements','inventory_counts','audit_events','idempotency_keys'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  IF t = 'tenants' THEN
   EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (id = nullif(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK (id = nullif(current_setting(''app.tenant_id'',true),'''')::uuid)',t);
  ELSE
   EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = nullif(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'',true),'''')::uuid)',t);
  END IF;
 END LOOP;
END $$;
GRANT USAGE ON SCHEMA public TO invictus_app;
GRANT SELECT,INSERT,UPDATE ON tenants,branches,catalog_entries,products,stock_balances,device_units,device_identifiers,inventory_counts TO invictus_app;
GRANT SELECT,INSERT ON stock_movements,audit_events,idempotency_keys TO invictus_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON sessions TO invictus_app;
GRANT SELECT ON users,memberships TO invictus_app;
-- Provisioning is intentionally NOT granted to the ERP runtime role. The
-- central/administrative migration account provisions tenants outside this API.

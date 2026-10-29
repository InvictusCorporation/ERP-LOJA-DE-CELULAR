ALTER TABLE memberships DROP CONSTRAINT memberships_role_check;
ALTER TABLE memberships ADD CONSTRAINT memberships_role_check CHECK(role IN ('owner','manager','stock','viewer','cashier','technician'));
-- Shared customer foundation; CRM features belong to module 4.
CREATE TABLE customers (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), name text NOT NULL,
 phone text NOT NULL, email text NOT NULL DEFAULT '', contact_permission boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id)
);
CREATE INDEX customers_search ON customers(tenant_id,phone);
CREATE TABLE repair_orders (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, branch_id uuid NOT NULL, customer_id uuid NOT NULL,
 code text NOT NULL, customer_name text NOT NULL, customer_phone text NOT NULL, customer_email text NOT NULL DEFAULT '',
 brand text NOT NULL, model text NOT NULL, color text NOT NULL DEFAULT '', imei text CHECK(imei ~ '^[0-9]{15}$'), serial text,
 reported_fault text NOT NULL, physical_state text NOT NULL, accessories text NOT NULL DEFAULT '', intake_notes text NOT NULL DEFAULT '',
 technician_id uuid REFERENCES users(id), diagnosis text NOT NULL DEFAULT '', due_on date,
 status text NOT NULL CHECK(status IN ('received','diagnosis','awaiting_approval','approved','in_repair','ready','declined','cancelled','delivered')),
 version integer NOT NULL DEFAULT 1, current_quote_id uuid, work_report text NOT NULL DEFAULT '',
 warranty_days integer NOT NULL DEFAULT 0 CHECK(warranty_days BETWEEN 0 AND 3650), warranty_terms text NOT NULL DEFAULT '',
 warranty_expires_on date, ready_at timestamptz, delivered_at timestamptz, receiver_name text,
 delivery_notes text NOT NULL DEFAULT '', delivery_outcome text, delivered_by uuid REFERENCES users(id),
 created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,code),
 FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id), FOREIGN KEY(tenant_id,customer_id) REFERENCES customers(tenant_id,id)
);
CREATE UNIQUE INDEX repair_one_active_imei ON repair_orders(tenant_id,imei) WHERE imei IS NOT NULL AND status<>'delivered';
CREATE UNIQUE INDEX repair_one_active_serial ON repair_orders(tenant_id,serial) WHERE serial IS NOT NULL AND status<>'delivered';
CREATE INDEX repair_branch_queue ON repair_orders(tenant_id,branch_id,status,created_at DESC);
CREATE INDEX repair_device_history ON repair_orders(tenant_id,imei,created_at DESC);
CREATE TABLE repair_quotes (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, order_id uuid NOT NULL, revision integer NOT NULL CHECK(revision>0),
 labor_price_cents integer NOT NULL CHECK(labor_price_cents>=0), labor_cost_cents integer NOT NULL CHECK(labor_cost_cents>=0),
 total_cents integer NOT NULL CHECK(total_cents>=0), warranty_days integer NOT NULL CHECK(warranty_days BETWEEN 0 AND 3650), warranty_terms text NOT NULL DEFAULT '', notes text NOT NULL DEFAULT '', created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,order_id,id), UNIQUE(tenant_id,order_id,revision), FOREIGN KEY(tenant_id,order_id) REFERENCES repair_orders(tenant_id,id)
);
ALTER TABLE repair_orders ADD CONSTRAINT repair_current_quote FOREIGN KEY(tenant_id,id,current_quote_id) REFERENCES repair_quotes(tenant_id,order_id,id);
CREATE TABLE repair_quote_items (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, order_id uuid NOT NULL, quote_id uuid NOT NULL, product_id uuid NOT NULL,
 product_name text NOT NULL, sku text NOT NULL, quantity integer NOT NULL CHECK(quantity>0),
 unit_price_cents integer NOT NULL CHECK(unit_price_cents>=0), unit_cost_cents integer NOT NULL CHECK(unit_cost_cents>=0),
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,order_id,id), UNIQUE(tenant_id,quote_id,product_id),
 FOREIGN KEY(tenant_id,order_id,quote_id) REFERENCES repair_quotes(tenant_id,order_id,id), FOREIGN KEY(tenant_id,product_id) REFERENCES products(tenant_id,id)
);
CREATE TABLE repair_approvals (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, order_id uuid NOT NULL, quote_id uuid NOT NULL,
 decision text NOT NULL CHECK(decision IN ('approved','declined')), customer_representative text NOT NULL,
 channel text NOT NULL CHECK(channel IN ('in_person','phone','whatsapp','email')), reference text NOT NULL,
 recorded_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,quote_id), FOREIGN KEY(tenant_id,order_id,quote_id) REFERENCES repair_quotes(tenant_id,order_id,id)
);
CREATE TABLE repair_part_events (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, order_id uuid NOT NULL, quote_item_id uuid NOT NULL,
 product_id uuid NOT NULL, kind text NOT NULL CHECK(kind IN ('issue','return')), quantity integer NOT NULL CHECK(quantity>0),
 unit_cost_cents integer NOT NULL CHECK(unit_cost_cents>=0), issue_id uuid, reason text NOT NULL,
 actor_id uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,order_id,id), FOREIGN KEY(tenant_id,order_id,quote_item_id) REFERENCES repair_quote_items(tenant_id,order_id,id),
 FOREIGN KEY(tenant_id,product_id) REFERENCES products(tenant_id,id), FOREIGN KEY(tenant_id,order_id,issue_id) REFERENCES repair_part_events(tenant_id,order_id,id),
 CHECK((kind='issue' AND issue_id IS NULL) OR (kind='return' AND issue_id IS NOT NULL))
);
CREATE INDEX repair_part_quote ON repair_part_events(tenant_id,quote_item_id);
CREATE INDEX repair_part_returns ON repair_part_events(tenant_id,issue_id);
CREATE TABLE repair_events (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, order_id uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES users(id), action text NOT NULL, details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,order_id) REFERENCES repair_orders(tenant_id,id)
);
CREATE INDEX repair_timeline ON repair_events(tenant_id,order_id,created_at);
CREATE TABLE repair_photos (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, order_id uuid NOT NULL,
 filename text NOT NULL, data bytea NOT NULL CHECK(octet_length(data)<=1500000), sha256 text NOT NULL,
 actor_id uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,order_id) REFERENCES repair_orders(tenant_id,id)
);
CREATE INDEX repair_order_photos ON repair_photos(tenant_id,order_id);
ALTER TABLE stock_movements ADD COLUMN repair_part_event_id uuid;
ALTER TABLE stock_movements ADD CONSTRAINT repair_stock_link FOREIGN KEY(tenant_id,repair_part_event_id) REFERENCES repair_part_events(tenant_id,id);
CREATE UNIQUE INDEX stock_repair_once ON stock_movements(tenant_id,repair_part_event_id);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['customers','repair_orders','repair_quotes','repair_quote_items','repair_approvals','repair_part_events','repair_events','repair_photos'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK (tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid)',t);
  EXECUTE format('GRANT SELECT,INSERT ON %I TO invictus_app',t);
 END LOOP;
END $$;
GRANT UPDATE ON repair_orders TO invictus_app;

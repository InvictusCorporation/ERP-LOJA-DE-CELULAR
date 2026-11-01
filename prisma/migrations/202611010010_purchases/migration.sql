CREATE TABLE purchase_supplier_profiles (
 tenant_id uuid NOT NULL, id uuid NOT NULL, document text NOT NULL DEFAULT '', email text NOT NULL DEFAULT '', phone text NOT NULL DEFAULT '', address text NOT NULL DEFAULT '', notes text NOT NULL DEFAULT '',
 active boolean NOT NULL DEFAULT true, version integer NOT NULL DEFAULT 1, PRIMARY KEY(tenant_id,id), FOREIGN KEY(tenant_id,id) REFERENCES catalog_entries(tenant_id,id)
);
CREATE TABLE purchase_orders (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, branch_id uuid NOT NULL, supplier_id uuid NOT NULL, code text NOT NULL,
 status text NOT NULL CHECK(status IN ('draft','ordered','partial','received','cancelled')), version integer NOT NULL DEFAULT 1,
 draft_lines jsonb NOT NULL, supplier_snapshot jsonb NOT NULL DEFAULT '{}', total_cents integer NOT NULL CHECK(total_cents BETWEEN 1 AND 1000000000),
 expected_on date, note text NOT NULL DEFAULT '', created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,branch_id,id), UNIQUE(tenant_id,code), FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id), FOREIGN KEY(tenant_id,supplier_id) REFERENCES catalog_entries(tenant_id,id)
);
CREATE TABLE purchase_order_lines (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, order_id uuid NOT NULL, product_id uuid NOT NULL, product_name text NOT NULL, sku text NOT NULL, serialized boolean NOT NULL,
 quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 1000000), unit_cost_cents integer NOT NULL CHECK(unit_cost_cents BETWEEN 1 AND 1000000000),
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,order_id,id), UNIQUE(tenant_id,order_id,product_id), FOREIGN KEY(tenant_id,order_id) REFERENCES purchase_orders(tenant_id,id), FOREIGN KEY(tenant_id,product_id) REFERENCES products(tenant_id,id)
);
CREATE TABLE purchase_receipts (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, branch_id uuid NOT NULL, order_id uuid NOT NULL, supplier_id uuid NOT NULL, reference text NOT NULL,
 received_on date NOT NULL, due_on date NOT NULL, total_cents integer NOT NULL CHECK(total_cents BETWEEN 1 AND 1000000000), update_cost boolean NOT NULL DEFAULT false,
 created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), UNIQUE(tenant_id,branch_id,id), UNIQUE(tenant_id,order_id,id), UNIQUE(tenant_id,supplier_id,reference),
 FOREIGN KEY(tenant_id,branch_id,order_id) REFERENCES purchase_orders(tenant_id,branch_id,id), FOREIGN KEY(tenant_id,supplier_id) REFERENCES catalog_entries(tenant_id,id)
);
CREATE TABLE purchase_receipt_lines (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, receipt_id uuid NOT NULL, order_id uuid NOT NULL, order_line_id uuid NOT NULL,
 quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 1000000), unit_cost_cents integer NOT NULL CHECK(unit_cost_cents BETWEEN 1 AND 1000000000),
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,receipt_id,order_line_id),
 FOREIGN KEY(tenant_id,order_id,receipt_id) REFERENCES purchase_receipts(tenant_id,order_id,id), FOREIGN KEY(tenant_id,order_id,order_line_id) REFERENCES purchase_order_lines(tenant_id,order_id,id)
);
CREATE TABLE purchase_receipt_units (
 tenant_id uuid NOT NULL, receipt_line_id uuid NOT NULL, unit_id uuid NOT NULL,
 PRIMARY KEY(tenant_id,receipt_line_id,unit_id), FOREIGN KEY(tenant_id,receipt_line_id) REFERENCES purchase_receipt_lines(tenant_id,id), FOREIGN KEY(tenant_id,unit_id) REFERENCES device_units(tenant_id,id)
);
CREATE TABLE purchase_receipt_reversals (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, receipt_id uuid NOT NULL, reason text NOT NULL, created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,receipt_id), FOREIGN KEY(tenant_id,receipt_id) REFERENCES purchase_receipts(tenant_id,id)
);
CREATE TABLE purchase_events (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, branch_id uuid, entity_id uuid NOT NULL, action text NOT NULL, details jsonb NOT NULL DEFAULT '{}', actor_id uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id)
);
ALTER TABLE stock_movements ADD COLUMN purchase_receipt_line_id uuid;
ALTER TABLE stock_movements ADD CONSTRAINT stock_purchase_line FOREIGN KEY(tenant_id,purchase_receipt_line_id) REFERENCES purchase_receipt_lines(tenant_id,id);
ALTER TABLE finance_titles DROP CONSTRAINT finance_titles_source_kind_check;
ALTER TABLE finance_titles ADD CONSTRAINT finance_titles_source_kind_check CHECK(source_kind IN ('manual','repair','credit','purchase'));
ALTER TABLE finance_titles ADD COLUMN purchase_receipt_id uuid;
ALTER TABLE finance_titles ADD CONSTRAINT finance_purchase_receipt FOREIGN KEY(tenant_id,branch_id,purchase_receipt_id) REFERENCES purchase_receipts(tenant_id,branch_id,id);
CREATE UNIQUE INDEX finance_one_purchase_receipt ON finance_titles(tenant_id,purchase_receipt_id) WHERE purchase_receipt_id IS NOT NULL;
CREATE INDEX purchase_order_queue ON purchase_orders(tenant_id,branch_id,status,created_at DESC,id);
CREATE INDEX purchase_receipt_order ON purchase_receipts(tenant_id,order_id,created_at DESC);
CREATE INDEX purchase_event_entity ON purchase_events(tenant_id,entity_id,created_at DESC);
CREATE INDEX purchase_movement_source ON stock_movements(tenant_id,purchase_receipt_line_id);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['purchase_supplier_profiles','purchase_orders','purchase_order_lines','purchase_receipts','purchase_receipt_lines','purchase_receipt_units','purchase_receipt_reversals','purchase_events'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_isolation ON %I USING(tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK(tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid)',t);
 END LOOP;
END $$;
GRANT SELECT,INSERT,UPDATE ON purchase_supplier_profiles,purchase_orders TO invictus_app;
GRANT SELECT,INSERT ON purchase_order_lines,purchase_receipts,purchase_receipt_lines,purchase_receipt_units,purchase_receipt_reversals,purchase_events TO invictus_app;

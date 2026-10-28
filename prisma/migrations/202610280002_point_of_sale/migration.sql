ALTER TABLE memberships DROP CONSTRAINT memberships_role_check;
ALTER TABLE memberships ADD CONSTRAINT memberships_role_check CHECK(role IN ('owner','manager','stock','viewer','cashier'));
CREATE TABLE pos_registers (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, branch_id uuid NOT NULL, name text NOT NULL,
 active boolean NOT NULL DEFAULT true, UNIQUE(tenant_id,id), UNIQUE(tenant_id,branch_id,id), UNIQUE(tenant_id,branch_id,name),
 FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id)
);
INSERT INTO pos_registers(id,tenant_id,branch_id,name) SELECT id,tenant_id,id,'Caixa principal' FROM branches;
CREATE FUNCTION create_branch_register() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
 BEGIN INSERT INTO pos_registers(id,tenant_id,branch_id,name) VALUES(NEW.id,NEW.tenant_id,NEW.id,'Caixa principal'); RETURN NEW; END;
$$;
CREATE TRIGGER branch_register AFTER INSERT ON branches FOR EACH ROW EXECUTE FUNCTION create_branch_register();
CREATE TABLE cash_sessions (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, branch_id uuid NOT NULL, register_id uuid NOT NULL,
 operator_id uuid NOT NULL REFERENCES users(id), status text NOT NULL CHECK(status IN ('open','closed')),
 opening_cents integer NOT NULL CHECK(opening_cents>=0), counted_cents integer CHECK(counted_cents>=0), expected_cents bigint,
 difference_cents bigint, closing_note text, closed_by uuid REFERENCES users(id), opened_at timestamptz NOT NULL DEFAULT now(), closed_at timestamptz,
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,branch_id,id), FOREIGN KEY(tenant_id,branch_id,register_id) REFERENCES pos_registers(tenant_id,branch_id,id),
 CHECK((status='open' AND closed_at IS NULL) OR (status='closed' AND closed_at IS NOT NULL AND counted_cents IS NOT NULL AND expected_cents IS NOT NULL))
);
CREATE UNIQUE INDEX one_open_register ON cash_sessions(tenant_id,register_id) WHERE status='open';
CREATE UNIQUE INDEX one_open_operator_per_branch ON cash_sessions(tenant_id,branch_id,operator_id) WHERE status='open';
CREATE TABLE pos_sales (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, branch_id uuid NOT NULL, session_id uuid NOT NULL,
 operator_id uuid NOT NULL REFERENCES users(id), receipt_code text NOT NULL, subtotal_cents integer NOT NULL CHECK(subtotal_cents>0),
 discount_cents integer NOT NULL CHECK(discount_cents>=0), total_cents integer NOT NULL CHECK(total_cents>0),
 change_cents integer NOT NULL CHECK(change_cents>=0), status text NOT NULL CHECK(status IN ('completed','partial_return','returned','cancelled')),
 note text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), UNIQUE(tenant_id,branch_id,id), UNIQUE(tenant_id,receipt_code),
 FOREIGN KEY(tenant_id,branch_id,session_id) REFERENCES cash_sessions(tenant_id,branch_id,id), CHECK(total_cents=subtotal_cents-discount_cents)
);
CREATE INDEX sales_history ON pos_sales(tenant_id,branch_id,created_at DESC);
CREATE TABLE pos_sale_items (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, sale_id uuid NOT NULL, product_id uuid NOT NULL, unit_id uuid,
 product_name text NOT NULL, sku text NOT NULL, identifiers text NOT NULL DEFAULT '', quantity integer NOT NULL CHECK(quantity>0),
 unit_price_cents integer NOT NULL CHECK(unit_price_cents>=0), unit_cost_cents integer NOT NULL CHECK(unit_cost_cents>=0),
 discount_cents integer NOT NULL CHECK(discount_cents>=0), net_cents integer NOT NULL CHECK(net_cents>=0),
 warranty_days integer NOT NULL, warranty_terms text NOT NULL, UNIQUE(tenant_id,id), UNIQUE(tenant_id,sale_id,id),
 FOREIGN KEY(tenant_id,sale_id) REFERENCES pos_sales(tenant_id,id), FOREIGN KEY(tenant_id,product_id) REFERENCES products(tenant_id,id),
 FOREIGN KEY(tenant_id,unit_id) REFERENCES device_units(tenant_id,id), CHECK(net_cents=quantity*unit_price_cents-discount_cents)
);
CREATE INDEX sale_units ON pos_sale_items(tenant_id,unit_id);
CREATE TABLE pos_sale_payments (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, sale_id uuid NOT NULL, method text NOT NULL CHECK(method IN ('cash','pix','debit','credit')),
 amount_cents integer NOT NULL CHECK(amount_cents>=0), tendered_cents integer NOT NULL CHECK(tendered_cents>=amount_cents),
 reference text NOT NULL DEFAULT '', UNIQUE(tenant_id,sale_id,method), FOREIGN KEY(tenant_id,sale_id) REFERENCES pos_sales(tenant_id,id)
);
CREATE TABLE pos_returns (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, branch_id uuid NOT NULL, sale_id uuid NOT NULL, session_id uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES users(id), kind text NOT NULL CHECK(kind IN ('return','cancel')), reason text NOT NULL,
 total_cents integer NOT NULL CHECK(total_cents>=0), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), UNIQUE(tenant_id,sale_id,id),
 FOREIGN KEY(tenant_id,branch_id,sale_id) REFERENCES pos_sales(tenant_id,branch_id,id), FOREIGN KEY(tenant_id,branch_id,session_id) REFERENCES cash_sessions(tenant_id,branch_id,id)
);
CREATE TABLE pos_return_items (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, sale_id uuid NOT NULL, return_id uuid NOT NULL, sale_item_id uuid NOT NULL,
 quantity integer NOT NULL CHECK(quantity>0), amount_cents integer NOT NULL CHECK(amount_cents>=0), UNIQUE(tenant_id,id), UNIQUE(tenant_id,return_id,sale_item_id),
 FOREIGN KEY(tenant_id,sale_id,return_id) REFERENCES pos_returns(tenant_id,sale_id,id), FOREIGN KEY(tenant_id,sale_id,sale_item_id) REFERENCES pos_sale_items(tenant_id,sale_id,id)
);
CREATE TABLE pos_refund_payments (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, return_id uuid NOT NULL, method text NOT NULL CHECK(method IN ('cash','pix','debit','credit')),
 amount_cents integer NOT NULL CHECK(amount_cents>0), reference text NOT NULL DEFAULT '', UNIQUE(tenant_id,return_id,method), FOREIGN KEY(tenant_id,return_id) REFERENCES pos_returns(tenant_id,id)
);
CREATE TABLE cash_entries (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, branch_id uuid NOT NULL, session_id uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES users(id), type text NOT NULL CHECK(type IN ('opening','sale','refund','supply','withdrawal')),
 amount_cents integer NOT NULL, reason text NOT NULL, sale_id uuid, return_id uuid, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,sale_id), UNIQUE(tenant_id,return_id), FOREIGN KEY(tenant_id,branch_id,session_id) REFERENCES cash_sessions(tenant_id,branch_id,id),
 FOREIGN KEY(tenant_id,sale_id) REFERENCES pos_sales(tenant_id,id), FOREIGN KEY(tenant_id,return_id) REFERENCES pos_returns(tenant_id,id),
 CHECK((type='opening' AND amount_cents>=0) OR (type IN ('sale','supply') AND amount_cents>0) OR (type IN ('refund','withdrawal') AND amount_cents<0))
);
CREATE INDEX cash_session_entries ON cash_entries(tenant_id,session_id,created_at);
ALTER TABLE stock_movements ADD COLUMN sale_item_id uuid, ADD COLUMN return_item_id uuid;
ALTER TABLE stock_movements ADD CONSTRAINT stock_sale_link FOREIGN KEY(tenant_id,sale_item_id) REFERENCES pos_sale_items(tenant_id,id);
ALTER TABLE stock_movements ADD CONSTRAINT stock_return_link FOREIGN KEY(tenant_id,return_item_id) REFERENCES pos_return_items(tenant_id,id);
CREATE UNIQUE INDEX stock_sale_once ON stock_movements(tenant_id,sale_item_id);
CREATE UNIQUE INDEX stock_return_once ON stock_movements(tenant_id,return_item_id);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['pos_registers','cash_sessions','pos_sales','pos_sale_items','pos_sale_payments','pos_returns','pos_return_items','pos_refund_payments','cash_entries'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK (tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid)',t);
  EXECUTE format('GRANT SELECT,INSERT ON %I TO invictus_app',t);
 END LOOP;
END $$;
GRANT UPDATE ON cash_sessions,pos_sales TO invictus_app;
GRANT UPDATE(id) ON pos_registers TO invictus_app;

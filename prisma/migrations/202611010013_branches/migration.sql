ALTER TABLE branches ADD COLUMN code text NOT NULL DEFAULT '',ADD COLUMN phone text NOT NULL DEFAULT '',ADD COLUMN email text NOT NULL DEFAULT '',ADD COLUMN address text NOT NULL DEFAULT '',ADD COLUMN city text NOT NULL DEFAULT '',ADD COLUMN state text NOT NULL DEFAULT '',ADD COLUMN notes text NOT NULL DEFAULT '',ADD COLUMN version integer NOT NULL DEFAULT 1,ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
CREATE UNIQUE INDEX branch_code_unique ON branches(tenant_id,code) WHERE code<>'';
CREATE TABLE stock_transfers (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,source_branch_id uuid NOT NULL,destination_branch_id uuid NOT NULL,source_name text NOT NULL,destination_name text NOT NULL,code text NOT NULL,reason text NOT NULL,created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,code),CHECK(source_branch_id<>destination_branch_id),FOREIGN KEY(tenant_id,source_branch_id) REFERENCES branches(tenant_id,id),FOREIGN KEY(tenant_id,destination_branch_id) REFERENCES branches(tenant_id,id)
);
CREATE TABLE stock_transfer_items (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,transfer_id uuid NOT NULL,product_id uuid NOT NULL,product_name text NOT NULL,sku text NOT NULL,quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 1000000),unit_id uuid,unit_revision integer,unit_cost_cents bigint NOT NULL CHECK(unit_cost_cents BETWEEN 0 AND 100000000000),
 UNIQUE(tenant_id,id),CHECK((unit_id IS NULL AND unit_revision IS NULL) OR (unit_id IS NOT NULL AND unit_revision IS NOT NULL AND quantity=1)),FOREIGN KEY(tenant_id,transfer_id) REFERENCES stock_transfers(tenant_id,id),FOREIGN KEY(tenant_id,product_id) REFERENCES products(tenant_id,id),FOREIGN KEY(tenant_id,unit_id) REFERENCES device_units(tenant_id,id)
);
CREATE TABLE stock_transfer_reversals (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,transfer_id uuid NOT NULL,reason text NOT NULL,created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,id),UNIQUE(tenant_id,transfer_id),FOREIGN KEY(tenant_id,transfer_id) REFERENCES stock_transfers(tenant_id,id)
);
ALTER TABLE stock_movements ADD COLUMN transfer_item_id uuid,ADD COLUMN transfer_leg text,ADD FOREIGN KEY(tenant_id,transfer_item_id) REFERENCES stock_transfer_items(tenant_id,id),ADD CHECK((transfer_item_id IS NULL AND transfer_leg IS NULL) OR (transfer_item_id IS NOT NULL AND transfer_leg IS NOT NULL AND transfer_leg IN ('out','in','reverse_out','reverse_in')));
CREATE UNIQUE INDEX transfer_movement_once ON stock_movements(tenant_id,transfer_item_id,transfer_leg) WHERE transfer_item_id IS NOT NULL;
CREATE INDEX transfer_history ON stock_transfers(tenant_id,source_branch_id,destination_branch_id,created_at DESC,id);
CREATE INDEX transfer_lines ON stock_transfer_items(tenant_id,transfer_id,id);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['stock_transfers','stock_transfer_items','stock_transfer_reversals'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY tenant_isolation ON %I USING(tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK(tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid)',t);
 EXECUTE format('GRANT SELECT,INSERT ON %I TO invictus_app',t);
 END LOOP;
END $$;
-- Shared row locks synchronize archival with writes, even from an already open screen.
CREATE FUNCTION require_operating_branch() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE branch_row record;expected integer;ids uuid[];BEGIN
 ids:=ARRAY[NEW.branch_id];
 IF TG_OP='UPDATE' THEN ids:=ARRAY[OLD.branch_id,NEW.branch_id];END IF;
 SELECT count(DISTINCT x) INTO expected FROM unnest(ids) x;
 FOR branch_row IN SELECT id,active FROM branches WHERE tenant_id=NEW.tenant_id AND id=ANY(ids) ORDER BY id FOR SHARE LOOP
  IF NOT branch_row.active THEN RAISE EXCEPTION 'branch_inactive' USING ERRCODE='55000';END IF;
  expected:=expected-1;
 END LOOP;
 IF expected<>0 THEN RAISE EXCEPTION 'branch_unavailable' USING ERRCODE='55000';END IF;
 RETURN NEW;
END $$;
DO $$ DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['stock_balances','device_units','stock_movements','pos_registers','cash_sessions','cash_entries','pos_sales','pos_returns','repair_orders','finance_accounts','finance_titles','finance_entries','finance_settlements','finance_reconciliations','credit_profiles','credit_offers','credit_contracts','credit_income_events','purchase_orders','purchase_receipts','crm_opportunities','crm_tasks'] LOOP
 EXECUTE format('CREATE TRIGGER operating_branch BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION require_operating_branch()',t);
 END LOOP;
END $$;

-- Reversal safety follows physical unit changes, not wall-clock ordering.
ALTER TABLE device_units ADD COLUMN movement_version integer NOT NULL DEFAULT 0;
CREATE FUNCTION advance_unit_revision() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.movement_version:=OLD.movement_version+1;RETURN NEW;END $$;
CREATE TRIGGER unit_revision BEFORE UPDATE ON device_units FOR EACH ROW EXECUTE FUNCTION advance_unit_revision();

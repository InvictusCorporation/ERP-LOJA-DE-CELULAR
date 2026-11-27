ALTER TABLE products ADD COLUMN image_data text NOT NULL DEFAULT '' CHECK (length(image_data)<=110000);
ALTER TABLE device_units ADD COLUMN battery_health integer CHECK(battery_health BETWEEN 0 AND 100),
 ADD COLUMN physical_condition text NOT NULL DEFAULT '',
 ADD COLUMN location text NOT NULL DEFAULT '',
 ADD COLUMN reserved boolean NOT NULL DEFAULT false,
 ADD COLUMN details_version integer NOT NULL DEFAULT 1,
 ADD CONSTRAINT reserved_unit_in_stock CHECK(NOT reserved OR status='in_stock');
-- A reserved unit must be released explicitly before leaving its branch or stock.
CREATE FUNCTION protect_reserved_unit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD.reserved AND (NEW.branch_id<>OLD.branch_id OR NEW.status<>OLD.status) THEN
  RAISE EXCEPTION 'Libere a reserva do aparelho antes de movimentar.' USING ERRCODE='40001';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER reserved_unit_guard BEFORE UPDATE ON device_units FOR EACH ROW EXECUTE FUNCTION protect_reserved_unit();

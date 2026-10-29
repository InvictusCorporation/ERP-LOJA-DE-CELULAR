-- Delivered services predating finance may have been paid outside the ERP.
-- Their outstanding balance must be reviewed before collections or new settlements.
ALTER TABLE finance_titles ADD COLUMN imported boolean NOT NULL DEFAULT false,
 ADD COLUMN needs_review boolean NOT NULL DEFAULT false,
 ADD COLUMN opening_paid_cents integer NOT NULL DEFAULT 0 CHECK(opening_paid_cents>=0 AND opening_paid_cents<=amount_cents);
UPDATE finance_titles t SET imported=true,needs_review=true
 WHERE source_kind='repair' AND NOT EXISTS(SELECT 1 FROM finance_settlements s WHERE s.title_id=t.id);

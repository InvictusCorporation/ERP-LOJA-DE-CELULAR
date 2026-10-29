-- Inventory acquisitions and capital movements must not duplicate operating costs.
ALTER TABLE finance_titles ADD COLUMN affects_result boolean NOT NULL DEFAULT true;

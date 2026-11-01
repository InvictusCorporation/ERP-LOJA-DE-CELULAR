CREATE TABLE credit_policies (
 tenant_id uuid PRIMARY KEY REFERENCES tenants(id), enabled boolean NOT NULL DEFAULT false, version integer NOT NULL DEFAULT 1,
 legal_name text NOT NULL, cnpj text NOT NULL, address text NOT NULL, email text NOT NULL, phone text NOT NULL,
 max_monthly_bps integer NOT NULL CHECK(max_monthly_bps BETWEEN 0 AND 300), late_fee_bps integer NOT NULL CHECK(late_fee_bps BETWEEN 0 AND 200), late_monthly_bps integer NOT NULL CHECK(late_monthly_bps BETWEEN 0 AND 100),
 max_installments integer NOT NULL CHECK(max_installments BETWEEN 1 AND 36), offer_days integer NOT NULL CHECK(offer_days BETWEEN 2 AND 30),
 terms text NOT NULL, legal_reference text NOT NULL, reviewed_by uuid NOT NULL REFERENCES users(id), reviewed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE credit_profiles (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, branch_id uuid NOT NULL, customer_id uuid NOT NULL, cpf text NOT NULL CHECK(cpf ~ '^[0-9]{11}$'),
 address text NOT NULL, limit_cents integer NOT NULL CHECK(limit_cents BETWEEN 0 AND 1000000000), enabled boolean NOT NULL, assessment text NOT NULL, bureau_reference text NOT NULL,
 version integer NOT NULL DEFAULT 1, approved_by uuid NOT NULL REFERENCES users(id), approved_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,customer_id), UNIQUE(tenant_id,cpf),
 FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id), FOREIGN KEY(tenant_id,customer_id) REFERENCES customers(tenant_id,id)
);
CREATE TABLE credit_offers (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, branch_id uuid NOT NULL, profile_id uuid NOT NULL, customer_id uuid NOT NULL,
 code text NOT NULL, purchase_cents integer NOT NULL CHECK(purchase_cents BETWEEN 1 AND 1000000000), down_cents integer NOT NULL CHECK(down_cents>=0 AND down_cents<purchase_cents),
 count integer NOT NULL CHECK(count BETWEEN 1 AND 36), monthly_bps integer NOT NULL CHECK(monthly_bps BETWEEN 0 AND 300), first_due_on date NOT NULL,
 issued_on date NOT NULL, valid_until date NOT NULL, policy jsonb NOT NULL, borrower jsonb NOT NULL, simulation jsonb NOT NULL,
 assessment text NOT NULL, approval_reference text NOT NULL, approved_by uuid NOT NULL REFERENCES users(id),
 status text NOT NULL CHECK(status IN ('approved','used','cancelled')), version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,branch_id,id), UNIQUE(tenant_id,code),
 FOREIGN KEY(tenant_id,profile_id) REFERENCES credit_profiles(tenant_id,id), FOREIGN KEY(tenant_id,customer_id) REFERENCES customers(tenant_id,id), FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id)
);
CREATE INDEX credit_offer_queue ON credit_offers(tenant_id,branch_id,status,valid_until);
CREATE TABLE credit_contracts (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, branch_id uuid NOT NULL, profile_id uuid NOT NULL, customer_id uuid NOT NULL,
 sale_id uuid NOT NULL, offer_id uuid NOT NULL, code text NOT NULL, status text NOT NULL CHECK(status IN ('active','cancelled')),
 current_plan_id uuid, version integer NOT NULL DEFAULT 1, borrower jsonb NOT NULL, policy jsonb NOT NULL,
 acceptance_reference text NOT NULL, accepted_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,branch_id,id), UNIQUE(tenant_id,code), UNIQUE(tenant_id,sale_id), UNIQUE(tenant_id,offer_id),
 FOREIGN KEY(tenant_id,branch_id,sale_id) REFERENCES pos_sales(tenant_id,branch_id,id), FOREIGN KEY(tenant_id,branch_id,offer_id) REFERENCES credit_offers(tenant_id,branch_id,id),
 FOREIGN KEY(tenant_id,profile_id) REFERENCES credit_profiles(tenant_id,id), FOREIGN KEY(tenant_id,customer_id) REFERENCES customers(tenant_id,id)
);
CREATE TABLE credit_plans (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, contract_id uuid NOT NULL, revision integer NOT NULL, principal_cents integer NOT NULL CHECK(principal_cents BETWEEN 1 AND 1000000000),
 issued_on date NOT NULL, monthly_bps integer NOT NULL CHECK(monthly_bps BETWEEN 0 AND 300), late_fee_bps integer NOT NULL CHECK(late_fee_bps BETWEEN 0 AND 200), late_monthly_bps integer NOT NULL CHECK(late_monthly_bps BETWEEN 0 AND 100),
 simulation jsonb NOT NULL, policy jsonb NOT NULL, reason text NOT NULL, acceptance_reference text NOT NULL, created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,contract_id,id), UNIQUE(tenant_id,contract_id,revision), FOREIGN KEY(tenant_id,contract_id) REFERENCES credit_contracts(tenant_id,id)
);
ALTER TABLE credit_contracts ADD FOREIGN KEY(tenant_id,id,current_plan_id) REFERENCES credit_plans(tenant_id,contract_id,id);
CREATE TABLE credit_installments (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, contract_id uuid NOT NULL, plan_id uuid NOT NULL, number integer NOT NULL CHECK(number>0),
 principal_cents integer NOT NULL CHECK(principal_cents>0), interest_cents integer NOT NULL CHECK(interest_cents>=0), due_on date NOT NULL,
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,plan_id,number), FOREIGN KEY(tenant_id,contract_id,plan_id) REFERENCES credit_plans(tenant_id,contract_id,id)
);
ALTER TABLE finance_titles DROP CONSTRAINT finance_titles_source_kind_check;
ALTER TABLE finance_titles ADD CONSTRAINT finance_titles_source_kind_check CHECK(source_kind IN ('manual','repair','credit'));
ALTER TABLE finance_titles ADD COLUMN credit_installment_id uuid, ADD UNIQUE(tenant_id,credit_installment_id), ADD FOREIGN KEY(tenant_id,credit_installment_id) REFERENCES credit_installments(tenant_id,id);
ALTER TABLE finance_settlements ADD COLUMN discount_cents integer NOT NULL DEFAULT 0 CHECK(discount_cents>=0), ADD COLUMN charges_cents integer NOT NULL DEFAULT 0 CHECK(charges_cents>=0 AND charges_cents<=amount_cents);
CREATE TABLE credit_receipts (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, contract_id uuid NOT NULL, installment_id uuid NOT NULL, settlement_id uuid NOT NULL,
 posted_on date NOT NULL, principal_cents integer NOT NULL CHECK(principal_cents>=0), interest_cents integer NOT NULL CHECK(interest_cents>=0), discount_cents integer NOT NULL CHECK(discount_cents>=0), fine_cents integer NOT NULL CHECK(fine_cents>=0), late_cents integer NOT NULL CHECK(late_cents>=0),
 reference text NOT NULL, created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,settlement_id), FOREIGN KEY(tenant_id,contract_id) REFERENCES credit_contracts(tenant_id,id), FOREIGN KEY(tenant_id,installment_id) REFERENCES credit_installments(tenant_id,id), FOREIGN KEY(tenant_id,settlement_id) REFERENCES finance_settlements(tenant_id,id)
);
CREATE TABLE credit_income_events (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, branch_id uuid NOT NULL, contract_id uuid NOT NULL, plan_id uuid NOT NULL,
 receipt_id uuid, amount_cents bigint NOT NULL CHECK(amount_cents<>0), competence_on date NOT NULL, kind text NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,branch_id,contract_id) REFERENCES credit_contracts(tenant_id,branch_id,id), FOREIGN KEY(tenant_id,plan_id) REFERENCES credit_plans(tenant_id,id), FOREIGN KEY(tenant_id,receipt_id) REFERENCES credit_receipts(tenant_id,id)
);
CREATE INDEX credit_income_period ON credit_income_events(tenant_id,branch_id,competence_on);
CREATE TABLE credit_events (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, branch_id uuid NOT NULL, entity_id uuid NOT NULL, action text NOT NULL, details jsonb NOT NULL DEFAULT '{}',
 actor_id uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id)
);
CREATE INDEX credit_events_entity ON credit_events(tenant_id,entity_id,created_at DESC);
ALTER TABLE credit_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_installments ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_income_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON credit_policies USING(tenant_id=current_setting('app.tenant_id',true)::uuid) WITH CHECK(tenant_id=current_setting('app.tenant_id',true)::uuid);
CREATE POLICY tenant_isolation ON credit_profiles USING(tenant_id=current_setting('app.tenant_id',true)::uuid) WITH CHECK(tenant_id=current_setting('app.tenant_id',true)::uuid);
CREATE POLICY tenant_isolation ON credit_offers USING(tenant_id=current_setting('app.tenant_id',true)::uuid) WITH CHECK(tenant_id=current_setting('app.tenant_id',true)::uuid);
CREATE POLICY tenant_isolation ON credit_contracts USING(tenant_id=current_setting('app.tenant_id',true)::uuid) WITH CHECK(tenant_id=current_setting('app.tenant_id',true)::uuid);
CREATE POLICY tenant_isolation ON credit_plans USING(tenant_id=current_setting('app.tenant_id',true)::uuid) WITH CHECK(tenant_id=current_setting('app.tenant_id',true)::uuid);
CREATE POLICY tenant_isolation ON credit_installments USING(tenant_id=current_setting('app.tenant_id',true)::uuid) WITH CHECK(tenant_id=current_setting('app.tenant_id',true)::uuid);
CREATE POLICY tenant_isolation ON credit_receipts USING(tenant_id=current_setting('app.tenant_id',true)::uuid) WITH CHECK(tenant_id=current_setting('app.tenant_id',true)::uuid);
CREATE POLICY tenant_isolation ON credit_income_events USING(tenant_id=current_setting('app.tenant_id',true)::uuid) WITH CHECK(tenant_id=current_setting('app.tenant_id',true)::uuid);
CREATE POLICY tenant_isolation ON credit_events USING(tenant_id=current_setting('app.tenant_id',true)::uuid) WITH CHECK(tenant_id=current_setting('app.tenant_id',true)::uuid);
GRANT SELECT,INSERT,UPDATE ON credit_policies,credit_profiles,credit_offers,credit_contracts TO invictus_app;
GRANT SELECT,INSERT ON credit_plans,credit_installments,credit_receipts,credit_income_events,credit_events TO invictus_app;

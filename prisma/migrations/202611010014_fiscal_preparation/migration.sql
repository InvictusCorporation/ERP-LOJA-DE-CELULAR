-- Preparation only: no state in this schema represents official authorization.
CREATE TABLE fiscal_issuers (
 tenant_id uuid NOT NULL,branch_id uuid NOT NULL,profile jsonb NOT NULL,version integer NOT NULL DEFAULT 1,updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,branch_id),FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id)
);
CREATE TABLE fiscal_products (
 tenant_id uuid NOT NULL,product_id uuid NOT NULL,profile jsonb NOT NULL,version integer NOT NULL DEFAULT 1,updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,product_id),FOREIGN KEY(tenant_id,product_id) REFERENCES products(tenant_id,id)
);
CREATE TABLE fiscal_drafts (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,branch_id uuid NOT NULL,model text NOT NULL CHECK(model IN ('nfe','nfce','nfse')),source_kind text NOT NULL CHECK(source_kind IN ('sale','repair')),sale_id uuid,repair_id uuid,
 snapshot jsonb NOT NULL,created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,branch_id,id),FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id),
 FOREIGN KEY(tenant_id,branch_id,sale_id) REFERENCES pos_sales(tenant_id,branch_id,id),FOREIGN KEY(tenant_id,repair_id) REFERENCES repair_orders(tenant_id,id),
 CHECK((source_kind='sale' AND sale_id IS NOT NULL AND repair_id IS NULL AND model IN ('nfe','nfce')) OR (source_kind='repair' AND repair_id IS NOT NULL AND sale_id IS NULL AND model='nfse'))
);
-- One preparation per source, even when the user chooses another goods model.
CREATE UNIQUE INDEX fiscal_sale_once ON fiscal_drafts(tenant_id,sale_id) WHERE sale_id IS NOT NULL;
CREATE UNIQUE INDEX fiscal_repair_once ON fiscal_drafts(tenant_id,repair_id) WHERE repair_id IS NOT NULL;
CREATE TABLE fiscal_draft_archives (
 tenant_id uuid NOT NULL,draft_id uuid NOT NULL,reason text NOT NULL,created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,draft_id),FOREIGN KEY(tenant_id,draft_id) REFERENCES fiscal_drafts(tenant_id,id)
);
CREATE TABLE fiscal_files (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,branch_id uuid NOT NULL,draft_id uuid,filename text NOT NULL,content text NOT NULL,sha256 text NOT NULL,byte_length integer NOT NULL CHECK(byte_length BETWEEN 1 AND 65536),
 description text NOT NULL,created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,branch_id,sha256),FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id),FOREIGN KEY(tenant_id,branch_id,draft_id) REFERENCES fiscal_drafts(tenant_id,branch_id,id)
);
CREATE INDEX fiscal_draft_history ON fiscal_drafts(tenant_id,branch_id,created_at DESC,id);
CREATE INDEX fiscal_file_history ON fiscal_files(tenant_id,branch_id,created_at DESC,id);
CREATE TABLE fiscal_certificates (
 tenant_id uuid NOT NULL,branch_id uuid NOT NULL,filename text NOT NULL,sha256 text NOT NULL,sealed jsonb,active boolean NOT NULL DEFAULT true,version integer NOT NULL DEFAULT 1,updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,branch_id),FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id)
);
DO $$ DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['fiscal_issuers','fiscal_products','fiscal_drafts','fiscal_draft_archives','fiscal_files','fiscal_certificates'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY tenant_isolation ON %I USING(tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK(tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid)',t);
 EXECUTE format('GRANT SELECT,INSERT ON %I TO invictus_app',t);
 END LOOP;
END $$;
GRANT UPDATE(profile,version,updated_at) ON fiscal_issuers,fiscal_products TO invictus_app;
GRANT UPDATE(filename,sha256,sealed,active,version,updated_at) ON fiscal_certificates TO invictus_app;
CREATE TRIGGER operating_branch BEFORE INSERT ON fiscal_certificates FOR EACH ROW EXECUTE FUNCTION require_operating_branch();
CREATE TRIGGER operating_branch_update BEFORE UPDATE ON fiscal_certificates FOR EACH ROW WHEN(NEW.active) EXECUTE FUNCTION require_operating_branch();
CREATE TRIGGER operating_branch BEFORE INSERT OR UPDATE ON fiscal_issuers FOR EACH ROW EXECUTE FUNCTION require_operating_branch();
CREATE TRIGGER operating_branch BEFORE INSERT ON fiscal_drafts FOR EACH ROW EXECUTE FUNCTION require_operating_branch();
-- Historical files and archival remain possible after a branch is deactivated.

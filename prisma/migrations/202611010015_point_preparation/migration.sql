CREATE TABLE point_settings (
 tenant_id uuid PRIMARY KEY REFERENCES tenants(id),profile jsonb NOT NULL,version integer NOT NULL DEFAULT 1,updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE point_branch_mappings (
 tenant_id uuid NOT NULL,branch_id uuid NOT NULL,external_branch_id text,version integer NOT NULL DEFAULT 1,updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,branch_id),UNIQUE(tenant_id,external_branch_id),FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id),CHECK(external_branch_id IS NULL OR length(external_branch_id) BETWEEN 1 AND 120)
);
-- Local review artifacts only, never a queue claiming transmission to an external system.
CREATE TABLE point_preparation_exports (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES tenants(id),branch_ids uuid[] NOT NULL,content jsonb NOT NULL,sha256 text NOT NULL,employee_count integer NOT NULL CHECK(employee_count BETWEEN 0 AND 500),
 created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,id),CHECK(cardinality(branch_ids)>0)
);
CREATE INDEX point_export_history ON point_preparation_exports(tenant_id,created_at DESC,id);
DO $$ DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['point_settings','point_branch_mappings','point_preparation_exports'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY tenant_isolation ON %I USING(tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK(tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid)',t);
 EXECUTE format('GRANT SELECT,INSERT ON %I TO invictus_app',t);
 END LOOP;
END $$;
GRANT UPDATE(profile,version,updated_at) ON point_settings TO invictus_app;
GRANT UPDATE(external_branch_id,version,updated_at) ON point_branch_mappings TO invictus_app;

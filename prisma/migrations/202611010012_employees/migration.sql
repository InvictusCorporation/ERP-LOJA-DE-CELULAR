ALTER TABLE memberships DROP CONSTRAINT memberships_role_check;
ALTER TABLE memberships ADD CONSTRAINT memberships_role_check CHECK(role IN ('owner','administrator','manager','seller','cashier','technician','financial','stock','viewer'));
ALTER TABLE memberships ADD COLUMN employee_name text NOT NULL DEFAULT '', ADD COLUMN job_title text NOT NULL DEFAULT '', ADD COLUMN job_function text NOT NULL DEFAULT '', ADD COLUMN employee_code text NOT NULL DEFAULT '', ADD COLUMN home_branch_id uuid, ADD COLUMN point_external_id text NOT NULL DEFAULT '', ADD COLUMN permission_grants text[] NOT NULL DEFAULT '{}', ADD COLUMN permission_denials text[] NOT NULL DEFAULT '{}', ADD COLUMN version integer NOT NULL DEFAULT 1, ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
UPDATE memberships m SET employee_name=u.name,home_branch_id=m.branch_ids[1] FROM users u WHERE u.id=m.user_id;
ALTER TABLE memberships ADD FOREIGN KEY(tenant_id,home_branch_id) REFERENCES branches(tenant_id,id);
ALTER TABLE memberships ADD CHECK(home_branch_id IS NULL OR home_branch_id=ANY(branch_ids)), ADD CHECK(version>0);
CREATE UNIQUE INDEX employee_code_unique ON memberships(tenant_id,employee_code) WHERE employee_code<>'';
CREATE UNIQUE INDEX employee_point_unique ON memberships(tenant_id,point_external_id) WHERE point_external_id<>'';
CREATE INDEX employee_roster ON memberships(tenant_id,active,employee_name,id);
CREATE INDEX employee_audit ON audit_events(tenant_id,actor_id,created_at DESC,id);
-- Authentication already reads memberships globally before choosing a tenant.
-- Preserve SELECT, while limiting the new management UPDATE to the tenant transaction.
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
CREATE POLICY membership_auth_read ON memberships FOR SELECT TO invictus_app USING(true);
CREATE POLICY membership_tenant_update ON memberships FOR UPDATE TO invictus_app USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
GRANT UPDATE(employee_name,job_title,job_function,employee_code,home_branch_id,point_external_id,permission_grants,permission_denials,version,updated_at,role,active,branch_ids) ON memberships TO invictus_app;

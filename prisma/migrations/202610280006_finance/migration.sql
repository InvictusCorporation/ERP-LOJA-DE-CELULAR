CREATE TABLE finance_accounts (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, branch_id uuid NOT NULL, name text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('cash','bank','other')), active boolean NOT NULL DEFAULT true, version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), UNIQUE(tenant_id,branch_id,id), UNIQUE(tenant_id,branch_id,name),
 FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id)
);
CREATE TABLE finance_centers (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), name text NOT NULL, active boolean NOT NULL DEFAULT true,
 version integer NOT NULL DEFAULT 1, UNIQUE(tenant_id,id), UNIQUE(tenant_id,name)
);
CREATE TABLE finance_titles (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, branch_id uuid NOT NULL, direction text NOT NULL CHECK(direction IN ('payable','receivable')),
 description text NOT NULL, counterparty text NOT NULL, amount_cents integer NOT NULL CHECK(amount_cents BETWEEN 1 AND 1000000000),
 competence_on date NOT NULL, due_on date NOT NULL, center_id uuid, source_kind text NOT NULL DEFAULT 'manual' CHECK(source_kind IN ('manual','repair')),
 source_id uuid, cancelled boolean NOT NULL DEFAULT false, version integer NOT NULL DEFAULT 1,
 created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,branch_id,id), UNIQUE(tenant_id,source_kind,source_id),
 FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id), FOREIGN KEY(tenant_id,center_id) REFERENCES finance_centers(tenant_id,id),
 FOREIGN KEY(tenant_id,source_id) REFERENCES repair_orders(tenant_id,id)
);
CREATE INDEX finance_title_queue ON finance_titles(tenant_id,branch_id,direction,due_on);
CREATE TABLE finance_settlements (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, branch_id uuid NOT NULL, title_id uuid NOT NULL,
 amount_cents integer NOT NULL CHECK(amount_cents BETWEEN 1 AND 1000000000), reference text NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,branch_id,title_id) REFERENCES finance_titles(tenant_id,branch_id,id)
);
CREATE TABLE finance_entries (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, branch_id uuid NOT NULL, account_id uuid,
 amount_cents integer NOT NULL CHECK(amount_cents<>0 AND amount_cents BETWEEN -1000000000 AND 1000000000),
 posted_on date NOT NULL, description text NOT NULL, source_kind text NOT NULL CHECK(source_kind IN ('pos_payment','pos_refund','settlement','settlement_reversal','opening','transfer','adjustment')),
 source_id uuid NOT NULL, source_part text NOT NULL DEFAULT '', settlement_id uuid, reverses_entry_id uuid,
 created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,branch_id,id), UNIQUE(tenant_id,source_kind,source_id,source_part), UNIQUE(reverses_entry_id),
 FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id), FOREIGN KEY(tenant_id,branch_id,account_id) REFERENCES finance_accounts(tenant_id,branch_id,id),
 FOREIGN KEY(tenant_id,settlement_id) REFERENCES finance_settlements(tenant_id,id), FOREIGN KEY(tenant_id,reverses_entry_id) REFERENCES finance_entries(tenant_id,id)
);
CREATE INDEX finance_entry_period ON finance_entries(tenant_id,branch_id,posted_on,id);
CREATE TABLE finance_reconciliations (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, branch_id uuid NOT NULL, entry_id uuid NOT NULL, account_id uuid NOT NULL,
 statement_on date NOT NULL, reference text NOT NULL, created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 voided_at timestamptz, voided_by uuid REFERENCES users(id), UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,branch_id,entry_id) REFERENCES finance_entries(tenant_id,branch_id,id),
 FOREIGN KEY(tenant_id,branch_id,account_id) REFERENCES finance_accounts(tenant_id,branch_id,id), CHECK((voided_at IS NULL)=(voided_by IS NULL))
);
CREATE UNIQUE INDEX finance_one_active_reconciliation ON finance_reconciliations(tenant_id,entry_id) WHERE voided_at IS NULL;
CREATE TABLE finance_events (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, branch_id uuid, entity_id uuid NOT NULL, action text NOT NULL,
 details jsonb NOT NULL DEFAULT '{}', actor_id uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id)
);
CREATE INDEX finance_event_entity ON finance_events(tenant_id,entity_id,created_at DESC);

-- Historic source records are adopted once. Identities are deterministic; amounts remain immutable.
CREATE FUNCTION finance_source_id(seed text) RETURNS uuid LANGUAGE sql IMMUTABLE SET search_path=public AS $$
 SELECT (substr(md5(seed),1,12)||'4'||substr(md5(seed),14,3)||'8'||substr(md5(seed),18,15))::uuid;
$$;
INSERT INTO finance_entries(id,tenant_id,branch_id,amount_cents,posted_on,description,source_kind,source_id,source_part,created_by,created_at)
 SELECT finance_source_id('pos-payment:'||p.sale_id::text||':'||p.method),p.tenant_id,v.branch_id,p.amount_cents,(v.created_at AT TIME ZONE 'America/Fortaleza')::date,
 'Recebimento '||v.receipt_code,'pos_payment',v.id,p.method,v.operator_id,v.created_at FROM pos_sale_payments p JOIN pos_sales v ON v.id=p.sale_id WHERE p.amount_cents>0;
INSERT INTO finance_entries(id,tenant_id,branch_id,amount_cents,posted_on,description,source_kind,source_id,source_part,created_by,created_at)
 SELECT finance_source_id('pos-refund:'||p.return_id::text||':'||p.method),p.tenant_id,r.branch_id,-p.amount_cents,(r.created_at AT TIME ZONE 'America/Fortaleza')::date,
 'Devolução '||v.receipt_code,'pos_refund',r.id,p.method,r.actor_id,r.created_at FROM pos_refund_payments p JOIN pos_returns r ON r.id=p.return_id JOIN pos_sales v ON v.id=r.sale_id;
INSERT INTO finance_titles(id,tenant_id,branch_id,direction,description,counterparty,amount_cents,competence_on,due_on,source_kind,source_id,created_by,created_at)
 SELECT finance_source_id('repair-title:'||o.id::text),o.tenant_id,o.branch_id,'receivable','Serviço '||o.code,o.customer_name,
 q.labor_price_cents+coalesce(p.amount,0),(o.delivered_at AT TIME ZONE 'America/Fortaleza')::date,(o.delivered_at AT TIME ZONE 'America/Fortaleza')::date,'repair',o.id,coalesce(o.delivered_by,o.created_by),o.delivered_at
 FROM repair_orders o JOIN repair_quotes q ON q.id=o.current_quote_id LEFT JOIN (
 SELECT e.order_id,sum(CASE WHEN e.kind='issue' THEN e.quantity ELSE -e.quantity END*x.unit_price_cents)::int AS amount FROM repair_part_events e JOIN repair_quote_items x ON x.id=e.quote_item_id GROUP BY e.order_id
 ) p ON p.order_id=o.id WHERE o.status='delivered' AND o.delivery_outcome='ready' AND q.labor_price_cents+coalesce(p.amount,0)>0;

CREATE FUNCTION finance_post_pos() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF TG_TABLE_NAME='pos_sale_payments' AND NEW.amount_cents>0 THEN
 INSERT INTO finance_entries(id,tenant_id,branch_id,amount_cents,posted_on,description,source_kind,source_id,source_part,created_by)
 SELECT finance_source_id('pos-payment:'||NEW.sale_id::text||':'||NEW.method),NEW.tenant_id,v.branch_id,NEW.amount_cents,(v.created_at AT TIME ZONE 'America/Fortaleza')::date,'Recebimento '||v.receipt_code,'pos_payment',v.id,NEW.method,v.operator_id FROM pos_sales v WHERE v.id=NEW.sale_id;
 ELSIF TG_TABLE_NAME='pos_refund_payments' THEN
 INSERT INTO finance_entries(id,tenant_id,branch_id,amount_cents,posted_on,description,source_kind,source_id,source_part,created_by)
 SELECT finance_source_id('pos-refund:'||NEW.return_id::text||':'||NEW.method),NEW.tenant_id,r.branch_id,-NEW.amount_cents,(r.created_at AT TIME ZONE 'America/Fortaleza')::date,'Devolução '||v.receipt_code,'pos_refund',r.id,NEW.method,r.actor_id FROM pos_returns r JOIN pos_sales v ON v.id=r.sale_id WHERE r.id=NEW.return_id;
 END IF; RETURN NEW;
END; $$;
CREATE TRIGGER finance_sale_payment AFTER INSERT ON pos_sale_payments FOR EACH ROW EXECUTE FUNCTION finance_post_pos();
CREATE TRIGGER finance_sale_refund AFTER INSERT ON pos_refund_payments FOR EACH ROW EXECUTE FUNCTION finance_post_pos();
CREATE FUNCTION finance_post_repair() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF NEW.status='delivered' AND OLD.status<>'delivered' AND NEW.delivery_outcome='ready' THEN
 INSERT INTO finance_titles(id,tenant_id,branch_id,direction,description,counterparty,amount_cents,competence_on,due_on,source_kind,source_id,created_by)
 SELECT finance_source_id('repair-title:'||NEW.id::text),NEW.tenant_id,NEW.branch_id,'receivable','Serviço '||NEW.code,NEW.customer_name,
 q.labor_price_cents+coalesce(p.amount,0),(NEW.delivered_at AT TIME ZONE 'America/Fortaleza')::date,(NEW.delivered_at AT TIME ZONE 'America/Fortaleza')::date,'repair',NEW.id,coalesce(NEW.delivered_by,NEW.created_by)
 FROM repair_quotes q LEFT JOIN (
 SELECT sum(CASE WHEN e.kind='issue' THEN e.quantity ELSE -e.quantity END*x.unit_price_cents)::int AS amount FROM repair_part_events e JOIN repair_quote_items x ON x.id=e.quote_item_id WHERE e.order_id=NEW.id
 ) p ON true WHERE q.id=NEW.current_quote_id AND q.labor_price_cents+coalesce(p.amount,0)>0;
 END IF; RETURN NEW;
END; $$;
CREATE TRIGGER finance_repair_delivery AFTER UPDATE OF status ON repair_orders FOR EACH ROW EXECUTE FUNCTION finance_post_repair();

ALTER TABLE finance_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_centers ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_titles ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_reconciliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON finance_accounts USING(tenant_id=current_setting('app.tenant_id',true)::uuid) WITH CHECK(tenant_id=current_setting('app.tenant_id',true)::uuid);
CREATE POLICY tenant_isolation ON finance_centers USING(tenant_id=current_setting('app.tenant_id',true)::uuid) WITH CHECK(tenant_id=current_setting('app.tenant_id',true)::uuid);
CREATE POLICY tenant_isolation ON finance_titles USING(tenant_id=current_setting('app.tenant_id',true)::uuid) WITH CHECK(tenant_id=current_setting('app.tenant_id',true)::uuid);
CREATE POLICY tenant_isolation ON finance_settlements USING(tenant_id=current_setting('app.tenant_id',true)::uuid) WITH CHECK(tenant_id=current_setting('app.tenant_id',true)::uuid);
CREATE POLICY tenant_isolation ON finance_entries USING(tenant_id=current_setting('app.tenant_id',true)::uuid) WITH CHECK(tenant_id=current_setting('app.tenant_id',true)::uuid);
CREATE POLICY tenant_isolation ON finance_reconciliations USING(tenant_id=current_setting('app.tenant_id',true)::uuid) WITH CHECK(tenant_id=current_setting('app.tenant_id',true)::uuid);
CREATE POLICY tenant_isolation ON finance_events USING(tenant_id=current_setting('app.tenant_id',true)::uuid) WITH CHECK(tenant_id=current_setting('app.tenant_id',true)::uuid);
GRANT SELECT,INSERT,UPDATE ON finance_accounts,finance_centers,finance_titles TO invictus_app;
GRANT SELECT,INSERT ON finance_settlements,finance_entries,finance_reconciliations,finance_events TO invictus_app;
GRANT UPDATE(voided_at,voided_by) ON finance_reconciliations TO invictus_app;

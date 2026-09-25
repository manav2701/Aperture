-- Tenant isolation for the Phase 4–5 tables (same policy as 0003), app-role grants, and the
-- notification the gateway listens on to drop cached keys, principals, policies and budgets.
DO $$
DECLARE
  tenant_table text;
BEGIN
  FOREACH tenant_table IN ARRAY ARRAY['credentials', 'alert_log', 'api_keys', 'gateway_requests'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tenant_table);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tenant_table);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (aperture_org_visible(org_id)) WITH CHECK (aperture_org_visible(org_id))',
      tenant_table
    );
  END LOOP;
END
$$;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON credentials, alert_log, api_keys, gateway_requests, prices TO aperture_app;
--> statement-breakpoint
ALTER TABLE principals ADD CONSTRAINT principals_system_role_check CHECK (system_role IS NULL OR system_role = 'unassigned');
--> statement-breakpoint
-- Every change that affects a gateway decision notifies `aperture_invalidate` with the org id,
-- so gateways drop their cache for that org within milliseconds (edge case P7).
CREATE OR REPLACE FUNCTION aperture_notify_invalidate() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('aperture_invalidate', coalesce(NEW.org_id, OLD.org_id)::text);
  RETURN NULL;
END
$$;
--> statement-breakpoint
DO $$
DECLARE
  watched text;
BEGIN
  FOREACH watched IN ARRAY ARRAY['principals', 'policies', 'api_keys', 'budgets', 'credentials', 'connections'] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION aperture_notify_invalidate()',
      watched || '_invalidate', watched
    );
  END LOOP;
END
$$;

-- Tenant isolation and grants for approvals, mandates and signing keys; mandate and approval
-- changes notify the gateway (P4: a revoked mandate stops working within milliseconds).
DO $$
DECLARE
  tenant_table text;
BEGIN
  FOREACH tenant_table IN ARRAY ARRAY['approvals', 'mandates', 'org_signing_keys'] LOOP
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
GRANT SELECT, INSERT, UPDATE ON approvals, mandates, org_signing_keys TO aperture_app;
--> statement-breakpoint
CREATE TRIGGER mandates_invalidate AFTER INSERT OR UPDATE OR DELETE ON mandates FOR EACH ROW EXECUTE FUNCTION aperture_notify_invalidate();

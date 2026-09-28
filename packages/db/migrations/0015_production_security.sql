-- Tenant isolation for the Phase 10 org tables (same policy as 0003); two-factor secrets are
-- auth tables like users and sessions (Better Auth manages them, deleting codes on disable).
DO $$
DECLARE
  tenant_table text;
BEGIN
  FOREACH tenant_table IN ARRAY ARRAY['org_settings', 'org_billing'] LOOP
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
GRANT SELECT, INSERT, UPDATE ON org_settings, org_billing TO aperture_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON two_factors TO aperture_app;
--> statement-breakpoint
-- Retention (org settings) deletes old request logs and generated media; the ledger and the
-- audit chain stay append-only.
GRANT DELETE ON gateway_requests, media_jobs TO aperture_app;

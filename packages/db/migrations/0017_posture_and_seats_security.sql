-- Tenant isolation and grants for Phases 11 and 12 (same policy as 0003). Posture runs are an
-- append-only history; nothing here is ever deleted except approved-tool entries an admin
-- removes. platform_signing_keys is global (like prices): it holds no org data.
DO $$
DECLARE
  tenant_table text;
BEGIN
  FOREACH tenant_table IN ARRAY ARRAY[
    'posture_runs', 'posture_waivers', 'statement_uploads', 'external_spend', 'attestations',
    'attestation_shares', 'seats', 'seat_usage_daily', 'receipts', 'tool_usage_daily',
    'telemetry_tokens', 'approved_tools', 'tool_confirmations'
  ] LOOP
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
GRANT SELECT, INSERT ON posture_runs TO aperture_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON statement_uploads, posture_waivers, external_spend, attestations, attestation_shares, seats,
  seat_usage_daily, receipts, tool_usage_daily, telemetry_tokens, tool_confirmations TO aperture_app;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON approved_tools TO aperture_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON platform_signing_keys TO aperture_app;

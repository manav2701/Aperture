-- Tenant isolation and grants for the x402 rail (same policy as 0003/0011). Stablecoin prices
-- are global, like prices. Account changes notify the gateway.
DO $$
DECLARE
  tenant_table text;
BEGIN
  FOREACH tenant_table IN ARRAY ARRAY['x402_accounts', 'x402_payments', 'x402_payees', 'audit_anchors'] LOOP
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
GRANT SELECT, INSERT, UPDATE ON x402_accounts, x402_payments, x402_payees, audit_anchors, stable_prices TO aperture_app;
--> statement-breakpoint
CREATE TRIGGER x402_accounts_invalidate AFTER INSERT OR UPDATE OR DELETE ON x402_accounts FOR EACH ROW EXECUTE FUNCTION aperture_notify_invalidate();

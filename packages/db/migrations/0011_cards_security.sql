-- Tenant isolation and grants for the cards rail (same policy as 0003/0009). FX rates are
-- global, like prices. Card changes notify the gateway and API caches.
DO $$
DECLARE
  tenant_table text;
BEGIN
  FOREACH tenant_table IN ARRAY ARRAY['cards', 'card_authorizations', 'card_transactions', 'webhook_receipts'] LOOP
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
GRANT SELECT, INSERT, UPDATE ON cards, card_authorizations, card_transactions, webhook_receipts, fx_rates TO aperture_app;
--> statement-breakpoint
CREATE TRIGGER cards_invalidate AFTER INSERT OR UPDATE OR DELETE ON cards FOR EACH ROW EXECUTE FUNCTION aperture_notify_invalidate();

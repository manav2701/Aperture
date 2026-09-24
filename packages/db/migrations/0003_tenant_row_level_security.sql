-- Tenant isolation as defence in depth (plan/security: cross-tenant data access). Application
-- code already scopes every query by org_id; these policies make a missed filter return nothing.
--
-- Each transaction declares whose data it may see:
--   select set_config('app.org_id', '<org uuid>', true)  -- request handling for one org
--   select set_config('app.system', 'on', true)          -- background jobs and migrations of data
-- FORCE applies the policies to the table owner too, so the app can't bypass them by accident.
CREATE OR REPLACE FUNCTION aperture_org_visible(target uuid) RETURNS boolean
  LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('app.system', true), '') = 'on'
      OR target = nullif(current_setting('app.org_id', true), '')::uuid
$$;
--> statement-breakpoint
DO $$
DECLARE
  tenant_table text;
BEGIN
  FOREACH tenant_table IN ARRAY ARRAY[
    'principals', 'budgets', 'holds', 'ledger_entries', 'audit_events', 'audit_org_counters',
    'teams', 'members', 'invitations', 'policies', 'connections'
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
ALTER TABLE orgs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE orgs FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON orgs USING (aperture_org_visible(id)) WITH CHECK (aperture_org_visible(id));
--> statement-breakpoint
-- budget_usage has no org_id; a row is visible when its budget is (the subquery is itself
-- subject to the budgets policy).
ALTER TABLE budget_usage ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE budget_usage FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON budget_usage
  USING (EXISTS (SELECT 1 FROM budgets b WHERE b.id = budget_id))
  WITH CHECK (EXISTS (SELECT 1 FROM budgets b WHERE b.id = budget_id));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON teams, members, invitations, policies, connections TO aperture_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON users, sessions, accounts, verifications, rate_limits TO aperture_app;
--> statement-breakpoint
-- Members are removed when someone leaves an org; invitations and policies are never deleted.
GRANT DELETE ON members TO aperture_app;

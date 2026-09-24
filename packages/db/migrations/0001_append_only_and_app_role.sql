-- The ledger journal and the audit log are append-only. The triggers apply to every role,
-- including the table owner, so history can't be edited without first dropping the trigger
-- (which itself shows up in migrations and database logs).
CREATE OR REPLACE FUNCTION aperture_forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% on % is not allowed: the table is append-only', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END
$$;
--> statement-breakpoint
CREATE TRIGGER ledger_entries_append_only
  BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION aperture_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER ledger_entries_no_truncate
  BEFORE TRUNCATE ON ledger_entries
  FOR EACH STATEMENT EXECUTE FUNCTION aperture_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER audit_events_append_only
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION aperture_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER audit_events_no_truncate
  BEFORE TRUNCATE ON audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION aperture_forbid_mutation();
--> statement-breakpoint
-- Role the services run as (deployments create a LOGIN user that is a member of it).
-- It can read and write working tables but only INSERT into the journal and audit log.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'aperture_app') THEN
    CREATE ROLE aperture_app NOLOGIN;
  END IF;
END
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO aperture_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON orgs, principals, budgets, budget_usage, holds, audit_org_counters TO aperture_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON ledger_entries, audit_events TO aperture_app;

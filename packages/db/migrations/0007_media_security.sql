-- Tenant isolation and app-role grants for media jobs (same policy as 0003/0005). Media prices
-- are global, like `prices`.
ALTER TABLE media_jobs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE media_jobs FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON media_jobs USING (aperture_org_visible(org_id)) WITH CHECK (aperture_org_visible(org_id));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON media_jobs, media_prices TO aperture_app;

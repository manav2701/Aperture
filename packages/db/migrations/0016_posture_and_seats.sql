CREATE TABLE "approved_tools" (
	"org_id" uuid NOT NULL,
	"tool_id" text NOT NULL,
	"added_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approved_tools_org_id_tool_id_pk" PRIMARY KEY("org_id","tool_id")
);
--> statement-breakpoint
CREATE TABLE "attestation_shares" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"attestation_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"views" integer DEFAULT 0 NOT NULL,
	"last_viewed_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attestation_shares_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "attestation_shares_expiry_check" CHECK (expires_at > created_at and expires_at <= created_at + interval '90 days')
);
--> statement-breakpoint
CREATE TABLE "attestations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"period_from" timestamp with time zone NOT NULL,
	"period_to" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"document" jsonb,
	"jws" text,
	"kid" text,
	"error" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attestations_status_check" CHECK (status in ('ready', 'failed')),
	CONSTRAINT "attestations_period_check" CHECK (period_from < period_to)
);
--> statement-breakpoint
CREATE TABLE "external_spend" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"occurred_on" text NOT NULL,
	"amount" bigint NOT NULL,
	"original_amount" text NOT NULL,
	"original_currency" text NOT NULL,
	"descriptor" text NOT NULL,
	"tool_id" text NOT NULL,
	"vendor" text NOT NULL,
	"category" text NOT NULL,
	"source" text NOT NULL,
	"upload_id" uuid,
	"receipt_id" uuid,
	"dedupe_hash" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"connection_id" uuid,
	"assigned_principal_id" uuid,
	"assigned_team_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "external_spend_dedupe_unique" UNIQUE("org_id","dedupe_hash"),
	CONSTRAINT "external_spend_source_check" CHECK (source in ('statement_upload', 'receipt')),
	CONSTRAINT "external_spend_status_check" CHECK (status in ('open', 'assigned', 'governed', 'dismissed', 'provider_billing')),
	CONSTRAINT "external_spend_amount_check" CHECK (amount >= 0)
);
--> statement-breakpoint
CREATE TABLE "platform_signing_keys" (
	"kid" text PRIMARY KEY NOT NULL,
	"public_jwk" jsonb NOT NULL,
	"private_key" jsonb NOT NULL,
	"retired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "posture_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"catalogue_version" integer NOT NULL,
	"trigger" text NOT NULL,
	"score" integer NOT NULL,
	"grade" text NOT NULL,
	"results" jsonb NOT NULL,
	"audit_verified_seq" bigint,
	"audit_verified_hash" text,
	"ran_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "posture_runs_trigger_check" CHECK (trigger in ('scheduled', 'manual', 'attestation')),
	CONSTRAINT "posture_runs_score_check" CHECK (score between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "posture_waivers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"check_id" text NOT NULL,
	"subject_id" text,
	"reason" text NOT NULL,
	"created_by" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "posture_waivers_reason_check" CHECK (char_length(reason) between 3 and 1000),
	CONSTRAINT "posture_waivers_expiry_check" CHECK (expires_at > created_at and expires_at <= created_at + interval '180 days')
);
--> statement-breakpoint
CREATE TABLE "receipts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"via" text NOT NULL,
	"submitted_by" text,
	"sender_domain" text,
	"message_hash" text NOT NULL,
	"status" text NOT NULL,
	"reason" text,
	"trust" text NOT NULL,
	"tool_id" text,
	"plan" text,
	"amount" bigint,
	"original_amount" text,
	"currency" text,
	"occurred_on" text,
	"renews_on" text,
	"seat_id" uuid,
	"external_spend_id" uuid,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "receipts_message_unique" UNIQUE("org_id","message_hash"),
	CONSTRAINT "receipts_via_check" CHECK (via in ('inbound_email', 'upload')),
	CONSTRAINT "receipts_status_check" CHECK (status in ('imported', 'review', 'dismissed'))
);
--> statement-breakpoint
CREATE TABLE "seat_usage_daily" (
	"seat_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"day" text NOT NULL,
	"active" boolean NOT NULL,
	"requests" integer DEFAULT 0 NOT NULL,
	"tokens" bigint DEFAULT 0 NOT NULL,
	"extra_usage_cost" bigint DEFAULT 0 NOT NULL,
	"estimated_cost" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "seat_usage_daily_seat_id_day_pk" PRIMARY KEY("seat_id","day")
);
--> statement-breakpoint
CREATE TABLE "seats" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"tool_id" text NOT NULL,
	"plan" text,
	"user_id" text,
	"external_user_ref" text,
	"source" text NOT NULL,
	"payer" text DEFAULT 'unknown' NOT NULL,
	"monthly_cost" bigint,
	"original_amount" text,
	"currency" text,
	"renews_on" text,
	"status" text DEFAULT 'active' NOT NULL,
	"last_active_at" timestamp with time zone,
	"connection_id" uuid,
	"note" text,
	"dedupe_key" text NOT NULL,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seats_dedupe_unique" UNIQUE("org_id","dedupe_key"),
	CONSTRAINT "seats_source_check" CHECK (source in ('connector', 'receipt', 'statement', 'declared', 'import', 'manual')),
	CONSTRAINT "seats_payer_check" CHECK (payer in ('company', 'personal_expensed', 'personal_unexpensed', 'unknown')),
	CONSTRAINT "seats_status_check" CHECK (status in ('active', 'idle', 'cancelled')),
	CONSTRAINT "seats_cost_check" CHECK (monthly_cost is null or monthly_cost >= 0)
);
--> statement-breakpoint
CREATE TABLE "statement_uploads" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"uploaded_by" text NOT NULL,
	"file_name" text NOT NULL,
	"rows_received" integer NOT NULL,
	"rows_new" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telemetry_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"tool" text NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"hash" text NOT NULL,
	"created_by" text NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "telemetry_tokens_hash_unique" UNIQUE("hash")
);
--> statement-breakpoint
CREATE TABLE "tool_confirmations" (
	"org_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tool_confirmations_org_id_user_id_pk" PRIMARY KEY("org_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "tool_usage_daily" (
	"org_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"tool" text NOT NULL,
	"day" text NOT NULL,
	"model" text NOT NULL,
	"sessions" integer DEFAULT 0 NOT NULL,
	"input_tokens" bigint DEFAULT 0 NOT NULL,
	"output_tokens" bigint DEFAULT 0 NOT NULL,
	"cache_read_tokens" bigint DEFAULT 0 NOT NULL,
	"cache_write_tokens" bigint DEFAULT 0 NOT NULL,
	"cost" bigint DEFAULT 0 NOT NULL,
	"active_seconds" integer DEFAULT 0 NOT NULL,
	"lines_added" integer DEFAULT 0 NOT NULL,
	"lines_removed" integer DEFAULT 0 NOT NULL,
	"commits" integer DEFAULT 0 NOT NULL,
	"pull_requests" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tool_usage_daily_org_id_user_id_tool_day_model_pk" PRIMARY KEY("org_id","user_id","tool","day","model")
);
--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN "receipts_token" text;--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN "idle_seat_days" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN "extra_usage_alert" bigint;--> statement-breakpoint
ALTER TABLE "principals" ADD COLUMN "purpose" text;--> statement-breakpoint
ALTER TABLE "principals" ADD COLUMN "data_classes" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "principals" ADD COLUMN "risk_tier" text;--> statement-breakpoint
ALTER TABLE "approved_tools" ADD CONSTRAINT "approved_tools_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approved_tools" ADD CONSTRAINT "approved_tools_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attestation_shares" ADD CONSTRAINT "attestation_shares_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attestation_shares" ADD CONSTRAINT "attestation_shares_attestation_id_attestations_id_fk" FOREIGN KEY ("attestation_id") REFERENCES "public"."attestations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attestation_shares" ADD CONSTRAINT "attestation_shares_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attestations" ADD CONSTRAINT "attestations_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attestations" ADD CONSTRAINT "attestations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_spend" ADD CONSTRAINT "external_spend_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_spend" ADD CONSTRAINT "external_spend_upload_id_statement_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."statement_uploads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_spend" ADD CONSTRAINT "external_spend_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_spend" ADD CONSTRAINT "external_spend_assigned_principal_id_principals_id_fk" FOREIGN KEY ("assigned_principal_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_spend" ADD CONSTRAINT "external_spend_assigned_team_id_teams_id_fk" FOREIGN KEY ("assigned_team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posture_runs" ADD CONSTRAINT "posture_runs_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posture_waivers" ADD CONSTRAINT "posture_waivers_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posture_waivers" ADD CONSTRAINT "posture_waivers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_seat_id_seats_id_fk" FOREIGN KEY ("seat_id") REFERENCES "public"."seats"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_external_spend_id_external_spend_id_fk" FOREIGN KEY ("external_spend_id") REFERENCES "public"."external_spend"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seat_usage_daily" ADD CONSTRAINT "seat_usage_daily_seat_id_seats_id_fk" FOREIGN KEY ("seat_id") REFERENCES "public"."seats"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seat_usage_daily" ADD CONSTRAINT "seat_usage_daily_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seats" ADD CONSTRAINT "seats_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seats" ADD CONSTRAINT "seats_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seats" ADD CONSTRAINT "seats_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement_uploads" ADD CONSTRAINT "statement_uploads_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement_uploads" ADD CONSTRAINT "statement_uploads_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telemetry_tokens" ADD CONSTRAINT "telemetry_tokens_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telemetry_tokens" ADD CONSTRAINT "telemetry_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telemetry_tokens" ADD CONSTRAINT "telemetry_tokens_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_confirmations" ADD CONSTRAINT "tool_confirmations_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_confirmations" ADD CONSTRAINT "tool_confirmations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_usage_daily" ADD CONSTRAINT "tool_usage_daily_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_usage_daily" ADD CONSTRAINT "tool_usage_daily_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attestation_shares_attestation_idx" ON "attestation_shares" USING btree ("attestation_id");--> statement-breakpoint
CREATE INDEX "attestations_org_idx" ON "attestations" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "external_spend_org_date_idx" ON "external_spend" USING btree ("org_id","occurred_on");--> statement-breakpoint
CREATE INDEX "posture_runs_org_ran_idx" ON "posture_runs" USING btree ("org_id","ran_at");--> statement-breakpoint
CREATE INDEX "posture_waivers_org_idx" ON "posture_waivers" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "receipts_org_status_idx" ON "receipts" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "seat_usage_daily_org_idx" ON "seat_usage_daily" USING btree ("org_id","day");--> statement-breakpoint
CREATE INDEX "seats_org_tool_idx" ON "seats" USING btree ("org_id","tool_id");--> statement-breakpoint
CREATE INDEX "seats_user_idx" ON "seats" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "telemetry_tokens_org_user_idx" ON "telemetry_tokens" USING btree ("org_id","user_id");--> statement-breakpoint
CREATE INDEX "tool_usage_daily_org_day_idx" ON "tool_usage_daily" USING btree ("org_id","day");--> statement-breakpoint
CREATE INDEX "ledger_entries_principal_time_idx" ON "ledger_entries" USING btree ("principal_id","occurred_at");--> statement-breakpoint
ALTER TABLE "org_settings" ADD CONSTRAINT "org_settings_receipts_token_unique" UNIQUE("receipts_token");--> statement-breakpoint
ALTER TABLE "org_settings" ADD CONSTRAINT "org_settings_idle_seat_days_check" CHECK (idle_seat_days between 7 and 365);--> statement-breakpoint
ALTER TABLE "principals" ADD CONSTRAINT "principals_risk_tier_check" CHECK (risk_tier is null or risk_tier in ('low', 'medium', 'high'));--> statement-breakpoint
ALTER TABLE "principals" ADD CONSTRAINT "principals_data_classes_check" CHECK (data_classes <@ array['none','internal','customer_personal','financial','health']::text[]);--> statement-breakpoint
ALTER TABLE "principals" ADD CONSTRAINT "principals_purpose_check" CHECK (purpose is null or char_length(purpose) <= 500);
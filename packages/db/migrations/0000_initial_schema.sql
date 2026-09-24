CREATE TABLE "audit_events" (
	"org_id" uuid NOT NULL,
	"seq" bigint NOT NULL,
	"id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"subject" text NOT NULL,
	"data" jsonb NOT NULL,
	"prev_hash" text NOT NULL,
	"hash" text NOT NULL,
	CONSTRAINT "audit_events_org_id_seq_pk" PRIMARY KEY("org_id","seq"),
	CONSTRAINT "audit_events_id_unique" UNIQUE("id")
);
--> statement-breakpoint
CREATE TABLE "audit_org_counters" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"last_seq" bigint NOT NULL,
	"last_hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budget_usage" (
	"budget_id" uuid NOT NULL,
	"period_key" text NOT NULL,
	"held" bigint DEFAULT 0 NOT NULL,
	"spent" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_usage_budget_id_period_key_pk" PRIMARY KEY("budget_id","period_key"),
	CONSTRAINT "budget_usage_held_check" CHECK (held >= 0)
);
--> statement-breakpoint
CREATE TABLE "budgets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"scope" text NOT NULL,
	"scope_id" uuid,
	"unit" text DEFAULT 'micros' NOT NULL,
	"period" text NOT NULL,
	"limit_amount" bigint NOT NULL,
	"mode" text DEFAULT 'hard' NOT NULL,
	"rails" text[] DEFAULT '{}'::text[] NOT NULL,
	"alert_thresholds" integer[] DEFAULT '{}'::integer[] NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budgets_scope_check" CHECK (scope in ('org', 'team', 'principal', 'mandate')),
	CONSTRAINT "budgets_unit_check" CHECK (unit in ('micros', 'count')),
	CONSTRAINT "budgets_period_check" CHECK (period in ('hour', 'day', 'week', 'month', 'none')),
	CONSTRAINT "budgets_mode_check" CHECK (mode in ('hard', 'soft')),
	CONSTRAINT "budgets_limit_check" CHECK (limit_amount >= 0),
	CONSTRAINT "budgets_rails_check" CHECK (rails <@ array['gateway','provider','card','x402']::text[])
);
--> statement-breakpoint
CREATE TABLE "holds" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"principal_id" uuid NOT NULL,
	"rail" text NOT NULL,
	"amount" bigint NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"on_expiry" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"resource" text,
	"external_ref" text,
	"budget_ids" uuid[] NOT NULL,
	"period_keys" text[] NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone,
	"settled_amount" bigint,
	CONSTRAINT "holds_idempotency_unique" UNIQUE("org_id","idempotency_key"),
	CONSTRAINT "holds_rail_check" CHECK (rail in ('gateway', 'provider', 'card', 'x402')),
	CONSTRAINT "holds_status_check" CHECK (status in ('open', 'settled', 'released', 'expired_reconciling')),
	CONSTRAINT "holds_on_expiry_check" CHECK (on_expiry in ('settle', 'release', 'reconcile')),
	CONSTRAINT "holds_amount_check" CHECK (amount > 0),
	CONSTRAINT "holds_settled_amount_check" CHECK (settled_amount is null or settled_amount >= 0),
	CONSTRAINT "holds_paths_check" CHECK (cardinality(budget_ids) = cardinality(period_keys))
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"amount" bigint NOT NULL,
	"hold_id" uuid,
	"rail" text NOT NULL,
	"principal_id" uuid NOT NULL,
	"resource" text,
	"external_ref" text,
	"budget_ids" uuid[] NOT NULL,
	"period_keys" text[] NOT NULL,
	"idempotency_key" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "ledger_entries_idempotency_unique" UNIQUE("org_id","idempotency_key"),
	CONSTRAINT "ledger_entries_kind_check" CHECK (kind in ('hold', 'release', 'capture', 'unheld_capture', 'observed', 'refund', 'adjustment')),
	CONSTRAINT "ledger_entries_rail_check" CHECK (rail in ('gateway', 'provider', 'card', 'x402')),
	CONSTRAINT "ledger_entries_paths_check" CHECK (cardinality(budget_ids) = cardinality(period_keys))
);
--> statement-breakpoint
CREATE TABLE "orgs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"timezone" text DEFAULT 'Asia/Dubai' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "principals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"parent_principal_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "principals_kind_check" CHECK (kind in ('user', 'agent')),
	CONSTRAINT "principals_status_check" CHECK (status in ('active', 'paused', 'revoked'))
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_org_counters" ADD CONSTRAINT "audit_org_counters_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_usage" ADD CONSTRAINT "budget_usage_budget_id_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."budgets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_parent_id_budgets_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."budgets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holds" ADD CONSTRAINT "holds_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holds" ADD CONSTRAINT "holds_principal_id_principals_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_hold_id_holds_id_fk" FOREIGN KEY ("hold_id") REFERENCES "public"."holds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_principal_id_principals_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "principals" ADD CONSTRAINT "principals_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "principals" ADD CONSTRAINT "principals_parent_principal_id_principals_id_fk" FOREIGN KEY ("parent_principal_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "budgets_org_idx" ON "budgets" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "budgets_scope_idx" ON "budgets" USING btree ("scope","scope_id");--> statement-breakpoint
CREATE INDEX "holds_expiry_idx" ON "holds" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "ledger_entries_org_time_idx" ON "ledger_entries" USING btree ("org_id","occurred_at");--> statement-breakpoint
CREATE INDEX "ledger_entries_hold_idx" ON "ledger_entries" USING btree ("hold_id");--> statement-breakpoint
CREATE INDEX "principals_org_idx" ON "principals" USING btree ("org_id");
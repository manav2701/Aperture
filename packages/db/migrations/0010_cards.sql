CREATE TABLE "card_authorizations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"card_id" uuid NOT NULL,
	"principal_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decision" text NOT NULL,
	"reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"hold_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"requested" bigint NOT NULL,
	"currency" text NOT NULL,
	"merchant" jsonb NOT NULL,
	"settled_at" timestamp with time zone,
	"settled_amount" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "card_authorizations_external_unique" UNIQUE("org_id","external_id"),
	CONSTRAINT "card_authorizations_status_check" CHECK (status in ('pending', 'closed', 'reversed', 'expired')),
	CONSTRAINT "card_authorizations_decision_check" CHECK (decision in ('approved', 'declined', 'unseen'))
);
--> statement-breakpoint
CREATE TABLE "card_transactions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"card_id" uuid NOT NULL,
	"principal_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"authorization_external_id" text,
	"type" text NOT NULL,
	"amount" bigint NOT NULL,
	"currency" text NOT NULL,
	"merchant" jsonb NOT NULL,
	"ledger_kind" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "card_transactions_external_unique" UNIQUE("org_id","external_id"),
	CONSTRAINT "card_transactions_type_check" CHECK (type in ('capture', 'refund'))
);
--> statement-breakpoint
CREATE TABLE "cards" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"principal_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"last4" text,
	"currency" text DEFAULT 'usd' NOT NULL,
	"controls" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"purpose" text,
	"approval_id" uuid,
	"mandate_id" uuid,
	"expires_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"canceled_at" timestamp with time zone,
	CONSTRAINT "cards_external_unique" UNIQUE("connection_id","external_id"),
	CONSTRAINT "cards_kind_check" CHECK (kind in ('agent', 'task')),
	CONSTRAINT "cards_status_check" CHECK (status in ('active', 'inactive', 'canceled'))
);
--> statement-breakpoint
CREATE TABLE "fx_rates" (
	"currency" text NOT NULL,
	"day" text NOT NULL,
	"micros_per_unit" bigint NOT NULL,
	"source" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fx_rates_currency_day_pk" PRIMARY KEY("currency","day")
);
--> statement-breakpoint
CREATE TABLE "webhook_receipts" (
	"org_id" uuid NOT NULL,
	"source" text NOT NULL,
	"event_id" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_receipts_org_id_source_event_id_pk" PRIMARY KEY("org_id","source","event_id")
);
--> statement-breakpoint
ALTER TABLE "card_authorizations" ADD CONSTRAINT "card_authorizations_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_authorizations" ADD CONSTRAINT "card_authorizations_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_authorizations" ADD CONSTRAINT "card_authorizations_principal_id_principals_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_transactions" ADD CONSTRAINT "card_transactions_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_transactions" ADD CONSTRAINT "card_transactions_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_transactions" ADD CONSTRAINT "card_transactions_principal_id_principals_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_principal_id_principals_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_approval_id_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approvals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_mandate_id_mandates_id_fk" FOREIGN KEY ("mandate_id") REFERENCES "public"."mandates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_receipts" ADD CONSTRAINT "webhook_receipts_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "card_authorizations_card_idx" ON "card_authorizations" USING btree ("card_id");--> statement-breakpoint
CREATE INDEX "card_transactions_auth_idx" ON "card_transactions" USING btree ("org_id","authorization_external_id");--> statement-breakpoint
CREATE INDEX "cards_principal_idx" ON "cards" USING btree ("principal_id");
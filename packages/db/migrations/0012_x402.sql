CREATE TABLE "audit_anchors" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"day" text NOT NULL,
	"root" text NOT NULL,
	"events" integer NOT NULL,
	"network" text NOT NULL,
	"signature" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_anchors_day_unique" UNIQUE("org_id","day")
);
--> statement-breakpoint
CREATE TABLE "stable_prices" (
	"asset" text PRIMARY KEY NOT NULL,
	"micros" bigint NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "x402_accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"principal_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"network" text NOT NULL,
	"asset" text NOT NULL,
	"mint" text NOT NULL,
	"decimals" integer NOT NULL,
	"treasury" text NOT NULL,
	"budget_account" text NOT NULL,
	"delegate" text,
	"delegate_secret" jsonb,
	"allowance" bigint DEFAULT 0 NOT NULL,
	"balance" bigint DEFAULT 0 NOT NULL,
	"max_per_payment" bigint NOT NULL,
	"status" text DEFAULT 'pending_setup' NOT NULL,
	"cursor" text,
	"checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "x402_accounts_budget_unique" UNIQUE("org_id","budget_account"),
	CONSTRAINT "x402_accounts_status_check" CHECK (status in ('pending_setup', 'active', 'revoked'))
);
--> statement-breakpoint
CREATE TABLE "x402_payees" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"origin" text NOT NULL,
	"pay_to" text NOT NULL,
	"network" text NOT NULL,
	"status" text NOT NULL,
	"approved_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "x402_payees_unique" UNIQUE("org_id","origin","pay_to"),
	CONSTRAINT "x402_payees_status_check" CHECK (status in ('active', 'pending'))
);
--> statement-breakpoint
CREATE TABLE "x402_payments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"principal_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"hold_id" uuid,
	"url" text NOT NULL,
	"origin" text NOT NULL,
	"pay_to" text NOT NULL,
	"fee_payer" text NOT NULL,
	"amount" bigint NOT NULL,
	"memo" text NOT NULL,
	"requirement" jsonb NOT NULL,
	"status" text DEFAULT 'authorized' NOT NULL,
	"tx_signature" text,
	"last_valid_block_height" bigint,
	"delivered_status" integer,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone,
	CONSTRAINT "x402_payments_memo_unique" UNIQUE("memo"),
	CONSTRAINT "x402_payments_status_check" CHECK (status in ('authorized', 'signed', 'settled', 'expired', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "audit_anchors" ADD CONSTRAINT "audit_anchors_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "x402_accounts" ADD CONSTRAINT "x402_accounts_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "x402_accounts" ADD CONSTRAINT "x402_accounts_principal_id_principals_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "x402_accounts" ADD CONSTRAINT "x402_accounts_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "x402_payees" ADD CONSTRAINT "x402_payees_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "x402_payees" ADD CONSTRAINT "x402_payees_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "x402_payments" ADD CONSTRAINT "x402_payments_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "x402_payments" ADD CONSTRAINT "x402_payments_principal_id_principals_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "x402_payments" ADD CONSTRAINT "x402_payments_account_id_x402_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."x402_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "x402_payments" ADD CONSTRAINT "x402_payments_hold_id_holds_id_fk" FOREIGN KEY ("hold_id") REFERENCES "public"."holds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "x402_accounts_principal_idx" ON "x402_accounts" USING btree ("principal_id");--> statement-breakpoint
CREATE INDEX "x402_payments_account_status_idx" ON "x402_payments" USING btree ("account_id","status");
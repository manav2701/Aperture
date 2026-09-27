CREATE TABLE "approvals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"requester_principal_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"rail" text NOT NULL,
	"resource" text NOT NULL,
	"amount" bigint NOT NULL,
	"purpose" text NOT NULL,
	"context" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" text,
	"decision_note" text,
	"approved_amount" bigint,
	"mandate_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approvals_status_check" CHECK (status in ('pending', 'approved', 'denied', 'expired', 'used'))
);
--> statement-breakpoint
CREATE TABLE "mandates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"parent_id" uuid,
	"issuer_user_id" text,
	"issuer_principal_id" uuid,
	"subject_principal_id" uuid NOT NULL,
	"scope" jsonb NOT NULL,
	"purpose" text NOT NULL,
	"budget_id" uuid,
	"not_before" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"max_uses" integer,
	"uses" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"kid" text NOT NULL,
	"jws" text NOT NULL,
	"approval_id" uuid,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mandates_status_check" CHECK (status in ('active', 'revoked')),
	CONSTRAINT "mandates_uses_check" CHECK (max_uses is null or uses <= max_uses)
);
--> statement-breakpoint
CREATE TABLE "org_signing_keys" (
	"kid" text PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"public_jwk" jsonb NOT NULL,
	"private_key" jsonb NOT NULL,
	"retired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_requester_principal_id_principals_id_fk" FOREIGN KEY ("requester_principal_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mandates" ADD CONSTRAINT "mandates_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mandates" ADD CONSTRAINT "mandates_parent_id_mandates_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."mandates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mandates" ADD CONSTRAINT "mandates_issuer_user_id_users_id_fk" FOREIGN KEY ("issuer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mandates" ADD CONSTRAINT "mandates_issuer_principal_id_principals_id_fk" FOREIGN KEY ("issuer_principal_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mandates" ADD CONSTRAINT "mandates_subject_principal_id_principals_id_fk" FOREIGN KEY ("subject_principal_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mandates" ADD CONSTRAINT "mandates_budget_id_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."budgets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_signing_keys" ADD CONSTRAINT "org_signing_keys_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approvals_org_status_idx" ON "approvals" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "mandates_subject_idx" ON "mandates" USING btree ("subject_principal_id");--> statement-breakpoint
CREATE INDEX "mandates_parent_idx" ON "mandates" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "org_signing_keys_org_idx" ON "org_signing_keys" USING btree ("org_id");
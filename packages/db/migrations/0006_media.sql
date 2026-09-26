CREATE TABLE "media_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"principal_id" uuid NOT NULL,
	"api_key_id" uuid,
	"kind" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"status" text NOT NULL,
	"prompt" text NOT NULL,
	"params" jsonb NOT NULL,
	"hold_id" uuid,
	"estimated" bigint NOT NULL,
	"cost" bigint,
	"provider_job_id" text,
	"outputs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"poll_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "media_jobs_kind_check" CHECK (kind in ('image', 'video')),
	CONSTRAINT "media_jobs_status_check" CHECK (status in ('running', 'succeeded', 'failed', 'expired_reconciling'))
);
--> statement-breakpoint
CREATE TABLE "media_prices" (
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"kind" text NOT NULL,
	"per_image" bigint,
	"per_image_token_per_m" bigint,
	"per_second" bigint,
	"skus" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_prices_provider_model_kind_pk" PRIMARY KEY("provider","model","kind")
);
--> statement-breakpoint
ALTER TABLE "media_jobs" ADD CONSTRAINT "media_jobs_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_jobs" ADD CONSTRAINT "media_jobs_principal_id_principals_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_jobs" ADD CONSTRAINT "media_jobs_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_jobs" ADD CONSTRAINT "media_jobs_hold_id_holds_id_fk" FOREIGN KEY ("hold_id") REFERENCES "public"."holds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_jobs_org_created_idx" ON "media_jobs" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "media_jobs_pending_idx" ON "media_jobs" USING btree ("status");
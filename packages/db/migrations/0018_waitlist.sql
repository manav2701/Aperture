CREATE TABLE "waitlist_signups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"company" text,
	"note" text,
	"team_size" text,
	"referrer" text,
	"invited_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "waitlist_signups_email_unique" UNIQUE("email"),
	CONSTRAINT "waitlist_signups_team_size_check" CHECK (team_size is null or team_size in ('just_me', '2_10', '11_50', '51_200', '200_plus'))
);
--> statement-breakpoint
CREATE INDEX "waitlist_signups_created_idx" ON "waitlist_signups" USING btree ("created_at");
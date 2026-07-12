CREATE TABLE "garmin_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"access_token_enc" text NOT NULL,
	"refresh_token_enc" text NOT NULL,
	"iv" text NOT NULL,
	"auth_tag" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"refresh_expires_at" timestamp with time zone,
	"scope" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activities" ALTER COLUMN "strava_activity_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "source" text DEFAULT 'strava' NOT NULL;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "garmin_summary_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "garmin_user_id" text;--> statement-breakpoint
ALTER TABLE "garmin_tokens" ADD CONSTRAINT "garmin_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "garmin_tokens_user_id_unique" ON "garmin_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "activities_user_garmin_summary_unique" ON "activities" USING btree ("user_id","garmin_summary_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_garmin_user_id_unique" ON "users" USING btree ("garmin_user_id");
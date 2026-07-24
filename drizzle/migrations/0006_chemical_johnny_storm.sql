ALTER TABLE "garmin_tokens" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "garmin_tokens" CASCADE;--> statement-breakpoint
DROP INDEX "activities_user_garmin_summary_unique";--> statement-breakpoint
DROP INDEX "users_garmin_user_id_unique";--> statement-breakpoint
ALTER TABLE "activities" DROP COLUMN "garmin_summary_id";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "garmin_user_id";
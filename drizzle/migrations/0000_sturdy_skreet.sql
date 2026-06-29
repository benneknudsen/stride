CREATE TYPE "public"."analysis_scope" AS ENUM('weekly', 'activity', 'trend', 'overall');--> statement-breakpoint
CREATE TYPE "public"."chat_role" AS ENUM('user', 'assistant', 'system');--> statement-breakpoint
CREATE TABLE "accounts" (
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text,
	CONSTRAINT "accounts_provider_provider_account_id_pk" PRIMARY KEY("provider","provider_account_id")
);
--> statement-breakpoint
CREATE TABLE "activities" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"strava_activity_id" bigint NOT NULL,
	"name" text NOT NULL,
	"type" text DEFAULT 'Run' NOT NULL,
	"distance" double precision NOT NULL,
	"moving_time" integer NOT NULL,
	"elapsed_time" integer NOT NULL,
	"total_elevation_gain" double precision DEFAULT 0 NOT NULL,
	"start_date" timestamp with time zone NOT NULL,
	"average_speed" double precision,
	"max_speed" double precision,
	"average_heartrate" real,
	"max_heartrate" real,
	"average_cadence" real,
	"average_watts" real,
	"calories" real,
	"splits" jsonb,
	"hr_zones" jsonb,
	"summary_polyline" text,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activity_embeddings" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"activity_id" text NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_analyses" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"scope" "analysis_scope" NOT NULL,
	"input_hash" text NOT NULL,
	"summary" text,
	"tool_calls" jsonb,
	"model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"role" "chat_role" NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"session_token" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expires" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "strava_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"access_token_enc" text NOT NULL,
	"refresh_token_enc" text NOT NULL,
	"iv" text NOT NULL,
	"auth_tag" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"scope" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"email_verified" timestamp with time zone,
	"name" text,
	"image" text,
	"strava_athlete_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification_tokens" (
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	"expires" timestamp with time zone NOT NULL,
	CONSTRAINT "verification_tokens_identifier_token_pk" PRIMARY KEY("identifier","token")
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_embeddings" ADD CONSTRAINT "activity_embeddings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_embeddings" ADD CONSTRAINT "activity_embeddings_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_analyses" ADD CONSTRAINT "ai_analyses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strava_tokens" ADD CONSTRAINT "strava_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "activities_user_strava_activity_unique" ON "activities" USING btree ("user_id","strava_activity_id");--> statement-breakpoint
CREATE INDEX "activities_user_start_date_idx" ON "activities" USING btree ("user_id","start_date");--> statement-breakpoint
CREATE INDEX "activity_embeddings_embedding_hnsw_idx" ON "activity_embeddings" USING hnsw ("embedding" vector_cosine_ops) WITH (m=16,ef_construction=64);--> statement-breakpoint
CREATE INDEX "activity_embeddings_user_idx" ON "activity_embeddings" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_analyses_user_scope_input_hash_unique" ON "ai_analyses" USING btree ("user_id","scope","input_hash");--> statement-breakpoint
CREATE INDEX "chat_messages_user_conversation_idx" ON "chat_messages" USING btree ("user_id","conversation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "strava_tokens_user_id_unique" ON "strava_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "users_strava_athlete_id_unique" ON "users" USING btree ("strava_athlete_id");
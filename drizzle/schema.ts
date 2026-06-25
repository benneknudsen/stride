import { createId } from "@paralleldrive/cuid2";
import {
  bigint,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  vector,
} from "drizzle-orm/pg-core";

/**
 * Database schema — see docs/architecture.md §2.
 *
 * Design notes:
 * - cuid2 primary keys (collision-resistant, URL-safe, sortable-ish)
 * - Strava OAuth tokens are NEVER stored in plaintext — only AES-256-GCM
 *   ciphertext + per-row IV + auth tag (see lib/crypto.ts)
 * - AI analyses are deduplicated via `inputHash` so the model is called
 *   once per dataset, not once per page view
 */

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/** Scope of an AI analysis — what slice of data it reasons over. */
export const analysisScopeEnum = pgEnum("analysis_scope", [
  "weekly",
  "activity",
  "trend",
  "overall",
]);

/** Role of a chat message in a Phase 2 RAG conversation. */
export const chatRoleEnum = pgEnum("chat_role", ["user", "assistant", "system"]);

// ---------------------------------------------------------------------------
// users — linked to a Strava athlete
// ---------------------------------------------------------------------------

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    email: text("email").notNull(),
    name: text("name"),
    image: text("image"),
    /** Strava athlete id (numeric, stored as bigint for headroom). */
    stravaAthleteId: bigint("strava_athlete_id", { mode: "number" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("users_email_unique").on(table.email),
    uniqueIndex("users_strava_athlete_id_unique").on(table.stravaAthleteId),
  ]
);

// ---------------------------------------------------------------------------
// strava_tokens — AES-256-GCM encrypted OAuth tokens (one row per user)
// ---------------------------------------------------------------------------

export const stravaTokens = pgTable(
  "strava_tokens",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** AES-256-GCM ciphertext of the Strava access token. */
    accessTokenEnc: text("access_token_enc").notNull(),
    /** AES-256-GCM ciphertext of the Strava refresh token. */
    refreshTokenEnc: text("refresh_token_enc").notNull(),
    /** Per-row initialization vector (base64). */
    iv: text("iv").notNull(),
    /** GCM authentication tag (base64). */
    authTag: text("auth_tag").notNull(),
    /** When the access token expires (Strava `expires_at`). */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    /** Granted OAuth scope string. */
    scope: text("scope"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("strava_tokens_user_id_unique").on(table.userId)]
);

// ---------------------------------------------------------------------------
// activities — running workouts from Strava with full metrics
// ---------------------------------------------------------------------------

export const activities = pgTable(
  "activities",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Strava activity id. */
    stravaActivityId: bigint("strava_activity_id", { mode: "number" }).notNull(),
    name: text("name").notNull(),
    /** Strava activity type, e.g. "Run", "TrailRun". */
    type: text("type").notNull().default("Run"),
    /** Distance in meters. */
    distance: doublePrecision("distance").notNull(),
    /** Moving time in seconds. */
    movingTime: integer("moving_time").notNull(),
    /** Elapsed time in seconds. */
    elapsedTime: integer("elapsed_time").notNull(),
    /** Total elevation gain in meters. */
    totalElevationGain: doublePrecision("total_elevation_gain").notNull().default(0),
    /** Activity start (UTC). */
    startDate: timestamp("start_date", { withTimezone: true }).notNull(),
    /** Average speed in meters/second. */
    averageSpeed: doublePrecision("average_speed"),
    /** Max speed in meters/second. */
    maxSpeed: doublePrecision("max_speed"),
    /** Average heart rate in bpm. */
    averageHeartrate: real("average_heartrate"),
    /** Max heart rate in bpm. */
    maxHeartrate: real("max_heartrate"),
    /** Average cadence (single-leg, Strava convention). */
    averageCadence: real("average_cadence"),
    /** Average power in watts. */
    averageWatts: real("average_watts"),
    /** Estimated calories burned. */
    calories: real("calories"),
    /** Per-kilometer/mile split metrics. */
    splits: jsonb("splits"),
    /** Time-in-zone heart rate buckets. */
    hrZones: jsonb("hr_zones"),
    /** Encoded summary polyline for map rendering. */
    summaryPolyline: text("summary_polyline"),
    /** Raw Strava payload retained for audit / re-processing. */
    raw: jsonb("raw"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("activities_user_strava_activity_unique").on(table.userId, table.stravaActivityId),
    index("activities_user_start_date_idx").on(table.userId, table.startDate),
  ]
);

// ---------------------------------------------------------------------------
// ai_analyses — cached AI responses, deduplicated by inputHash
// ---------------------------------------------------------------------------

export const aiAnalyses = pgTable(
  "ai_analyses",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    scope: analysisScopeEnum("scope").notNull(),
    /** Content hash of the input dataset — the cache key. */
    inputHash: text("input_hash").notNull(),
    /** Streamed prose summary persisted for replay. */
    summary: text("summary"),
    /** Generative-UI tool calls (typed component invocations). */
    toolCalls: jsonb("tool_calls"),
    /** Model identifier that produced this analysis. */
    model: text("model"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("ai_analyses_user_scope_input_hash_unique").on(
      table.userId,
      table.scope,
      table.inputHash
    ),
  ]
);

// ---------------------------------------------------------------------------
// chat_messages — Phase 2 RAG conversation threading
// ---------------------------------------------------------------------------

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Groups messages into a single conversation thread. */
    conversationId: text("conversation_id").notNull(),
    role: chatRoleEnum("role").notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("chat_messages_user_conversation_idx").on(table.userId, table.conversationId)]
);

// ---------------------------------------------------------------------------
// activity_embeddings — Phase 2 pgvector, HNSW cosine index
// ---------------------------------------------------------------------------

export const activityEmbeddings = pgTable(
  "activity_embeddings",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    activityId: text("activity_id")
      .notNull()
      .references(() => activities.id, { onDelete: "cascade" }),
    /** Natural-language summary that was embedded. */
    content: text("content").notNull(),
    /** OpenAI text-embedding-3-small dimensionality. */
    embedding: vector("embedding", { dimensions: 1536 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("activity_embeddings_embedding_hnsw_idx")
      .using("hnsw", table.embedding.op("vector_cosine_ops"))
      .with({ m: 16, ef_construction: 64 }),
    index("activity_embeddings_user_idx").on(table.userId),
  ]
);

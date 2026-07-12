import { createId } from "@paralleldrive/cuid2";
import {
  bigint,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  vector,
} from "drizzle-orm/pg-core";
import type { AdapterAccount } from "next-auth/adapters";

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
    /** Set by NextAuth when an email/OAuth identity is verified. */
    emailVerified: timestamp("email_verified", { withTimezone: true }),
    name: text("name"),
    image: text("image"),
    /** Strava athlete id (numeric, stored as bigint for headroom). */
    stravaAthleteId: bigint("strava_athlete_id", { mode: "number" }),
    /**
     * Garmin's app-scoped user id (issue #35). Opaque string, not numeric — it
     * is how a Garmin push notification names the athlete, so the webhook
     * resolves the owning user through this column.
     */
    garminUserId: text("garmin_user_id"),
    /** Målrace-dato (dag-granulær, ingen tz). Null = ingen race valgt → demo-fallback. */
    raceDate: date("race_date", { mode: "date" }),
    /** Valgfrit racenavn til UI ("Silkeborg Halvmarathon"). */
    raceName: text("race_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("users_email_unique").on(table.email),
    uniqueIndex("users_strava_athlete_id_unique").on(table.stravaAthleteId),
    uniqueIndex("users_garmin_user_id_unique").on(table.garminUserId),
  ]
);

// ---------------------------------------------------------------------------
// NextAuth (Auth.js) adapter tables — required by @auth/drizzle-adapter for the
// Email magic-link + GitHub/Google OAuth providers. Column/property names follow
// the Auth.js contract exactly (the adapter accesses them by these keys).
// ---------------------------------------------------------------------------

export const accounts = pgTable(
  "accounts",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccount["type"]>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (account) => [
    primaryKey({ columns: [account.provider, account.providerAccountId] }),
    // NextAuth adapter lookups and user-cascade deletes filter accounts by
    // user_id; the composite PK leads with provider and can't serve it — #43.
    index("accounts_user_id_idx").on(account.userId),
  ]
);

export const sessions = pgTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { withTimezone: true }).notNull(),
});

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { withTimezone: true }).notNull(),
  },
  (vt) => [primaryKey({ columns: [vt.identifier, vt.token] })]
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
// garmin_tokens — AES-256-GCM encrypted OAuth tokens (one row per user).
// Mirrors strava_tokens (issue #35). Garmin's tokens are deliberately NOT left
// in the NextAuth `accounts` row the adapter writes: the adapter stores them in
// plaintext, and this codebase's rule is that provider tokens are encrypted at
// rest (lib/crypto.ts). `accounts` keeps the identity link; the secrets live here.
// ---------------------------------------------------------------------------

export const garminTokens = pgTable(
  "garmin_tokens",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** AES-256-GCM ciphertext of a JSON blob holding both tokens (single IV). */
    accessTokenEnc: text("access_token_enc").notNull(),
    /** Unused — both tokens live in `accessTokenEnc`. Kept for parity with strava_tokens. */
    refreshTokenEnc: text("refresh_token_enc").notNull(),
    /** Per-row initialization vector (hex). */
    iv: text("iv").notNull(),
    /** GCM authentication tag (hex). */
    authTag: text("auth_tag").notNull(),
    /** When the access token expires (derived from Garmin's relative `expires_in`). */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    /** When the *refresh* token expires — Garmin's expire too (~3 months). */
    refreshExpiresAt: timestamp("refresh_expires_at", { withTimezone: true }),
    /** Granted OAuth scope string. */
    scope: text("scope"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("garmin_tokens_user_id_unique").on(table.userId)]
);

// ---------------------------------------------------------------------------
// activities — running workouts with full metrics, from Strava or Garmin
// ---------------------------------------------------------------------------

export const activities = pgTable(
  "activities",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /**
     * Which provider this row was ingested from (issue #35). Defaults to
     * "strava" so every row written before Garmin existed keeps its true origin
     * without a backfill. Feeds the UI's SourceBadge.
     */
    source: text("source").notNull().default("strava"),
    /**
     * Strava activity id. Null on Garmin rows — the provider-specific id columns
     * are mutually exclusive, one per `source`.
     */
    stravaActivityId: bigint("strava_activity_id", { mode: "number" }),
    /**
     * Garmin's `summaryId` — the dedup key for a Garmin activity. A string, not
     * a number (e.g. "x153.1652667514"), and the only id Garmin guarantees on
     * both the pull and the push payload (`activityId` is absent on some manual
     * entries). Null on Strava rows.
     */
    garminSummaryId: text("garmin_summary_id"),
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
    /** Raw provider payload retained for audit / re-processing. */
    raw: jsonb("raw"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Both provider keys are nullable now, and Postgres treats NULLs as distinct
    // in a unique index — so a user's many Garmin rows (all with a null
    // strava_activity_id) don't collide here, and vice versa.
    uniqueIndex("activities_user_strava_activity_unique").on(table.userId, table.stravaActivityId),
    uniqueIndex("activities_user_garmin_summary_unique").on(table.userId, table.garminSummaryId),
    index("activities_user_start_date_idx").on(table.userId, table.startDate),
    // Webhook delete/lookup filters by strava_activity_id alone; the composite
    // unique above leads with user_id and can't serve it — see issue #38.
    index("activities_strava_activity_id_idx").on(table.stravaActivityId),
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
// chat_messages — persisted AI coach conversation history (issue #74).
// One rolling thread per user; the chat route loads the newest N rows as
// model context and appends each user/assistant turn after streaming.
// ---------------------------------------------------------------------------

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: chatRoleEnum("role").notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("chat_messages_user_created_idx").on(table.userId, table.createdAt)]
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

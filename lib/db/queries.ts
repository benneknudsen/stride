import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { revalidateTag, unstable_cache } from "next/cache";
import { cache } from "react";
import {
  accounts,
  activities,
  aiAnalyses,
  chatMessages,
  stravaTokens,
  users,
} from "../../drizzle/schema";
import type { AnalysisScope, HrZone } from "../../types/domain";
import { fromDbDate, toDbDate } from "./calendar-date";
import { db } from "./index";

/**
 * Default look-back window for the dashboard read. The dashboard only renders
 * recent training load (last ~3 months of stat tiles, charts, and rows), so
 * bounding the query to 90 days keeps it from scanning a user's entire history
 * as their activity count grows unbounded (issue #63).
 */
const DASHBOARD_WINDOW_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * TTL for the dashboard activities cache (issue #57) — activities rarely
 * change within a minute, so a short revalidation window absorbs repeat
 * dashboard loads between requests without serving meaningfully stale data.
 */
const DASHBOARD_ACTIVITIES_TTL_SECONDS = 60;

/** Cache tag scoping a user's dashboard-activities cache entries for targeted invalidation. */
function dashboardActivitiesTag(userId: string): string {
  return `dashboard-activities:${userId}`;
}

/**
 * Typed query functions. Every read that returns user-owned data takes a
 * `userId` so ownership is enforced at the query layer, not in the caller.
 *
 * Read getters are wrapped in React `cache()` for per-request deduplication
 * (issue #65): when several Server Components in the same render request the
 * same row (e.g. the layout and a page both fetch the session user), the query
 * runs once and the result is shared. `cache()` is a no-op outside a request
 * scope, so callers and tests see normal call-through semantics. Write paths
 * (`upsert*`, `insert*`) are intentionally left uncached.
 */

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export const getUserByEmail = cache(async (email: string) => {
  try {
    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    return user ?? null;
  } catch {
    return null;
  }
});

export const getUserById = cache(async (id: string) => {
  try {
    const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    if (!user) return null;
    // Normalised here too, so every raceDate leaving this module is a
    // local-midnight calendar day regardless of which read it came from.
    return { ...user, raceDate: fromDbDate(user.raceDate) };
  } catch {
    return null;
  }
});

/**
 * The user's target race (issue #99): a day-granular date plus an optional
 * display name. Both fields are null until the user picks a race — callers
 * fall back to the engine's DEFAULT_RACE_DATE (demo plan) in that case.
 * Returns null when the user row itself is missing or the read fails.
 */
export const getRacePlan = cache(async (userId: string) => {
  try {
    const [row] = await db
      .select({ raceDate: users.raceDate, raceName: users.raceName })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!row) return null;
    return { ...row, raceDate: fromDbDate(row.raceDate) };
  } catch {
    return null;
  }
});

/**
 * Set (or clear) the user's target race. Write path — intentionally uncached.
 * `raceDate` is a local-midnight calendar day (see lib/db/calendar-date.ts).
 */
export async function updateRacePlan(
  userId: string,
  input: { raceDate: Date | null; raceName: string | null }
) {
  const [user] = await db
    .update(users)
    .set({
      raceDate: toDbDate(input.raceDate),
      raceName: input.raceName,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId))
    .returning({ id: users.id, raceDate: users.raceDate, raceName: users.raceName });
  if (!user) return null;
  return { ...user, raceDate: fromDbDate(user.raceDate) };
}

/**
 * OAuth accounts linked to a user via NextAuth (GitHub, Google, …). Returns the
 * non-sensitive identity columns only — never the stored tokens.
 */
export const getAccountsByUserId = cache(async (userId: string) => {
  try {
    return await db
      .select({ provider: accounts.provider, type: accounts.type })
      .from(accounts)
      .where(eq(accounts.userId, userId));
  } catch {
    return [];
  }
});

// ---------------------------------------------------------------------------
// Strava tokens (encrypted at rest)
// ---------------------------------------------------------------------------

export const getStravaTokens = cache(async (userId: string) => {
  try {
    const [token] = await db
      .select()
      .from(stravaTokens)
      .where(eq(stravaTokens.userId, userId))
      .limit(1);
    return token ?? null;
  } catch {
    return null;
  }
});

type UpsertStravaTokensInput = {
  userId: string;
  accessTokenEnc: string;
  refreshTokenEnc: string;
  iv: string;
  authTag: string;
  expiresAt: Date;
  scope?: string | null;
};

export async function upsertStravaTokens(input: UpsertStravaTokensInput) {
  const [token] = await db
    .insert(stravaTokens)
    .values(input)
    .onConflictDoUpdate({
      target: stravaTokens.userId,
      set: {
        accessTokenEnc: input.accessTokenEnc,
        refreshTokenEnc: input.refreshTokenEnc,
        iv: input.iv,
        authTag: input.authTag,
        expiresAt: input.expiresAt,
        scope: input.scope,
        updatedAt: new Date(),
      },
    })
    .returning();
  return token;
}

// ---------------------------------------------------------------------------
// Activities
// ---------------------------------------------------------------------------

type GetActivitiesOptions = {
  limit?: number;
  offset?: number;
  from?: Date;
  to?: Date;
};

export const getActivities = cache(async (userId: string, options: GetActivitiesOptions = {}) => {
  const { limit = 30, offset = 0, from, to } = options;

  const conditions = [eq(activities.userId, userId)];
  if (from) {
    conditions.push(gte(activities.startDate, from));
  }
  if (to) {
    conditions.push(lte(activities.startDate, to));
  }

  try {
    return await db
      .select()
      .from(activities)
      .where(and(...conditions))
      .orderBy(desc(activities.startDate))
      .limit(limit)
      .offset(offset);
  } catch {
    return [];
  }
});

/**
 * Column-projected activity read for the dashboard. Selects only the fields the
 * dashboard's stat tiles, charts, and activity rows actually consume — omitting
 * the heavy jsonb/text columns (`raw`, `splits`, `summaryPolyline`) a page view
 * never touches. One call replaces the six independent `getActivities` reads the
 * dashboard used to issue (issue #37): the page fetches this once and slices it
 * per component instead of re-querying the same rows six times.
 *
 * Bounded to the last {@link DASHBOARD_WINDOW_DAYS} days by default so the read
 * stays cheap as a user's history grows (issue #63); pass `sinceDays` to widen
 * or narrow the window.
 *
 * Two cache layers, per issue #57: React `cache()` dedupes repeat calls within
 * a single render (the six dashboard components that slice this share one
 * query per request), and `unstable_cache` wraps the actual query with a
 * {@link DASHBOARD_ACTIVITIES_TTL_SECONDS}s TTL so it also survives *across*
 * requests — activities change rarely enough that a one-minute-stale read is
 * an acceptable trade for skipping the DB round trip. The TTL cache is tagged
 * per-user so a sync or webhook write can invalidate just that user's entry
 * (see {@link revalidateDashboardActivities}).
 */
export const getDashboardActivities = cache(
  async (userId: string, sinceDays: number = DASHBOARD_WINDOW_DAYS) => {
    // Defensive: an empty/undefined userId would otherwise poison the cache key
    // and query every user's activities-window with a falsy owner filter.
    if (!userId) return [];
    return unstable_cache(
      async () => {
        const since = new Date(Date.now() - sinceDays * DAY_MS);
        try {
          const rows = await db
            .select({
              id: activities.id,
              name: activities.name,
              type: activities.type,
              startDate: activities.startDate,
              distance: activities.distance,
              movingTime: activities.movingTime,
              averageSpeed: activities.averageSpeed,
              averageHeartrate: activities.averageHeartrate,
              averageCadence: activities.averageCadence,
              totalElevationGain: activities.totalElevationGain,
              hrZones: activities.hrZones,
            })
            .from(activities)
            .where(and(eq(activities.userId, userId), gte(activities.startDate, since)))
            .orderBy(desc(activities.startDate))
            .limit(500);
          // `hr_zones` is a jsonb column, which Drizzle types as `unknown`; the
          // sync writer only ever stores HrZone[]. Narrow it here — the same
          // explicit-JSON convention as `Activity` in types/domain.ts — so these
          // rows can feed the coach engine's zone charts (issue #86).
          return rows.map((row) => ({ ...row, hrZones: row.hrZones as HrZone[] | null }));
        } catch {
          return [];
        }
      },
      ["dashboard-activities", userId, String(sinceDays)],
      { revalidate: DASHBOARD_ACTIVITIES_TTL_SECONDS, tags: [dashboardActivitiesTag(userId)] }
    )();
  }
);

/**
 * Expire a user's dashboard-activities TTL cache immediately. Called by the
 * Strava webhook and sync routes when that user's activity data changes, so
 * the 60s cache never serves a dashboard read older than the newest sync —
 * same `expire: 0` hard-expiry pattern as {@link revalidateProgression} in
 * `lib/coach/dashboard-data.ts`.
 */
export function revalidateDashboardActivities(userId: string): void {
  revalidateTag(dashboardActivitiesTag(userId), { expire: 0 });
}

/**
 * A single row from {@link getDashboardActivities} — the projected activity
 * shape shared by every dashboard component's props.
 */
export type DashboardActivity = Awaited<ReturnType<typeof getDashboardActivities>>[number];

/** Fetch a single activity, enforcing ownership via userId. */
export const getActivityById = cache(async (userId: string, activityId: string) => {
  try {
    const [activity] = await db
      .select()
      .from(activities)
      .where(and(eq(activities.id, activityId), eq(activities.userId, userId)))
      .limit(1);
    return activity ?? null;
  } catch {
    return null;
  }
});

// ---------------------------------------------------------------------------
// AI analyses (inputHash-deduplicated cache)
// ---------------------------------------------------------------------------

export const getCachedAnalysis = cache(
  async (userId: string, scope: AnalysisScope, inputHash: string) => {
    try {
      const [analysis] = await db
        .select()
        .from(aiAnalyses)
        .where(
          and(
            eq(aiAnalyses.userId, userId),
            eq(aiAnalyses.scope, scope),
            eq(aiAnalyses.inputHash, inputHash)
          )
        )
        .limit(1);
      return analysis ?? null;
    } catch {
      return null;
    }
  }
);

type InsertAnalysisInput = {
  userId: string;
  scope: AnalysisScope;
  inputHash: string;
  summary?: string | null;
  toolCalls?: unknown;
  model?: string | null;
};

export async function insertAnalysis(input: InsertAnalysisInput) {
  const [analysis] = await db
    .insert(aiAnalyses)
    .values(input)
    .onConflictDoUpdate({
      target: [aiAnalyses.userId, aiAnalyses.scope, aiAnalyses.inputHash],
      set: {
        summary: input.summary,
        toolCalls: input.toolCalls,
        model: input.model,
      },
    })
    .returning();
  return analysis;
}

// ---------------------------------------------------------------------------
// Chat messages (issue #74) — persisted AI coach conversation history.
// Both functions are best-effort: a DB outage must never break the chat
// route, so failures are swallowed and the chat degrades to stateless.
// ---------------------------------------------------------------------------

export async function insertChatMessage(input: {
  userId: string;
  role: "user" | "assistant";
  content: string;
}): Promise<void> {
  try {
    await db.insert(chatMessages).values(input);
  } catch {
    // Best-effort — the message simply isn't persisted.
  }
}

/**
 * The user's newest `limit` chat messages in chronological order, ready to be
 * prepended to the model context. System rows are excluded — the route owns
 * its own system prompt.
 */
export async function getChatHistory(
  userId: string,
  limit: number = 50
): Promise<{ role: "user" | "assistant"; content: string }[]> {
  try {
    const rows = await db
      .select({ role: chatMessages.role, content: chatMessages.content })
      .from(chatMessages)
      .where(
        and(eq(chatMessages.userId, userId), inArray(chatMessages.role, ["user", "assistant"]))
      )
      .orderBy(desc(chatMessages.createdAt))
      .limit(limit);
    return rows.reverse() as { role: "user" | "assistant"; content: string }[];
  } catch {
    return [];
  }
}

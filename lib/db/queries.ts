import { and, desc, eq, gte, lte } from "drizzle-orm";
import { accounts, activities, aiAnalyses, stravaTokens, users } from "../../drizzle/schema";
import type { AnalysisScope } from "../../types/domain";
import { db } from "./index";

/**
 * Typed query functions. Every read that returns user-owned data takes a
 * `userId` so ownership is enforced at the query layer, not in the caller.
 */

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export async function getUserByEmail(email: string) {
  try {
    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    return user ?? null;
  } catch {
    return null;
  }
}

export async function getUserById(id: string) {
  try {
    const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return user ?? null;
  } catch {
    return null;
  }
}

/**
 * OAuth accounts linked to a user via NextAuth (GitHub, Google, …). Returns the
 * non-sensitive identity columns only — never the stored tokens.
 */
export async function getAccountsByUserId(userId: string) {
  try {
    return await db
      .select({ provider: accounts.provider, type: accounts.type })
      .from(accounts)
      .where(eq(accounts.userId, userId));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Strava tokens (encrypted at rest)
// ---------------------------------------------------------------------------

export async function getStravaTokens(userId: string) {
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
}

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

export async function getActivities(userId: string, options: GetActivitiesOptions = {}) {
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
}

/**
 * Column-projected activity read for the dashboard. Selects only the fields the
 * dashboard's stat tiles, charts, and activity rows actually consume — omitting
 * the heavy jsonb/text columns (`raw`, `splits`, `summaryPolyline`) a page view
 * never touches. One call replaces the six independent `getActivities` reads the
 * dashboard used to issue (issue #37): the page fetches this once and slices it
 * per component instead of re-querying the same rows six times.
 */
export async function getDashboardActivities(userId: string) {
  try {
    return await db
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
      .where(eq(activities.userId, userId))
      .orderBy(desc(activities.startDate))
      .limit(500);
  } catch {
    return [];
  }
}

/**
 * A single row from {@link getDashboardActivities} — the projected activity
 * shape shared by every dashboard component's props.
 */
export type DashboardActivity = Awaited<ReturnType<typeof getDashboardActivities>>[number];

/** Fetch a single activity, enforcing ownership via userId. */
export async function getActivityById(userId: string, activityId: string) {
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
}

// ---------------------------------------------------------------------------
// AI analyses (inputHash-deduplicated cache)
// ---------------------------------------------------------------------------

export async function getCachedAnalysis(userId: string, scope: AnalysisScope, inputHash: string) {
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

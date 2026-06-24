import { and, desc, eq, gte, lte } from "drizzle-orm";
import { activities, aiAnalyses, stravaTokens, users } from "../../drizzle/schema";
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
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return user ?? null;
}

export async function getUserById(id: string) {
  const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return user ?? null;
}

// ---------------------------------------------------------------------------
// Strava tokens (encrypted at rest)
// ---------------------------------------------------------------------------

export async function getStravaTokens(userId: string) {
  const [token] = await db
    .select()
    .from(stravaTokens)
    .where(eq(stravaTokens.userId, userId))
    .limit(1);
  return token ?? null;
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

  return db
    .select()
    .from(activities)
    .where(and(...conditions))
    .orderBy(desc(activities.startDate))
    .limit(limit)
    .offset(offset);
}

/** Fetch a single activity, enforcing ownership via userId. */
export async function getActivityById(userId: string, activityId: string) {
  const [activity] = await db
    .select()
    .from(activities)
    .where(and(eq(activities.id, activityId), eq(activities.userId, userId)))
    .limit(1);
  return activity ?? null;
}

// ---------------------------------------------------------------------------
// AI analyses (inputHash-deduplicated cache)
// ---------------------------------------------------------------------------

export async function getCachedAnalysis(userId: string, scope: AnalysisScope, inputHash: string) {
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

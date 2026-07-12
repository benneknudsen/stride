"use server";

import type { InferSelectModel } from "drizzle-orm";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { activities } from "@/drizzle/schema";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export type Activity = InferSelectModel<typeof activities>;

/**
 * List-view projection of {@link Activity}: every column except the heavy
 * jsonb/text payloads (`raw`, `splits`, `summaryPolyline`). List rows, stat
 * tiles, and charts never read those columns, and shipping them to the client
 * bloats the wire payload — so getActivities() projects them out (query
 * optimizer MELLEM-1). Use getActivity() when the full row is needed.
 */
export type ActivityListItem = Omit<Activity, "raw" | "splits" | "summaryPolyline">;

export async function getActivities(opts?: {
  limit?: number;
  offset?: number;
  from?: Date;
  to?: Date;
}): Promise<ActivityListItem[]> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const userId = session.user.id;
  const conditions = [eq(activities.userId, userId)];

  if (opts?.from) conditions.push(gte(activities.startDate, opts.from));
  if (opts?.to) conditions.push(lte(activities.startDate, opts.to));

  // Column projection: select every column except the heavy jsonb/text
  // payloads (`raw`, `splits`, `summaryPolyline`) a list view never reads —
  // same pattern as getDashboardActivities() in lib/db/queries.ts. The full
  // row, including those columns, is served by getActivity().
  return db
    .select({
      id: activities.id,
      userId: activities.userId,
      source: activities.source,
      stravaActivityId: activities.stravaActivityId,
      garminSummaryId: activities.garminSummaryId,
      name: activities.name,
      type: activities.type,
      distance: activities.distance,
      movingTime: activities.movingTime,
      elapsedTime: activities.elapsedTime,
      totalElevationGain: activities.totalElevationGain,
      startDate: activities.startDate,
      averageSpeed: activities.averageSpeed,
      maxSpeed: activities.maxSpeed,
      averageHeartrate: activities.averageHeartrate,
      maxHeartrate: activities.maxHeartrate,
      averageCadence: activities.averageCadence,
      averageWatts: activities.averageWatts,
      calories: activities.calories,
      hrZones: activities.hrZones,
      createdAt: activities.createdAt,
      updatedAt: activities.updatedAt,
    })
    .from(activities)
    .where(and(...conditions))
    .orderBy(desc(activities.startDate))
    .limit(opts?.limit ?? 50)
    .offset(opts?.offset ?? 0);
}

export async function getActivity(id: string): Promise<Activity | null> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const rows = await db
    .select()
    .from(activities)
    .where(and(eq(activities.id, id), eq(activities.userId, session.user.id)))
    .limit(1);

  return rows[0] ?? null;
}

export async function getRecentActivities(limit = 10): Promise<ActivityListItem[]> {
  return getActivities({ limit });
}

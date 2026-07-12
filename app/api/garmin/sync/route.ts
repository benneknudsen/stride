import { sql } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { activities } from "@/drizzle/schema";
import { auth } from "@/lib/auth";
import { revalidateProgression } from "@/lib/coach/dashboard-data";
import { db } from "@/lib/db";
import { revalidateDashboardActivities } from "@/lib/db/queries";
import { GARMIN_MAX_WINDOW_SECONDS, withGarminTokenRefresh } from "@/lib/garmin/client";
import { mapGarminActivityToDb } from "@/lib/garmin/mappers";
import { rateLimit } from "@/lib/rate-limit";

/**
 * Historical Garmin sync (issue #35).
 *
 * Garmin has no paged "give me everything" endpoint like Strava's
 * `/athlete/activities?page=n`. `/activities` is a *window* query bounded to 24
 * hours of upload time, so a backfill is a walk of consecutive 24h windows
 * backwards from now — {@link BACKFILL_DAYS} requests, one per day.
 *
 * The window filters on **upload** time, not activity start time: a run recorded
 * on Saturday and synced from the watch on Monday lands in Monday's window. That
 * is precisely what makes the walk exhaustive — an activity cannot slip into a
 * window that has already been read.
 */

/** How far back a manual sync reaches. The dashboard only reads 90 days (#63). */
const BACKFILL_DAYS = 90;

export async function POST(_req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const userId = session.user.id;

  // A backfill is ~90 upstream calls — the same "at most one per minute" budget
  // the Strava sync gets, for the same reason.
  const limit = rateLimit(`garmin-sync:${userId}`, { max: 1, windowMs: 60_000 });
  if (!limit.allowed) {
    const retryAfterSeconds = Math.max(1, Math.ceil((limit.resetAt - Date.now()) / 1000));
    return NextResponse.json(
      { ok: false, error: "Sync ran recently — try again shortly." },
      { status: 429, headers: { "retry-after": String(retryAfterSeconds) } }
    );
  }

  try {
    const client = await withGarminTokenRefresh(userId);

    const nowSeconds = Math.floor(Date.now() / 1000);
    let inserted = 0;

    for (let day = 0; day < BACKFILL_DAYS; day++) {
      const end = nowSeconds - day * GARMIN_MAX_WINDOW_SECONDS;
      const start = end - GARMIN_MAX_WINDOW_SECONDS;

      let batch: Awaited<ReturnType<typeof client.getActivities>>;
      try {
        batch = await client.getActivities(start, end);
      } catch (error) {
        // One bad window (a 429, a transient 5xx) must not abandon the other 89.
        console.error(`[garmin-sync] Window ${start}–${end} failed for user ${userId}:`, error);
        continue;
      }

      if (batch.length === 0) continue;

      const mapped = batch
        .filter((summary) => summary.summaryId)
        .map((summary) => mapGarminActivityToDb(summary, userId));

      // Collapse duplicate summaryIds within the window, keeping the last: a
      // multi-row ON CONFLICT DO UPDATE that touches the same row twice throws
      // ("cannot affect row a second time") — same guard as the webhook.
      const rows = [...new Map(mapped.map((row) => [row.garminSummaryId, row])).values()];

      if (rows.length === 0) continue;

      await db
        .insert(activities)
        .values(rows)
        .onConflictDoUpdate({
          target: [activities.userId, activities.garminSummaryId],
          set: {
            name: sql`excluded.name`,
            type: sql`excluded.type`,
            startDate: sql`excluded.start_date`,
            distance: sql`excluded.distance`,
            movingTime: sql`excluded.moving_time`,
            elapsedTime: sql`excluded.elapsed_time`,
            totalElevationGain: sql`excluded.total_elevation_gain`,
            averageSpeed: sql`excluded.average_speed`,
            maxSpeed: sql`excluded.max_speed`,
            averageHeartrate: sql`excluded.average_heartrate`,
            maxHeartrate: sql`excluded.max_heartrate`,
            averageCadence: sql`excluded.average_cadence`,
            averageWatts: sql`excluded.average_watts`,
            calories: sql`excluded.calories`,
            raw: sql`excluded.raw`,
            updatedAt: new Date(),
            // splits / hr_zones / summary_polyline are left alone: the Activity
            // *summary* cannot carry them, so overwriting would blank whatever a
            // richer payload already stored — the same rule the Strava backfill
            // follows (#101).
          },
        });

      inserted += rows.length;
    }

    if (inserted > 0) {
      revalidateProgression();
      revalidateDashboardActivities(userId);
    }

    return NextResponse.json({ ok: true, inserted });
  } catch (err) {
    // Log the cause server-side; never leak upstream messages or token state to
    // the client (#42).
    console.error("[garmin-sync] Historical sync failed", err);
    return NextResponse.json(
      { ok: false, error: "Sync failed. Please try again later." },
      { status: 500 }
    );
  }
}

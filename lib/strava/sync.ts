import { sql } from "drizzle-orm";
import { activities } from "@/drizzle/schema";
import { revalidateProgression } from "@/lib/coach/dashboard-data";
import { db } from "@/lib/db";
import { revalidateDashboardActivities } from "@/lib/db/queries";
import { withTokenRefresh } from "@/lib/strava/client";
import { mapStravaSummaryToDb } from "@/lib/strava/mappers";

/**
 * Full historical Strava sync for one user (issue #183).
 *
 * Extracted from the POST /api/strava/sync route so the same logic backs both a
 * manual re-sync (the route, with its auth + rate-limit shell) and the initial
 * sync fired automatically after an OAuth connect (`handleStravaCallback`).
 *
 * Fetches every activity page-by-page from the list endpoint and upserts each as
 * a row. The list response is a full `SummaryActivity` — it already carries every
 * column the dashboard reads — so it maps directly via {@link mapStravaSummaryToDb}
 * instead of an N+1 per-activity detail fetch (issue #76 B7). `splits`, `calories`
 * and `hr_zones` are deliberately left out of the update `set`: a summary can't
 * carry them, so overwriting would blank out the richer values the webhook's
 * detail fetch already stored (issue #101).
 *
 * Returns the number of activities upserted.
 */
const SYNC_PAGE_SIZE = 100;

export async function syncStravaActivities(userId: string): Promise<number> {
  const client = await withTokenRefresh(userId);

  let page = 1;
  let inserted = 0;

  while (true) {
    const batch = await client.getActivities(page, SYNC_PAGE_SIZE);
    if (batch.length === 0) break;

    const rows: ReturnType<typeof mapStravaSummaryToDb>[] = [];
    for (const summary of batch) {
      try {
        rows.push(mapStravaSummaryToDb(summary, userId));
      } catch {
        // Skip individual failures — continue with remaining activities.
      }
    }

    if (rows.length > 0) {
      await db
        .insert(activities)
        .values(rows)
        .onConflictDoUpdate({
          target: [activities.userId, activities.stravaActivityId],
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
            summaryPolyline: sql`excluded.summary_polyline`,
            // splits / calories / hr_zones are NOT updated here: the summary
            // payload can't carry them, so overwriting would blank out the
            // richer values the webhook's detail fetch already stored (#101).
            raw: sql`excluded.raw`,
            updatedAt: new Date(),
          },
        });

      inserted += rows.length;
    }

    if (batch.length < SYNC_PAGE_SIZE) break;
    page++;
  }

  if (inserted > 0) {
    revalidateProgression();
    revalidateDashboardActivities(userId);
  }

  return inserted;
}

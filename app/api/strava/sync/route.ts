import { sql } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { activities } from "@/drizzle/schema";
import { auth } from "@/lib/auth";
import { revalidateProgression } from "@/lib/coach/dashboard-data";
import { db } from "@/lib/db";
import { revalidateDashboardActivities } from "@/lib/db/queries";
import { rateLimit } from "@/lib/rate-limit";
import { withTokenRefresh } from "@/lib/strava/client";
import { mapStravaSummaryToDb } from "@/lib/strava/mappers";

// Full historical sync — fetches all activities page by page
export async function POST(_req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const userId = session.user.id;

  // B7: a full historical sync is expensive — enforce at least one minute
  // between syncs per user: rateLimit("strava-sync", { max: 1, windowMs: 60_000 }).
  const limit = rateLimit(`strava-sync:${userId}`, { max: 1, windowMs: 60_000 });
  if (!limit.allowed) {
    const retryAfterSeconds = Math.max(1, Math.ceil((limit.resetAt - Date.now()) / 1000));
    return NextResponse.json(
      { ok: false, error: "Sync ran recently — try again shortly." },
      { status: 429, headers: { "retry-after": String(retryAfterSeconds) } }
    );
  }

  try {
    const client = await withTokenRefresh(userId);

    let page = 1;
    let inserted = 0;

    while (true) {
      const batch = await client.getActivities(page, 100);
      if (batch.length === 0) break;

      // B7: the list response is a full SummaryActivity — it already carries
      // every column the dashboard reads, so map it directly instead of a
      // per-activity getActivity() detail fetch (removes the N+1). One list
      // call per page; splits/raw detail have no consumer.
      const rows: ReturnType<typeof mapStravaSummaryToDb>[] = [];
      for (const summary of batch) {
        try {
          rows.push(mapStravaSummaryToDb(summary, userId));
        } catch {
          // Skip individual failures — continue with remaining activities
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

      if (batch.length < 100) break;
      page++;
    }

    if (inserted > 0) {
      revalidateProgression();
      revalidateDashboardActivities(userId);
    }

    return NextResponse.json({ ok: true, inserted });
  } catch (err) {
    // Log the real cause server-side; never leak internal error details (stack
    // traces, upstream Strava messages, token issues) to the client — see #42.
    console.error("[strava-sync] Historical sync failed", err);
    return NextResponse.json(
      { ok: false, error: "Sync failed. Please try again later." },
      { status: 500 }
    );
  }
}

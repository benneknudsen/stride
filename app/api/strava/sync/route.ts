import { sql } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { activities } from "@/drizzle/schema";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { withTokenRefresh } from "@/lib/strava/client";
import { mapStravaToDb } from "@/lib/strava/mappers";

// Full historical sync — fetches all activities page by page
export async function POST(_req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const userId = session.user.id;

  try {
    const client = await withTokenRefresh(userId);

    let page = 1;
    let inserted = 0;

    while (true) {
      const batch = await client.getActivities(page, 100);
      if (batch.length === 0) break;

      // Strava calls stay serial (rate limits); collect rows then insert once.
      const rows: ReturnType<typeof mapStravaToDb>[] = [];
      for (const summary of batch) {
        try {
          const raw = await client.getActivity(summary.id);
          rows.push(mapStravaToDb(raw, userId));
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
              averageHeartrate: sql`excluded.average_heartrate`,
              maxHeartrate: sql`excluded.max_heartrate`,
              averageCadence: sql`excluded.average_cadence`,
              summaryPolyline: sql`excluded.summary_polyline`,
              splits: sql`excluded.splits`,
              raw: sql`excluded.raw`,
              updatedAt: new Date(),
            },
          });

        inserted += rows.length;
      }

      if (batch.length < 100) break;
      page++;
    }

    return NextResponse.json({ ok: true, inserted });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sync failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

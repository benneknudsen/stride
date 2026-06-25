import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { activities } from "@/drizzle/schema";
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

      for (const summary of batch) {
        try {
          const raw = await client.getActivity(summary.id);
          const data = mapStravaToDb(raw, userId);

          await db
            .insert(activities)
            .values(data)
            .onConflictDoUpdate({
              target: [activities.userId, activities.stravaActivityId],
              set: {
                name: data.name,
                type: data.type,
                startDate: data.startDate,
                distance: data.distance,
                movingTime: data.movingTime,
                elapsedTime: data.elapsedTime,
                totalElevationGain: data.totalElevationGain,
                averageSpeed: data.averageSpeed,
                averageHeartrate: data.averageHeartrate,
                maxHeartrate: data.maxHeartrate,
                averageCadence: data.averageCadence,
                summaryPolyline: data.summaryPolyline,
                splits: data.splits,
                raw: data.raw,
                updatedAt: new Date(),
              },
            });

          inserted++;
        } catch {
          // Skip individual failures — continue with remaining activities
        }
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

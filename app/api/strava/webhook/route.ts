import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { activities, users } from "@/drizzle/schema";
import { db } from "@/lib/db";
import { withTokenRefresh } from "@/lib/strava/client";
import { mapStravaToDb } from "@/lib/strava/mappers";

const VERIFY_TOKEN = process.env.STRAVA_WEBHOOK_VERIFY_TOKEN ?? "stride-verify";

// Strava webhook subscription validation
export function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === VERIFY_TOKEN && challenge) {
    return NextResponse.json({ "hub.challenge": challenge });
  }

  return new NextResponse("Forbidden", { status: 403 });
}

// Strava webhook event handler
export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    object_type: string;
    object_id: number;
    aspect_type: string;
    owner_id: number;
    updates?: Record<string, unknown>;
  };

  // Only handle activity create/update events
  if (body.object_type !== "activity") {
    return NextResponse.json({ ok: true });
  }

  const stravaAthleteId = body.owner_id;
  const stravaActivityId = body.object_id;

  const userRows = await db
    .select()
    .from(users)
    .where(eq(users.stravaAthleteId, stravaAthleteId))
    .limit(1);

  const user = userRows[0];
  if (!user) {
    return NextResponse.json({ ok: true });
  }

  if (body.aspect_type === "delete") {
    await db.delete(activities).where(eq(activities.stravaActivityId, stravaActivityId));
    return NextResponse.json({ ok: true });
  }

  if (body.aspect_type === "create" || body.aspect_type === "update") {
    try {
      const client = await withTokenRefresh(user.id);
      const raw = await client.getActivity(stravaActivityId);
      const data = mapStravaToDb(raw, user.id);

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
    } catch {
      // Don't fail the webhook — Strava will retry
      return NextResponse.json({ ok: true });
    }
  }

  return NextResponse.json({ ok: true });
}

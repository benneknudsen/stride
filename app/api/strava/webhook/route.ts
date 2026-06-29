import { createHmac, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { activities, users } from "@/drizzle/schema";
import { db } from "@/lib/db";
import { withTokenRefresh } from "@/lib/strava/client";
import { mapStravaToDb } from "@/lib/strava/mappers";

const VERIFY_TOKEN = process.env.STRAVA_WEBHOOK_VERIFY_TOKEN ?? "stride-verify";

/**
 * Verify the X-Hub-Signature-256 header against an HMAC-SHA256 of the raw body
 * keyed by the Strava client secret. Returns false on any missing/malformed
 * input or signature mismatch. Uses a timing-safe comparison.
 */
function verifySignature(rawBody: string, header: string | null): boolean {
  const secret = process.env.STRAVA_CLIENT_SECRET;
  if (!secret) {
    console.error("[strava-webhook] STRAVA_CLIENT_SECRET is not set — rejecting POST");
    return false;
  }
  if (!header?.startsWith("sha256=")) return false;

  const provided = header.slice("sha256=".length);
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");

  // Buffers must be equal length for timingSafeEqual; hex-decode both.
  const providedBuf = Buffer.from(provided, "hex");
  const expectedBuf = Buffer.from(expected, "hex");
  if (providedBuf.length !== expectedBuf.length) return false;

  return timingSafeEqual(providedBuf, expectedBuf);
}

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
  // Read the raw body BEFORE parsing so the HMAC matches Strava's signature byte-for-byte.
  const rawBody = await req.text();
  const signature = req.headers.get("x-hub-signature-256");

  if (!verifySignature(rawBody, signature)) {
    console.warn(
      `[strava-webhook] Rejected POST with invalid signature (header present: ${signature !== null})`
    );
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const body = JSON.parse(rawBody) as {
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

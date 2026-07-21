import { timingSafeEqual } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { activities } from "@/drizzle/schema";
import { revalidateProgression } from "@/lib/coach/dashboard-data";
import { db } from "@/lib/db";
import {
  deleteGarminTokens,
  getUserByGarminUserId,
  revalidateDashboardActivities,
} from "@/lib/db/queries";
import { withGarminTokenRefresh } from "@/lib/garmin/client";
import { isAllowedCallbackUrl } from "@/lib/garmin/config";
import { mapGarminActivityToDb } from "@/lib/garmin/mappers";
import type { GarminActivitySummary, GarminPushItem, GarminPushPayload } from "@/lib/garmin/types";
import { captureError } from "@/lib/observability";

/**
 * Garmin push/ping webhook (issue #35) — the Garmin counterpart to the Strava
 * webhook (#87).
 *
 * **Authentication is different from Strava's, of necessity.** Strava signs each
 * body with an HMAC we verify against the client secret. Garmin signs nothing:
 * it POSTs to whatever URL the partner registered, and the documented way to
 * authenticate the caller is to register a URL that carries a secret. So the
 * endpoint's own URL is the credential — register
 *
 *     https://<host>/api/garmin/webhook?token=<GARMIN_WEBHOOK_SECRET>
 *
 * in Garmin's developer portal. The comparison below is timing-safe, and a
 * missing secret rejects every POST rather than defaulting open (#41).
 *
 * Garmin fans out two shapes on this endpoint. A **push** carries the activity
 * summaries inline; a **ping** carries only a `callbackURL` to fetch them from.
 * Both are handled — which one you get is a per-app setting in Garmin's portal,
 * and it can be changed there without a deploy.
 */

/**
 * The shared secret, from a header if the caller can send one, else from the
 * query string.
 *
 * A secret in a URL is a liability — query strings land in access logs, proxy
 * logs and error-reporter breadcrumbs in a way headers usually don't. The header
 * is therefore preferred and is what a proxy or a replay tool should use. Garmin
 * itself cannot send one: its portal only lets a partner register a URL, so the
 * query form has to stay supported or the integration cannot receive an event at
 * all. Keep `?token=` out of log sinks, and rotate GARMIN_WEBHOOK_SECRET.
 */
function verifyToken(req: NextRequest): boolean {
  const secret = process.env.GARMIN_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[garmin-webhook] GARMIN_WEBHOOK_SECRET is not set — rejecting POST");
    return false;
  }

  const provided =
    req.headers.get("x-garmin-webhook-token") ?? req.nextUrl.searchParams.get("token") ?? "";

  const providedBuf = Buffer.from(provided, "utf8");
  const expectedBuf = Buffer.from(secret, "utf8");
  // timingSafeEqual throws on a length mismatch, so the lengths are compared
  // first — which does leak the secret's length, and nothing more.
  if (providedBuf.length !== expectedBuf.length) return false;

  return timingSafeEqual(providedBuf, expectedBuf);
}

/**
 * Redact a `token` query parameter before a string reaches a log sink (#172).
 *
 * The webhook's own URL carries `?token=<GARMIN_WEBHOOK_SECRET>` (see
 * verifyToken), and callbackURLs are attacker-controlled body input that can
 * carry a `token` of their own. Either way the secret must never be written to
 * an access/proxy log line — that is precisely the leak this endpoint guards
 * against — so scrub it to `[REDACTED]` before logging any request-derived
 * string.
 */
function scrubToken(value: string): string {
  return value.replace(/([?&]token=)[^&#\s]*/gi, "$1[REDACTED]");
}

/** A push item is a full summary when it carries the id the DB dedups on. */
function isSummary(item: GarminPushItem): item is GarminPushItem & GarminActivitySummary {
  return (
    typeof item.summaryId === "string" &&
    typeof item.startTimeInSeconds === "number" &&
    typeof item.durationInSeconds === "number" &&
    typeof item.activityType === "string"
  );
}

async function upsertSummaries(
  userId: string,
  summaries: GarminActivitySummary[]
): Promise<number> {
  const mapped = summaries
    .filter((summary) => summary.summaryId)
    .map((summary) => mapGarminActivityToDb(summary, userId));

  // Collapse duplicate summaryIds within this batch, keeping the last. Garmin
  // can fan the same activity out more than once in a single push, and Postgres
  // rejects an ON CONFLICT DO UPDATE that would touch the same row twice in one
  // statement ("cannot affect row a second time"), which would 500 the whole
  // batch and put it back in the retry queue.
  const rows = [...new Map(mapped.map((row) => [row.garminSummaryId, row])).values()];

  if (rows.length === 0) return 0;

  // Garmin re-delivers a notification until it gets a 2xx, and can fan the same
  // activity out more than once — so, like the Strava webhook (#64), serialize
  // handlers for the same activity behind a transaction-scoped advisory lock.
  // The lock key is an int, and Garmin's summaryId is a string, so hash it in
  // Postgres rather than inventing a client-side mapping.
  await db.transaction(async (tx) => {
    for (const row of rows) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${row.garminSummaryId}))`);
    }
    await tx
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
        },
      });
  });

  return rows.length;
}

export async function POST(req: NextRequest) {
  if (!verifyToken(req)) {
    console.warn("[garmin-webhook] Rejected POST with missing or invalid token");
    return new NextResponse("Unauthorized", { status: 401 });
  }

  let payload: GarminPushPayload;
  try {
    payload = (await req.json()) as GarminPushPayload;
  } catch {
    return new NextResponse("Bad Request", { status: 400 });
  }

  // The athlete revoked access in Garmin Connect. Drop the tokens so the UI
  // stops claiming a live connection; their synced runs stay (see
  // deleteGarminTokens).
  //
  // Garmin sends deregistrations one at a time, so a request carrying more than
  // one is malformed — and a bulk list is exactly what a leaked `?token=` URL
  // would be abused with to wipe many athletes' Garmin tokens at once (#172).
  // Reject the whole request rather than partially applying it; 400 is a client
  // error Garmin will not retry.
  const deregistrations = payload.deregistrations ?? [];
  if (deregistrations.length > 1) {
    console.warn(
      `[garmin-webhook] Rejecting request with ${deregistrations.length} deregistrations (max 1)`
    );
    return new NextResponse("Bad Request", { status: 400 });
  }
  for (const dereg of deregistrations) {
    const user = await getUserByGarminUserId(dereg.userId);
    if (user) await deleteGarminTokens(user.id);
  }

  const items = payload.activities ?? [];
  if (items.length === 0) {
    return NextResponse.json({ ok: true });
  }

  // One notification can carry several athletes' activities. Group by Garmin
  // user so each group resolves its owner — and its access token — exactly once.
  const byGarminUser = new Map<string, GarminPushItem[]>();
  for (const item of items) {
    if (!item.userId) continue;
    const group = byGarminUser.get(item.userId) ?? [];
    group.push(item);
    byGarminUser.set(item.userId, group);
  }

  let ingested = 0;

  for (const [garminUserId, group] of byGarminUser) {
    const user = await getUserByGarminUserId(garminUserId);
    // Not our athlete (or they disconnected). Ack — retrying changes nothing.
    if (!user) continue;

    try {
      const summaries: GarminActivitySummary[] = group.filter(isSummary);

      // Ping-style: only a callbackURL. Fetch the summaries it points at.
      //
      // The URL is attacker-controlled input — it comes from the request body —
      // and the fetch that follows it carries the athlete's Garmin bearer token.
      // Drop anything that isn't an allowlisted Garmin host *here*, rather than
      // letting the client throw: a throw would 500, and a 500 puts the event
      // back in Garmin's retry queue, so a single forged ping would have us
      // re-attempt the exfiltration for ~24 hours. A bad URL is not transient —
      // ack it and move on. (lib/garmin/client.ts enforces the same allowlist as
      // the last line of defence.)
      const callbacks = group.filter((item) => item.callbackURL && !isSummary(item));
      const allowed: string[] = [];
      for (const ping of callbacks) {
        const url = ping.callbackURL as string;
        if (isAllowedCallbackUrl(url)) {
          allowed.push(url);
        } else {
          console.warn(
            `[garmin-webhook] Dropped ping with non-Garmin callbackURL: ${scrubToken(url)}`
          );
        }
      }

      if (allowed.length > 0) {
        const client = await withGarminTokenRefresh(user.id);
        for (const url of allowed) {
          summaries.push(...(await client.fetchCallback(url)));
        }
      }

      const count = await upsertSummaries(user.id, summaries);
      if (count > 0) {
        revalidateProgression();
        revalidateDashboardActivities(user.id);
        ingested += count;
      }
    } catch (error) {
      // Fail loudly, exactly as the Strava webhook does (#87): a 2xx tells Garmin
      // the event was delivered and it is never re-sent, so a transient DB or API
      // error would silently lose the activity forever. A 5xx puts it back in
      // Garmin's retry queue. Route through captureError so only the error's
      // name/message/cause are serialised — never a raw value that might carry
      // a token or connection string (#135, #172).
      captureError(`garmin-webhook.ingest[user ${user.id}]`, error);
      return new NextResponse("Internal Server Error", { status: 500 });
    }
  }

  return NextResponse.json({ ok: true, ingested });
}

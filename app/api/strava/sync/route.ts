import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { captureError } from "@/lib/observability";
import { rateLimit } from "@/lib/rate-limit";
import { syncStravaActivities } from "@/lib/strava/sync";

/**
 * How long the platform lets this function run.
 *
 * A full historical sync pages through the whole activity history and writes
 * it batch by batch, so it needs minutes — not the 30 seconds the AI route
 * gets. Without a declared duration the platform cuts the function off at its
 * default timeout, the rest of the history is lost, and the client only sees
 * a 500 with no idea how far the sync got (issue #338).
 *
 * 300 seconds is Vercel's ceiling for a function, so this is the longest run
 * the platform allows; the sync's own deadline (`SYNC_DEADLINE_MS`) stops it a
 * minute earlier so it can still answer with what it managed to sync.
 */
export const maxDuration = 300;

// Full historical sync — fetches all activities page by page
export async function POST(_req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const userId = session.user.id;

  // B7: a full historical sync is expensive — enforce at least one minute
  // between syncs per user: rateLimit("strava-sync", { max: 1, windowMs: 60_000 }).
  const limit = await rateLimit(`strava-sync:${userId}`, { max: 1, windowMs: 60_000 });
  if (!limit.allowed) {
    const retryAfterSeconds = Math.max(1, Math.ceil((limit.resetAt - Date.now()) / 1000));
    return NextResponse.json(
      { ok: false, error: "Sync ran recently — try again shortly." },
      { status: 429, headers: { "retry-after": String(retryAfterSeconds) } }
    );
  }

  try {
    // The page-by-page fetch + upsert + revalidation lives in lib/strava/sync.ts
    // so the initial post-connect sync (handleStravaCallback) shares it.
    const result = await syncStravaActivities(userId);

    // Another sync for this user is already running (issue #338). That is a
    // conflict, not a failure — the running sync is doing the work.
    if (result.status === "busy") {
      return NextResponse.json(
        { ok: false, error: "A sync is already running for this account." },
        { status: 409 }
      );
    }

    // `inserted` counts written rows, not covered history — the client has to
    // be able to tell a complete history from a truncated one.
    return NextResponse.json({
      ok: true,
      inserted: result.inserted,
      partial: result.status === "partial",
      ...(result.status === "partial" ? { reason: result.reason } : {}),
    });
  } catch (err) {
    // Log the real cause server-side; never leak internal error details (stack
    // traces, upstream Strava messages, token issues) to the client — see #42.
    captureError("strava-sync", err);
    return NextResponse.json(
      { ok: false, error: "Sync failed. Please try again later." },
      { status: 500 }
    );
  }
}

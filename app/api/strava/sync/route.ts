import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { syncStravaActivities } from "@/lib/strava/sync";

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
    const inserted = await syncStravaActivities(userId);
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

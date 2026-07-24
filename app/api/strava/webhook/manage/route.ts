/**
 * GET/POST/DELETE /api/strava/webhook/manage — operator route for the app's
 * single Strava push subscription (issue #184).
 *
 * A push subscription is application-scoped: there is exactly one per Strava
 * app, authenticated with the *application* credentials (not an athlete's bearer
 * token) — see the header comment in `lib/strava/client.ts`. This route is the
 * signed-in operator surface over that lifecycle:
 *   - GET    → inspect whether a subscription currently exists.
 *   - POST   → create it (idempotent: a live one is returned untouched).
 *   - DELETE → tear it down (by ?id=, or the live one when the id is omitted).
 *
 * Access is limited to authenticated sessions. Refused (unauthenticated)
 * attempts are logged via `captureError` so a probe against this endpoint is
 * visible in the log drain / Sentry, mirroring the webhook route's rejection
 * logging. Internal error detail is never leaked to the client — the real cause
 * is captured server-side, the client sees a generic Danish message (see #42).
 */

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { captureError } from "@/lib/observability";
import {
  createWebhookSubscription,
  deleteWebhookSubscription,
  getWebhookSubscription,
} from "@/lib/strava/client";

/**
 * Resolve the signed-in user id, or `null` when there is no session. A refused
 * attempt is recorded through `captureError` before returning null so the caller
 * can answer 401 while the attempt still shows up in observability.
 */
async function requireUserId(method: string): Promise<string | null> {
  const session = await auth();
  if (!session?.user?.id) {
    captureError(
      "strava-webhook-manage.unauthorized",
      new Error(`Refused unauthenticated ${method} on /api/strava/webhook/manage`)
    );
    return null;
  }
  return session.user.id;
}

const UNAUTHORIZED = () => new NextResponse("Unauthorized", { status: 401 });

// Inspect the application's current push subscription.
export async function GET() {
  const userId = await requireUserId("GET");
  if (!userId) return UNAUTHORIZED();

  try {
    const subscription = await getWebhookSubscription();
    return NextResponse.json({ ok: true, active: subscription !== null, subscription });
  } catch (error) {
    captureError("strava-webhook-manage.get", error);
    return NextResponse.json(
      { ok: false, error: "Kunne ikke hente webhook-subscription." },
      { status: 500 }
    );
  }
}

// Create the application's push subscription.
export async function POST() {
  const userId = await requireUserId("POST");
  if (!userId) return UNAUTHORIZED();

  try {
    // Idempotency is the caller's job (see `createWebhookSubscription`): Strava
    // rejects a second POST with a 400 while one already exists, so short-circuit
    // on the live subscription instead of surfacing that as a 500.
    const existing = await getWebhookSubscription();
    if (existing) {
      return NextResponse.json({ ok: true, created: false, subscription: existing });
    }

    const subscription = await createWebhookSubscription();
    return NextResponse.json({ ok: true, created: true, subscription }, { status: 201 });
  } catch (error) {
    captureError("strava-webhook-manage.post", error);
    return NextResponse.json(
      { ok: false, error: "Kunne ikke oprette webhook-subscription." },
      { status: 500 }
    );
  }
}

// Delete the application's push subscription.
export async function DELETE(req: NextRequest) {
  const userId = await requireUserId("DELETE");
  if (!userId) return UNAUTHORIZED();

  try {
    // Prefer an explicit ?id=; fall back to the live subscription so a caller
    // that doesn't already know the id can still tear it down.
    const idParam = req.nextUrl.searchParams.get("id");
    let id: number | null = null;
    if (idParam !== null) {
      const parsed = Number(idParam);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        return NextResponse.json(
          { ok: false, error: "Ugyldigt subscription-id." },
          { status: 400 }
        );
      }
      id = parsed;
    } else {
      const existing = await getWebhookSubscription();
      id = existing?.id ?? null;
    }

    if (id === null) {
      return NextResponse.json(
        { ok: false, error: "Ingen aktiv webhook-subscription at slette." },
        { status: 404 }
      );
    }

    await deleteWebhookSubscription(id);
    return NextResponse.json({ ok: true, deleted: id });
  } catch (error) {
    captureError("strava-webhook-manage.delete", error);
    return NextResponse.json(
      { ok: false, error: "Kunne ikke slette webhook-subscription." },
      { status: 500 }
    );
  }
}

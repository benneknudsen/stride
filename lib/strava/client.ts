import { eq, sql } from "drizzle-orm";
import { stravaTokens } from "../../drizzle/schema";
import { decrypt, encrypt } from "../crypto";
import { db } from "../db";
import { refreshAccessToken } from "./oauth";
import type { DetailedActivity, StravaWebhookSubscription, SummaryActivity } from "./types";

const STRAVA_API_BASE = "https://www.strava.com/api/v3";

// ---------------------------------------------------------------------------
// Push (webhook) subscription management — issue #183.
//
// A push subscription is application-scoped: there is one per Strava app, not
// one per athlete. Strava therefore authenticates these endpoints with the
// *application* credentials (`client_id` + `client_secret`) rather than an
// athlete's bearer token — a per-user access token returns 401 here. See
// https://developers.strava.com/docs/webhooks/. The callback + verify token are
// the same pair the webhook route validates against (`STRAVA_VERIFY_TOKEN`,
// GET /api/strava/webhook), so a subscription created here can complete Strava's
// challenge handshake.
// ---------------------------------------------------------------------------

const STRAVA_PUSH_SUBSCRIPTION_URL = `${STRAVA_API_BASE}/push_subscriptions`;

/** Default public callback the webhook route is deployed at (env-overridable). */
const DEFAULT_WEBHOOK_CALLBACK_URL = "https://stride-run.club/api/strava/webhook";

/** The URL Strava will POST activity events to; verified via `hub.challenge`. */
function getWebhookCallbackUrl(): string {
  return process.env.STRAVA_WEBHOOK_CALLBACK_URL || DEFAULT_WEBHOOK_CALLBACK_URL;
}

/** Shared secret Strava echoes back during the subscription validation handshake. */
function getVerifyToken(): string {
  const token = process.env.STRAVA_VERIFY_TOKEN;
  if (!token) throw new Error("STRAVA_VERIFY_TOKEN is not set");
  return token;
}

/** The application credentials Strava's subscription API authenticates against. */
function requireStravaAppCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;
  if (!clientId) throw new Error("Missing environment variable: STRAVA_CLIENT_ID");
  if (!clientSecret) throw new Error("Missing environment variable: STRAVA_CLIENT_SECRET");
  return { clientId, clientSecret };
}

/**
 * Create the application's push subscription. Idempotency is the caller's job —
 * Strava rejects a second POST while one already exists (HTTP 400), so callers
 * should check {@link getWebhookSubscription} first (see the manage route).
 */
export async function createWebhookSubscription(): Promise<StravaWebhookSubscription> {
  const { clientId, clientSecret } = requireStravaAppCredentials();
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    callback_url: getWebhookCallbackUrl(),
    verify_token: getVerifyToken(),
  });

  const res = await fetch(STRAVA_PUSH_SUBSCRIPTION_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Strava subscription create failed (${res.status}): ${text}`);
  }
  return res.json() as Promise<StravaWebhookSubscription>;
}

/**
 * Read the application's current push subscription, or `null` when none exists.
 * GET /push_subscriptions returns an array of zero or one subscription.
 */
export async function getWebhookSubscription(): Promise<StravaWebhookSubscription | null> {
  const { clientId, clientSecret } = requireStravaAppCredentials();
  const params = new URLSearchParams({ client_id: clientId, client_secret: clientSecret });

  const res = await fetch(`${STRAVA_PUSH_SUBSCRIPTION_URL}?${params.toString()}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Strava subscription read failed (${res.status}): ${text}`);
  }
  const subscriptions = (await res.json()) as StravaWebhookSubscription[];
  return subscriptions[0] ?? null;
}

/** Delete the application's push subscription by its Strava-assigned id. */
export async function deleteWebhookSubscription(id: number): Promise<void> {
  const { clientId, clientSecret } = requireStravaAppCredentials();
  const params = new URLSearchParams({ client_id: clientId, client_secret: clientSecret });

  const res = await fetch(`${STRAVA_PUSH_SUBSCRIPTION_URL}/${id}?${params.toString()}`, {
    method: "DELETE",
  });
  // Strava answers 204 No Content on success.
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Strava subscription delete failed (${res.status}): ${text}`);
  }
}

export function createStravaClient(accessToken: string) {
  async function request<T>(path: string): Promise<T> {
    const res = await fetch(`${STRAVA_API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Strava API error ${res.status}: ${text}`);
    }
    return res.json() as Promise<T>;
  }

  return {
    getActivities(page = 1, perPage = 30): Promise<SummaryActivity[]> {
      return request<SummaryActivity[]>(`/athlete/activities?page=${page}&per_page=${perPage}`);
    },
    getActivity(id: number): Promise<DetailedActivity> {
      return request<DetailedActivity>(`/activities/${id}`);
    },
  };
}

/** Load tokens for userId, decrypt, refresh if expired, persist updated tokens, return client. */
export async function withTokenRefresh(userId: string) {
  const rows = await db.select().from(stravaTokens).where(eq(stravaTokens.userId, userId)).limit(1);
  const row = rows[0];

  if (!row) throw new Error(`No Strava tokens found for user ${userId}`);

  // Both tokens were encrypted together as a JSON blob (single IV).
  const parsed = JSON.parse(decrypt(row.accessTokenEnc, row.iv, row.authTag)) as {
    access_token: string;
    refresh_token: string;
  };
  const accessToken = parsed.access_token;

  const nowSecs = Math.floor(Date.now() / 1000);
  const expiresSecs = Math.floor(row.expiresAt.getTime() / 1000);

  if (expiresSecs - nowSecs > 60) {
    return createStravaClient(accessToken);
  }

  // Serialize the refresh+persist against other concurrent callers for the
  // same user (webhook fanout, manual sync) so two calls don't both see an
  // expired token and both fire a refresh. The advisory lock is released when
  // the transaction commits; a caller that was waiting on it re-reads the row
  // afterwards and, if another caller already refreshed it, uses that token
  // instead of refreshing again.
  const newAccessToken = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`);

    const lockedRows = await tx
      .select()
      .from(stravaTokens)
      .where(eq(stravaTokens.userId, userId))
      .limit(1);
    const lockedRow = lockedRows[0];
    if (!lockedRow) throw new Error(`No Strava tokens found for user ${userId}`);

    const lockedTokens = JSON.parse(
      decrypt(lockedRow.accessTokenEnc, lockedRow.iv, lockedRow.authTag)
    ) as { access_token: string; refresh_token: string };

    const lockedNowSecs = Math.floor(Date.now() / 1000);
    const lockedExpiresSecs = Math.floor(lockedRow.expiresAt.getTime() / 1000);
    if (lockedExpiresSecs - lockedNowSecs > 60) {
      // Another caller already refreshed while we waited for the lock.
      return lockedTokens.access_token;
    }

    const refreshed = await refreshAccessToken(lockedTokens.refresh_token);

    // Re-encrypt both tokens together with a single IV.
    const blob = encrypt(
      JSON.stringify({
        access_token: refreshed.access_token,
        refresh_token: refreshed.refresh_token,
      })
    );

    await tx
      .update(stravaTokens)
      .set({
        accessTokenEnc: blob.encrypted,
        refreshTokenEnc: "", // unused — both tokens live in accessTokenEnc
        iv: blob.iv,
        authTag: blob.authTag,
        expiresAt: new Date(refreshed.expires_at * 1000),
        updatedAt: new Date(),
      })
      .where(eq(stravaTokens.userId, userId));

    return refreshed.access_token;
  });

  return createStravaClient(newAccessToken);
}

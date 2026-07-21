import { eq, sql } from "drizzle-orm";
import { garminTokens } from "../../drizzle/schema";
import { decrypt, encrypt } from "../crypto";
import type { DbOrTx } from "../db";
import { db } from "../db";
import { saveGarminTokens } from "../db/queries";
import { GARMIN_API_BASE, isAllowedCallbackUrl } from "./config";
import { expiresAtFrom, refreshAccessToken } from "./oauth";
import type { GarminActivitySummary, GarminTokensResponse, GarminUserIdResponse } from "./types";

/**
 * Garmin's `/activities` window is capped: a single call may span at most 24
 * hours of *upload* time. A historical backfill is therefore a walk of 24h
 * windows, not one big range query — see the sync route.
 */
export const GARMIN_MAX_WINDOW_SECONDS = 24 * 60 * 60;

/** Refresh when the access token has less than this left — same margin as Strava. */
const REFRESH_MARGIN_SECONDS = 60;

export function createGarminClient(accessToken: string) {
  async function request<T>(path: string): Promise<T> {
    const res = await fetch(`${GARMIN_API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Garmin API error ${res.status}: ${text}`);
    }
    return res.json() as Promise<T>;
  }

  return {
    /**
     * Activities uploaded in `[startSeconds, endSeconds)`. Note this filters on
     * *upload* time, not start time: a run recorded on Saturday but synced from
     * the watch on Monday appears in Monday's window. That is what makes the
     * endpoint safe to poll incrementally — nothing can appear in a window that
     * has already been walked.
     */
    getActivities(startSeconds: number, endSeconds: number): Promise<GarminActivitySummary[]> {
      const params = new URLSearchParams({
        uploadStartTimeInSeconds: String(Math.floor(startSeconds)),
        uploadEndTimeInSeconds: String(Math.floor(endSeconds)),
      });
      return request<GarminActivitySummary[]>(`/activities?${params.toString()}`);
    },

    /** The app-scoped Garmin user id — the key a push notification arrives under. */
    getUserId(): Promise<GarminUserIdResponse> {
      return request<GarminUserIdResponse>("/user/id");
    },

    /**
     * Follow a ping notification's `callbackURL`. Garmin sends an absolute URL
     * on its own API host, so it bypasses `GARMIN_API_BASE` — but it still needs
     * the user's bearer token.
     *
     * The URL arrives in a *request body*, and this fetch attaches a live OAuth
     * token to it. Unvalidated, that is an SSRF that exfiltrates the athlete's
     * Garmin credential to any host an attacker can name — so the destination is
     * checked against the allowlist before the token is attached, and redirects
     * are not followed: a 3xx from an otherwise-legitimate Garmin host would
     * otherwise rewrite the destination *after* the check passed, and the bearer
     * would ride along to wherever the Location header points.
     */
    async fetchCallback(callbackUrl: string): Promise<GarminActivitySummary[]> {
      if (!isAllowedCallbackUrl(callbackUrl)) {
        throw new Error(`Garmin callback URL rejected — not an allowlisted host: ${callbackUrl}`);
      }

      const res = await fetch(callbackUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
        redirect: "manual",
      });

      if (res.status >= 300 && res.status < 400) {
        throw new Error(`Garmin callback redirected (${res.status}) — refusing to follow`);
      }
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Garmin callback error ${res.status}: ${text}`);
      }
      return res.json() as Promise<GarminActivitySummary[]>;
    },
  };
}

export type GarminClient = ReturnType<typeof createGarminClient>;

/**
 * Encrypt both tokens under one IV and persist them for `userId`.
 *
 * Upserts, so it serves both the first link (sign-in / connect) and every later
 * refresh. Separate `encrypt()` calls per token would each mint their own IV,
 * and only one of them can be stored — which is why the two are sealed together
 * as a single JSON blob, exactly as the Strava path does it.
 */
export async function persistGarminTokens(
  userId: string,
  tokens: GarminTokensResponse,
  now: number = Date.now(),
  dbClient: DbOrTx = db
): Promise<void> {
  const blob = encrypt(
    JSON.stringify({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
    })
  );

  await saveGarminTokens(
    {
      userId,
      accessTokenEnc: blob.encrypted,
      refreshTokenEnc: "", // unused — both tokens live in accessTokenEnc
      iv: blob.iv,
      authTag: blob.authTag,
      expiresAt: expiresAtFrom(tokens, now),
      refreshExpiresAt: tokens.refresh_token_expires_in
        ? new Date(now + tokens.refresh_token_expires_in * 1000)
        : null,
      scope: tokens.scope ?? null,
    },
    dbClient
  );
}

/**
 * Load tokens for `userId`, decrypt, refresh if expired, persist, return a
 * client. Mirrors `withTokenRefresh` in lib/strava/client.ts.
 *
 * Garmin's refresh token expires too (Strava's does not). When it has, no grant
 * can recover the connection — the athlete has to re-authorize — so we throw a
 * distinguishable error instead of firing a refresh that is certain to 400.
 */
export async function withGarminTokenRefresh(userId: string): Promise<GarminClient> {
  const rows = await db.select().from(garminTokens).where(eq(garminTokens.userId, userId)).limit(1);
  const row = rows[0];

  if (!row) throw new Error(`No Garmin tokens found for user ${userId}`);

  const parsed = JSON.parse(decrypt(row.accessTokenEnc, row.iv, row.authTag)) as {
    access_token: string;
    refresh_token: string;
  };

  const now = Date.now();
  const secondsLeft = Math.floor((row.expiresAt.getTime() - now) / 1000);

  if (secondsLeft > REFRESH_MARGIN_SECONDS) {
    return createGarminClient(parsed.access_token);
  }

  if (row.refreshExpiresAt && row.refreshExpiresAt.getTime() <= now) {
    throw new Error(`Garmin refresh token expired for user ${userId} — reconnect required`);
  }

  // Serialize the refresh+persist against other concurrent callers for the same
  // user (webhook fanout, manual sync). Garmin rotates refresh tokens, so if two
  // callers both refreshed with the same (now-consumed) refresh token, the
  // slower writer would persist a token that can never refresh again. The
  // advisory lock is released when the transaction commits; a caller that was
  // waiting on it re-reads the row afterwards and — if another caller already
  // refreshed it — uses that token instead of refreshing again.
  const accessToken = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`);

    const lockedRows = await tx
      .select()
      .from(garminTokens)
      .where(eq(garminTokens.userId, userId))
      .limit(1);
    const lockedRow = lockedRows[0];
    if (!lockedRow) throw new Error(`No Garmin tokens found for user ${userId}`);

    const lockedTokens = JSON.parse(
      decrypt(lockedRow.accessTokenEnc, lockedRow.iv, lockedRow.authTag)
    ) as { access_token: string; refresh_token: string };

    const lockedNow = Date.now();
    const lockedSecondsLeft = Math.floor((lockedRow.expiresAt.getTime() - lockedNow) / 1000);
    if (lockedSecondsLeft > REFRESH_MARGIN_SECONDS) {
      // Another caller already refreshed while we waited for the lock — use
      // the token it persisted instead of refreshing (and burning) it again.
      return lockedTokens.access_token;
    }

    if (lockedRow.refreshExpiresAt && lockedRow.refreshExpiresAt.getTime() <= lockedNow) {
      throw new Error(`Garmin refresh token expired for user ${userId} — reconnect required`);
    }

    const refreshed = await refreshAccessToken(lockedTokens.refresh_token);
    await persistGarminTokens(userId, refreshed, lockedNow, tx);

    return refreshed.access_token;
  });

  return createGarminClient(accessToken);
}

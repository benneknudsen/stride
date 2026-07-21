import { eq, sql } from "drizzle-orm";
import { stravaTokens } from "../../drizzle/schema";
import { decrypt, encrypt } from "../crypto";
import { db } from "../db";
import { refreshAccessToken } from "./oauth";
import type { DetailedActivity, SummaryActivity } from "./types";

const STRAVA_API_BASE = "https://www.strava.com/api/v3";

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

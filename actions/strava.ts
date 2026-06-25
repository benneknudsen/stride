'use server';

import { generatePkce, getAuthorizationUrl, exchangeCodeForTokens } from "@/lib/strava/oauth";
import { encrypt } from "@/lib/crypto";
import { db } from "@/lib/db";
import { stravaTokens } from "@/drizzle/schema";

export async function connectStrava(): Promise<{ url: string; codeVerifier: string }> {
  const { codeVerifier, codeChallenge } = generatePkce();
  const url = getAuthorizationUrl(codeChallenge);
  return { url, codeVerifier };
}

export async function handleStravaCallback(
  code: string,
  codeVerifier: string,
  userId: string
): Promise<void> {
  const tokens = await exchangeCodeForTokens(code, codeVerifier);

  const encAccess = encrypt(tokens.access_token);
  const encRefresh = encrypt(tokens.refresh_token);

  await db.insert(stravaTokens).values({
    userId,
    accessTokenEnc: encAccess.encrypted,
    refreshTokenEnc: encRefresh.encrypted,
    iv: encAccess.iv,
    authTag: encAccess.authTag,
    expiresAt: new Date(tokens.expires_at * 1000),
    scope: "read,activity:read_all",
  });
}

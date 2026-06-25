"use server";

import { stravaTokens } from "@/drizzle/schema";
import { encrypt } from "@/lib/crypto";
import { db } from "@/lib/db";
import { exchangeCodeForTokens, generatePkce, getAuthorizationUrl } from "@/lib/strava/oauth";

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

  // Encrypt both tokens together with a single IV so decryption is consistent.
  // Separate encrypt() calls would produce different IVs, breaking refresh token decryption.
  const blob = encrypt(
    JSON.stringify({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
    })
  );

  await db.insert(stravaTokens).values({
    userId,
    accessTokenEnc: blob.encrypted,
    refreshTokenEnc: "", // unused — both tokens live in accessTokenEnc
    iv: blob.iv,
    authTag: blob.authTag,
    expiresAt: new Date(tokens.expires_at * 1000),
    scope: "read,activity:read_all",
  });
}

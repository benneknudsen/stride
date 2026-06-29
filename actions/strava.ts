"use server";

import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { users } from "@/drizzle/schema";
import { auth } from "@/lib/auth";
import { encrypt } from "@/lib/crypto";
import { db } from "@/lib/db";
import { upsertStravaTokens } from "@/lib/db/queries";
import { exchangeCodeForTokens, generatePkce, getAuthorizationUrl } from "@/lib/strava/oauth";

const STRAVA_COOKIE = "strava_oauth";
const COOKIE_MAX_AGE = 600; // 10 minutes

export async function connectStrava(): Promise<{ url: string }> {
  const { codeVerifier, codeChallenge } = generatePkce();
  // Generate a CSRF state (not the PKCE verifier) and store the verifier
  // in an httpOnly cookie so it never touches the browser URL.
  const state = crypto.randomUUID();

  const cookieStore = await cookies();
  cookieStore.set(STRAVA_COOKIE, JSON.stringify({ v: codeVerifier, s: state }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: COOKIE_MAX_AGE,
    path: "/",
  });

  const url = getAuthorizationUrl(codeChallenge, state);
  return { url };
}

export async function handleStravaCallback(code: string, codeVerifier: string): Promise<void> {
  // Derive the user from the session — never trust a client-supplied id. This
  // function is a server action and therefore a callable RPC endpoint.
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) throw new Error("Not authenticated");

  const tokens = await exchangeCodeForTokens(code, codeVerifier);

  // Encrypt both tokens together with a single IV so decryption is consistent.
  // Separate encrypt() calls would produce different IVs, breaking refresh token decryption.
  const blob = encrypt(
    JSON.stringify({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
    })
  );

  // Upsert so reconnecting an already-linked account overwrites the row rather
  // than violating the unique(user_id) constraint.
  await upsertStravaTokens({
    userId,
    accessTokenEnc: blob.encrypted,
    refreshTokenEnc: "", // unused — both tokens live in accessTokenEnc
    iv: blob.iv,
    authTag: blob.authTag,
    expiresAt: new Date(tokens.expires_at * 1000),
    scope: "read,activity:read_all",
  });

  // Link the Strava athlete ID to the user so the dashboard shows "connected"
  if (tokens.athlete?.id) {
    await db
      .update(users)
      .set({ stravaAthleteId: tokens.athlete.id, updatedAt: new Date() })
      .where(eq(users.id, userId));
  }
}

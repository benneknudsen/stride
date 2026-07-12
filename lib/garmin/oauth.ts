import { createHash, randomBytes } from "node:crypto";
import {
  GARMIN_AUTHORIZATION_URL,
  GARMIN_SCOPE,
  GARMIN_TOKEN_URL,
  requireGarminCredentials,
} from "./config";
import type { GarminTokensResponse } from "./types";

/**
 * Garmin OAuth 2.0 PKCE.
 *
 * NextAuth drives the interactive leg of this flow (the provider in
 * `auth.config.ts` declares `checks: ["pkce", "state"]`, so Auth.js generates
 * and verifies the verifier/challenge and the CSRF state itself). The functions
 * here exist for the paths Auth.js does not cover: the **refresh** grant, which
 * runs from the sync route and the webhook long after sign-in, and a standalone
 * authorization URL for tests and scripts.
 *
 * Unlike Strava, Garmin's token endpoint takes `application/x-www-form-urlencoded`
 * — a JSON body is rejected with a 400.
 */

/** Generate a PKCE code verifier and its S256 challenge. */
export function generatePkce(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = randomBytes(32).toString("base64url");
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
  return { codeVerifier, codeChallenge };
}

/** Build the Garmin authorization URL with PKCE. */
export function getAuthorizationUrl(
  codeChallenge: string,
  state: string,
  redirectUri: string
): string {
  const { clientId } = requireGarminCredentials();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GARMIN_SCOPE,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state,
  });
  return `${GARMIN_AUTHORIZATION_URL}?${params.toString()}`;
}

async function tokenRequest(body: URLSearchParams, label: string): Promise<GarminTokensResponse> {
  const response = await fetch(GARMIN_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Garmin ${label} failed (${response.status}): ${text}`);
  }

  return response.json() as Promise<GarminTokensResponse>;
}

/** Exchange an authorization code + PKCE verifier for tokens. */
export function exchangeCodeForTokens(
  code: string,
  codeVerifier: string,
  redirectUri: string
): Promise<GarminTokensResponse> {
  const { clientId, clientSecret } = requireGarminCredentials();
  return tokenRequest(
    new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      client_secret: clientSecret,
      code,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri,
    }),
    "token exchange"
  );
}

/** Refresh an expired access token using the stored refresh token. */
export function refreshAccessToken(refreshToken: string): Promise<GarminTokensResponse> {
  const { clientId, clientSecret } = requireGarminCredentials();
  return tokenRequest(
    new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }),
    "token refresh"
  );
}

/**
 * Absolute expiry for a token response. Garmin reports a *relative* lifetime
 * (`expires_in`), where Strava reports an absolute `expires_at` — so the clock
 * read has to happen here, at the moment the response lands.
 */
export function expiresAtFrom(tokens: GarminTokensResponse, now: number = Date.now()): Date {
  return new Date(now + tokens.expires_in * 1000);
}

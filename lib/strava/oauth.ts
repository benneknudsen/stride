import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import type { RefreshTokenResponse, StravaTokensResponse } from "./types";

const STRAVA_AUTH_URL = "https://www.strava.com/oauth/authorize";
const STRAVA_TOKEN_URL = "https://www.strava.com/oauth/token";

function getEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing environment variable: ${key}`);
  return value;
}

/** Generate a PKCE code verifier and its S256 challenge. */
export function generatePkce(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = randomBytes(32).toString("base64url");
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
  return { codeVerifier, codeChallenge };
}

/** Build the Strava OAuth authorization URL with PKCE. */
export function getAuthorizationUrl(codeChallenge: string, state: string): string {
  const params = new URLSearchParams({
    client_id: getEnv("STRAVA_CLIENT_ID"),
    redirect_uri: getEnv("STRAVA_REDIRECT_URI"),
    response_type: "code",
    approval_prompt: "auto",
    scope: "read,activity:read_all",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state,
  });
  return `${STRAVA_AUTH_URL}?${params.toString()}`;
}

/** Exchange an authorization code + PKCE verifier for tokens. */
export async function exchangeCodeForTokens(
  code: string,
  codeVerifier: string
): Promise<StravaTokensResponse> {
  const response = await fetch(STRAVA_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: getEnv("STRAVA_CLIENT_ID"),
      client_secret: getEnv("STRAVA_CLIENT_SECRET"),
      code,
      grant_type: "authorization_code",
      code_verifier: codeVerifier,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Strava token exchange failed (${response.status}): ${text}`);
  }

  return response.json() as Promise<StravaTokensResponse>;
}

/**
 * Strava can answer a refresh with a 200 body that is not a token response
 * (HTML error page, missing fields). A body without `refresh_token` would
 * stringify `undefined` into the re-encrypted blob the consumer persists, so
 * the *next* refresh would send `undefined` and 400 forever — bricking the
 * connection with no signal (issue #271). Validate before anything persists.
 */
const refreshTokenResponseSchema = z.object({
  token_type: z.string(),
  access_token: z.string().min(1),
  expires_at: z.number(),
  expires_in: z.number(),
  refresh_token: z.string().min(1),
});

/** Refresh an expired access token using the stored refresh token. */
export async function refreshAccessToken(refreshToken: string): Promise<RefreshTokenResponse> {
  const response = await fetch(STRAVA_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: getEnv("STRAVA_CLIENT_ID"),
      client_secret: getEnv("STRAVA_CLIENT_SECRET"),
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Strava token refresh failed (${response.status}): ${text}`);
  }

  const body: unknown = await response.json();
  const parsed = refreshTokenResponseSchema.safeParse(body);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`strava_refresh_invalid_response: ${issues}`);
  }
  return parsed.data;
}

/**
 * Garmin Connect Developer Program endpoints and app credentials.
 *
 * Every endpoint is overridable by env var. Garmin has moved these hosts more
 * than once (the OAuth 1.0a → OAuth 2.0 PKCE migration split the token service
 * onto its own host), and a partner account can be provisioned against the
 * evaluation hosts rather than production — so hard-coding them would make a
 * host change a code change. The defaults below are the production values.
 *
 * Note on the token endpoint: Garmin's PKCE spec puts the authorization-code
 * exchange and the refresh on `diauth.garmin.com/di-oauth2-service/oauth/token`.
 * `connectapi.garmin.com/oauth-service/oauth/exchange` is a *different*
 * endpoint — it upgrades a legacy OAuth 1.0a token to an OAuth 2.0 one — and
 * will reject an authorization_code grant.
 *
 * This module is imported by `auth.config.ts`, which the proxy loads in the Edge
 * runtime: keep it free of `node:` imports and DB access.
 */

function env(key: string, fallback: string): string {
  return process.env[key] || fallback;
}

/** Where the user is sent to approve the connection. */
export const GARMIN_AUTHORIZATION_URL = env(
  "GARMIN_AUTHORIZATION_URL",
  "https://connect.garmin.com/oauth2Confirm"
);

/** Authorization-code exchange *and* refresh-token grant. Form-encoded. */
export const GARMIN_TOKEN_URL = env(
  "GARMIN_TOKEN_URL",
  "https://diauth.garmin.com/di-oauth2-service/oauth/token"
);

/** Base for the Health/Activity REST API. */
export const GARMIN_API_BASE = env("GARMIN_API_BASE", "https://apis.garmin.com/wellness-api/rest");

/**
 * Garmin's permission scopes. The API grants data access per scope string, and
 * the exact vocabulary is set on the partner app in Garmin's developer portal —
 * hence the env override.
 */
export const GARMIN_SCOPE = env("GARMIN_SCOPE", "activity:read health:read");

/**
 * The redirect Garmin sends the user back to. NextAuth owns this path — it is
 * always `<AUTH_URL>/api/auth/callback/garmin` — so `GARMIN_REDIRECT_URI` is not
 * read by the OAuth code; it exists so the value registered in Garmin's portal
 * is captured alongside the other credentials, and so deploys can assert it.
 */
export const GARMIN_REDIRECT_URI = process.env.GARMIN_REDIRECT_URI ?? null;

/**
 * Hosts a ping notification's `callbackURL` may point at.
 *
 * A ping tells us to fetch summaries from a URL *supplied in the request body*,
 * and we attach the athlete's Garmin bearer token to that fetch. Following the
 * URL unvalidated turns the webhook into an SSRF primitive that exfiltrates a
 * live OAuth token to whatever host the body names — so the destination is
 * allowlisted, and the callback is matched on exact hostname equality (a suffix
 * check would accept `apis.garmin.com.evil.tld`).
 */
export const GARMIN_CALLBACK_HOSTS: readonly string[] = (
  process.env.GARMIN_CALLBACK_HOSTS || "apis.garmin.com,healthapi.garmin.com"
)
  .split(",")
  .map((host) => host.trim().toLowerCase())
  .filter(Boolean);

/** Whether a ping's `callbackURL` is a Garmin host we will send a bearer token to. */
export function isAllowedCallbackUrl(rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  // https only: a http:// callback would put the bearer token on the wire in
  // plaintext even if the host itself is legitimate.
  if (url.protocol !== "https:") return false;
  return GARMIN_CALLBACK_HOSTS.includes(url.hostname.toLowerCase());
}

/**
 * Read a required Garmin credential. Throws rather than falling back: a missing
 * client id would otherwise produce an opaque 4xx from Garmin at redirect time.
 */
export function requireGarminCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.GARMIN_CLIENT_ID;
  const clientSecret = process.env.GARMIN_CLIENT_SECRET;
  if (!clientId) throw new Error("Missing environment variable: GARMIN_CLIENT_ID");
  if (!clientSecret) throw new Error("Missing environment variable: GARMIN_CLIENT_SECRET");
  return { clientId, clientSecret };
}

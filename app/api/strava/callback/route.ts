import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { handleStravaCallback } from "@/actions/strava";

// Strava redirects here with ?code and ?state after the user authorizes.
// The PKCE codeVerifier is stored in an httpOnly cookie (set by connectStrava)
// and never appears in the URL, preventing CSRF account-injection attacks.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");

  const base = new URL("/", req.url);

  if (!code || !state) {
    base.searchParams.set("strava_error", "true");
    return NextResponse.redirect(base);
  }

  // Read the cookie we set in connectStrava — it contains the PKCE verifier
  // and the expected CSRF state value.
  const cookie = req.cookies.get("strava_oauth");
  if (!cookie) {
    base.searchParams.set("strava_error", "true");
    return NextResponse.redirect(base);
  }

  let codeVerifier: string;
  try {
    const payload = JSON.parse(cookie.value) as { v: string; s: string };
    // Verify the returned state matches what we sent — CSRF protection.
    if (payload.s !== state) {
      base.searchParams.set("strava_error", "true");
      const response = NextResponse.redirect(base);
      response.cookies.set("strava_oauth", "", { maxAge: 0, path: "/" });
      return response;
    }
    codeVerifier = payload.v;
  } catch {
    base.searchParams.set("strava_error", "true");
    const response = NextResponse.redirect(base);
    response.cookies.set("strava_oauth", "", { maxAge: 0, path: "/" });
    return response;
  }

  try {
    await handleStravaCallback(code, codeVerifier);
    base.searchParams.set("strava_connected", "true");
  } catch {
    base.searchParams.set("strava_error", "true");
  }

  // Always clear the one-time-use cookie
  const response = NextResponse.redirect(base);
  response.cookies.set("strava_oauth", "", { maxAge: 0, path: "/" });
  return response;
}

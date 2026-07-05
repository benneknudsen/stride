import { NextResponse } from "next/server";
import NextAuth from "next-auth";
import authConfig from "@/auth.config";
import { buildCsp } from "@/lib/csp";

// Build an edge-safe auth instance from the config that excludes nodemailer and
// the Drizzle adapter. The full instance lives in lib/auth.ts (Node runtime).
const { auth } = NextAuth(authConfig);

/**
 * Request proxy. Two responsibilities:
 *
 *  1. Auth-gate the dashboard (unchanged from the original middleware).
 *  2. Attach the CSP header. `next.config.ts` `headers()` can only emit static
 *     headers, so the policy is built here. The CSP no longer uses a nonce
 *     (`script-src 'self' 'unsafe-inline'`), so no per-request/session value is
 *     minted — `buildCsp` receives an empty nonce. The remaining static
 *     security headers stay in `next.config.ts`.
 */
export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isAuthed = !!req.auth;

  // Authenticated users have no reason to see the login page.
  if (isAuthed && pathname === "/login") {
    return NextResponse.redirect(new URL("/", req.nextUrl));
  }

  // Protect all app routes (root /, /aktiviteter, /coach, /plan).
  const APP_ROUTES = ["/", "/aktiviteter", "/coach", "/plan"];
  const isProtected = APP_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  );
  if (!isAuthed && isProtected) {
    return NextResponse.redirect(new URL("/login", req.nextUrl));
  }

  const csp = buildCsp("", process.env.NODE_ENV === "development");

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);

  return response;
});

/**
 * Run on document/page requests. Static assets, image optimisation, the favicon
 * and API routes (JSON — no inline scripts) are excluded so the CSP work is
 * spent only where an HTML document with scripts is served. The auth-protected
 * paths (`/`, `/dashboard/*`, `/login`) fall inside this matcher.
 */
export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};

import { NextResponse } from "next/server";
import NextAuth from "next-auth";
import authConfig from "@/auth.config";
import { buildCsp } from "@/lib/csp";

// Build an edge-safe auth instance from the config that excludes nodemailer and
// the Drizzle adapter. The full instance lives in lib/auth.ts (Node runtime).
const { auth } = NextAuth(authConfig);

// The CSP no longer depends on any per-request value (the nonce is gone), so the
// policy is identical for every request. Build it once at module load instead of
// on every request.
const CSP = buildCsp("", process.env.NODE_ENV === "development");

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

  // Protect all app routes (root /, /aktiviteter, /coach, /dashboard/*, /plan).
  const APP_ROUTES = ["/", "/aktiviteter", "/coach", "/dashboard", "/plan"];
  const isProtected = APP_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  );
  if (!isAuthed && isProtected) {
    return NextResponse.redirect(new URL("/login", req.nextUrl));
  }

  // CSP is only consumed on the response; nothing reads it off the request, so
  // there is no need to clone/override the request headers.
  const response = NextResponse.next();
  response.headers.set("Content-Security-Policy", CSP);

  return response;
});

/**
 * Run on document/page requests. Static assets, image optimisation, the favicon
 * and API routes (JSON — no inline scripts) are excluded so the CSP work is
 * spent only where an HTML document with scripts is served. The auth-protected
 * paths (`/`, `/dashboard/*`, `/login`) fall inside this matcher.
 */
export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2|ttf|otf|css|js|map|txt|xml|json)$).*)",
  ],
};

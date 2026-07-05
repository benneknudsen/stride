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
 *  2. Attach a per-request CSP nonce (issue #61). `next.config.ts` `headers()`
 *     is evaluated once at build time and cannot produce a unique value per
 *     response, so the nonce is minted here. It is set on both the inbound
 *     request headers (so Next.js reads it and stamps its own `<script>` tags)
 *     and the response headers (so the browser enforces it). The remaining
 *     static security headers stay in `next.config.ts`.
 */
export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isAuthed = !!req.auth;

  // Authenticated users have no reason to see the login page.
  if (isAuthed && pathname === "/login") {
    return NextResponse.redirect(new URL("/", req.nextUrl));
  }

  // Protect the dashboard (root) and everything under /dashboard.
  const isProtected = pathname === "/" || pathname.startsWith("/dashboard");
  if (!isAuthed && isProtected) {
    return NextResponse.redirect(new URL("/login", req.nextUrl));
  }

  // Continue to the page, stamping a fresh CSP nonce onto request + response.
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCsp(nonce, process.env.NODE_ENV === "development");

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
});

/**
 * Run on document/page requests. Static assets, image optimisation, the favicon
 * and API routes (JSON — no inline scripts) are excluded so the nonce work is
 * spent only where an HTML document with scripts is served. The auth-protected
 * paths (`/`, `/dashboard/*`, `/login`) fall inside this matcher.
 */
export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};

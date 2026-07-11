import { NextResponse } from "next/server";
import NextAuth from "next-auth";
import authConfig from "@/auth.config";
import { buildCsp, createNonce } from "@/lib/csp";
import { ROUTES } from "@/lib/routes";

// Build an edge-safe auth instance from the config that excludes nodemailer and
// the Drizzle adapter. The full instance lives in lib/auth.ts (Node runtime).
const { auth } = NextAuth(authConfig);

const IS_DEV = process.env.NODE_ENV === "development";

/**
 * Request proxy. Two responsibilities:
 *
 *  1. Keep signed-in users off the login page. The app pages themselves are no
 *     longer gated — see below.
 *  2. Mint a per-request nonce and attach the CSP header. `next.config.ts`
 *     `headers()` can only emit static headers, so a nonce-bearing policy has to
 *     be built here; the request-independent security headers stay there.
 *
 * The policy is set on the **request** headers as well as the response — that is
 * not redundant. Next.js' renderer reads the nonce off the incoming request's
 * `Content-Security-Policy` and stamps its own inline scripts with it; the
 * response header is what the browser actually enforces. Setting only the
 * response header (the state this file was in) meant Next never saw the nonce, so
 * its scripts went out unstamped and got blocked — which is why the policy had
 * been downgraded to `'unsafe-inline'` (issue #89).
 *
 * `x-nonce` carries the same value to the render tree, where `app/layout.tsx`
 * hands it to next-themes, whose anti-FOUC script is our only hand-rolled inline
 * script and is therefore not stamped by Next.
 */
export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isAuthed = !!req.auth;

  // Authenticated users have no reason to see the login page.
  if (isAuthed && pathname === ROUTES.LOGIN) {
    return NextResponse.redirect(new URL(ROUTES.HOME, req.nextUrl));
  }

  // The four app pages (/, /aktiviteter, /dashboard/* — which covers the coach —
  // and /plan) are deliberately *not* auth-gated (issue #100). Every one of them
  // builds its view-model from the signed-in user's synced runs and falls back to
  // the demo fixtures when there is no session or nothing synced (issue #84), so a
  // visitor browsing them sees a working product rather than a login wall. The
  // per-user data itself is still protected where it is read: `auth()` in each
  // Server Component and in the /api routes, which this matcher never touches.

  const nonce = createNonce();
  const csp = buildCsp(nonce, IS_DEV);

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("Content-Security-Policy", csp);
  requestHeaders.set("x-nonce", nonce);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);

  return response;
});

/**
 * Run on document/page requests. Static assets, image optimisation, the favicon
 * and API routes (JSON — no inline scripts) are excluded so the CSP work is
 * spent only where an HTML document with scripts is served. `/login` — the one
 * path still redirected above — falls inside this matcher.
 */
export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2|ttf|otf|css|js|map|txt|xml|json)$).*)",
  ],
};

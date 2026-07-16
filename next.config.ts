import type { NextConfig } from "next";
// Relative, not the "@/" alias: next.config.ts is loaded outside the app's
// module resolution, so the tsconfig paths don't apply here.
import {
  DEMO_HOME_REWRITE_TARGET,
  DEMO_HOME_ROUTE,
  LEGACY_COACH_ROUTE,
  ROUTES,
} from "./lib/routes";

/**
 * The Content-Security-Policy is set in `proxy.ts`, not here: it carries a
 * per-request nonce, and `headers()` below can only emit static values. The
 * headers below are request-independent, so they stay static.
 */

/** Applied to every response — see issue #46. */
const securityHeaders = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "X-DNS-Prefetch-Control", value: "on" },
];

const nextConfig: NextConfig = {
  images: {
    // Avatar hosts for the sign-in providers surfaced on the settings page.
    remotePatterns: [
      { protocol: "https", hostname: "avatars.githubusercontent.com" },
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
      { protocol: "https", hostname: "*.cloudfront.net" },
    ],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
  /**
   * Issue #86 — the coach used to live at two overlapping routes. `/dashboard/coach`
   * (the one the NavBar and BottomTabBar point at, so the tab marker works) is now
   * the only one; the old `/coach` links permanently redirect here.
   */
  async redirects() {
    return [
      {
        source: LEGACY_COACH_ROUTE,
        destination: ROUTES.COACH,
        permanent: true,
      },
    ];
  },
  /**
   * The public demo lives at the clean `/demo` (every link uses DEMO_HOME_ROUTE),
   * but the page itself is the front page reading `?demo=1` — a rewrite, not a
   * redirect, so the browser keeps the pretty URL and there is still only one
   * page implementation (#100's concern). Old `/?demo=1` links keep working
   * since the front page reads the query either way.
   */
  async rewrites() {
    return [
      {
        source: DEMO_HOME_ROUTE,
        destination: DEMO_HOME_REWRITE_TARGET,
      },
    ];
  },
};

export default nextConfig;

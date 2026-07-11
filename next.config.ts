import type { NextConfig } from "next";
// Relative, not the "@/" alias: next.config.ts is loaded outside the app's
// module resolution, so the tsconfig paths don't apply here.
import { LEGACY_COACH_ROUTE, ROUTES } from "./lib/routes";

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
};

export default nextConfig;

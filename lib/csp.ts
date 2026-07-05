/**
 * Builds the per-request Content-Security-Policy string.
 *
 * `script-src` carries a per-request `nonce` plus `'strict-dynamic'` so Next.js'
 * inline bootstrap/hydration scripts (which Next automatically stamps with this
 * nonce) are trusted, while arbitrary injected inline scripts are not — this is
 * what a nonce buys us over the old blanket `'unsafe-inline'` (issue #61).
 *
 * `style-src` deliberately keeps `'unsafe-inline'`: Tailwind, Recharts and
 * Leaflet emit un-nonce-able inline styles, so nonce-ing styles would break the
 * UI. Styles are a far lower XSS risk than scripts.
 *
 * Dev additionally needs `'unsafe-eval'` (React Refresh) and a websocket (HMR).
 */
export function buildCsp(nonce: string, isDev: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    // `connect-src` must allowlist the external origins the browser may reach:
    // the Strava API/OAuth host and the Vercel AI Gateway (AI SDK streaming).
    // Without these, `'self'` alone blocks those fetch/XHR/stream connections
    // (issue #62). Dev additionally needs a websocket for HMR.
    `connect-src 'self' https://www.strava.com https://ai-gateway.vercel.sh${isDev ? " ws:" : ""}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

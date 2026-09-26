/**
 * Builds the per-request Content-Security-Policy string.
 *
 * `script-src` carries a per-request nonce plus `'strict-dynamic'`. Next.js reads
 * the nonce off the *request's* CSP header (see `proxy.ts`) and stamps its own
 * bootstrap/hydration/flight-data scripts with it; `'strict-dynamic'` then extends
 * that trust to the chunks those scripts load, while arbitrary injected inline
 * scripts stay blocked. This is what a nonce buys us over a blanket
 * `'unsafe-inline'` (issue #61, restored in #89).
 *
 * CSP3 browsers ignore `'self'` and `'unsafe-inline'` in a directive that carries
 * `'strict-dynamic'`/a nonce, so neither is listed; `'self'` remains only as the
 * `default-src` baseline for the other resource types.
 *
 * `worker-src 'self'` is listed explicitly rather than left to fall back to
 * `script-src`: MapLibre spawns `/maplibre-gl-worker.mjs` (`RouteMap.tsx`), and
 * that only works today because CSP3 engines propagate `'strict-dynamic'` into
 * module workers. That inheritance is engine behaviour, not contract — a worker
 * is a separate script, so it should not be gated on the parent script's
 * `'strict-dynamic'`. Naming `child-src` too covers pre-CSP3 engines, where
 * `worker-src` is unknown and the worker permission resolves via `child-src`
 * (and then `script-src`). Both are additive `'self'`: no `'unsafe-*'`, and the
 * nonce contract above is untouched.
 *
 * `style-src` deliberately keeps `'unsafe-inline'`: Tailwind, Recharts and
 * MapLibre emit un-nonce-able inline styles, so nonce-ing styles would break the
 * UI. Styles are a far lower XSS risk than scripts.
 *
 * Dev additionally needs `'unsafe-eval'` (React Refresh) and a websocket (HMR).
 */
export function buildCsp(nonce: string, isDev: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "worker-src 'self'",
    "child-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    // `img-src` lists only the origins that actually paint: `'self'` (the Strava
    // avatar arrives through `next/image`, so the browser fetches same-origin
    // `/_next/image` — the optimizer server is what reaches out), the tile host
    // for MapLibre's sprites/rasters, and `data:`/`blob:` for MapLibre's own
    // in-memory textures. Nothing renders a remote `<img src>` directly, so the
    // blanket `https:` wildcard went (issue #281).
    "img-src 'self' data: blob: https://tiles.openfreemap.org",
    "font-src 'self' data:",
    // `connect-src` must allowlist the external origins the browser may reach:
    // the Strava API/OAuth host and OpenFreeMap's tile server (RouteMap fetches
    // its style, glyphs and vector tiles via fetch/XHR — issue #275). Without
    // these, `'self'` alone blocks those fetch/XHR connections (issue #62). Dev
    // additionally needs a websocket for HMR. #292 dropped the AI gateway host
    // here: the browser never streams from a model any more.
    `connect-src 'self' https://www.strava.com https://tiles.openfreemap.org${isDev ? " ws:" : ""}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

/**
 * Mints a nonce for one request. Base64 of a random UUID — `btoa`/`crypto` are
 * Web APIs, so this works in both the edge and Node proxy runtimes (`Buffer` is
 * not guaranteed on the edge). The output matches the base64 shape Next.js'
 * `getScriptNonceFromHeader` accepts; a malformed nonce would be silently dropped
 * and every script on the page would then be blocked.
 */
export function createNonce(): string {
  return btoa(crypto.randomUUID());
}

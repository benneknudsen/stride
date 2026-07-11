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
 * `style-src` deliberately keeps `'unsafe-inline'`: Tailwind, Recharts and Leaflet
 * emit un-nonce-able inline styles, so nonce-ing styles would break the UI. Styles
 * are a far lower XSS risk than scripts.
 *
 * Dev additionally needs `'unsafe-eval'` (React Refresh) and a websocket (HMR).
 */
export function buildCsp(nonce: string, isDev: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
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

// Server-side Sentry init (Node runtime). Loaded by `instrumentation.ts`'s
// `register()` when NEXT_RUNTIME === "nodejs". A missing SENTRY_DSN makes
// `init` a no-op, so this is safe to ship before the DSN is configured (#178).
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  // GDPR/cost: never let the SDK attach IPs, cookies, or request bodies. Our own
  // `captureError` already forwards only sanitized fields (#135, #143).
  sendDefaultPii: false,
  // Sample traces sparingly — this is error observability, not full APM.
  tracesSampleRate: 0.1,
});

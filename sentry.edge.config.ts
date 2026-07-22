// Edge-runtime Sentry init (middleware / edge routes — `proxy.ts` runs here).
// Loaded by `instrumentation.ts`'s `register()` when NEXT_RUNTIME === "edge".
// A missing SENTRY_DSN makes `init` a no-op (#178).
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  sendDefaultPii: false,
  tracesSampleRate: 0.1,
});

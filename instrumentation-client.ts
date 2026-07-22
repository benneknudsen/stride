// Client-side Sentry init. Next 16 uses Turbopack, where the legacy
// `sentry.client.config.ts` is no longer auto-injected — `instrumentation-client.ts`
// is the framework-native hook that runs before the app hydrates (#178).
// The browser needs a public DSN; a missing one makes `init` a no-op.
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  sendDefaultPii: false,
  tracesSampleRate: 0.1,
});

// Required for Next's navigation instrumentation to report client transitions.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;

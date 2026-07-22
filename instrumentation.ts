// Next.js instrumentation hook — runs once per server runtime at startup and
// loads the matching Sentry init (#178). `onRequestError` forwards uncaught
// errors from Server Components, route handlers, and the like to Sentry.
import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;

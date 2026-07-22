/**
 * Minimal server-side error observability (issue #135).
 *
 * The query layer degrades gracefully on failure — a failed read returns
 * `null`/`[]` so the UI can fall back to demo data instead of crashing. The
 * cost of that resilience was silence: a genuinely failing query looked
 * identical to "no data", so real incidents disappeared behind the demo
 * fallback with nothing logged.
 *
 * `captureError` is the thin seam that makes those failures visible without
 * changing the degradation behaviour. It writes a structured line to
 * `console.error` (picked up by the platform's log drain) *and* forwards to
 * Sentry (#178) — the single choke point, so call sites never change. Sentry is
 * a no-op until `SENTRY_DSN` is set, so this is safe with no config.
 */

import * as Sentry from "@sentry/nextjs";

/** Pull the serialisable, log-safe fields out of an unknown thrown value. */
function serializeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      // `cause` is often another Error (e.g. the underlying pg/socket error);
      // recurse so its message survives instead of logging `[object Object]`.
      ...(err.cause !== undefined ? { cause: serializeError(err.cause) } : {}),
    };
  }
  if (typeof err === "object" && err !== null) {
    return { value: String(err) };
  }
  return { value: err };
}

/**
 * Record a server-side error with a human-readable context tag. Never throws —
 * observability must not become a new failure mode for the code it wraps.
 *
 * @param context Where the failure happened, e.g. `"queries.getUserById"`.
 * @param err     The caught value (unknown, since `catch` bindings are untyped).
 */
export function captureError(context: string, err: unknown): void {
  const serialized = serializeError(err);
  try {
    console.error(`[stride] ${context}`, serialized);
  } catch {
    // Logging itself failed — there is nothing safe left to do here.
  }
  try {
    // Forward the *sanitized* view, never the raw thrown value: a raw pg/socket
    // error can carry a connection string or token in its own properties, and
    // Sentry would serialise those onto the event. We rebuild a clean Error
    // from the log-safe fields (name/message) and attach only `serialized` as
    // context, so nothing beyond that boundary can reach Sentry (#135, #143).
    const safeError =
      err instanceof Error ? new Error(err.message) : new Error(String(serialized.value));
    if (err instanceof Error) {
      safeError.name = err.name;
    }
    Sentry.captureException(safeError, { tags: { context }, extra: serialized });
  } catch {
    // Sentry transport failed — observability must not become a failure mode.
  }
}

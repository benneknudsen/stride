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
 * changing the degradation behaviour. Today it writes a structured line to
 * `console.error` (picked up by the platform's log drain); it's the single
 * choke point to later forward into Sentry/OTel without touching call sites.
 */

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
  try {
    console.error(`[stride] ${context}`, serializeError(err));
  } catch {
    // Logging itself failed — there is nothing safe left to do here.
  }
}

"use client";

import { useEffect } from "react";
import { captureError } from "@/lib/observability";

// global-error replaces the root layout when the layout itself throws, so it
// must render its own <html>/<body>. Kept dependency-free and self-styled for
// that reason (no shared components or globals are guaranteed to be available).
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // global-error catches failures in the root layout itself — the most severe
    // class of crash — so it is always reported. captureError carries both hops:
    // the structured log line *and* the Sentry forward, and it forwards only the
    // sanitized error, so the direct captureException went (issue #281).
    captureError("error.global", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0b0d11",
          color: "#e9ecf1",
          fontFamily: "system-ui, sans-serif",
          padding: "1.5rem",
        }}
      >
        <div style={{ maxWidth: "26rem", textAlign: "center" }}>
          <h1 style={{ fontSize: "1.25rem", fontWeight: 600, margin: 0 }}>Something went wrong</h1>
          <p style={{ marginTop: "0.5rem", color: "#79828f", fontSize: "0.9rem" }}>
            Stride ran into an unexpected error. Please try reloading.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: "1.25rem",
              padding: "0.5rem 1rem",
              borderRadius: "0.5rem",
              border: "none",
              background: "#1b29c0",
              color: "#fdf3ee",
              fontWeight: 500,
              fontSize: "0.85rem",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}

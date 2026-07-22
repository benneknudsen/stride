import { afterEach, describe, expect, it, vi } from "vitest";

// Mock the SDK so the test asserts on what we hand Sentry, without a real DSN or
// network. `vi.hoisted` lets the factory reference the spy despite vi.mock hoisting.
const { captureExceptionMock } = vi.hoisted(() => ({ captureExceptionMock: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureException: captureExceptionMock }));

import { captureError } from "@/lib/observability";

describe("captureError", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("forwards the failure to Sentry.captureException tagged with the context", () => {
    captureError("queries.getUserById", new Error("boom"));

    expect(captureExceptionMock).toHaveBeenCalledOnce();
    const [, options] = captureExceptionMock.mock.calls[0];
    expect(options?.tags?.context).toBe("queries.getUserById");
  });

  it("never forwards the raw thrown value, so connection secrets cannot leak to Sentry", () => {
    // A pg/socket-style error object carrying a secret in a non-message field —
    // exactly the shape that must never reach a third-party service (#135, #143).
    const leaky = {
      message: "connect ECONNREFUSED",
      connectionString: "postgres://user:SUPERSECRET@db.internal/stride",
    };

    captureError("db.connect", leaky);

    // Nothing handed to Sentry — the exception arg or the context payload — may
    // contain the secret. Serialising the whole call catches it wherever it hides.
    const everythingSentToSentry = JSON.stringify(captureExceptionMock.mock.calls);
    expect(everythingSentToSentry).not.toContain("SUPERSECRET");
  });

  it("still records when the error is a bare object, without throwing", () => {
    expect(() => captureError("weird.case", { code: 500 })).not.toThrow();
    expect(captureExceptionMock).toHaveBeenCalledOnce();
  });
});

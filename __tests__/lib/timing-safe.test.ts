import { describe, expect, it } from "vitest";

/**
 * Unit tests for lib/timing-safe.ts (issue #272).
 *
 * The helper wraps node:crypto's timingSafeEqual with a length pre-check, so
 * the behaviours that matter are: equality, inequality (same length), unequal
 * lengths (must not throw), and multi-byte UTF-8 handling — the OAuth state and
 * webhook verify tokens it compares are ASCII, but the helper must stay safe
 * for any string.
 */
import { timingSafeStringEqual } from "@/lib/timing-safe";

describe("timingSafeStringEqual", () => {
  it("returns true for identical strings", () => {
    expect(timingSafeStringEqual("state-123", "state-123")).toBe(true);
  });

  it("returns true for two empty strings", () => {
    expect(timingSafeStringEqual("", "")).toBe(true);
  });

  it("returns false for different strings of the same length", () => {
    expect(timingSafeStringEqual("state-123", "state-456")).toBe(false);
  });

  it("returns false for strings of unequal length (no throw)", () => {
    // timingSafeEqual throws on unequal-length buffers; the helper must
    // short-circuit to false instead.
    expect(() => timingSafeStringEqual("short", "a-much-longer-state")).not.toThrow();
    expect(timingSafeStringEqual("short", "a-much-longer-state")).toBe(false);
    expect(timingSafeStringEqual("a-much-longer-state", "short")).toBe(false);
  });

  it("returns false when one side is empty", () => {
    expect(timingSafeStringEqual("", "state")).toBe(false);
    expect(timingSafeStringEqual("state", "")).toBe(false);
  });

  it("is case-sensitive", () => {
    expect(timingSafeStringEqual("STATE", "state")).toBe(false);
  });

  it("compares bytes, not code points (multi-byte UTF-8)", () => {
    // "æøå" is 6 bytes in UTF-8; "aeoa" is 4 — unequal byte length → false.
    expect(timingSafeStringEqual("æøå", "aeoa")).toBe(false);
    expect(timingSafeStringEqual("æøå", "æøå")).toBe(true);
    // Same byte length, different multi-byte content.
    expect(timingSafeStringEqual("æø", "åø")).toBe(false);
  });

  it("matches long, token-shaped strings (UUID-like)", () => {
    const state = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
    expect(timingSafeStringEqual(state, state)).toBe(true);
    expect(timingSafeStringEqual(state, "f47ac10b-58cc-4372-a567-0e02b2c3d47a")).toBe(false);
  });
});

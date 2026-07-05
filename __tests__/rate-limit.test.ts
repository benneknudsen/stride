import { beforeEach, describe, expect, it } from "vitest";
import { rateLimit, resetRateLimit } from "@/lib/rate-limit";

describe("rateLimit", () => {
  beforeEach(() => {
    resetRateLimit();
  });

  it("allows up to 5 requests per key by default", () => {
    const now = 1_000_000;
    for (let i = 0; i < 5; i++) {
      expect(rateLimit("a@b.com", { now }).allowed).toBe(true);
    }
    expect(rateLimit("a@b.com", { now }).allowed).toBe(false);
  });

  it("reports decreasing remaining count", () => {
    const now = 1_000_000;
    expect(rateLimit("k", { now }).remaining).toBe(4);
    expect(rateLimit("k", { now }).remaining).toBe(3);
  });

  it("blocks the 6th request within the window", () => {
    const now = 0;
    for (let i = 0; i < 5; i++) rateLimit("x", { now });
    const blocked = rateLimit("x", { now });
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it("rolls over after the window expires", () => {
    const windowMs = 10 * 60 * 1000;
    for (let i = 0; i < 5; i++) rateLimit("y", { now: 0, windowMs });
    expect(rateLimit("y", { now: 0, windowMs }).allowed).toBe(false);
    // After the window resets, requests are allowed again.
    expect(rateLimit("y", { now: windowMs, windowMs }).allowed).toBe(true);
  });

  it("tracks keys independently", () => {
    const now = 0;
    for (let i = 0; i < 5; i++) rateLimit("one", { now });
    expect(rateLimit("one", { now }).allowed).toBe(false);
    expect(rateLimit("two", { now }).allowed).toBe(true);
  });

  it("respects a custom max", () => {
    const now = 0;
    expect(rateLimit("z", { now, max: 1 }).allowed).toBe(true);
    expect(rateLimit("z", { now, max: 1 }).allowed).toBe(false);
  });
});

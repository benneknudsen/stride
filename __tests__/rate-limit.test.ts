import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rateLimit, resetRateLimit } from "@/lib/rate-limit";

const { redisMock } = vi.hoisted(() => ({
  redisMock: {
    multi: vi.fn(),
    pexpire: vi.fn(),
  },
}));

vi.mock("@upstash/redis", () => ({
  Redis: class {
    constructor() {
      Object.assign(this, redisMock);
    }
  },
}));

describe("rateLimit (in-memory fallback)", () => {
  beforeEach(() => {
    // No Upstash credentials → the Map-backed path.
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    resetRateLimit();
  });

  it("allows up to 5 requests per key by default", async () => {
    const now = 1_000_000;
    for (let i = 0; i < 5; i++) {
      expect((await rateLimit("a@b.com", { now })).allowed).toBe(true);
    }
    expect((await rateLimit("a@b.com", { now })).allowed).toBe(false);
  });

  it("reports decreasing remaining count", async () => {
    const now = 1_000_000;
    expect((await rateLimit("k", { now })).remaining).toBe(4);
    expect((await rateLimit("k", { now })).remaining).toBe(3);
  });

  it("blocks the 6th request within the window", async () => {
    const now = 0;
    for (let i = 0; i < 5; i++) await rateLimit("x", { now });
    const blocked = await rateLimit("x", { now });
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it("rolls over after the window expires", async () => {
    const windowMs = 10 * 60 * 1000;
    for (let i = 0; i < 5; i++) await rateLimit("y", { now: 0, windowMs });
    expect((await rateLimit("y", { now: 0, windowMs })).allowed).toBe(false);
    // After the window resets, requests are allowed again.
    expect((await rateLimit("y", { now: windowMs, windowMs })).allowed).toBe(true);
  });

  it("tracks keys independently", async () => {
    const now = 0;
    for (let i = 0; i < 5; i++) await rateLimit("one", { now });
    expect((await rateLimit("one", { now })).allowed).toBe(false);
    expect((await rateLimit("two", { now })).allowed).toBe(true);
  });

  it("respects a custom max", async () => {
    const now = 0;
    expect((await rateLimit("z", { now, max: 1 })).allowed).toBe(true);
    expect((await rateLimit("z", { now, max: 1 })).allowed).toBe(false);
  });
});

describe("rateLimit (Upstash Redis)", () => {
  /** Stubs one MULTI round trip returning [count, pttl]. */
  function stubTransaction(count: number, ttl: number) {
    const exec = vi.fn().mockResolvedValue([count, ttl]);
    redisMock.multi.mockReturnValue({ incr: vi.fn(), pttl: vi.fn(), exec });
    return exec;
  }

  beforeEach(() => {
    process.env.UPSTASH_REDIS_REST_URL = "https://fake.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "token";
    vi.clearAllMocks();
    resetRateLimit();
  });

  afterEach(() => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
  });

  it("allows a first hit and arms the window's expiry", async () => {
    stubTransaction(1, -1); // fresh key: no TTL yet
    const result = await rateLimit("chat:u1", { now: 1_000, windowMs: 60_000 });

    expect(result).toEqual({ allowed: true, remaining: 4, resetAt: 61_000 });
    expect(redisMock.pexpire).toHaveBeenCalledWith("ratelimit:chat:u1", 60_000);
  });

  it("derives resetAt from the live TTL and leaves the window alone", async () => {
    stubTransaction(3, 20_000);
    const result = await rateLimit("chat:u1", { now: 1_000, windowMs: 60_000 });

    expect(result).toEqual({ allowed: true, remaining: 2, resetAt: 21_000 });
    // The window must not be extended by a mid-window hit.
    expect(redisMock.pexpire).not.toHaveBeenCalled();
  });

  it("blocks once the counter passes max", async () => {
    stubTransaction(6, 20_000);
    const result = await rateLimit("chat:u1", { now: 1_000, windowMs: 60_000 });

    expect(result).toEqual({ allowed: false, remaining: 0, resetAt: 21_000 });
  });

  it("falls back to the in-memory limiter when Redis fails", async () => {
    redisMock.multi.mockReturnValue({
      incr: vi.fn(),
      pttl: vi.fn(),
      exec: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")),
    });

    const now = 0;
    expect((await rateLimit("degraded", { now, max: 1 })).allowed).toBe(true);
    expect((await rateLimit("degraded", { now, max: 1 })).allowed).toBe(false);
  });
});

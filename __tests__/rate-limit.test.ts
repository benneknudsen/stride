import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rateLimit, resetRateLimit } from "@/lib/rate-limit";

const { captureErrorMock, redisMock } = vi.hoisted(() => ({
  captureErrorMock: vi.fn(),
  redisMock: {
    multi: vi.fn(),
  },
}));

vi.mock("@upstash/redis", () => ({
  Redis: class {
    constructor() {
      Object.assign(this, redisMock);
    }
  },
}));

vi.mock("@/lib/observability", () => ({ captureError: captureErrorMock }));

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
  /**
   * Stubs one MULTI round trip returning [incr, pexpire, pttl]. PEXPIRE NX runs
   * inside the transaction, so PTTL always reports a live (positive) TTL.
   */
  function stubTransaction(count: number, ttl: number, armed: 0 | 1 = 1) {
    const tx = {
      incr: vi.fn(),
      pexpire: vi.fn(),
      pttl: vi.fn(),
      exec: vi.fn().mockResolvedValue([count, armed, ttl]),
    };
    redisMock.multi.mockReturnValue(tx);
    return tx;
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
    // Fresh key: PEXPIRE NX arms it, so PTTL reports the full window.
    const tx = stubTransaction(1, 60_000, 1);
    const result = await rateLimit("chat:u1", { now: 1_000, windowMs: 60_000 });

    expect(result).toEqual({ allowed: true, remaining: 4, resetAt: 61_000 });
    expect(tx.pexpire).toHaveBeenCalledWith("ratelimit:chat:u1", 60_000, "NX");
  });

  it("derives resetAt from the live TTL and leaves the window alone", async () => {
    // Mid-window hit: the key already has a TTL, so PEXPIRE NX is a no-op (0).
    const tx = stubTransaction(3, 20_000, 0);
    const result = await rateLimit("chat:u1", { now: 1_000, windowMs: 60_000 });

    expect(result).toEqual({ allowed: true, remaining: 2, resetAt: 21_000 });
    // The window must not be extended by a mid-window hit.
    expect(tx.pexpire).toHaveBeenCalledWith("ratelimit:chat:u1", 60_000, "NX");
  });

  it("blocks once the counter passes max", async () => {
    stubTransaction(6, 20_000, 0);
    const result = await rateLimit("chat:u1", { now: 1_000, windowMs: 60_000 });

    expect(result).toEqual({ allowed: false, remaining: 0, resetAt: 21_000 });
  });

  it("falls back to the in-memory limiter when Redis fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    redisMock.multi.mockReturnValue({
      incr: vi.fn(),
      pexpire: vi.fn(),
      pttl: vi.fn(),
      exec: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")),
    });

    const now = 0;
    expect((await rateLimit("degraded", { now, max: 1 })).allowed).toBe(true);
    expect((await rateLimit("degraded", { now, max: 1 })).allowed).toBe(false);
    // Repo policy (#135/#143/#272): the raw thrown value is never logged — it
    // goes through captureError's sanitising choke point instead.
    expect(captureErrorMock).toHaveBeenCalledTimes(2);
    expect(captureErrorMock).toHaveBeenCalledWith("rate-limit.redis", expect.any(Error));
    expect(consoleError).not.toHaveBeenCalled();

    consoleError.mockRestore();
  });
});

/**
 * #294: the limiter needs url AND token. Production shipped with only one of the
 * two, which looked identical to "not configured" — the per-instance Map ran
 * forever with nothing in the logs. These pin the three states apart.
 */
describe("rateLimit (Redis configuration, #294)", () => {
  beforeEach(() => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    vi.clearAllMocks();
    resetRateLimit();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
  });

  /** Config reports, oldest first. */
  function configReports(): string[] {
    return captureErrorMock.mock.calls
      .filter(([context]) => context === "rate-limit.config")
      .map(([, err]) => (err as Error).message);
  }

  it("names the missing half when only the URL is set, and still limits", async () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://fake.upstash.io";

    expect((await rateLimit("half", { now: 0, max: 1 })).allowed).toBe(true);
    expect((await rateLimit("half", { now: 0, max: 1 })).allowed).toBe(false);

    expect(configReports()).toHaveLength(1);
    expect(configReports()[0]).toContain("UPSTASH_REDIS_REST_TOKEN");
  });

  it("names the missing half when only the token is set", async () => {
    process.env.UPSTASH_REDIS_REST_TOKEN = "token";

    await rateLimit("half-token", { now: 0 });

    expect(configReports()).toHaveLength(1);
    expect(configReports()[0]).toContain("UPSTASH_REDIS_REST_URL");
  });

  it("reports the per-instance fallback once when production has no Redis at all", async () => {
    vi.stubEnv("NODE_ENV", "production");

    // Still limited — just per instance, which is the degradation worth naming.
    expect((await rateLimit("prod", { now: 0, max: 1 })).allowed).toBe(true);
    expect((await rateLimit("prod", { now: 0, max: 1 })).allowed).toBe(false);
    await rateLimit("other", { now: 0 });

    // Once per process, not once per request.
    expect(configReports()).toHaveLength(1);
  });

  it("stays quiet when Redis is simply absent outside production", async () => {
    vi.stubEnv("NODE_ENV", "test");

    await rateLimit("local", { now: 0 });

    expect(configReports()).toHaveLength(0);
  });
});

/** The only env contract `lib/rate-limit.ts` is allowed to depend on. */
const REDIS_ENV = ["UPSTASH_REDIS_REST_TOKEN", "UPSTASH_REDIS_REST_URL"];

/**
 * The deployment, not this repo, is what drifts: Vercel carried a Redis instance
 * whose variables no code read (#294). These keep the documented contract and the
 * read one in lockstep, so a rename cannot quietly leave either side stale.
 */
describe("rate limiting env contract (#294)", () => {
  it("reads exactly the variables .env.example documents", () => {
    const source = readFileSync(join(__dirname, "..", "lib", "rate-limit.ts"), "utf8");
    const read = [
      ...new Set(
        [...source.matchAll(/process\.env\.(UPSTASH_[A-Z0-9_]+)/g)].map(([, name]) => name)
      ),
    ].sort();

    const example = readFileSync(join(__dirname, "..", ".env.example"), "utf8");
    const documented = example
      .split("\n")
      .filter((line) => line.startsWith("UPSTASH_"))
      .map((line) => line.slice(0, line.indexOf("=")))
      .sort();

    expect(read).toEqual(REDIS_ENV);
    expect(documented).toEqual(REDIS_ENV);
  });
});

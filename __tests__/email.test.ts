import { afterEach, describe, expect, it, vi } from "vitest";
import { assertTrustedMagicLinkUrl } from "@/lib/email";

// Each case flips NODE_ENV / AUTH_URL via vi.stubEnv; unstub after every case so
// nothing leaks into the rest of the suite.
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("assertTrustedMagicLinkUrl (host poisoning — issue #168)", () => {
  it("rejects a spoofed host in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_URL", "https://stride.run");

    expect(() =>
      assertTrustedMagicLinkUrl("https://evil.example.com/api/auth/callback/email?token=abc")
    ).toThrow(/untrusted host "evil\.example\.com"/);
  });

  it("throws in production when AUTH_URL is not set", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_URL", "");

    expect(() => assertTrustedMagicLinkUrl("https://stride.run/api/auth/callback/email")).toThrow(
      /AUTH_URL must be set/
    );
  });

  it("allows a URL whose host matches AUTH_URL in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_URL", "https://stride.run");

    expect(() =>
      assertTrustedMagicLinkUrl("https://stride.run/api/auth/callback/email?token=abc")
    ).not.toThrow();
  });

  it("does not touch dev: a spoofed host passes when NODE_ENV is development", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("AUTH_URL", "");

    expect(() =>
      assertTrustedMagicLinkUrl("http://evil.example.com/api/auth/callback/email")
    ).not.toThrow();
  });
});

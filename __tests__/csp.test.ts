import { describe, expect, it } from "vitest";
import { buildCsp, createNonce } from "@/lib/csp";

// The regex Next.js itself uses to pull the nonce back out of the header. If our
// nonce doesn't match it, Next silently renders scripts without a nonce and
// 'strict-dynamic' blocks every one of them (issue #89).
const CSP_NONCE_SOURCE_REGEX = /^'nonce-([A-Za-z0-9+/_-]+={0,2})'$/;

const directive = (csp: string, name: string) =>
  csp.split("; ").find((d) => d.startsWith(name)) ?? "";
const scriptSrc = (csp: string) => directive(csp, "script-src");
const styleSrc = (csp: string) => directive(csp, "style-src");
const connectSrc = (csp: string) => directive(csp, "connect-src");

/** Mirrors Next.js' `getScriptNonceFromHeader`. */
const nonceFromCsp = (csp: string): string | undefined => {
  for (const source of scriptSrc(csp).split(/\s+/).slice(1)) {
    const match = source.trim().match(CSP_NONCE_SOURCE_REGEX);
    if (match) return match[1];
  }
};

describe("createNonce", () => {
  it("emits a nonce Next.js can parse back out of the header", () => {
    const nonce = createNonce();
    expect(nonceFromCsp(buildCsp(nonce, false))).toBe(nonce);
  });

  it("is unique per call — a reused nonce would defeat the point", () => {
    expect(createNonce()).not.toBe(createNonce());
  });
});

describe("buildCsp", () => {
  it("trusts scripts via the nonce, not unsafe-inline", () => {
    const script = scriptSrc(buildCsp("abc123", false));
    expect(script).toContain("'nonce-abc123'");
    expect(script).toContain("'strict-dynamic'");
    expect(script).not.toContain("'unsafe-inline'");
  });

  it("keeps unsafe-inline for styles so Recharts/Leaflet/Tailwind still render", () => {
    expect(styleSrc(buildCsp("n", false))).toContain("'unsafe-inline'");
  });

  it("adds unsafe-eval and ws: only in development", () => {
    const dev = buildCsp("n", true);
    expect(scriptSrc(dev)).toContain("'unsafe-eval'");
    expect(connectSrc(dev)).toContain("ws:");

    const prod = buildCsp("n", false);
    expect(scriptSrc(prod)).not.toContain("'unsafe-eval'");
    expect(connectSrc(prod)).not.toContain("ws:");
  });

  it("allowlists Strava and the AI gateway in connect-src (issue #62)", () => {
    const connect = connectSrc(buildCsp("n", false));
    expect(connect).toContain("'self'");
    expect(connect).toContain("https://www.strava.com");
    expect(connect).toContain("https://ai-gateway.vercel.sh");
  });

  it("retains the baseline directives", () => {
    const csp = buildCsp("n", false);
    for (const d of [
      "default-src 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "upgrade-insecure-requests",
    ]) {
      expect(csp).toContain(d);
    }
  });
});

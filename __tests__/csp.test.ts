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
const imgSrc = (csp: string) => directive(csp, "img-src");
const workerSrc = (csp: string) => directive(csp, "worker-src");
const childSrc = (csp: string) => directive(csp, "child-src");

/** Source tokens of a directive, so a `https://host` entry can't hide a bare `https:`. */
const sources = (directiveValue: string) => directiveValue.split(/\s+/).slice(1);

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
    // Regression guard for the nonce contract: re-adding 'self' to script-src
    // would re-open the injected-inline path that the nonce + 'strict-dynamic'
    // pair closed (#89), and the directives added in #281 must not erode it.
    const script = scriptSrc(buildCsp("abc123", false));
    expect(script).toContain("'nonce-abc123'");
    expect(script).toContain("'strict-dynamic'");
    expect(sources(script)).not.toContain("'unsafe-inline'");
    expect(sources(script)).not.toContain("'self'");
  });

  it("keeps unsafe-inline for styles so Recharts/MapLibre/Tailwind still render", () => {
    expect(styleSrc(buildCsp("n", false))).toContain("'unsafe-inline'");
  });

  it("allows the MapLibre worker from 'self' instead of relying on strict-dynamic (#281)", () => {
    // worker-src is what gates a module worker; without it the MapLibre worker
    // only loads because CSP3 engines inherit 'strict-dynamic' into it.
    for (const isDev of [false, true]) {
      const csp = buildCsp("n", isDev);
      expect(workerSrc(csp)).toBe("worker-src 'self'");
      // Pre-CSP3 engines fall back worker-src -> child-src -> script-src.
      expect(childSrc(csp)).toBe("child-src 'self'");
    }
  });

  it("adds unsafe-eval and ws: only in development", () => {
    const dev = buildCsp("n", true);
    expect(scriptSrc(dev)).toContain("'unsafe-eval'");
    expect(connectSrc(dev)).toContain("ws:");

    const prod = buildCsp("n", false);
    expect(scriptSrc(prod)).not.toContain("'unsafe-eval'");
    expect(connectSrc(prod)).not.toContain("ws:");
  });

  it("allowlists Strava and the map tiles in connect-src (issue #62)", () => {
    const connect = connectSrc(buildCsp("n", false));
    expect(connect).toContain("'self'");
    expect(connect).toContain("https://www.strava.com");
    expect(connect).toContain("https://tiles.openfreemap.org");
  });

  it("no longer allowlists the AI gateway — the browser streams from no model (#292)", () => {
    expect(connectSrc(buildCsp("n", false))).not.toContain("ai-gateway.vercel.sh");
  });

  it("narrows img-src to the tile host — no blanket https: wildcard (issue #281)", () => {
    const img = sources(imgSrc(buildCsp("n", false)));
    expect(img).toContain("https://tiles.openfreemap.org");
    expect(img).toContain("'self'");
    // Assert on tokens, not substrings: the tile host is itself an https source.
    expect(img).not.toContain("https:");
    expect(img).not.toContain("http:");
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

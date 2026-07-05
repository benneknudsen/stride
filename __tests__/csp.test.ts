import { describe, expect, it } from "vitest";
import { buildCsp } from "@/lib/csp";

const scriptSrc = (csp: string) => csp.split("; ").find((d) => d.startsWith("script-src")) ?? "";
const styleSrc = (csp: string) => csp.split("; ").find((d) => d.startsWith("style-src")) ?? "";
const connectSrc = (csp: string) => csp.split("; ").find((d) => d.startsWith("connect-src")) ?? "";

describe("buildCsp", () => {
  it("puts the nonce and strict-dynamic in script-src", () => {
    const csp = buildCsp("abc123", false);
    expect(scriptSrc(csp)).toContain("'nonce-abc123'");
    expect(scriptSrc(csp)).toContain("'strict-dynamic'");
  });

  it("does NOT allow unsafe-inline scripts (the whole point of the nonce)", () => {
    expect(scriptSrc(buildCsp("n", false))).not.toContain("'unsafe-inline'");
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
    for (const directive of [
      "default-src 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "upgrade-insecure-requests",
    ]) {
      expect(csp).toContain(directive);
    }
  });
});

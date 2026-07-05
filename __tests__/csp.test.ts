import { describe, expect, it } from "vitest";
import { buildCsp } from "@/lib/csp";

const scriptSrc = (csp: string) => csp.split("; ").find((d) => d.startsWith("script-src")) ?? "";
const styleSrc = (csp: string) => csp.split("; ").find((d) => d.startsWith("style-src")) ?? "";
const connectSrc = (csp: string) => csp.split("; ").find((d) => d.startsWith("connect-src")) ?? "";

describe("buildCsp", () => {
  it("uses unsafe-inline in script-src (RSC navigation compat)", () => {
    const csp = buildCsp("abc123", false);
    expect(scriptSrc(csp)).toContain("'unsafe-inline'");
    expect(scriptSrc(csp)).not.toContain("'nonce-'");
    expect(scriptSrc(csp)).not.toContain("'strict-dynamic'");
  });

  it("allows unsafe-inline scripts for RSC navigation compatibility", () => {
    expect(scriptSrc(buildCsp("n", false))).toContain("'unsafe-inline'");
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

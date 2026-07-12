import { describe, expect, it } from "vitest";
import { isAllowedCallbackUrl } from "@/lib/garmin/config";

/**
 * A Garmin ping notification names the URL we should fetch the summaries from —
 * in the *request body* — and that fetch carries the athlete's live OAuth bearer
 * token. Without an allowlist the webhook is an SSRF primitive that hands a
 * working Garmin credential to whatever host an attacker puts in the payload.
 *
 * These pin the guard, including the near-misses a sloppier check would wave
 * through.
 */

describe("isAllowedCallbackUrl", () => {
  it("accepts Garmin's own API hosts over https", () => {
    expect(
      isAllowedCallbackUrl("https://apis.garmin.com/wellness-api/rest/activities?uploadStart=1")
    ).toBe(true);
    expect(isAllowedCallbackUrl("https://healthapi.garmin.com/wellness-api/rest/activities")).toBe(
      true
    );
  });

  it("rejects an outright attacker host", () => {
    expect(isAllowedCallbackUrl("https://evil.tld/collect")).toBe(false);
  });

  it("rejects a suffix-match impostor — the classic endsWith() bypass", () => {
    expect(isAllowedCallbackUrl("https://apis.garmin.com.evil.tld/collect")).toBe(false);
    expect(isAllowedCallbackUrl("https://notapis.garmin.com/collect")).toBe(false);
  });

  it("rejects a host smuggled into userinfo or a subdomain", () => {
    // `new URL()` parses the hostname as evil.tld — a naive `includes()` check
    // on the raw string would see "apis.garmin.com" and pass it.
    expect(isAllowedCallbackUrl("https://apis.garmin.com@evil.tld/collect")).toBe(false);
    expect(isAllowedCallbackUrl("https://evil.tld/?x=apis.garmin.com")).toBe(false);
  });

  it("rejects plaintext http, which would put the bearer token on the wire", () => {
    expect(isAllowedCallbackUrl("http://apis.garmin.com/wellness-api/rest/activities")).toBe(false);
  });

  it("rejects non-http schemes and internal targets used for SSRF pivots", () => {
    expect(isAllowedCallbackUrl("file:///etc/passwd")).toBe(false);
    expect(isAllowedCallbackUrl("http://169.254.169.254/latest/meta-data/")).toBe(false);
    expect(isAllowedCallbackUrl("https://localhost/admin")).toBe(false);
  });

  it("rejects garbage rather than throwing", () => {
    expect(isAllowedCallbackUrl("")).toBe(false);
    expect(isAllowedCallbackUrl("not a url")).toBe(false);
  });
});

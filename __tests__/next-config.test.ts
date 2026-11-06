import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";

const remotePatterns = nextConfig.images?.remotePatterns ?? [];
const hostnames = remotePatterns.map((pattern) => pattern.hostname);

describe("next.config images.remotePatterns", () => {
  // #358: a `*.cloudfront.net` wildcard turns /_next/image into an open proxy
  // for every CloudFront distribution. Only Strava's known avatar CDN belongs.
  it("does not allowlist a CloudFront wildcard", () => {
    const cloudfrontWildcards = hostnames.filter(
      (hostname) => hostname.includes("*") && hostname.includes("cloudfront")
    );

    expect(cloudfrontWildcards).toEqual([]);
  });

  it("allows Strava's concrete avatar CloudFront host", () => {
    expect(hostnames).toContain("dgtbsa32eaptv.cloudfront.net");
  });

  it("keeps the other Strava and Facebook avatar hosts", () => {
    expect(hostnames).toContain("*.strava.com");
    expect(hostnames).toContain("graph.facebook.com");
  });
});

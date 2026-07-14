import { describe, expect, it } from "vitest";
import OpengraphImage, { alt, contentType, size } from "@/app/opengraph-image";

describe("opengraph-image", () => {
  it("declares the standard social-card contract", () => {
    expect(size).toEqual({ width: 1200, height: 630 });
    expect(contentType).toBe("image/png");
    expect(alt).toContain("Stride");
  });

  // Exercises the whole route — Google Fonts fetch, satori layout, PNG encode —
  // so a broken font URL or invalid flex layout fails here instead of at build.
  // Needs network (same as the build-time prerender of this route).
  it("renders a PNG without crashing", async () => {
    const response = await OpengraphImage();
    expect(response.headers.get("content-type")).toBe("image/png");

    const bytes = new Uint8Array(await response.arrayBuffer());
    const pngMagic = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    expect(Array.from(bytes.slice(0, 8))).toEqual(pngMagic);
  }, 30_000);
});

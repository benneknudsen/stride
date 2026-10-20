import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

// Review B1/N1/N2/N4: the login CTA affordances are pure CSS contracts with no
// test guard. The reviewer could delete the `aria-disabled` exception from the
// cursor rule, or restore the old white sheen on the Strava button, and every
// existing test stayed green. This file reads app/globals.css (the
// FlipText.test.ts / cg-label.test.ts pattern) and pins the contracts:
//
// 1. the base cursor rule covers exactly `button` / `[role="button"]` /
//    `summary` while enabled and not aria-disabled, leaves plain links to the
//    UA stylesheet, and makes `[aria-disabled="true"]` an explicit default;
// 2. `cg-cta`'s motion lives in `@variant motion-safe`, and globals.css keeps
//    exactly one raw `prefers-reduced-motion: no-preference` block (FlipText's);
// 3. the sheen never lowers the label contrast per tone (B1);
// 4. the two transition declarations the CTAs pick up agree (N3).

const ROOT = join(__dirname, "..", "..");
const GLOBALS = readFileSync(join(ROOT, "app", "globals.css"), "utf8");

/** Every block whose text starts at `marker`, brace-matched and inclusive. */
function blocks(css: string, marker: string): string[] {
  const found: string[] = [];
  let from = 0;
  for (;;) {
    const at = css.indexOf(marker, from);
    if (at === -1) return found;
    const open = css.indexOf("{", at);
    let depth = 0;
    let end = -1;
    for (let i = open; i < css.length && end === -1; i++) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}" && --depth === 0) end = i;
    }
    if (end === -1) throw new Error(`block never closed: ${marker}`);
    found.push(css.slice(at, end + 1));
    from = end + 1;
  }
}

/** The first block starting at `marker`; throws when the marker is gone. */
function block(css: string, marker: string): string {
  const found = blocks(css, marker)[0];
  if (found === undefined) throw new Error(`block not found: ${marker}`);
  return found;
}

describe("the base cursor rule covers real controls only (N1/N2/N6)", () => {
  const base = block(GLOBALS, "@layer base");
  const pointerRule = block(base, "button:not(:disabled)");

  test("enabled buttons and role=buttons get the pointer; disabled ones do not", () => {
    expect(pointerRule).toContain('button:not(:disabled):not([aria-disabled="true"])');
    expect(pointerRule).toContain('[role="button"]:not(:disabled):not([aria-disabled="true"])');
    expect(pointerRule).toContain("summary");
    expect(pointerRule).toContain("cursor: pointer");
  });

  test("plain links stay out of the rule — the UA stylesheet gives them the pointer", () => {
    expect(pointerRule).not.toContain("a[href]");
  });

  test("aria-disabled is an explicit cursor: default, overriding the UA link pointer", () => {
    expect(base).toMatch(/\[aria-disabled="true"\]\s*\{\s*cursor:\s*default;?\s*\}/);
  });
});

describe("cg-cta motion is gated by @variant motion-safe (#306 contract)", () => {
  const rawNoPreference = blocks(GLOBALS, "@media (prefers-reduced-motion: no-preference)");
  const cta = block(GLOBALS, "@utility cg-cta {");

  test("globals.css keeps exactly one raw no-preference block — FlipText's", () => {
    expect(rawNoPreference).toHaveLength(1);
    expect(rawNoPreference[0]).toContain(".cg-flip-char");
  });

  test("the lift, glow and sheen live inside @variant motion-safe, not a raw media query", () => {
    expect(cta).toMatch(/@variant motion-safe\s*\{/);
    expect(cta).not.toContain("@media (prefers-reduced-motion: no-preference)");
    expect(cta).toMatch(/&:hover:not\(:disabled\):not\(\[aria-disabled="true"\]\):not\(:active\)/);
    expect(cta).toMatch(/animation:\s*cg-cta-sheen 640ms ease-out/);
  });

  test("cg-cta and cg-interactive declare the same transition timing (N3)", () => {
    const interactive = block(GLOBALS, "@utility cg-interactive {");
    const timing = /transition:\s*transform 150ms ease,\s*box-shadow 150ms ease/;
    expect(cta).toMatch(timing);
    expect(interactive).toMatch(timing);
  });
});

// B1: the sheen sits under the label but over the button background, so the
// sweep still tints the pixels behind the text. The tint is picked per tone so
// the label contrast rises (Strava) or dips only negligibly (cobalt). These
// tests compute the WCAG 2.x contrast from the values actually in globals.css,
// so changing a sheen's colour or alpha re-runs the measurement.
describe("the sheen never lowers the label contrast per tone (B1)", () => {
  type RGB = [number, number, number];

  const channel = (value: number): number => {
    const s = value / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const luminance = ([r, g, b]: RGB): number =>
    0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  const contrast = (a: RGB, b: RGB): number => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  const blend = (over: RGB, alpha: number, under: RGB): RGB => [
    over[0] * alpha + under[0] * (1 - alpha),
    over[1] * alpha + under[1] * (1 - alpha),
    over[2] * alpha + under[2] * (1 - alpha),
  ];
  const hex = (name: string): RGB => {
    const match = GLOBALS.match(new RegExp(`--color-${name}:\\s*#([0-9a-fA-F]{6})`));
    const value = match?.[1];
    if (value === undefined) throw new Error(`--color-${name} not found`);
    return [0, 2, 4].map((i) => Number.parseInt(value.slice(i, i + 2), 16)) as RGB;
  };
  const sheen = (variant: string): { tint: RGB; alpha: number } => {
    const body = blocks(GLOBALS, `@utility ${variant} {`)[0];
    const match = body?.match(
      /--cg-cta-sheen:\s*rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*\/\s*([\d.]+)\s*\)/
    );
    if (!match) throw new Error(`${variant} has no rgb()/alpha --cg-cta-sheen`);
    return {
      tint: [Number(match[1]), Number(match[2]), Number(match[3])],
      alpha: Number(match[4]),
    };
  };

  const white: RGB = [255, 255, 255];

  test("Strava: the dark tint raises white-on-#fc4c02 through the sweep peak", () => {
    const background = hex("strava");
    const rest = contrast(white, background);
    const { tint, alpha } = sheen("cg-cta-strava");
    const peak = contrast(white, blend(tint, alpha, background));

    // The rest state is the pre-existing AA miss (3.40:1 on Strava's official
    // orange); the sheen must only ever push it up, never down.
    expect(rest).toBeCloseTo(3.4, 1);
    expect(peak).toBeGreaterThanOrEqual(rest);
    expect(peak).toBeGreaterThanOrEqual(4.5);
  });

  test("cobalt: the tint's dip stays bounded and far above AA", () => {
    // The demo CTA stacks bg-white/70 over the card's bg-white/60 over the
    // silver page (app/(auth)/login/page.tsx + --color-silver).
    const stack = blend(white, 0.7, blend(white, 0.6, hex("silver")));
    const text = hex("cobalt");
    const rest = contrast(text, stack);
    const { tint, alpha } = sheen("cg-cta-cobalt");
    const peak = contrast(text, blend(tint, alpha, stack));

    // The accepted dip: text-cobalt measures 9.7:1 at rest and stays ≥ 4.5:1
    // through the sweep, costing under 2 points.
    expect(rest).toBeCloseTo(9.7, 0);
    expect(peak).toBeGreaterThanOrEqual(4.5);
    expect(rest - peak).toBeLessThanOrEqual(2);
  });
});

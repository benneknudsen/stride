import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// User feedback round: the glass edge was inconsistent across the five surface
// variants (white cards carried a near-edge + inset seat, red/cobalt carried
// only one soft layer) and the white-card edge was too harsh (0.45 near-edge
// alpha + 0.28 seat). The fix gives every variant the same three shadow roles
// in its own tone — ambient (0 8px 32px), near-edge (0 2px 5px), seat
// (inset 0 -2px 2px) — with only the alphas differing. The nav pill and demo
// banner got their own shadow vars in the follow-up: their denser veils
// (0.64/0.68 vs the cards' 0.42) need a lighter ambient to keep the boundary
// step at or below the old recipe's on blob-tinted backdrops. These tests read
// app/globals.css from disk and pin that structure so an inconsistent or
// harsh edge cannot come back unnoticed.

const ROOT = join(__dirname, "..", "..");
const GLOBALS = readFileSync(join(ROOT, "app", "globals.css"), "utf8");

const SHADOW_VARS = [
  "--cg-glass-shadow",
  "--cg-glass-shadow-nav",
  "--cg-glass-shadow-banner",
  "--cg-glass-shadow-red",
  "--cg-glass-shadow-cobalt",
];

/** Each glass utility must reference exactly its own shared shadow var. */
const UTILITY_SHADOWS: Record<string, string> = {
  "cg-glass": "var(--cg-glass-shadow)",
  "cg-glass-nav": "var(--cg-glass-shadow-nav)",
  "cg-glass-banner": "var(--cg-glass-shadow-banner)",
  "cg-glass-red": "var(--cg-glass-shadow-red)",
  "cg-glass-cobalt": "var(--cg-glass-shadow-cobalt)",
};

/** The role signature every glass shadow must resolve to, in order. */
const EXPECTED_ROLES = ["0 8px 32px", "0 2px 5px", "inset 0 -2px 2px"];

/** Extract a custom-property declaration value by name. */
function varValue(css: string, name: string): string {
  const match = css.match(new RegExp(`${name}:\\s*([^;]+);`));
  if (!match) throw new Error(`${name} not declared`);
  return match[1].replace(/\s+/g, " ").trim();
}

interface ShadowLayer {
  inset: boolean;
  geometry: string;
  color: string;
  alpha: number;
}

/** Split a box-shadow value into layers (commas inside rgba() don't count). */
function shadowLayers(value: string): ShadowLayer[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of value) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts.map((part) => {
    const text = part.trim();
    const colorMatch = text.match(/rgba?\(([^)]*)\)/);
    const geometry = text
      .replace(/\binset\b/, "")
      .replace(/rgba?\([^)]*\)/, "")
      .trim()
      .split(/\s+/)
      .join(" ");
    const numbers = colorMatch ? colorMatch[1].split(/[,\s/]+/).map(Number) : [];
    return {
      inset: /\binset\b/.test(text),
      geometry,
      color: colorMatch?.[0] ?? "",
      alpha: numbers.length === 4 ? numbers[3] : 1,
    };
  });
}

/** Extract the body of a single `@utility <name> { … }` block. */
function utilityBody(css: string, name: string): string {
  const start = css.indexOf(`@utility ${name} {`);
  if (start === -1) throw new Error(`@utility ${name} not found`);
  let depth = 0;
  for (let i = css.indexOf("{", start); i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) {
      return css.slice(css.indexOf("{", start) + 1, i);
    }
  }
  throw new Error(`@utility ${name} block never closed`);
}

describe("glass edge — uniform three-role shadow structure", () => {
  it("declares all three shadow vars with the same layer count and geometry", () => {
    const signatures = SHADOW_VARS.map((name) =>
      shadowLayers(varValue(GLOBALS, name))
        .map((layer) => `${layer.inset ? "inset " : ""}${layer.geometry}`)
        .join(" | ")
    );
    for (const signature of signatures) {
      expect(signature).toBe(EXPECTED_ROLES.join(" | "));
    }
  });

  it("keeps the edge subtle: near-edge alpha ≤ 0.3, seat alpha ≤ 0.2, both present", () => {
    for (const name of SHADOW_VARS) {
      const [, nearEdge, seat] = shadowLayers(varValue(GLOBALS, name));
      expect(nearEdge.geometry).toBe("0 2px 5px");
      expect(seat.geometry).toBe("0 -2px 2px");
      expect(seat.inset).toBe(true);
      expect(nearEdge.alpha).toBeGreaterThan(0.05);
      expect(nearEdge.alpha).toBeLessThanOrEqual(0.3);
      expect(seat.alpha).toBeGreaterThan(0.05);
      expect(seat.alpha).toBeLessThanOrEqual(0.2);
    }
  });

  it("draws every layer in the variant's own cobalt or red tone — never white", () => {
    for (const name of SHADOW_VARS) {
      for (const layer of shadowLayers(varValue(GLOBALS, name))) {
        expect(layer.color).toMatch(/^rgba\((27, 41, 192|238, 36, 24), [\d.]+\)$/);
      }
    }
  });
});

describe("glass edge — utilities stay on the shared shadow vars", () => {
  it.each(
    Object.entries(UTILITY_SHADOWS)
  )("%s resolves exactly %s and nothing else", (name, expected) => {
    const body = utilityBody(GLOBALS, name);
    const shadowValues = [...body.matchAll(/box-shadow:\s*([^;]+);/g)].map((m) =>
      m[1].replace(/\s+/g, " ").trim()
    );
    expect(shadowValues).toEqual([expected]);
  });
});

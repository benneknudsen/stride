import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Issue #166 — the repeated Spline-Mono kicker treatment
// (`font-cg-mono text-[…] uppercase tracking-[…] text-…`) was consolidated into
// the `cg-label` / `cg-label-sm` utilities in app/globals.css. These tests pin
// the utility definitions and guard against the canonical pattern creeping back
// into the component tree as a raw string.

const ROOT = join(__dirname, "..", "..");
const GLOBALS = readFileSync(join(ROOT, "app", "globals.css"), "utf8");

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

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsxFiles(full));
    else if (entry.endsWith(".tsx")) out.push(full);
  }
  return out;
}

describe("cg-label utility", () => {
  it("defines cg-label with the modal mono-label geometry and Ink color", () => {
    const body = utilityBody(GLOBALS, "cg-label");
    expect(body).toContain("font-family: var(--font-cg-mono)");
    expect(body).toContain("font-size: 10px");
    expect(body).toContain("text-transform: uppercase");
    expect(body).toContain("letter-spacing: 0.14em");
    expect(body).toContain("color: var(--color-ink)");
  });

  it("defines cg-label-sm as the 9.5px variant, otherwise identical", () => {
    const body = utilityBody(GLOBALS, "cg-label-sm");
    expect(body).toContain("font-family: var(--font-cg-mono)");
    expect(body).toContain("font-size: 9.5px");
    expect(body).toContain("text-transform: uppercase");
    expect(body).toContain("letter-spacing: 0.14em");
    expect(body).toContain("color: var(--color-ink)");
  });
});

describe("cg-label adoption", () => {
  const files = [...tsxFiles(join(ROOT, "components")), ...tsxFiles(join(ROOT, "app"))];

  // The exact strings the utility replaces — these must never reappear verbatim.
  const bannedPatterns = [
    "font-cg-mono text-[10px] uppercase tracking-[0.14em] text-ink",
    "font-cg-mono text-[9.5px] uppercase tracking-[0.14em] text-ink",
  ];

  it.each(bannedPatterns)("no component still hardcodes %s", (pattern) => {
    const offenders = files.filter((f) => readFileSync(f, "utf8").includes(pattern));
    expect(offenders).toEqual([]);
  });

  it("cg-label is actually adopted somewhere in the cobalt components", () => {
    const usesLabel = files.some((f) => {
      const src = readFileSync(f, "utf8");
      return /\bcg-label(-sm)?\b/.test(src);
    });
    expect(usesLabel).toBe(true);
  });
});

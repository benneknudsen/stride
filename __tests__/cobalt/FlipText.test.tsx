/** @vitest-environment jsdom */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { FlipText } from "@/components/cobalt/FlipText";

// Issue #306: the login heading adopts ObsidianUI's Flip Text (MIT) as a local
// component. The registry source has no reduced-motion handling and no screen
// reader story, so these tests pin the three contracts the issue names: one
// accessible string, the animated characters hidden from the accessibility
// tree, and a deterministic server render. The reduced-motion guarantee is a
// CSS contract — the flip keyframes only run inside a
// `prefers-reduced-motion: no-preference` media query in app/globals.css — so
// that test reads the file, matching the cg-label.test.ts pattern.

const ROOT = join(__dirname, "..", "..");
const GLOBALS = readFileSync(join(ROOT, "app", "globals.css"), "utf8");

/** Extract the body of an `@media (…)` block, brace-matched. */
function mediaBody(css: string, query: string): string {
  const start = css.indexOf(`@media (${query})`);
  if (start === -1) throw new Error(`@media (${query}) not found`);
  const open = css.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) {
      return css.slice(open + 1, i);
    }
  }
  throw new Error(`@media (${query}) block never closed`);
}

describe("FlipText — one accessible string (#306)", () => {
  test("every animated character is hidden from assistive tech", () => {
    const { container } = render(<FlipText>Log ind</FlipText>);

    const chars = container.querySelectorAll("[data-char]");
    expect(chars.length).toBe("Log ind".replace(" ", "").length);
    for (const char of chars) {
      expect(char.closest('[aria-hidden="true"]')).not.toBeNull();
    }
  });

  test("the heading exposes the title as one string, not one span per character", () => {
    render(
      <h1>
        <FlipText>Log ind</FlipText>
      </h1>
    );

    const heading = screen.getByRole("heading", { level: 1, name: "Log ind" });
    // Exactly one element inside the heading carries the full title; the split
    // character spans contribute no text to the accessibility tree.
    expect(within(heading).getByText("Log ind")).toBeTruthy();
  });
});

describe("FlipText — SSR determinism (#306)", () => {
  test("the server render is byte-identical run to run", () => {
    const first = renderToStaticMarkup(<FlipText>Log ind</FlipText>);
    const second = renderToStaticMarkup(<FlipText>Log ind</FlipText>);
    expect(first).toBe(second);
  });

  test("character delays are quantised to 2 decimals", () => {
    // Math.sin is only spec'd as implementation-approximated, so raw products
    // can differ in the last ULP between the Node engine and a browser engine.
    // Quantising keeps the inline styles — and with them the SSR output and
    // the hydrated markup — identical everywhere.
    const html = renderToStaticMarkup(<FlipText>Log ind</FlipText>);

    const delays = [...html.matchAll(/--flip-delay:([^;"]+)/g)].map((match) => match[1]);
    expect(delays.length).toBe("Log ind".replace(" ", "").length);
    for (const delay of delays) {
      expect(delay).toMatch(/^\d+\.\d{2}s$/);
    }
  });
});

// Issue #317: the same component now carries every page-title flip, and a title
// can be arbitrarily long (an activity name is user data). Two additions make
// that safe: `\n` in the string becomes a real line break between the animated
// lines, and `maxTotalDuration` caps delay + stagger + duration so the whole
// flip finishes on schedule no matter how long the string is.
describe("FlipText — bounded flip for long titles (#317)", () => {
  const delayList = (html: string): number[] =>
    [...html.matchAll(/--flip-delay:([\d.]+)s/g)].map((match) => Number(match[1]));

  test("a cap bounds the last character's delay and the flip's end", () => {
    const LONG = "Morgenløb langs åen i Silkeborg";
    const html = renderToStaticMarkup(
      <FlipText duration={1.2} maxTotalDuration={1.4}>
        {LONG}
      </FlipText>
    );

    const delays = delayList(html);
    expect(delays).toHaveLength(LONG.replaceAll(" ", "").length);
    // The cap leaves 1.4 − 1.2 = 0.2 s for the stagger; nothing starts later.
    expect(Math.max(...delays)).toBeLessThanOrEqual(0.2);
  });

  test("without a cap the source's sine pacing is unchanged", () => {
    // Regression pin for the login flip (#306): its stagger must keep the
    // ported sine spread, which reaches ~0.54 s with the 2.2 s default.
    const delays = delayList(renderToStaticMarkup(<FlipText>Log ind</FlipText>));
    expect(Math.max(...delays)).toBeGreaterThan(0.5);
  });

  test("a newline renders a real line break and is not animated as a character", () => {
    const { container } = render(<FlipText>{"Alle dine ture,\nsamlet ét sted."}</FlipText>);

    const hidden = container.querySelector('[aria-hidden="true"]');
    expect(hidden?.querySelectorAll("br")).toHaveLength(1);
    // The newline itself must not sit inside a character span — every animated
    // span is a single glyph.
    expect(hidden?.textContent).not.toContain("\n");
  });

  test("the accessible name stays one string across the line break", () => {
    render(
      <h1>
        <FlipText>{"Alle dine ture,\nsamlet ét sted."}</FlipText>
      </h1>
    );

    expect(
      screen.getByRole("heading", { level: 1, name: "Alle dine ture, samlet ét sted." })
    ).toBeTruthy();
  });
});

describe("FlipText — reduced motion is CSS-gated (#306)", () => {
  const NO_PREFERENCE = "prefers-reduced-motion: no-preference";

  test("the flip animation only runs under prefers-reduced-motion: no-preference", () => {
    const body = mediaBody(GLOBALS, NO_PREFERENCE);
    expect(body).toContain(".cg-flip-char");
    expect(body).toMatch(/animation:\s*cg-flip\s/);
    expect(body).toMatch(/animation:\s*cg-flip-fade\s/);
  });

  test("no flip animation clause exists outside that media query", () => {
    const outside = GLOBALS.replace(mediaBody(GLOBALS, NO_PREFERENCE), "");
    expect(outside).not.toMatch(/animation:\s*cg-flip\s/);
    expect(outside).not.toMatch(/animation:\s*cg-flip-fade\s/);
  });

  test("while paused, the static front face shows and the back face stays hidden", () => {
    // .cg-flip-char text is transparent; the visible glyph is the ::after face.
    expect(GLOBALS).toMatch(/\.cg-flip-char\s*\{[^}]*text-fill-color:\s*transparent/);
    expect(GLOBALS).toMatch(/\.cg-flip-char::after\s*\{[^}]*translateZ\(0\.6em\)/);
    expect(GLOBALS).toMatch(/\.cg-flip-char::before\s*\{[^}]*opacity:\s*0/);
  });
});

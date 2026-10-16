/** @vitest-environment jsdom */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, render, screen, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { FlipText } from "@/components/cobalt/FlipText";
import { TITLE_FLIP } from "@/lib/cobalt/flip";

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

const delayList = (html: string): number[] =>
  [...html.matchAll(/--flip-delay:([\d.]+)s/g)].map((match) => Number(match[1]));

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

// Issue #323: the 1.2 s preset was too fast to register ("man når næsten ikke at
// se det"). The tempo is now 2.2 s per character cycle, and the cap arithmetic
// in `staggerSpread` is re-derived for it: spread = min(duration × 0.25, cap −
// delay − duration), floored at zero, so no character delay can go negative and
// the run still ends inside the cap.
describe("FlipText — the entrance tempo reads (#323)", () => {
  test("the preset is slower, readable early in the run, and inside its cap", () => {
    // A 40-character title — the length the #317 comment budgeted for.
    const LONG = "Morgenløb langs åen i Silkeborg bymidten";
    expect(LONG).toHaveLength(40);
    const html = renderToStaticMarkup(<FlipText {...TITLE_FLIP}>{LONG}</FlipText>);
    const delays = delayList(html);

    // The issue's suggested tempo band, with "overdriv ikke" as the lower bar.
    expect(TITLE_FLIP.duration).toBeGreaterThanOrEqual(2);
    expect(TITLE_FLIP.duration).toBeLessThanOrEqual(2.4);

    const lastStart = Math.max(...delays);
    // The sine pacing runs over the normalised character index, so the last
    // character of a 40-character title starts at ~0.999 × spread.
    expect(lastStart).toBeLessThanOrEqual(TITLE_FLIP.duration * 0.25 + 0.01);
    // The last character's face-swap completes at 30 % of its cycle (the
    // cg-flip-fade keyframes): past that moment the title is fully readable,
    // and the whole entrance must land well before the run ends.
    expect(lastStart + TITLE_FLIP.duration * 0.3).toBeLessThan(1.5);
    // The run — last delay + one full cycle — ends inside the cap.
    expect(lastStart + TITLE_FLIP.duration).toBeLessThanOrEqual(TITLE_FLIP.maxTotalDuration);
    // And the cap leaves room for the whole sine spread (0.25 × duration), so
    // it never silently clamps the stagger.
    expect(TITLE_FLIP.maxTotalDuration).toBeGreaterThanOrEqual(TITLE_FLIP.duration * 1.25);
  });

  test("a cap that cannot fit the stagger floors every delay at zero", () => {
    const html = renderToStaticMarkup(
      <FlipText duration={2} maxTotalDuration={1.5}>
        Log ind
      </FlipText>
    );

    const delays = delayList(html);
    expect(delays.length).toBeGreaterThan(0);
    expect(Math.min(...delays)).toBe(0);
    expect(Math.max(...delays)).toBe(0);
  });
});

// Issue #323: the Hjem hero swaps its greeting placeholder for the real,
// local-clock greeting in an effect right after mount (#134). Every text swap
// used to remount every character span — the running flip restarted from zero
// mid-entrance, which a multi-second tempo makes visible. A swap that arrives
// while the entrance is still running now rides the same run: the existing
// character nodes (and their running CSS animations) stay, and the new glyphs
// appear in place. Once the entrance is over, a swap is a new run again.
describe("FlipText — a mid-entrance text swap rides the same run (#323)", () => {
  test("the greeting swap keeps every character node and its delay", () => {
    const swap = (greeting: string) => <FlipText {...TITLE_FLIP}>{`${greeting}, Benne.`}</FlipText>;
    const { container, rerender } = render(swap("Goddag"));
    const charsBefore = [...container.querySelectorAll<HTMLElement>(".cg-flip-char")];
    const delaysBefore = charsBefore.map((char) => char.style.getPropertyValue("--flip-delay"));
    expect(charsBefore.length).toBeGreaterThan(0);

    rerender(swap("Godaften"));

    // Same nodes, same delays: the animation properties of the running flip are
    // untouched, so the browser cannot restart it. A remount (the old behavior)
    // would leave the "before" nodes detached from the document.
    for (const char of charsBefore) expect(container.contains(char)).toBe(true);
    expect(charsBefore.map((char) => char.style.getPropertyValue("--flip-delay"))).toEqual(
      delaysBefore
    );
    // The heading now reads the new greeting as one string.
    expect(container.querySelector(".sr-only")?.textContent).toBe("Godaften, Benne.");
    // The two characters "Godaften" adds joined the same run with real delays.
    const charsAfter = [...container.querySelectorAll<HTMLElement>(".cg-flip-char")];
    expect(charsAfter.length).toBe(charsBefore.length + 2);
    for (const char of charsAfter) {
      expect(char.style.getPropertyValue("--flip-delay")).toMatch(/^\d+\.\d{2}s$/);
    }
  });

  test("a swap after the entrance is done starts a fresh run", () => {
    vi.useFakeTimers();
    try {
      const { container, rerender } = render(<FlipText {...TITLE_FLIP}>Morgenløb</FlipText>);
      const before = container.querySelector<HTMLElement>(".cg-flip-char");
      expect(before).not.toBeNull();

      // Past delay + stagger + duration for the preset (0 + 0.55 + 2.2 s).
      act(() => {
        vi.advanceTimersByTime(4000);
      });
      rerender(<FlipText {...TITLE_FLIP}>Aftentur</FlipText>);

      expect(container.querySelector(".cg-flip-char")).not.toBe(before);
      expect(container.contains(before as HTMLElement)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
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

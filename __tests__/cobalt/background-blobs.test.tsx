/** @vitest-environment jsdom */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import AuthLayout from "@/app/(auth)/layout";
import { BackgroundBlobs } from "@/components/cobalt/BackgroundBlobs";

// Issue #344: the ambient background used to be a `position: fixed` layer that
// had to keep itself synchronised with the viewport, so it desynced from the
// page whenever mobile browsers resized or offset the viewport (URL bar,
// rubber-band, dynamic dvh) and split into a hard-edged band. The fix is
// structural: the layer becomes document-bound (`absolute inset-0` inside the
// shell that is already `relative min-h-screen`), paints its own silver base,
// and `html, body` refuse to scroll past the page (overscroll-behavior-y).
// These tests pin the structural contracts; the pixel probe lives in /tmp and
// is never committed.
//
// jsdom has no matchMedia; Motion reads it at render time (as in
// auth-backdrop.test.tsx).
if (typeof window.matchMedia !== "function") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

const ROOT = join(__dirname, "..", "..");
const APP_LAYOUT = readFileSync(join(ROOT, "app", "(app)", "layout.tsx"), "utf8");
const AUTH_LAYOUT = readFileSync(join(ROOT, "app", "(auth)", "layout.tsx"), "utf8");
const GLOBALS = readFileSync(join(ROOT, "app", "globals.css"), "utf8");

/** The BackgroundBlobs layer: the aria-hidden div whose children are exactly
 *  the three drift blobs. AuthBackdrop's container is also aria-hidden, but
 *  holds four motion divs carrying data-chip, so the shapes never collide. */
function blobLayer(container?: HTMLElement | Document): HTMLElement {
  const scope = (container ?? document).querySelectorAll<HTMLElement>("div[aria-hidden='true']");
  const layer = [...scope].find(
    (el) =>
      el.children.length === 3 &&
      [...el.children].every((child) => child.className.includes("rounded-full"))
  );
  if (!layer) throw new Error("BackgroundBlobs layer not found");
  return layer;
}

/** Every block whose text starts at `marker`, brace-matched and inclusive
 *  (the cta-affordances.test.tsx helper, for reading globals.css rules). */
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

/** True when `needle` appears inside the JSX element whose opening tag carries
 *  `shellMarker` — walking real <div> open/close tokens between the two
 *  positions (self-closing tags count once). The sources are Biome-formatted,
 *  so the token scan is stable. */
function mountedInsideShell(src: string, shellMarker: string, needle: string): boolean {
  const shellAt = src.indexOf(shellMarker);
  const shellOpen = src.indexOf(">", shellAt);
  const needleAt = src.indexOf(needle, shellOpen + 1);
  if (shellAt === -1 || shellOpen === -1 || needleAt === -1) return false;
  let depth = 1;
  const span = src.slice(shellOpen + 1, needleAt);
  for (const match of span.matchAll(/<\/?div\b/g)) {
    const tagStart = shellOpen + 1 + (match.index ?? 0);
    const tagEnd = src.indexOf(">", tagStart);
    if (src.slice(tagStart, tagEnd + 1).endsWith("/>")) continue;
    depth += match[0].startsWith("</") ? -1 : 1;
  }
  return depth >= 1;
}

describe("BackgroundBlobs layer (#344)", () => {
  it("binds the layer to the document, not the viewport", () => {
    const { container } = render(<BackgroundBlobs />);
    const layer = blobLayer(container);
    expect(layer.className).toContain("absolute");
    expect(layer.className).toContain("inset-0");
    expect(layer.className).not.toContain("fixed");
    expect(layer.className).not.toContain("h-screen");
    expect(layer.className).not.toContain("100dvh");
  });

  it("paints its own silver base so no underlay can shine through", () => {
    const { container } = render(<BackgroundBlobs />);
    expect(blobLayer(container).style.backgroundColor).toBe("var(--color-silver)");
  });

  it("keeps the decorative contract: aria-hidden, non-interactive, unclipped blobs", () => {
    const { container } = render(<BackgroundBlobs />);
    const layer = blobLayer(container);
    expect(layer.getAttribute("aria-hidden")).toBe("true");
    expect(layer.className).toContain("pointer-events-none");
    expect(layer.className).toContain("overflow-hidden");
  });

  it("keeps the three drift blobs and the reduced-motion opt-out on each", () => {
    const { container } = render(<BackgroundBlobs />);
    const blobs = [...blobLayer(container).children];
    expect(blobs.length).toBe(3);
    expect(blobs[0].className).toContain("cg-drift1");
    expect(blobs[1].className).toContain("cg-drift2");
    expect(blobs[2].className).toContain("cg-drift3");
    for (const blob of blobs) {
      expect(blob.className).toContain("motion-reduce:animate-none");
    }
  });
});

describe("both shells mount the layer inside the relative container (#344)", () => {
  it("app/(app) keeps BackgroundBlobs inside the min-h-screen shell", () => {
    expect(
      mountedInsideShell(APP_LAYOUT, 'className="relative min-h-screen', "<BackgroundBlobs")
    ).toBe(true);
  });

  it("app/(auth) keeps BackgroundBlobs inside the locked single-screen shell", () => {
    expect(
      mountedInsideShell(AUTH_LAYOUT, 'className="relative flex h-screen', "<BackgroundBlobs")
    ).toBe(true);
  });

  it("the rendered auth shell is the layer's direct parent", () => {
    render(<AuthLayout>{<div />}</AuthLayout>);
    const shell = blobLayer().parentElement;
    expect(shell?.className).toContain("relative");
    expect(shell?.className).toContain("h-screen");
    expect(shell?.className).toContain("bg-silver");
  });
});

describe("html and body refuse to rubber-band past the page (#344)", () => {
  it("globals.css sets overscroll-behavior-y: none on the shared html, body rule", () => {
    const baseLayer = blocks(GLOBALS, "@layer base")[0];
    if (!baseLayer) throw new Error("@layer base not found in globals.css");
    const shared = blocks(baseLayer, "html,").find((rule) => /html,\s*body\s*\{/.test(rule));
    expect(shared).toBeDefined();
    expect(shared).toContain("overscroll-behavior-y: none");
  });
});

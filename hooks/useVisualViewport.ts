import { useEffect, useState } from "react";

/**
 * Track `window.visualViewport` — the region actually visible to the user, which
 * shrinks when the mobile keyboard opens (issue #226). Server render and the
 * first client render both report `height: null` (there is no `window` on the
 * server), so nothing height-dependent can hydrate-mismatch; the real
 * measurement lands in the mount effect. Falls back to `window.innerHeight` when
 * the API is unavailable (older WebViews, jsdom).
 */
export interface VisualViewportState {
  /** Usable viewport height in px, or `null` before the first client read. */
  height: number | null;
  /**
   * How far the visual viewport is scrolled down from the layout viewport top.
   * iOS Safari shifts this when it scrolls a focused input into view; adding it
   * back keeps a from-the-top measurement pointing at the real visible bottom.
   */
  offsetTop: number;
}

export function useVisualViewport(): VisualViewportState {
  const [state, setState] = useState<VisualViewportState>({ height: null, offsetTop: 0 });

  useEffect(() => {
    const vv = window.visualViewport;

    const read = () => {
      const height = vv?.height ?? window.innerHeight;
      const offsetTop = vv?.offsetTop ?? 0;
      // Skip the re-render when nothing moved — iOS fires `scroll` continuously
      // during keyboard/momentum, and most of those carry identical values.
      setState((prev) =>
        prev.height === height && prev.offsetTop === offsetTop ? prev : { height, offsetTop }
      );
    };

    read();

    const target: VisualViewport | Window = vv ?? window;
    target.addEventListener("resize", read);
    target.addEventListener("scroll", read);
    return () => {
      target.removeEventListener("resize", read);
      target.removeEventListener("scroll", read);
    };
  }, []);

  return state;
}

/** Is `el` a field that raises the on-screen keyboard when focused? */
function isEditable(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable;
}

/**
 * True while a text field is focused — the reliable "the mobile keyboard is up"
 * signal across both viewport-resize modes (issue #226). A ratio-on-height
 * heuristic would miss Android's `interactiveWidget: resizes-content`, where the
 * layout *and* visual viewport shrink together so their ratio never drops. Used
 * to fold away the bottom tab bar so it can't cover the composer.
 */
export function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => {
      if (isEditable(e.target)) setOpen(true);
    };
    const onFocusOut = (e: FocusEvent) => {
      // Focus moving straight to another field keeps the keyboard up — only
      // treat it as closed when nothing editable receives focus next.
      if (!isEditable(e.relatedTarget)) setOpen(false);
    };
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, []);

  return open;
}

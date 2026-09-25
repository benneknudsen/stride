import { useEffect, useState } from "react";

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
 * to fold away the bottom tab bar so it can't cover whatever is at the bottom.
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

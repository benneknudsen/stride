import { useSyncExternalStore } from "react";

// Tailwind's `md` breakpoint — where the top NavBar takes over from the
// BottomTabBar (#321). The two switch at exactly 768px, so this query mirrors
// the `md:` utilities the two bars are styled with.
const DESKTOP_QUERY = "(min-width: 768px)";

function subscribe(onChange: () => void) {
  const query = window.matchMedia?.(DESKTOP_QUERY);
  if (!query) return () => {};
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

// No matchMedia (jsdom without a stub, exotic embeds) keeps the pre-#321
// behaviour: with no way to ask, the bar acts as it does on desktop.
function getSnapshot() {
  return window.matchMedia?.(DESKTOP_QUERY).matches ?? true;
}

// The server cannot know the viewport. False keeps the server's output and the
// first hydration render identical (the bar is a CSS-hidden, animation-idle
// pill down there either way); the snapshot is re-read as hydration commits,
// so a desktop entrance loses no more than that same commit.
function getServerSnapshot() {
  return false;
}

/**
 * True at Tailwind's `md` breakpoint (>= 768px) — where the top NavBar is
 * visible and the BottomTabBar is not. Used to keep the pill's entrance and
 * scroll-hide work off the phone, where the bar is hidden by CSS (#321).
 */
export function useIsDesktop(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

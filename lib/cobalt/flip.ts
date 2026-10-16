// The flip configuration every page title uses (issue #317). It lives outside
// components/cobalt/FlipText.tsx on purpose: that file is a client component,
// and a "use client" module only shares references — spreading an object it
// exports in a *server* component silently yields `{}` (and with it the
// component defaults, i.e. a slow looping flip). A plain module is readable
// from both sides of the boundary.

/**
 * The one-shot flip every page title uses (#317; retimed in #323 so it reads as
 * an entrance instead of a blink): settled once, and capped so length never
 * stretches the run. A 2.2 s character cycle spreads the stagger to 0.55 s, so
 * for any title — a 40-character one included — the last character completes
 * its face-swap (30 % of its cycle) around 1.2 s in and the whole run ends at
 * ~2.75 s, inside the 3.0 s cap.
 */
export const TITLE_FLIP = { loop: false, duration: 2.2, maxTotalDuration: 3.0 } as const;

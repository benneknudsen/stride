// The flip configuration every page title uses (issue #317). It lives outside
// components/cobalt/FlipText.tsx on purpose: that file is a client component,
// and a "use client" module only shares references — spreading an object it
// exports in a *server* component silently yields `{}` (and with it the
// component defaults, i.e. a slow looping flip). A plain module is readable
// from both sides of the boundary.

/**
 * The one-shot flip every page title uses (#317): fast enough to read as an
 * entrance, settled once, and capped so length never stretches the run. A
 * 40-character title finishes around 1.5 s.
 */
export const TITLE_FLIP = { loop: false, duration: 1.2, maxTotalDuration: 1.8 } as const;

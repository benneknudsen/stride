// The flip configuration every page title uses (issue #317). It lives outside
// components/cobalt/FlipText.tsx on purpose: that file is a client component,
// and a "use client" module only shares references — spreading an object it
// exports in a *server* component silently yields `{}` (and with it the
// component defaults, i.e. a slow looping flip). A plain module is readable
// from both sides of the boundary.

/**
 * The repeating, calm flip every page title uses (#317; retimed in #323, and
 * re-paced after a user feedback round so the animation is still running when
 * the eye lands on it). A run is the same entrance as before: a 2.2 s
 * character cycle spreads the stagger to 0.55 s, so for any title — a
 * 40-character one included — the last character completes its face-swap
 * (30 % of its cycle) around 1.21 s in and the whole run ends at ~2.75 s,
 * still inside the 3.0 s cap. `maxTotalDuration` bounds that first run, not
 * the repeats. Then the title rests: `pause` holds 4.5 s of stillness before
 * the next run remounts the characters, so the cadence is spread + duration +
 * pause ≈ 7.25 s — roughly one entrance every seven seconds, with a readable
 * pause in between, instead of a one-shot entrance that is gone in 2.75 s.
 */
export const TITLE_FLIP = { loop: true, pause: 4.5, duration: 2.2, maxTotalDuration: 3.0 } as const;

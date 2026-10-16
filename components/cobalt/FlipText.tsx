"use client";

// Ported from ObsidianUI's Flip Text registry block
// (https://www.obsidianui.dev/r/flip-text.json), MIT © Atharvsinh-codez —
// https://github.com/Atharvsinh-codez/ObsidianUI. Adopted as a local file per
// issue #306; the registry copy is the reference for the flip itself.
//
// Added by Stride, not present in the source:
// - Reduced motion: the flip keyframes only run inside a
//   `prefers-reduced-motion: no-preference` gate in app/globals.css, so with
//   `reduce` the title renders as ordinary static text — no JS branch, so the
//   server and client markup cannot diverge.
// - Screen readers: the animated characters are wrapped in `aria-hidden` and a
//   `sr-only` sibling carries the whole title as one string.
// - Character delays are quantised to two decimals, so the inline styles do not
//   depend on `Math.sin` being bit-identical between the server and the
//   browser engine.
// - The wrapper is a <span>, not the source's <div>, so it can nest in a
//   heading, and the unused default export is dropped (repo convention).
//
// Added for #317 (the component now carries every page title):
// - A `\n` in the string renders a real <br> between the animated lines, so a
//   two-line headline flips as one title and still reads as one string.
// - `maxTotalDuration` caps `delay + stagger + duration` — the moment the last
//   character has finished — so a title that is user data (an activity name)
//   cannot stretch the flip. `TITLE_FLIP` (lib/cobalt/flip.ts — a plain module,
//   readable from server components too) is the preset every header uses:
//   one-shot, capped.
//
// Added for #323 (a slower tempo, and a text swap rides the run):
// - `TITLE_FLIP` was retimed so the entrance is actually visible; the pacing
//   and cap arithmetic are unchanged.
// - A one-shot run remembers the delays it started with, per character
//   position. When its text swaps while the entrance is still in flight — the
//   Hjem hero swaps its greeting placeholder right after mount (#134) — the
//   character spans keep their nodes and animation properties, so the running
//   CSS animations are untouched and the new glyphs ride the same run instead
//   of restarting it mid-flip. A swap after the run has ended is a new
//   entrance: the spans remount with delays recomputed from the new text.
//
// Added after a user feedback round (the one-shot title was over before the
// eye landed on it — "kører kun en gang og er ultra hurtigt"):
// - `pause` keeps a looping title calm. With `loop` on and `pause > 0` each
//   run renders one-shot (--flip-iteration:1) and a client timer remounts the
//   characters after `delay + spread + duration + pause`, so the title rests
//   between entrances instead of animating forever. `pause = 0` (the default,
//   and the login heading) keeps the old constant CSS loop, byte for byte.
// - Every timer is scheduled from the run's start (`lastRunStart`), so a text
//   swap that opens a fresh run during a pause reschedules the remainder
//   instead of cutting the new run short or restarting on the old grid.
//   Reduced motion skips the restart entirely: the CSS gate already keeps the
//   title static, and remounting would move DOM nodes for no visual gain.

import { type CSSProperties, Fragment, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface FlipTextProps {
  /** The text to animate — split into lines on `\n`, then words, then characters. */
  children: string;
  /** Additional classes for the wrapper. */
  className?: string;
  /** One flip cycle in seconds. Default 2.2. */
  duration?: number;
  /** Extra pause before the stagger starts, in seconds. Default 0. */
  delay?: number;
  /** Flip forever, or exactly once. Default true. */
  loop?: boolean;
  /**
   * Seconds of stillness between runs when `loop` is true. 0 (the default)
   * keeps the constant CSS loop; a positive pause renders each run one-shot
   * and a timer remounts the characters after the pause.
   */
  pause?: number;
  /** Word separator. Default " ". */
  separator?: string;
  /** Animate every character together instead of staggering. Default false. */
  together?: boolean;
  /**
   * Upper bound, in seconds, on `delay + stagger spread + duration` — the
   * moment the last character has finished flipping. Without it the ported
   * sine pacing is unbounded by contract; with it a long title can never take
   * longer than this (#317).
   */
  maxTotalDuration?: number;
}

/**
 * How much later the last character may start, relative to the first (#317).
 * The source's pacing spreads a sine curve over the *normalised* character
 * index, so the spread never grows with length; `maxTotalDuration` clamps it
 * further so the last character finishes inside the budget.
 */
function staggerSpread(duration: number, delay: number, maxTotalDuration?: number): number {
  const base = duration * 0.25;
  if (maxTotalDuration === undefined) return base;
  return Math.max(0, Math.min(base, maxTotalDuration - delay - duration));
}

export function FlipText({
  children,
  className,
  duration = 2.2,
  delay = 0,
  loop = true,
  pause = 0,
  separator = " ",
  together = false,
  maxTotalDuration,
}: FlipTextProps) {
  const spread = staggerSpread(duration, delay, maxTotalDuration);
  // The paused loop is its own mode: one-shot runs, restarted by a timer. An
  // unpaused loop keeps the infinite CSS animation (login heading), and a
  // non-looping flip stays a single entrance.
  const pausesBetweenRuns = loop && pause > 0;

  // Lines → words, each word with its characters and their delays in the
  // running character order (a space occupies a slot like a character; a line
  // break animates nothing, so it does not). The per-word shape lets a later
  // text swap keep the delays position by position while the first run is in
  // flight.
  const lines = useMemo(() => {
    const totalChars = children.replaceAll("\n", "").length;
    let cursor = 0;
    return children.split("\n").map((line) =>
      line.split(separator).map((word) => {
        const start = cursor;
        cursor += word.length + separator.length;
        const chars = word.split("");
        const delays = chars.map((_, indexInWord) => {
          if (together) return delay;
          const normalizedIndex = (start + indexInWord) / totalChars;
          const sine = Math.sin(normalizedIndex * (Math.PI / 2));
          return sine * spread + delay;
        });
        return { chars, delays };
      })
    );
  }, [children, separator, together, delay, spread]);

  // #323: the run's delays, captured when the run started. Earlier positions
  // always resolve from here, so a text swap cannot change an existing
  // character's animation properties; characters (or whole words) the new text
  // adds fall back to its own computed delay and join the run's tail. This must
  // be decided in the very render that carries the new text — a remount cannot
  // be undone from an effect — hence the render-time bookkeeping.
  const runLines = useRef(lines);
  const runText = useRef(children);
  const runEpoch = useRef(0);
  // A looping flip never leaves its run; a one-shot flip leaves it when the
  // last character has finished (delay + spread + duration). A paused loop
  // starts inside a run and leaves it at the same moment.
  const runActive = useRef(!loop || pausesBetweenRuns);
  // When the current run started, on the client's clock. Every restart timer
  // counts from here, so reschedules keep the cadence instead of drifting.
  const lastRunStart = useRef(Date.now());
  // The pause timer's remount trigger. The epoch ref above moves inside the
  // render that carries a swap; a timer has no such render, so it bumps this
  // state instead — both land in the same word keys and remount the
  // characters.
  const [cycle, setCycle] = useState(0);

  if (children !== runText.current) {
    runText.current = children;
    if (!runActive.current) {
      // The entrance is over: this is a new run. The bumped epoch remounts the
      // character spans, so their animations start over, as they always did.
      runEpoch.current += 1;
      runLines.current = lines;
      if (pausesBetweenRuns) {
        // The swap opens a fresh run during the pause: move the run's origin
        // to now so the timers below schedule the new run's remainder rather
        // than the previous run's leftover grid.
        lastRunStart.current = Date.now();
        runActive.current = true;
      }
    }
  }

  // The one-shot run leaves `runActive` when its last character has finished.
  // A paused loop never reaches this effect: its run-end timer lives with the
  // restart timer below, so the two always share one schedule.
  useEffect(() => {
    if (loop) return;
    const timer = window.setTimeout(
      () => {
        runActive.current = false;
      },
      (delay + spread + duration) * 1000
    );
    return () => window.clearTimeout(timer);
  }, [loop, delay, spread, duration]);

  // The paused loop's clock: one timeout chain flips `runActive` off when the
  // run ends and remounts the characters after the pause — the CSS animation
  // itself stays one-shot — then re-arms for the next run. Both timers are
  // scheduled from `lastRunStart` at scheduling time, so a text swap (which
  // re-runs this effect through `lines`) keeps the remainder of the current
  // run, and a swap that opened a fresh run during the pause (see the
  // render-time bookkeeping above) restarts the full cadence from there. The
  // effect's cleanup can cancel the chain at any point: both timers are
  // reassigned in place as the chain advances.
  useEffect(() => {
    if (!pausesBetweenRuns) return;
    // Reduced motion draws a static title; remounting would only churn nodes.
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) return;

    let runEnd = 0;
    let nextRun = 0;
    const scheduleRun = () => {
      const elapsed = Date.now() - lastRunStart.current;
      runEnd = window.setTimeout(
        () => {
          runActive.current = false;
        },
        Math.max(0, (delay + spread + duration) * 1000 - elapsed)
      );
      nextRun = window.setTimeout(
        () => {
          runLines.current = lines;
          lastRunStart.current = Date.now();
          runActive.current = true;
          setCycle((count) => count + 1);
          scheduleRun();
        },
        Math.max(0, (delay + spread + duration + pause) * 1000 - elapsed)
      );
    };
    scheduleRun();
    return () => {
      window.clearTimeout(runEnd);
      window.clearTimeout(nextRun);
    };
  }, [pausesBetweenRuns, delay, spread, duration, pause, lines]);

  return (
    <span className={cn("inline-block leading-none", className)} style={{ perspective: "1000px" }}>
      <span aria-hidden="true">
        {lines.map((words, lineIndex) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: lines come from a static string and never reorder
          <Fragment key={lineIndex}>
            {lineIndex > 0 && <br />}
            {words.map(({ chars, delays }, wordIndex) => (
              <span
                // biome-ignore lint/suspicious/noArrayIndexKey: the key is a stable word slot (+ run epoch and cycle) so a text swap can keep the node; words come from a static string and never reorder
                key={`${lineIndex}-${wordIndex}-${runEpoch.current}-${cycle}`}
                className="inline-block"
                style={{ transformStyle: "preserve-3d" }}
              >
                {chars.map((char, indexInWord) => {
                  // #323: while the run is in flight its delays win — on a text
                  // swap the node and its animation properties stay identical,
                  // so the browser keeps the animation running.
                  const charDelay =
                    runLines.current[lineIndex]?.[wordIndex]?.delays?.[indexInWord] ??
                    delays[indexInWord];

                  return (
                    <span
                      // biome-ignore lint/suspicious/noArrayIndexKey: characters come from a static string and never reorder
                      key={indexInWord}
                      className="cg-flip-char relative inline-block"
                      data-char={char}
                      style={
                        {
                          "--flip-duration": `${duration}s`,
                          "--flip-delay": `${charDelay.toFixed(2)}s`,
                          "--flip-iteration": loop && !pausesBetweenRuns ? "infinite" : "1",
                          transformStyle: "preserve-3d",
                        } as CSSProperties
                      }
                    >
                      {char}
                    </span>
                  );
                })}
                {wordIndex < words.length - 1 && (
                  <span className="inline-block">{separator === " " ? "\u00a0" : separator}</span>
                )}
              </span>
            ))}
          </Fragment>
        ))}
      </span>
      {/* The line break becomes a space, not a literal `\n`: engines differ on
          whether they collapse whitespace while flattening the accessible
          name, and "one string" should read the same everywhere (#317). */}
      <span className="sr-only">{children.replaceAll("\n", " ")}</span>
    </span>
  );
}

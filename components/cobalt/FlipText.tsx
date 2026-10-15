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
//   one-shot, fast, capped.

import { type CSSProperties, Fragment, useMemo } from "react";
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
  separator = " ",
  together = false,
  maxTotalDuration,
}: FlipTextProps) {
  // Lines → words, with each word's start position in the running character
  // index (a space occupies a slot like a character; a line break animates
  // nothing, so it does not).
  const parsedLines = useMemo(() => {
    let cursor = 0;
    return children.split("\n").map((line) =>
      line.split(separator).map((word) => {
        const start = cursor;
        cursor += word.length + separator.length;
        return { word, start };
      })
    );
  }, [children, separator]);
  const totalChars = children.replaceAll("\n", "").length;
  const spread = staggerSpread(duration, delay, maxTotalDuration);

  return (
    <span className={cn("inline-block leading-none", className)} style={{ perspective: "1000px" }}>
      <span aria-hidden="true">
        {parsedLines.map((words, lineIndex) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: lines come from a static string and never reorder
          <Fragment key={lineIndex}>
            {lineIndex > 0 && <br />}
            {words.map(({ word, start }, wordIndex) => (
              <span
                key={`${start}-${word}`}
                className="inline-block"
                style={{ transformStyle: "preserve-3d" }}
              >
                {word.split("").map((char, indexInWord) => {
                  const normalizedIndex = (start + indexInWord) / totalChars;
                  const sine = Math.sin(normalizedIndex * (Math.PI / 2));
                  const charDelay = together ? delay : sine * spread + delay;

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
                          "--flip-iteration": loop ? "infinite" : "1",
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

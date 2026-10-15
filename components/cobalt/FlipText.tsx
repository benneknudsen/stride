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

import { type CSSProperties, useMemo } from "react";
import { cn } from "@/lib/utils";

interface FlipTextProps {
  /** The text to animate — split into words, then characters. */
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
}

export function FlipText({
  children,
  className,
  duration = 2.2,
  delay = 0,
  loop = true,
  separator = " ",
  together = false,
}: FlipTextProps) {
  const words = useMemo(() => children.split(separator), [children, separator]);
  const totalChars = children.length;

  function charIndex(wordIndex: number, indexInWord: number): number {
    let index = 0;
    for (let i = 0; i < wordIndex; i++) {
      index += words[i].length + separator.length;
    }
    return index + indexInWord;
  }

  return (
    <span className={cn("inline-block leading-none", className)} style={{ perspective: "1000px" }}>
      <span aria-hidden="true">
        {words.map((word, wordIndex) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: words come from a static string and never reorder
            key={`${wordIndex}-${word}`}
            className="inline-block whitespace-nowrap"
            style={{ transformStyle: "preserve-3d" }}
          >
            {word.split("").map((char, indexInWord) => {
              const normalizedIndex = charIndex(wordIndex, indexInWord) / totalChars;
              const sine = Math.sin(normalizedIndex * (Math.PI / 2));
              const charDelay = together ? delay : sine * (duration * 0.25) + delay;

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
      </span>
      <span className="sr-only">{children}</span>
    </span>
  );
}

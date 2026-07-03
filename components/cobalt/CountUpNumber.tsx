"use client";

import { useEffect, useRef, useState } from "react";
import { formatDanish } from "@/lib/cobalt/format";
import { cn } from "@/lib/utils";

interface CountUpNumberProps {
  value: number;
  label?: string;
  className?: string;
  decimals?: number;
  durationMs?: number;
  /** When false, shows the dimmed pulsing zero-state instead of counting. */
  run?: boolean;
  /** Override the formatter (e.g. for a m:ss time). Defaults to Danish decimal. */
  format?: (value: number) => string;
}

// Number that counts up over 1.2s (ease-out cubic) once `run` is true, formatted
// in Danish (comma decimal). Before it runs it shows a dimmed, pulsing zero.
// Size/weight/colour/alignment come from `className` (font-size cascades to the
// number; the label keeps its own mono styling).
export function CountUpNumber({
  value,
  label,
  className,
  decimals,
  durationMs = 1200,
  run = true,
  format,
}: CountUpNumberProps) {
  const resolvedDecimals = decimals ?? (Number.isInteger(value) ? 0 : 1);
  const formatValue = format ?? ((n: number) => formatDanish(n, resolvedDecimals));
  const [display, setDisplay] = useState(0);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    if (!run) {
      setDisplay(0);
      return;
    }
    const prefersReduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (prefersReduced) {
      setDisplay(value);
      return;
    }
    let startTime: number | null = null;
    const tick = (now: number) => {
      if (startTime === null) startTime = now;
      const progress = Math.min(1, (now - startTime) / durationMs);
      const eased = 1 - (1 - progress) ** 3;
      setDisplay(value * eased);
      if (progress < 1) frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, [run, value, durationMs]);

  return (
    <div className={cn("flex flex-col", className)}>
      <span
        className={cn(
          "font-cg-display font-extrabold leading-none tracking-[-0.04em]",
          !run &&
            "animate-[cg-pulse-dot_1.4s_ease-in-out_infinite] opacity-25 motion-reduce:animate-none"
        )}
      >
        {formatValue(run ? display : 0)}
      </span>
      {label ? (
        <span className="mt-3 font-cg-mono text-[11px] uppercase tracking-[0.2em] text-ink">
          {label}
        </span>
      ) : null}
    </div>
  );
}

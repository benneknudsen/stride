"use client";

import { useEffect, useState } from "react";
import { RunnerLoader } from "@/components/cobalt/RunnerLoader";
import { cn } from "@/lib/utils";

// Full-region loading overlay: a blurred silver scrim + centred RunnerLoader.
// Drop it inside a `relative` container (e.g. a GlassCard or the widget area);
// nav/hero stay outside the container and remain interactive. On `show` → false
// it fades for 0.6s, then unmounts.
export function LoadingOverlay({
  show,
  label = "HENTER DINE DATA…",
  className,
}: {
  show: boolean;
  label?: string;
  className?: string;
}) {
  const [mounted, setMounted] = useState(show);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (show) {
      setMounted(true);
      setClosing(false);
      return;
    }
    if (!mounted) return;
    setClosing(true);
    const timer = setTimeout(() => {
      setMounted(false);
      setClosing(false);
    }, 600);
    return () => clearTimeout(timer);
  }, [show, mounted]);

  if (!mounted) return null;

  return (
    <div
      className={cn(
        "absolute inset-0 z-[900] flex flex-col items-center justify-center gap-5 rounded-[26px]",
        closing && "[animation:cg-overlay-fade_0.6s_ease_both] motion-reduce:[animation:none]",
        className
      )}
      style={{
        background: "color-mix(in srgb, var(--color-silver) 40%, transparent)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
      }}
    >
      <RunnerLoader size={70} label={label} />
    </div>
  );
}

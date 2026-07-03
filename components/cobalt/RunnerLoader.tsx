import { cn } from "@/lib/utils";

// The one-and-only loader: static runner glyph over a dashed road that rolls
// backwards (0.5s linear loop). No skeletons anywhere — this is the loader.
// The road animation freezes under prefers-reduced-motion.
export function RunnerLoader({
  size = 58,
  label,
  stroke = "#1b29c0",
  head = "#ee2418",
  className,
  labelClassName,
}: {
  size?: number;
  label?: string;
  stroke?: string;
  head?: string;
  className?: string;
  labelClassName?: string;
}) {
  const height = Math.round((size * 104) / 100);
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn("flex flex-col items-center justify-center gap-4", className)}
    >
      <svg width={size} height={height} viewBox="0 0 100 104" fill="none" aria-hidden="true">
        <circle cx="74" cy="17" r="10" fill={head} />
        <path
          d="M66 32 L44 50 L60 62 L40 88"
          stroke={stroke}
          strokeWidth="12"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M44 50 L22 62 L8 56"
          stroke={stroke}
          strokeWidth="10"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.5"
        />
        <path d="M64 40 L86 50" stroke={stroke} strokeWidth="10" strokeLinecap="round" opacity="0.5" />
        <path
          d="M6 100 H94"
          stroke={stroke}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray="10 14"
          opacity="0.3"
          className="[animation:cg-ground-move_0.5s_linear_infinite] motion-reduce:[animation:none]"
        />
      </svg>
      {label ? (
        <span
          className={cn(
            "font-cg-mono text-[11px] uppercase tracking-[0.22em] text-cobalt",
            labelClassName
          )}
        >
          {label}
        </span>
      ) : null}
    </div>
  );
}

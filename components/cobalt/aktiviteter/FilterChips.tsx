"use client";

import type { ActivityFilter } from "@/lib/cobalt/aktiviteter";
import { cn } from "@/lib/utils";

// Intensity filter chips. Active = cobalt pill with silver text; inactive =
// glass outline pill. Labels are mono uppercase (letter-spacing ≥0.14em) per the
// Cobalt Glass rules — never zone codes.
const FILTERS: { key: ActivityFilter; label: string }[] = [
  { key: "alle", label: "Alle" },
  { key: "rolig", label: "Rolig" },
  { key: "moderat", label: "Moderat" },
  { key: "haard", label: "Hård" },
];

export function FilterChips({
  active,
  onChange,
}: {
  active: ActivityFilter;
  onChange: (filter: ActivityFilter) => void;
}) {
  return (
    <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0">
      {FILTERS.map((f) => {
        const isActive = f.key === active;
        return (
          <button
            key={f.key}
            type="button"
            onClick={() => onChange(f.key)}
            aria-pressed={isActive}
            className={cn(
              "cg-interactive shrink-0 rounded-pill px-[18px] py-2 font-cg-mono text-[11px] uppercase tracking-[0.16em] transition-colors",
              isActive
                ? "border border-cobalt bg-cobalt text-silver"
                : "cg-glass text-ink hover:text-cobalt"
            )}
          >
            {f.label}
          </button>
        );
      })}
    </div>
  );
}

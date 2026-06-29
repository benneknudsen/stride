"use client";

import { FlaskConical, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useDemoStore } from "@/stores/demo";

/**
 * Persistent banner shown whenever demo mode is active, making it unmistakable
 * that the data on screen is simulated. Rendered globally; self-hides when demo
 * mode is off. The "Exit demo" action just clears the flag — on the dashboard
 * that swaps back to live data, and the /demo route navigates home in response.
 */
export function DemoBanner() {
  const isDemoMode = useDemoStore((s) => s.isDemoMode);
  const disable = useDemoStore((s) => s.disable);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => setHydrated(true), []);

  if (!hydrated || !isDemoMode) return null;

  return (
    <div className="sticky top-16 z-40 border-b border-signal/30 bg-signal/15 backdrop-blur-md">
      <div className="mx-auto flex h-10 max-w-7xl items-center justify-between gap-3 px-6">
        <span className="flex items-center gap-2 text-sm font-medium text-signal">
          <FlaskConical className="size-4" />
          Demo Mode — showing sample data, not a real account.
        </span>
        <button
          type="button"
          onClick={disable}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-signal transition-colors hover:bg-signal/15"
        >
          <X className="size-3.5" />
          Exit demo
        </button>
      </div>
    </div>
  );
}

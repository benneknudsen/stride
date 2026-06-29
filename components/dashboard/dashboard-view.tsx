"use client";

import { useEffect, useState } from "react";
import { DemoDashboard } from "@/components/dashboard/demo-dashboard";
import { useDemoStore } from "@/stores/demo";

/**
 * Client-side switch between the live, server-rendered dashboard (`children`)
 * and the local demo dashboard. Toggling demo mode swaps the two instantly with
 * no navigation or refetch.
 *
 * `children` is the real dashboard, rendered on the server and handed in as an
 * already-serialized element, so its server-only data fetching never reaches
 * the browser bundle.
 *
 * Until the persisted store has hydrated we render the live dashboard to match
 * the server HTML and avoid a hydration mismatch.
 */
export function DashboardView({ children }: { children: React.ReactNode }) {
  const isDemoMode = useDemoStore((s) => s.isDemoMode);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => setHydrated(true), []);

  if (hydrated && isDemoMode) {
    return <DemoDashboard />;
  }
  return <>{children}</>;
}

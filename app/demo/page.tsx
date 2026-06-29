"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { DemoDashboard } from "@/components/dashboard/demo-dashboard";
import { useDemoStore } from "@/stores/demo";

/**
 * Public demo entry point. Not covered by the auth middleware matcher, so it's
 * reachable without logging in. Turns demo mode on so the header toggle and
 * banner stay consistent, and navigates home if the visitor exits demo mode
 * from either of those controls.
 */
export default function DemoPage() {
  const router = useRouter();
  const enable = useDemoStore((s) => s.enable);
  const isDemoMode = useDemoStore((s) => s.isDemoMode);
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    enable();
    setArmed(true);
  }, [enable]);

  useEffect(() => {
    if (armed && !isDemoMode) {
      router.push("/");
    }
  }, [armed, isDemoMode, router]);

  return <DemoDashboard />;
}

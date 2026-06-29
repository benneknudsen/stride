"use client";

import { Eye, EyeOff } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useDemoStore } from "@/stores/demo";

/**
 * Header control to enter/leave demo mode. The toggle only flips client state,
 * so on the dashboard the data swaps instantly with no reload. Renders nothing
 * until hydrated so the label matches the persisted value.
 */
export function DemoToggle() {
  const isDemoMode = useDemoStore((s) => s.isDemoMode);
  const toggle = useDemoStore((s) => s.toggle);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => setHydrated(true), []);

  if (!hydrated) {
    return (
      <Button variant="outline" size="sm" disabled>
        <Eye className="size-4" />
        View demo
      </Button>
    );
  }

  return (
    <Button variant="outline" size="sm" onClick={toggle}>
      {isDemoMode ? (
        <>
          <EyeOff className="size-4" />
          Exit demo
        </>
      ) : (
        <>
          <Eye className="size-4" />
          View demo
        </>
      )}
    </Button>
  );
}

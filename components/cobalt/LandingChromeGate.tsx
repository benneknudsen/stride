"use client";

import { usePathname, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { ROUTES } from "@/lib/routes";

// The Velkommen landing page — "/" for a visitor without ?demo — has to read as
// a landing page, not as the app: no NavBar, no BottomTabBar (it brings its own
// header). Everything else keeps the chrome: signed-in users everywhere, and
// visitors on the demo and the three other public pages, so the demo stays
// browsable (#100). The demo's clean path (`/demo`) is its own pathname and
// passes the gate by itself; the searchParams check covers legacy `/?demo=1`
// links, where landing-or-demo hinges on the query string, which layouts never
// see — hence this client gate around the bars instead of a condition in
// app/(app)/layout.tsx. The demo check mirrors app/(app)/page.tsx: any ?demo
// value (even empty) means the demo dashboard.
export function LandingChromeGate({
  signedIn = false,
  children,
}: {
  signedIn?: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const onLanding = !signedIn && pathname === ROUTES.HOME && !searchParams?.has("demo");
  return onLanding ? null : children;
}

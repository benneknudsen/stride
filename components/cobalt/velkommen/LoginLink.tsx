"use client";

import { track } from "@vercel/analytics";
import Link from "next/link";
import type { ReactNode } from "react";
import { ROUTES } from "@/lib/routes";

// The landing's login/connect CTAs, as a client island so a visitor's intent to
// connect a data source is captured. VelkommenPage stays a Server Component and
// just renders these where a login link is needed. The event is anonymous —
// clicking "Log ind" starts the Strava/Garmin connect flow, and no PII is sent.
export function LoginLink({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <Link href={ROUTES.LOGIN} className={className} onClick={() => track("datakilde_forbundet")}>
      {children}
    </Link>
  );
}

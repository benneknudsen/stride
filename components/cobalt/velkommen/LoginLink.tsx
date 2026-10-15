"use client";

import { track } from "@vercel/analytics";
import Link from "next/link";
import type { ReactNode } from "react";
import { ROUTES } from "@/lib/routes";

// The landing's login/connect CTAs, as a client island so a visitor's intent to
// connect a data source is captured. VelkommenPage stays a Server Component and
// just renders these where a login link is needed. The event is anonymous —
// clicking "Log ind" starts the Strava connect flow, and no PII is sent.
//
// Issue #304: the login page reuses this for its secondary demo CTA, so the
// destination and the tracked event are overridable — the defaults keep every
// existing landing call site (and its event) exactly as it was.
export function LoginLink({
  className,
  children,
  href = ROUTES.LOGIN,
  trackEvent = "datakilde_forbundet",
}: {
  className?: string;
  children: ReactNode;
  href?: string;
  trackEvent?: string;
}) {
  return (
    <Link href={href} className={className} onClick={() => track(trackEvent)}>
      {children}
    </Link>
  );
}

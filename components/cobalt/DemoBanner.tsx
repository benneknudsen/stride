"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { ROUTES } from "@/lib/routes";
import { GlassCard } from "./GlassCard";

// Demo-markering (#212): a sticky glass bar telling a visitor the numbers are
// fixtures — with the way into the real thing one click away. It used to live
// only on Hjem (HjemPageClient), so it vanished the moment a visitor clicked
// through to /aktiviteter, /coach or /plan, which all show the same demo
// fallback (#100). Living in the shared (app) layout instead, it rides along on
// every public page. `useSession` (via the root SessionProvider) hides it for
// signed-in users; the LandingChromeGate wrapper in the layout hides it on the
// Velkommen landing, and the login page sits in the (auth) route group, so it
// never renders this layout at all.
export function DemoBanner() {
  const { data: session } = useSession();

  // Don't show for logged-in users
  if (session?.user) return null;

  return (
    // Sticky (not fixed) so it scrolls inside the page flow and can't detach on
    // iOS like a fixed bar with backdrop-filter would; z-40 keeps it under the
    // BottomTabBar (z-50).
    <div className="sticky top-2 z-40 mt-3 flex justify-center sm:mt-4 [animation:cg-fade-up_0.6s_ease_both] motion-reduce:[animation:none]">
      <GlassCard className="flex max-w-full items-center gap-3 rounded-pill py-1.5 pr-1.5 pl-4 sm:gap-4 sm:py-2 sm:pr-2">
        <span className="flex-none rounded-pill bg-red px-2.5 py-1 cg-label tracking-[0.18em] font-semibold text-white">
          Demo
        </span>
        <p className="m-0 min-w-0 truncate text-[13px] leading-snug text-ink">
          <span className="sm:hidden">Du kigger på eksempeldata</span>
          <span className="hidden sm:inline">Dette er en demo med eksempeldata</span>
        </p>
        <Link
          href={ROUTES.LOGIN}
          className="cg-interactive flex-none rounded-pill bg-cobalt px-4 py-1.5 text-[12.5px] font-semibold text-white transition-opacity hover:opacity-90 sm:px-5 sm:py-2 sm:text-[13px]"
        >
          Log ind
        </Link>
      </GlassCard>
    </div>
  );
}

"use client";

import { track } from "@vercel/analytics";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Logo } from "@/components/cobalt/Logo";
import { SyncButton, type SyncState } from "@/components/cobalt/SyncButton";
import { Wordmark } from "@/components/cobalt/Wordmark";
import { glassTabStyle } from "@/lib/cobalt/nav-glass";
import { DEMO_HOME_ROUTE, ROUTES } from "@/lib/routes";
import { cn } from "@/lib/utils";

// Glass-pill navigation. Active route = a raised liquid-glass pill (issue #100,
// shared with the BottomTabBar) rather than a flat cobalt fill. Coach carries the
// red AI spark. Sync POSTs to /api/strava/sync and drives the button from the
// response — idle → syncing → synced|error → idle — so it can be run again (#97).
//
// For a visitor the Hjem tab points at the demo dashboard (`/demo`) instead of
// bare "/" — "/" shows the Velkommen landing page without a session, and a tab
// that dropped the visitor out of the demo mid-browse would read as a bug.
const LINKS = [
  { label: "Hjem", href: ROUTES.HOME },
  { label: "Aktiviteter", href: ROUTES.AKTIVITETER },
  { label: "Coach", href: ROUTES.COACH, spark: true },
  { label: "Plan", href: ROUTES.PLAN },
];

/** How long the terminal state shows before the button returns to "Sync now". */
const RESET_DELAY_MS = { synced: 2500, error: 4000 } as const;

export function NavBar({
  userName,
  activeHref,
  onSync,
}: {
  /** Display name of the signed-in user. Absent for visitors. */
  userName?: string;
  activeHref?: string;
  /** Fired when a sync finishes successfully, after the router has refreshed. */
  onSync?: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const current = activeHref ?? pathname ?? "/";
  const [syncState, setSyncState] = useState<SyncState>("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // syncState lags a render behind, so two fast clicks would both see "idle".
  // The ref flips synchronously and is what actually guards the fetch.
  const syncingRef = useRef(false);

  // Drop the pending reset and any in-flight sync when the bar unmounts.
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      abortRef.current?.abort();
    },
    []
  );

  const settle = useCallback((state: "synced" | "error") => {
    setSyncState(state);
    timerRef.current = setTimeout(() => setSyncState("idle"), RESET_DELAY_MS[state]);
  }, []);

  const handleSync = useCallback(async () => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    if (timerRef.current) clearTimeout(timerRef.current);

    const controller = new AbortController();
    abortRef.current = controller;
    setSyncState("syncing");

    try {
      const res = await fetch("/api/strava/sync", {
        method: "POST",
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (!res.ok) throw new Error(`Sync failed: ${res.status}`);

      // The synced runs live in server-rendered pages — pull them in.
      router.refresh();
      onSync?.();
      settle("synced");
    } catch {
      // Unmounted mid-sync — never touch state after abort.
      if (controller.signal.aborted) return;
      settle("error");
    } finally {
      syncingRef.current = false;
    }
  }, [onSync, router, settle]);

  // The demo is the front page under another path (a rewrite), so the
  // visitor's Hjem tab has to light up on both `/demo` and legacy `/?demo=1`
  // links, which still land on "/" (usePathname carries no query string).
  const isActive = (href: string) => {
    if (href === DEMO_HOME_ROUTE) return current === href || current === ROUTES.HOME;
    return current === href || current.startsWith(`${href}/`);
  };

  // Visitors (no identity chip) keep the demo when they tab back to Hjem.
  const links = userName
    ? LINKS
    : LINKS.map((link) => (link.href === ROUTES.HOME ? { ...link, href: DEMO_HOME_ROUTE } : link));

  return (
    <nav className="cg-glass mt-[18px] flex items-center justify-between gap-3 rounded-card px-4 py-2.5 md:gap-[18px] md:px-[22px] md:py-[13px]">
      <Link href={ROUTES.HOME} className="flex items-center gap-3">
        <Logo />
        <Wordmark />
      </Link>

      <div className="hidden items-center gap-1.5 text-[13px] font-medium md:flex">
        {links.map((link) => {
          const active = isActive(link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={active ? "page" : undefined}
              // Anonymous nav event: the tab label is the only property, no PII.
              onClick={() => track("navigeret_til_side", { side: link.label })}
              style={glassTabStyle(active)}
              className={cn(
                "cg-interactive flex items-center gap-1.5 rounded-pill border border-solid px-[18px] py-2.5",
                "transition-all duration-300 ease-out motion-reduce:transition-none",
                active ? "font-semibold text-cobalt" : "text-ink hover:text-cobalt"
              )}
            >
              {link.spark ? (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M12 2 L14.2 9.8 L22 12 L14.2 14.2 L12 22 L9.8 14.2 L2 12 L9.8 9.8 Z"
                    fill="var(--color-red)"
                  />
                </svg>
              ) : null}
              {link.label}
            </Link>
          );
        })}
      </div>

      <div className="flex items-center gap-3">
        <SyncButton state={syncState} onSync={handleSync} />
        {userName ? (
          <>
            <span className="hidden font-cg-mono text-[11px] tracking-[0.12em] text-ink sm:inline">
              {userName.toUpperCase()}
            </span>
            <span className="flex size-8 flex-none items-center justify-center rounded-full bg-cobalt text-[12px] font-semibold text-silver">
              {userName.slice(0, 1).toUpperCase()}
            </span>
          </>
        ) : null}
      </div>
    </nav>
  );
}

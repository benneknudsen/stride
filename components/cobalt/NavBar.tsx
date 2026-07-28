"use client";

import { track } from "@vercel/analytics";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signIn, signOut } from "next-auth/react";
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

/** How long a terminal state shows before the button returns to "Synkronisér". */
const RESET_DELAY_MS = { synced: 2500, error: 4000, rate_limited: 4000 } as const;

export function NavBar({
  userName,
  userImage,
  stravaConnected,
  activeHref,
  onSync,
}: {
  /** Display name of the signed-in user. Absent for visitors. */
  userName?: string;
  /** Strava athlete avatar (session.user.image). Null when unset (#187). */
  userImage?: string | null;
  /**
   * Whether the signed-in user has Strava tokens on file (#216). Only a
   * connected user gets a sync button that can succeed; without it we offer a
   * connect CTA instead, and visitors get neither — there is no path to a 401.
   */
  stravaConnected?: boolean;
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
  // Account drop-down: opens on hover/click of the identity chip, holds a
  // short grace timer so a brief pointer slip between chip and menu doesn't
  // snap it shut (#logout-menu).
  const [menuOpen, setMenuOpen] = useState(false);
  const menuTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const openMenu = useCallback(() => {
    if (menuTimerRef.current) clearTimeout(menuTimerRef.current);
    setMenuOpen(true);
  }, []);
  // Delay the close so the pointer can travel from chip to menu item.
  const closeMenu = useCallback(() => {
    if (menuTimerRef.current) clearTimeout(menuTimerRef.current);
    menuTimerRef.current = setTimeout(() => setMenuOpen(false), 120);
  }, []);

  // Drop the pending reset and any in-flight sync when the bar unmounts.
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (menuTimerRef.current) clearTimeout(menuTimerRef.current);
      abortRef.current?.abort();
    },
    []
  );

  const settle = useCallback((state: "synced" | "error" | "rate_limited") => {
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
      // Strava throttled the pull (429) — a wait, not a failure. Show a calm
      // "kørte for nylig" instead of the red retry button (#216).
      if (res.status === 429) {
        settle("rate_limited");
        return;
      }
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
        {/* The sync button only makes sense for a connected user (#216).
            A visitor has no session, so it would always 401 — hide it. A
            signed-in user without Strava gets a connect CTA into the OAuth
            flow instead; only a connected user gets the real sync control. */}
        {!userName ? null : !stravaConnected ? (
          <button
            type="button"
            onClick={() => void signIn("strava", { callbackUrl: ROUTES.HOME })}
            className="cg-interactive inline-flex items-center gap-2 rounded-pill bg-cobalt px-[18px] py-2 text-[12.5px] font-semibold text-silver transition-colors hover:bg-cobalt-light"
            style={{
              boxShadow: "0 6px 20px color-mix(in srgb, var(--color-cobalt) 25%, transparent)",
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M12 5v14M5 12h14"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
              />
            </svg>
            Forbind Strava
          </button>
        ) : (
          <SyncButton state={syncState} onSync={handleSync} />
        )}
        {userName ? (
          // Hover open/close is a pointer-only nicety; keyboard and touch users
          // drive the menu through the button's click toggle below.
          // biome-ignore lint/a11y/noStaticElementInteractions: hover is progressive enhancement, button handles interaction
          <div className="relative" onMouseEnter={openMenu} onMouseLeave={closeMenu}>
            <button
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label="Kontomenu"
              className="cg-interactive flex items-center gap-3 rounded-pill"
            >
              <span className="hidden font-cg-mono text-[11px] tracking-[0.12em] text-ink sm:inline">
                {userName.toUpperCase()}
              </span>
              {userImage ? (
                <Image
                  src={userImage}
                  alt={userName}
                  width={32}
                  height={32}
                  className="size-8 flex-none rounded-full object-cover ring-1 ring-white/70"
                />
              ) : (
                <span className="flex size-8 flex-none items-center justify-center rounded-full bg-cobalt text-[12px] font-semibold text-silver">
                  {userName.slice(0, 1).toUpperCase()}
                </span>
              )}
            </button>

            {menuOpen ? (
              <div
                role="menu"
                className="absolute right-0 top-[calc(100%+8px)] z-50 min-w-[168px] rounded-card border border-cobalt/15 bg-white/60 p-1.5 shadow-lg backdrop-blur-xl"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    void signOut({ callbackUrl: ROUTES.HOME });
                  }}
                  className="flex w-full items-center gap-2.5 rounded-pill px-3 py-2 text-left text-[14px] font-medium text-cobalt transition-colors hover:bg-cobalt/[0.08]"
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                    <path d="M16 17l5-5-5-5" />
                    <path d="M21 12H9" />
                  </svg>
                  Log ud
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </nav>
  );
}

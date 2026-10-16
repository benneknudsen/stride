"use client";

import { track } from "@vercel/analytics";
import { motion, useReducedMotion } from "motion/react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signIn, signOut } from "next-auth/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Logo } from "@/components/cobalt/Logo";
import { SyncButton, type SyncState } from "@/components/cobalt/SyncButton";
import { Wordmark } from "@/components/cobalt/Wordmark";
import { useIsDesktop } from "@/hooks/useIsDesktop";
import { glassTabStyle } from "@/lib/cobalt/nav-glass";
import { DEMO_HOME_ROUTE, ROUTES } from "@/lib/routes";
import { lockSmoothScroll, unlockSmoothScroll } from "@/lib/smooth-scroll";
import { cn } from "@/lib/utils";

// Floating-pill navigation (#308). A full-width fixed strip that only centres
// (clicks pass through it everywhere except the pill itself); the pill is the
// glass bar grown from zero on load and scaled back to zero when the user
// scrolls down — the measured reference movement from docs/bevaegelsesstrategi.md
// a.5. The (app) layout reserves the height the bar used to occupy in flow, so
// page content starts where it always did and nothing scrolls underneath it at
// rest. #321: the pill only exists from md up — below that the BottomTabBar owns
// navigation, the pill is display:none, and it neither animates nor listens for
// scroll. What does not vanish below md is the account menu: Log ud has its only
// UI here, so the phone gets the same chip as a free-standing control in the
// top-right corner, with the pill's sync/connect entry added to its dropdown
// (the pill's own SyncButton is hidden down there). Active route = a raised
// liquid-glass pill (issue #100, shared with the BottomTabBar) rather than a
// flat cobalt fill. Coach carries the red sync spark. Sync POSTs to
// /api/strava/sync and drives the button from the response — idle → syncing →
// synced|error|rate_limited → idle — so it can be run again (#97).
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

/** Reference entrance/hide curve (a.5): a strong ease-out over ~0.8 s. */
const PILL_EASE: [number, number, number, number] = [0.23, 1, 0.32, 1];
const PILL_DURATION_S = 0.8;
/** Hide only after a real downward run — the reference listener's thresholds. */
const HIDE_AFTER_Y = 150;
const HIDE_AFTER_DELTA = 120;

/** One row shape for both account dropdowns, so the entries cannot drift. */
const MENU_ROW =
  "flex w-full items-center gap-2.5 rounded-pill px-3 text-left text-[14px] font-medium";

// The phone dropdown's data entry (#321): what the pill's sync control or
// connect CTA does on desktop, as one menu row. A connected user gets the
// manual sync — idle and error are the clickable states, the other three are
// the status SyncButton would be showing; a signed-in user without Strava gets
// the same connect CTA that opens the OAuth flow, so neither entry loses its
// only way in below md. Same words as SyncButton, sentence-cased for the menu.
function SyncMenuItem({
  stravaConnected,
  syncState,
  onSync,
}: {
  stravaConnected: boolean;
  syncState: SyncState;
  onSync?: () => void;
}) {
  const row = cn(MENU_ROW, "min-h-11");

  if (!stravaConnected) {
    return (
      <button
        type="button"
        role="menuitem"
        onClick={() => void signIn("strava", { callbackUrl: ROUTES.HOME })}
        className={cn(row, "text-cobalt transition-colors hover:bg-cobalt/[0.08]")}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M12 5v14M5 12h14"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
          />
        </svg>
        Forbind Strava
      </button>
    );
  }

  if (syncState === "syncing" || syncState === "synced" || syncState === "rate_limited") {
    const status = {
      syncing: {
        label: "Syncer…",
        dot: "bg-red animate-[cg-pulse-dot_0.8s_ease-in-out_infinite] motion-reduce:animate-none",
        text: "text-ink",
      },
      synced: { label: "Synced", dot: "bg-success", text: "text-success-ink" },
      rate_limited: { label: "Kørte for nylig", dot: "bg-ink/50", text: "text-ink" },
    }[syncState];
    return (
      <div role="menuitem" tabIndex={-1} aria-disabled="true" className={cn(row, status.text)}>
        <span className={cn("size-[7px] rounded-full", status.dot)} />
        {status.label}
      </div>
    );
  }

  // Idle sync, or the red retry after a failed one (#97) — both start a sync.
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onSync}
      className={cn(
        row,
        "transition-colors",
        syncState === "error" ? "text-red hover:bg-red/8" : "text-cobalt hover:bg-cobalt/[0.08]"
      )}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M20 12 A8 8 0 1 1 17.5 6"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
        <path
          d="M17.5 2.5 V6.5 H13.5"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {syncState === "error" ? "Prøv igen" : "Synkronisér nu"}
    </button>
  );
}

// The identity chip and its dropdown (#logout-menu, #321), shared by the
// desktop pill and the phone's free-standing control so Log ud and the data
// entries can never drift between the two. `mobile` sizes the rows for a
// finger and adds the data entry; the desktop instance renders exactly what the
// pill always rendered. Hover open/close is a pointer-only nicety; keyboard and
// touch users drive the menu through the click toggle.
function AccountMenu({
  userName,
  userImage,
  testId,
  mobile = false,
  stravaConnected = false,
  syncState = "idle",
  onSync,
  className,
}: {
  userName: string;
  userImage?: string | null;
  testId: string;
  mobile?: boolean;
  stravaConnected?: boolean;
  syncState?: SyncState;
  onSync?: () => void;
  className?: string;
}) {
  // Opens on hover/click of the identity chip, holds a short grace timer so a
  // brief pointer slip between chip and menu doesn't snap it shut.
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

  useEffect(
    () => () => {
      if (menuTimerRef.current) clearTimeout(menuTimerRef.current);
    },
    []
  );

  // #307: an open menu freezes the smooth-scrolled page behind it. This is the
  // account dropdown — Stride's only menu (mobile navigation is the always-on
  // BottomTabBar, there is no hamburger). Pairing is effect-based, so the
  // delayed close, a click-toggle close and an unmount all restart scrolling.
  // No-op where Lenis is not running, which is everywhere the NavBar renders
  // today: the landing and login own Lenis and carry no NavBar.
  useEffect(() => {
    if (!menuOpen) return;
    lockSmoothScroll();
    return () => unlockSmoothScroll();
  }, [menuOpen]);

  const menuItem = cn(MENU_ROW, mobile && "min-h-11");

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: hover is progressive enhancement, button handles interaction
    <div
      data-testid={testId}
      className={cn("relative", className)}
      // Open on approach for pointers that actually hover. A tap also fires
      // the compatibility mouse events, so opening on approach there would
      // have the tap's own click-toggle shut the menu in the same tap (#321);
      // pointerType separates the two. Leaving still closes on every pointer,
      // which is what shuts the menu when a finger lands elsewhere.
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") openMenu();
      }}
      onMouseLeave={closeMenu}
    >
      <button
        type="button"
        onClick={() => setMenuOpen((open) => !open)}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-label="Kontomenu"
        className={cn(
          "cg-interactive flex items-center gap-3 rounded-pill",
          // Touch target (#321): 32px avatar + 6px padding all round = 44px.
          mobile && "min-h-11 min-w-11 justify-center p-1.5"
        )}
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
          {mobile ? (
            <>
              <SyncMenuItem
                stravaConnected={stravaConnected}
                syncState={syncState}
                onSync={onSync}
              />
              <div aria-hidden className="my-1 h-px bg-cobalt/10" />
            </>
          ) : null}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenuOpen(false);
              void signOut({ callbackUrl: ROUTES.HOME });
            }}
            className={cn(menuItem, "py-2 text-cobalt transition-colors hover:bg-cobalt/[0.08]")}
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
  );
}

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
  const reduceMotion = useReducedMotion();
  // #321: below md the bar is hidden by CSS (the BottomTabBar owns mobile
  // navigation), so the entrance and the scroll-hide below stay off there.
  const isDesktop = useIsDesktop();
  // #308: the pill scoots away on a downward scroll and returns on the first
  // upward one — the reference behaviour, driven by a plain passive listener.
  // Reduced motion turns the whole idea off: the pill stays put and visible.
  const [scrolledAway, setScrolledAway] = useState(false);
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

  // #308 scroll listener: accumulate downward travel past the thresholds to
  // hide, return on the first upward pixel (or back near the top). A client
  // navigation scrolls back to the top, and that programmatic scroll fires the
  // same event, so the pill can never stay hidden across pages.
  // #321: only arms with the bar on screen (md+). Below md it stays unarmed and
  // drops any stale hidden state, so nothing invisible reacts to scrolling.
  useEffect(() => {
    if (!isDesktop) {
      setScrolledAway(false);
      return;
    }
    if (reduceMotion) return;
    let lastY = window.scrollY;
    let downward = 0;
    const onScroll = () => {
      const y = window.scrollY;
      const delta = y - lastY;
      lastY = y;
      if (y <= HIDE_AFTER_Y || delta < 0) {
        downward = 0;
        setScrolledAway(false);
        return;
      }
      if (delta > 0) {
        downward += delta;
        if (downward > HIDE_AFTER_DELTA) setScrolledAway(true);
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [isDesktop, reduceMotion]);

  const pillHidden = !reduceMotion && scrolledAway;

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
    // #308: a full-width fixed strip that only centres the pill — nothing of
    // the strip itself is visible or clickable (`pointer-events-none` lets
    // content behind it work; the pill re-enables its own events). The top
    // offset matches the old in-flow bar (`mt-[18px]` under the safe-area).
    // #321: below md there is no pill — the BottomTabBar owns mobile
    // navigation and the layout reserves no space up here — but the strip
    // stays mounted for the free-standing account control in the top-right,
    // which is all the phone gets. Through md the pill spans the shell (phone
    // ~92%, tablet full column): at those widths a content-fit pill would
    // overflow once the identity chip and sync control are on screen. From lg
    // it is content-sized and centred — the reference geometry (a centred
    // pill, not a full-width bar) — with the measured natural width (~700px at
    // 1440px) coming from `lg:gap-16`/`xl:gap-24` between the three groups.
    <nav className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center">
      {/* The phone's whole top chrome (#321): the account menu, nothing else.
          Same 16px gutter as the shell's px-4. It floats above the page, so
          the (app) shell reserves its band (safe-area + 56px) on the top
          padding below md — the page's first line starts under the chip at
          every phone width. */}
      {userName ? (
        <AccountMenu
          testId="nav-account-mobile"
          mobile
          userName={userName}
          userImage={userImage}
          stravaConnected={stravaConnected}
          syncState={syncState}
          onSync={handleSync}
          className="pointer-events-auto absolute top-[calc(env(safe-area-inset-top,0px)_+_12px)] right-4 md:hidden"
        />
      ) : null}
      <div className="hidden w-full max-w-[1360px] px-4 md:block md:px-7">
        <motion.div
          data-testid="nav-pill"
          initial={{ opacity: 0, scale: 0 }}
          // #321: below md the entrance stays at its initial hidden state — the
          // CSS-hidden bar has nothing to animate for. The class flip at md and
          // the snapshot flip land together, so crossing up still plays the
          // grow-in exactly as it does on a desktop load.
          animate={!isDesktop || pillHidden ? { opacity: 0, scale: 0 } : { opacity: 1, scale: 1 }}
          transition={
            reduceMotion ? { duration: 0 } : { duration: PILL_DURATION_S, ease: PILL_EASE }
          }
          className="cg-glass-nav pointer-events-auto mt-[calc(env(safe-area-inset-top,0px)_+_18px)] flex w-full items-center justify-between gap-3 rounded-pill px-5 py-2 md:gap-[18px] md:px-7 md:py-3 lg:mx-auto lg:w-fit lg:gap-16 xl:gap-24"
        >
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
              <AccountMenu testId="nav-account-desktop" userName={userName} userImage={userImage} />
            ) : null}
          </div>
        </motion.div>
      </div>
    </nav>
  );
}

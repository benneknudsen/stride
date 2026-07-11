"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Logo } from "@/components/cobalt/Logo";
import { SyncButton, type SyncState } from "@/components/cobalt/SyncButton";
import { Wordmark } from "@/components/cobalt/Wordmark";
import { ROUTES } from "@/lib/routes";
import { cn } from "@/lib/utils";

// Glass-pill navigation. Active route = cobalt pill with silver text. Coach
// carries the red AI spark. The sync flow is self-contained (idle → syncing →
// synced) so the bar works on any page; pass `onSync` to hook the real API.
const LINKS = [
  { label: "Hjem", href: ROUTES.HOME },
  { label: "Aktiviteter", href: ROUTES.AKTIVITETER },
  { label: "Coach", href: ROUTES.COACH, spark: true },
  { label: "Plan", href: ROUTES.PLAN },
];

export function NavBar({
  userName,
  activeHref,
  onSync,
}: {
  /** Display name of the signed-in user. Absent for visitors (e.g. /demo). */
  userName?: string;
  activeHref?: string;
  onSync?: () => void;
}) {
  const pathname = usePathname();
  const current = activeHref ?? pathname ?? "/";
  const [syncState, setSyncState] = useState<SyncState>("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    []
  );

  const handleSync = useCallback(() => {
    onSync?.();
    setSyncState("syncing");
    timerRef.current = setTimeout(() => setSyncState("synced"), 1800);
  }, [onSync]);

  const isActive = (href: string) => current === href || current.startsWith(`${href}/`);

  return (
    <nav className="cg-glass mt-[18px] flex items-center justify-between gap-3 rounded-card px-4 py-2.5 md:gap-[18px] md:px-[22px] md:py-[13px]">
      <Link href={ROUTES.HOME} className="flex items-center gap-3">
        <Logo />
        <Wordmark />
      </Link>

      <div className="hidden items-center gap-1.5 text-[13px] font-medium md:flex">
        {LINKS.map((link) => {
          const active = isActive(link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "cg-interactive flex items-center gap-1.5 rounded-pill px-[18px] py-2.5 transition-colors",
                active ? "bg-cobalt text-silver" : "text-ink hover:text-cobalt"
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

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { ROUTES } from "@/lib/routes";
import { cn } from "@/lib/utils";

// Mobile-only bottom navigation: a floating glass pill fixed to the bottom of the
// viewport (hidden from md up, where the top NavBar's links take over). Each tab
// carries its own icon; the active route reads full-opacity cobalt, the rest sit
// dimmed. Routes point at the real Cobalt Glass pages (Danish slugs).
const cobalt = "var(--color-cobalt)";
const red = "var(--color-red)";

const TABS: { label: string; href: string; icon: ReactNode }[] = [
  {
    label: "Hjem",
    href: ROUTES.HOME,
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="3.5" y="3.5" width="7" height="7" rx="2" fill={cobalt} />
        <rect x="13.5" y="3.5" width="7" height="7" rx="2" fill={cobalt} opacity="0.45" />
        <rect x="3.5" y="13.5" width="7" height="7" rx="2" fill={cobalt} opacity="0.45" />
        <rect x="13.5" y="13.5" width="7" height="7" rx="2" fill={red} />
      </svg>
    ),
  },
  {
    label: "Aktiviteter",
    href: ROUTES.AKTIVITETER,
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M4 17 L9 9 L13 14 L20 5"
          stroke={cobalt}
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="20" cy="5" r="2.2" fill={red} />
      </svg>
    ),
  },
  {
    label: "Coach",
    href: ROUTES.COACH,
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M12 2 L14.2 9.8 L22 12 L14.2 14.2 L12 22 L9.8 14.2 L2 12 L9.8 9.8 Z" fill={red} />
      </svg>
    ),
  },
  {
    label: "Plan",
    href: ROUTES.PLAN,
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="3.5" y="4.5" width="17" height="16" rx="3" stroke={cobalt} strokeWidth="2" />
        <path d="M3.5 9.5 H20.5" stroke={cobalt} strokeWidth="2" />
        <path d="M8 2.5 V6 M16 2.5 V6" stroke={cobalt} strokeWidth="2" strokeLinecap="round" />
        <circle cx="16" cy="15" r="2" fill={red} />
      </svg>
    ),
  },
];

export function BottomTabBar() {
  const pathname = usePathname() ?? "";

  return (
    <nav
      aria-label="Primær navigation"
      className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom,0px)_+_12px)] z-50 flex items-center justify-around rounded-widget px-2 py-2.5 md:hidden"
      style={{
        background: "rgba(255,255,255,0.55)",
        border: "1px solid rgba(255,255,255,0.85)",
        backdropFilter: "blur(28px)",
        WebkitBackdropFilter: "blur(28px)",
        boxShadow: "0 12px 36px rgba(27,41,192,0.18), inset 0 1px 0 rgba(255,255,255,0.9)",
      }}
    >
      {TABS.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex min-h-[44px] min-w-[58px] flex-col items-center justify-center gap-[3px] rounded-tile",
              "cg-interactive transition-[opacity,transform]",
              active ? "opacity-100" : "opacity-55"
            )}
          >
            {tab.icon}
            <span
              className={cn("text-[9.5px] text-cobalt", active ? "font-semibold" : "font-medium")}
            >
              {tab.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

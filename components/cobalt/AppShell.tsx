"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { BackgroundBlobs } from "@/components/cobalt/BackgroundBlobs";
import { BottomTabBar } from "@/components/cobalt/BottomTabBar";
import { NavBar } from "@/components/cobalt/NavBar";

// Shell wrapper that only renders if authenticated OR on /demo.
// This is needed because Next.js layout can't easily read pathname from
// headers() in all cases — the client wrapper guarantees correct routing.
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // /demo is public — always render shell
  if (pathname === "/demo") {
    return (
      <div className="relative min-h-screen bg-silver font-cg-sans text-cobalt">
        <BackgroundBlobs />
        <div className="relative mx-auto max-w-[1360px] px-4 pt-[env(safe-area-inset-top,0px)] pb-[calc(env(safe-area-inset-bottom,0px)_+_96px)] md:px-7 md:pt-0 md:pb-10">
          <NavBar />
          {children}
        </div>
        <BottomTabBar />
      </div>
    );
  }

  return (
    <div className="relative min-h-screen bg-silver font-cg-sans text-cobalt">
      <BackgroundBlobs />
      <div className="relative mx-auto max-w-[1360px] px-4 pt-[env(safe-area-inset-top,0px)] pb-[calc(env(safe-area-inset-bottom,0px)_+_96px)] md:px-7 md:pt-0 md:pb-10">
        <NavBar />
        {children}
      </div>
      <BottomTabBar />
    </div>
  );
}

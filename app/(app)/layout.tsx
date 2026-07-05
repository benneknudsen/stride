import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { BackgroundBlobs } from "@/components/cobalt/BackgroundBlobs";
import { BottomTabBar } from "@/components/cobalt/BottomTabBar";
import { NavBar } from "@/components/cobalt/NavBar";
import { auth } from "@/lib/auth";

// Shared shell for every app page — Hjem (/), Aktiviteter, Coach, Plan, Demo.
// Auth guard skips /demo — public portfolio page.
//
// Mobile: content starts below the iOS status bar (safe-area top inset) and gets
// extra bottom padding so the last widgets clear the floating BottomTabBar.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const heads = await headers();
  const pathname = heads.get("x-next-pathname") || heads.get("next-url") || "";

  if (!session?.user?.id && !pathname.startsWith("/demo")) redirect("/login");

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

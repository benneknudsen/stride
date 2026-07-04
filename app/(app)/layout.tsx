import { redirect } from "next/navigation";
import { BackgroundBlobs } from "@/components/cobalt/BackgroundBlobs";
import { BottomTabBar } from "@/components/cobalt/BottomTabBar";
import { NavBar } from "@/components/cobalt/NavBar";
import { auth } from "@/lib/auth";

// Shared shell for every app page — Hjem (/), Aktiviteter, Coach, Plan. Silver
// "paper" background with the drifting blobs behind, then the centred content
// column carrying the glass nav. This lives in the (app) route group so the
// shell wraps the main pages but NOT the (auth) login route, which has its own
// layout; that is why no conditional header suppression is needed here.
//
// Mobile: content starts below the iOS status bar (safe-area top inset) and gets
// extra bottom padding so the last widgets clear the floating BottomTabBar; the
// horizontal gutter tightens from 28px to 16px. All of this collapses to the
// desktop values from md up, where the tab bar is hidden.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Auth guard for the whole (app) group: every page here is user-scoped, so
  // bounce anonymous visitors to the login route before rendering the shell.
  // Mirrors the session check in actions/activities.ts. The (auth)/login route
  // lives in a different route group with its own layout, so it is never caught
  // by this guard.
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

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

import { BackgroundBlobs } from "@/components/cobalt/BackgroundBlobs";
import { BottomTabBar } from "@/components/cobalt/BottomTabBar";
import { NavBar } from "@/components/cobalt/NavBar";
import { auth } from "@/lib/auth";

// Shared Cobalt Glass shell for every (app) page.
// Auth is handled by the proxy middleware (proxy.ts) — this layout only
// provides the visual wrapper. /demo is public because it's not in
// the middleware's APP_ROUTES list, so `session` is null there and the NavBar
// renders without an identity chip rather than inventing one.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const user = session?.user;
  // Email sign-in leaves `name` null, so fall back to the address' local part.
  const userName = user?.name?.trim() || user?.email?.split("@")[0] || undefined;

  return (
    <div className="relative min-h-screen bg-silver font-cg-sans text-cobalt">
      <BackgroundBlobs />
      <div className="relative mx-auto max-w-[1360px] px-4 pt-[env(safe-area-inset-top,0px)] pb-[calc(env(safe-area-inset-bottom,0px)_+_96px)] md:px-7 md:pt-0 md:pb-10">
        <NavBar userName={userName} />
        {children}
      </div>
      <BottomTabBar />
    </div>
  );
}

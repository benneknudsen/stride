import { BackgroundBlobs } from "@/components/cobalt/BackgroundBlobs";
import { BottomTabBar } from "@/components/cobalt/BottomTabBar";
import { NavBar } from "@/components/cobalt/NavBar";
import { auth } from "@/lib/auth";

// Shared Cobalt Glass shell for every (app) page.
// Every page here is public (issue #100): each one falls back to the demo
// fixtures when there is no session (#84). `session` is simply null for a
// visitor, so the NavBar renders without an identity chip rather than
// inventing one.
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

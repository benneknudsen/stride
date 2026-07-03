import { BackgroundBlobs } from "@/components/cobalt/BackgroundBlobs";
import { BottomTabBar } from "@/components/cobalt/BottomTabBar";
import { NavBar } from "@/components/cobalt/NavBar";

// Shared shell for every Cobalt Glass page: silver "paper" background with the
// drifting blobs behind, then the centred content column carrying the glass nav.
// The legacy AppHeader is suppressed on these routes (see ConditionalAppHeader).
//
// Mobile: content starts below the iOS status bar (safe-area top inset) and gets
// extra bottom padding so the last widgets clear the floating BottomTabBar; the
// horizontal gutter tightens from 28px to 16px. All of this collapses to the
// desktop values from md up, where the tab bar is hidden.
export default function CobaltLayout({ children }: { children: React.ReactNode }) {
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

import { BackgroundBlobs } from "@/components/cobalt/BackgroundBlobs";
import { NavBar } from "@/components/cobalt/NavBar";

// Shared shell for every Cobalt Glass page: silver "paper" background with the
// drifting blobs behind, then the centred content column carrying the glass nav.
// The legacy AppHeader is suppressed on these routes (see ConditionalAppHeader).
export default function CobaltLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen bg-silver font-cg-sans text-cobalt">
      <BackgroundBlobs />
      <div className="relative mx-auto max-w-[1360px] px-7 pb-10">
        <NavBar />
        {children}
      </div>
    </div>
  );
}

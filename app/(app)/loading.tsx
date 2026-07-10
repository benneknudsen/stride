import { RunnerLoader } from "@/components/cobalt/RunnerLoader";

// Suspense fallback for every (app) page. Next.js renders this inside
// app/(app)/layout.tsx, so the Cobalt shell (NavBar + BottomTabBar +
// background blobs) stays put while the page's server work streams in.
export default function AppLoading() {
  return (
    <main className="flex min-h-[60vh] items-center justify-center">
      <RunnerLoader size={70} label="HENTER DINE DATA…" />
    </main>
  );
}

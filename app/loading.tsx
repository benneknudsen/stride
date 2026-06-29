import { LoadingCard } from "@/components/dashboard/loading-card";

export default function DashboardLoading() {
  return (
    <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-8">
      <div className="mb-8">
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-fg">Dashboard</h1>
        <p className="mt-1 text-sub">Your training at a glance</p>
      </div>

      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <LoadingCard label="Loading stats…" className="min-h-[120px]" />
          <LoadingCard label="Loading stats…" className="min-h-[120px]" />
          <LoadingCard label="Loading stats…" className="min-h-[120px]" />
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <LoadingCard label="Charting volume…" />
          <LoadingCard label="Charting pace…" />
        </div>

        <LoadingCard label="Analysing your runs…" />
      </div>
    </main>
  );
}

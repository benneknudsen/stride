import Link from "next/link";
import { GlassCard } from "@/components/cobalt/GlassCard";
import { ROUTES } from "@/lib/routes";

// The fallback when an activity id matches neither the user's own runs nor the
// demo fixtures (issue #92). Route-level, so it renders inside the Cobalt Glass
// shell — the app-wide app/not-found.tsx is the legacy English page.
export default function ActivityNotFound() {
  return (
    <main className="flex min-h-[60vh] items-center justify-center px-3">
      <GlassCard className="max-w-[420px] p-10 text-center">
        <div className="cg-label text-[11px] tracking-[0.2em] text-red">404 · Aktivitet</div>
        <h1 className="mt-3 mb-2 font-cg-serif text-[32px] italic leading-[1.1] text-cobalt">
          Turen findes ikke
        </h1>
        <p className="text-[14px] text-ink">
          Aktiviteten er enten slettet, eller også hører den til en anden bruger.
        </p>
        <Link
          href={ROUTES.AKTIVITETER}
          className="cg-interactive mt-6 inline-flex min-h-[44px] items-center rounded-pill border border-cobalt bg-cobalt px-[18px] py-2 cg-label text-[11px] tracking-[0.16em] text-silver"
        >
          Alle aktiviteter
        </Link>
      </GlassCard>
    </main>
  );
}

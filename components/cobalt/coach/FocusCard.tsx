import Link from "next/link";
import { GlassCard } from "@/components/cobalt/GlassCard";
import { ROUTES } from "@/lib/routes";

// "Ugens fokus" (cobalt surface): the week's headline recommendation as a serif-
// italic quote in guillemets, plus a silver pill linking into the plan.
export function FocusCard({ quote }: { quote: string }) {
  return (
    <GlassCard variant="cobalt" className="rounded-widget px-[26px] py-[22px]">
      <div className="mb-3 font-cg-mono text-[10px] uppercase tracking-[0.18em] text-silver/70">
        Ugens fokus
      </div>
      <p className="m-0 font-cg-serif text-[21px] italic leading-[1.35] text-silver">»{quote}«</p>
      <Link
        href={ROUTES.PLAN}
        className="mt-4 inline-block rounded-pill bg-silver px-5 py-2.5 text-[13px] font-semibold text-cobalt transition-colors hover:bg-white"
      >
        Se i planen →
      </Link>
    </GlassCard>
  );
}

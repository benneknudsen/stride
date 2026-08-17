import Link from "next/link";
import { GlassCard } from "@/components/cobalt/GlassCard";
import { RunnerGlyph } from "@/components/cobalt/RunnerGlyph";
import { ROUTES } from "@/lib/routes";

// "AI Coach" widget (5/12, cobalt variant): the runner glyph + mono label, a
// serif-italic coaching quote in guillemets, and the "Spørg coach" pill. The
// "Ugens plan" pill is gone with the weekly schedule it pointed at — the coach
// recommends the next activity from the last five runs instead.
export function AiCoachCard({ quote }: { quote: string }) {
  return (
    <GlassCard
      variant="cobalt"
      className="flex flex-col justify-between gap-5 rounded-widget p-[26px]"
    >
      <div className="flex items-center gap-2.5">
        <RunnerGlyph size={22} stroke="var(--color-silver)" head="var(--color-red)" />
        <span className="cg-label tracking-[0.2em] text-silver/90">AI Coach</span>
      </div>

      <p className="m-0 font-cg-serif text-[22px] italic leading-[1.28] text-silver">»{quote}«</p>

      <div className="flex flex-wrap gap-3">
        <Link
          href={ROUTES.COACH}
          className="cg-interactive rounded-pill bg-silver px-[18px] py-[9px] text-[12.5px] font-semibold text-cobalt transition-colors hover:bg-white"
        >
          Spørg coach
        </Link>
      </div>
    </GlassCard>
  );
}

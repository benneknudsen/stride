import Link from "next/link";
import { FlipText } from "@/components/cobalt/FlipText";
import { IntensityMeter } from "@/components/cobalt/IntensityMeter";
import { SourceBadge } from "@/components/cobalt/SourceBadge";
import type { ActivityDetailView } from "@/lib/cobalt/aktivitet";
import { TITLE_FLIP } from "@/lib/cobalt/flip";
import { formatDanish } from "@/lib/cobalt/format";
import { PAGE_TITLE_CLASS } from "@/lib/cobalt/title";
import { zoneBadgeText } from "@/lib/cobalt/zones";
import { ROUTES } from "@/lib/routes";
import { cn } from "@/lib/utils";

// Detail header: the back link, a red mono type/date line, the serif-italic
// activity name, and the three headline numbers (km / tid / tempo). Sits on the
// silver paper (no glass), mirroring ActivitiesHeader on the list page.
export function ActivityDetailHeader({ view }: { view: ActivityDetailView }) {
  return (
    <header className="px-3 pt-[26px] pb-2">
      <Link
        href={ROUTES.AKTIVITETER}
        className="cg-interactive inline-flex min-h-[44px] items-center gap-2 cg-label text-[11px] tracking-[0.16em] transition-colors hover:text-cobalt"
      >
        <span aria-hidden="true">←</span> Alle aktiviteter
      </Link>

      <div className="mt-2 flex flex-wrap items-end justify-between gap-x-8 gap-y-6">
        <div className="min-w-0 [animation:cg-fade-up_0.7s_ease_both] motion-reduce:[animation:none]">
          <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 cg-label text-[11px] tracking-[0.2em] text-red">
            <span>
              {view.typeLabel} · {view.dateLabel}
            </span>
            <SourceBadge source={view.source} />
          </div>

          <h1 className={cn(PAGE_TITLE_CLASS, "flex items-center gap-4")}>
            {view.zone ? (
              <IntensityMeter
                level={view.zone.level}
                size={48}
                label={view.zone.label}
                className="hidden sm:flex"
              />
            ) : null}
            <span className="min-w-0 break-words">
              <FlipText {...TITLE_FLIP}>{view.name}</FlipText>
            </span>
          </h1>

          {view.zone ? (
            <p
              className={cn(
                "mt-3 font-cg-sans text-[14px] font-semibold",
                view.zone.tone === "red" ? "text-red" : "text-cobalt"
              )}
            >
              {zoneBadgeText(view.zone)}
            </p>
          ) : (
            <p className="mt-3 font-cg-sans text-[14px] text-ink">Ingen pulsdata på denne tur.</p>
          )}
        </div>

        <div className="flex gap-6 sm:gap-9 [animation:cg-fade-up_0.7s_0.1s_ease_both] motion-reduce:[animation:none]">
          <HeadlineStat value={formatDanish(view.km, 1)} label="km" />
          <HeadlineStat value={view.durationLabel} label="tid" />
          <HeadlineStat
            value={view.paceLabel}
            label="min/km"
            tone={view.zone?.tone === "red" ? "red" : "cobalt"}
          />
        </div>
      </div>
    </header>
  );
}

function HeadlineStat({
  value,
  label,
  tone = "cobalt",
}: {
  value: string;
  label: string;
  tone?: "cobalt" | "red";
}) {
  return (
    <div>
      <div
        className={cn(
          "font-cg-display text-[30px] font-bold tracking-[-0.02em] sm:text-[44px]",
          tone === "red" ? "text-red" : "text-cobalt"
        )}
      >
        {value}
      </div>
      <div className="cg-label text-[11px]">{label}</div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { ActivitiesHeader } from "@/components/cobalt/aktiviteter/ActivitiesHeader";
import { ActivityRow } from "@/components/cobalt/aktiviteter/ActivityRow";
import { FilterChips } from "@/components/cobalt/aktiviteter/FilterChips";
import { LoadingOverlay } from "@/components/cobalt/LoadingOverlay";
import type { ActivitiesView, ActivityFilter } from "@/lib/cobalt/aktiviteter";

// Aktiviteter (Activities) — the Cobalt Glass list page. Owns the client-only
// loading choreography and filter state the server page can't: nav + header
// stay interactive while one overlay covers the widget area (chips + list) for
// a beat; when it lifts, the month totals count up and each row fades up in
// sequence. The view itself is built server-side (demo or live) and arrives as
// a plain-JSON prop.
export function AktiviteterPageClient({ view }: { view: ActivitiesView }) {
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<ActivityFilter>("alle");

  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 300);
    return () => clearTimeout(timer);
  }, []);

  const started = !loading;
  const rows = filter === "alle" ? view.rows : view.rows.filter((r) => r.category === filter);

  return (
    <main>
      <ActivitiesHeader
        periodLabel={view.periodLabel}
        totalKm={view.totalKm}
        totalRuns={view.totalRuns}
        totalSeconds={view.totalSeconds}
        started={started}
      />

      {/* Widget area: covered by one loading overlay; nav + header stay clickable. */}
      <div className="relative pt-2">
        <div className="pt-[10px] pb-4 [animation:cg-fade-up_0.6s_0.1s_ease_both] motion-reduce:[animation:none]">
          <FilterChips active={filter} onChange={setFilter} />
        </div>

        <div className="flex flex-col gap-3">
          {rows.map((row, i) => (
            <div
              key={row.id}
              className="[animation:cg-fade-up_0.5s_ease_both] motion-reduce:[animation:none]"
              style={{ animationDelay: `${Math.min(i * 0.05, 0.4)}s` }}
            >
              <ActivityRow row={row} />
            </div>
          ))}

          {rows.length === 0 ? (
            <div className="rounded-card border border-dashed border-cobalt/25 bg-white/35 p-10 text-center text-[14px] text-ink">
              Ingen ture matcher filteret.
            </div>
          ) : null}
        </div>

        <p className="mt-[18px] px-2 text-[12px] text-ink [animation:cg-fade-up_0.6s_0.2s_ease_both] motion-reduce:[animation:none]">
          Intensitet måles ud fra din puls:{" "}
          <strong className="font-semibold text-cobalt">rolig er snak-fart</strong>, moderat er
          behageligt hårdt,{" "}
          <strong className="font-semibold text-red">
            hårdt til maks er tempo- og intervalarbejde
          </strong>
          .
        </p>

        <LoadingOverlay show={loading} label="HENTER DINE TURE…" />
      </div>
    </main>
  );
}

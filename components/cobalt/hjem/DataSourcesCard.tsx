"use client";

import { useState } from "react";
import { GlassCard } from "@/components/cobalt/GlassCard";

// "Datakilder" widget (5/12): Garmin row (connected, green dot) + Strava row
// with a connect-flow (orange button → connected). A plain-language zone legend
// sits at the bottom — no "Z2"/"Z4" codes anywhere.
const ZONE_LEGEND = [
  { label: "Rolig snak-fart", color: "var(--color-cobalt)" },
  { label: "Moderat tempo", color: "rgba(27,41,192,0.6)" },
  { label: "Hårdt tempo", color: "var(--color-red)" },
];

function SourceRow({
  name,
  dotColor,
  children,
}: {
  name: string;
  dotColor: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="flex items-center justify-between gap-3 rounded-card px-3 py-3"
      style={{ background: "rgba(255,255,255,0.4)" }}
    >
      <div className="flex items-center gap-2.5">
        <span className="size-[9px] rounded-full" style={{ background: dotColor }} />
        <span className="text-[14px] font-semibold text-cobalt">{name}</span>
      </div>
      {children}
    </div>
  );
}

export function DataSourcesCard() {
  const [stravaConnected, setStravaConnected] = useState(false);

  return (
    <GlassCard className="flex flex-col rounded-widget p-[26px]">
      <h2 className="m-0 mb-4 font-cg-serif text-[22px] italic tracking-[-0.01em] text-cobalt">
        Datakilder
      </h2>

      <div className="flex flex-col gap-2.5">
        <SourceRow name="Garmin Connect" dotColor="var(--color-success)">
          <span className="font-cg-mono text-[10px] uppercase tracking-[0.14em] text-success-ink">
            Forbundet
          </span>
        </SourceRow>

        <SourceRow
          name="Strava"
          dotColor={stravaConnected ? "var(--color-success)" : "var(--color-strava)"}
        >
          {stravaConnected ? (
            <span className="font-cg-mono text-[10px] uppercase tracking-[0.14em] text-success-ink">
              Forbundet
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setStravaConnected(true)}
              className="rounded-pill px-[16px] py-[7px] text-[12px] font-semibold text-white transition-opacity hover:opacity-90"
              style={{ background: "var(--color-strava)" }}
            >
              Forbind
            </button>
          )}
        </SourceRow>
      </div>

      <div className="mt-5 border-t pt-4" style={{ borderColor: "rgba(27,41,192,0.1)" }}>
        <div className="mb-2.5 font-cg-mono text-[9.5px] uppercase tracking-[0.16em] text-ink">
          Zoner i klartekst
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {ZONE_LEGEND.map((zone) => (
            <span key={zone.label} className="flex items-center gap-2 text-[12px] text-ink">
              <span className="size-[7px] rounded-full" style={{ background: zone.color }} />
              {zone.label}
            </span>
          ))}
        </div>
      </div>
    </GlassCard>
  );
}

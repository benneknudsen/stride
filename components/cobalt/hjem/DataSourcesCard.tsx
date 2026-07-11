"use client";

import { useState, useTransition } from "react";
import { connectStrava } from "@/actions/strava";
import { GlassCard } from "@/components/cobalt/GlassCard";
import { ROUTES } from "@/lib/routes";

// "Datakilder" widget (5/12): the Strava row, reflecting the user's real
// connection state (issue #98 — it used to hardcode a "Garmin Forbundet" row for
// an integration that doesn't exist, and faked the connect with local state).
// Strava is the only source the app actually ingests; the button runs the real
// PKCE OAuth flow. A plain-language zone legend sits at the bottom — no
// "Z2"/"Z4" codes anywhere.
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

export function DataSourcesCard({
  stravaConnected,
  signedIn,
}: {
  stravaConnected: boolean;
  /** Visitors on /demo can't start an OAuth flow — the callback needs a session. */
  signedIn: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);

  const handleConnect = () => {
    setFailed(false);
    startTransition(async () => {
      try {
        const { url } = await connectStrava();
        window.location.assign(url);
      } catch {
        setFailed(true);
      }
    });
  };

  return (
    <GlassCard className="flex flex-col rounded-widget p-[26px]">
      <h2 className="m-0 mb-4 font-cg-serif text-[22px] italic tracking-[-0.01em] text-cobalt">
        Datakilder
      </h2>

      <div className="flex flex-col gap-2.5">
        <SourceRow
          name="Strava"
          dotColor={stravaConnected ? "var(--color-success)" : "var(--color-strava)"}
        >
          {stravaConnected ? (
            <span className="font-cg-mono text-[10px] uppercase tracking-[0.14em] text-success-ink">
              Forbundet
            </span>
          ) : signedIn ? (
            <button
              type="button"
              onClick={handleConnect}
              disabled={pending}
              className="cg-interactive rounded-pill px-[16px] py-[7px] text-[12px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
              style={{ background: "var(--color-strava)" }}
            >
              {pending ? "Forbinder…" : "Forbind"}
            </button>
          ) : (
            <a
              href={ROUTES.LOGIN}
              className="cg-interactive rounded-pill px-[16px] py-[7px] text-[12px] font-semibold text-white transition-opacity hover:opacity-90"
              style={{ background: "var(--color-strava)" }}
            >
              Log ind for at forbinde
            </a>
          )}
        </SourceRow>

        {failed ? (
          <p className="m-0 px-3 text-[12px] text-red">
            Kunne ikke starte forbindelsen. Prøv igen.
          </p>
        ) : null}
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

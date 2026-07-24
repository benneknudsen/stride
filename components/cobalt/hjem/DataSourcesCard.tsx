"use client";

import { useState, useTransition } from "react";
import { connectStrava } from "@/actions/strava";
import { GlassCard } from "@/components/cobalt/GlassCard";
import { ROUTES } from "@/lib/routes";

// "Datakilder" widget (5/12): one row per provider, each reflecting the user's
// real connection state. Strava is a data-only link (a server action mints the
// PKCE challenge, and the callback stores the tokens).
//
// A plain-language zone legend sits at the bottom — no "Z2"/"Z4" codes anywhere.
const ZONE_LEGEND = [
  { label: "Rolig snak-fart", color: "var(--color-cobalt)" },
  { label: "Moderat tempo", color: "color-mix(in srgb, var(--color-cobalt) 60%, transparent)" },
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

/** The connect/status control on the right of a provider row. */
function ConnectControl({
  connected,
  signedIn,
  pending,
  brandColor,
  onConnect,
}: {
  connected: boolean;
  signedIn: boolean;
  pending: boolean;
  brandColor: string;
  onConnect: () => void;
}) {
  if (connected) {
    return <span className="cg-label text-success-ink">Forbundet</span>;
  }

  if (!signedIn) {
    return (
      <a
        href={ROUTES.LOGIN}
        className="cg-interactive rounded-pill px-[16px] py-[7px] text-[12px] font-semibold text-white transition-opacity hover:opacity-90"
        style={{ background: brandColor }}
      >
        Log ind for at forbinde
      </a>
    );
  }

  return (
    <button
      type="button"
      onClick={onConnect}
      disabled={pending}
      className="cg-interactive rounded-pill px-[16px] py-[7px] text-[12px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
      style={{ background: brandColor }}
    >
      {pending ? "Forbinder…" : "Forbind"}
    </button>
  );
}

export function DataSourcesCard({
  stravaConnected,
  signedIn,
}: {
  stravaConnected: boolean;
  /** Visitors can't start an OAuth flow — the callback needs a session. */
  signedIn: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);

  const handleConnectStrava = () => {
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
          <ConnectControl
            connected={stravaConnected}
            signedIn={signedIn}
            pending={pending}
            brandColor="var(--color-strava)"
            onConnect={handleConnectStrava}
          />
        </SourceRow>

        {failed ? (
          <p className="m-0 px-3 text-[12px] text-red">
            Kunne ikke starte forbindelsen. Prøv igen.
          </p>
        ) : null}
      </div>

      <div
        className="mt-5 border-t pt-4"
        style={{ borderColor: "color-mix(in srgb, var(--color-cobalt) 10%, transparent)" }}
      >
        <div className="mb-2.5 cg-label-sm tracking-[0.16em]">Zoner i klartekst</div>
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

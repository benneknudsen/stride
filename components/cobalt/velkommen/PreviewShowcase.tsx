"use client";

import { useEffect, useState } from "react";
import { CountUpNumber } from "@/components/cobalt/CountUpNumber";
import { AvgPaceRing } from "@/components/cobalt/hjem/AvgPaceRing";
import { RouteCard } from "@/components/cobalt/hjem/RouteCard";
import { VolumeCard } from "@/components/cobalt/hjem/VolumeCard";

// The landing page's "live forsmag": three of the real dashboard widgets fed by
// the real demo view-model — not screenshots, the actual components. The only
// job of this client wrapper is the entrance choreography: `started` flips a
// beat after mount so the ring sweeps, the bars grow and the km counts up in
// front of the visitor, exactly like they do on Hjem.
export function PreviewShowcase({
  weeklyKm,
  routeCoords,
  routeKm,
  routeElevation,
  routeName,
  avgPaceLabel,
  avgPaceFraction,
  avgPaceDeltaLabel,
  volumeBars,
}: {
  weeklyKm: number;
  routeCoords: [number, number][];
  routeKm: number;
  routeElevation: number;
  routeName: string;
  avgPaceLabel: string;
  avgPaceFraction: number;
  avgPaceDeltaLabel: string | null;
  volumeBars: { id: string; km: number }[];
}) {
  const [started, setStarted] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setStarted(true), 250);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-x-8 gap-y-3 px-1">
        <p className="m-0 max-w-[380px] text-[13.5px] leading-relaxed text-ink">
          Det her er ikke et screenshot — det er de rigtige dashboard-widgets, drevet af demoens 30
          løbeture.
        </p>
        <CountUpNumber
          value={weeklyKm}
          decimals={1}
          label="km · denne uge"
          run={started}
          className="items-end text-right text-[44px] text-cobalt"
        />
      </div>

      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-12 h-full md:col-span-5 [&>*]:h-full">
          <RouteCard
            coords={routeCoords}
            km={routeKm}
            elevation={routeElevation}
            name={routeName}
          />
        </div>
        <div className="col-span-12 h-full sm:col-span-6 md:col-span-3 [&>*]:h-full">
          <AvgPaceRing
            paceLabel={avgPaceLabel}
            fraction={avgPaceFraction}
            deltaLabel={avgPaceDeltaLabel}
            started={started}
          />
        </div>
        <div className="col-span-12 h-full sm:col-span-6 md:col-span-4 [&>*]:h-full">
          <VolumeCard bars={volumeBars} started={started} />
        </div>
      </div>
    </div>
  );
}

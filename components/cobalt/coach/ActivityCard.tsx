"use client";

import { ChevronRight, Footprints, HeartPulse } from "lucide-react";
import Link from "next/link";
import { formatDanish } from "@/lib/cobalt/format";
import { formatPace } from "@/lib/metrics";
import { activityRoute } from "@/lib/routes";
import { cn } from "@/lib/utils";
import type { ChatActivity } from "@/types/chat";

// A coach-chat activity card (issue #221): the model calls `getRecentActivities`,
// the route validates the tool output and streams it as a block, and this
// renders it as a clickable card that lands on the activity's detail page (#92).
// The numbers come from the tool, never the model — pace is rebuilt from
// distance/movingTime here (m/s = meters ÷ seconds), so the card never trusts a
// model-supplied pace.

const DA_WEEKDAYS = ["søn", "man", "tir", "ons", "tor", "fre", "lør"];
const DA_MONTHS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "maj",
  "jun",
  "jul",
  "aug",
  "sep",
  "okt",
  "nov",
  "dec",
];

/** "tir 30. jun" — a short Danish date, or "" for an unparseable timestamp. */
function dateLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${DA_WEEKDAYS[d.getDay()]} ${d.getDate()}. ${DA_MONTHS[d.getMonth()]}`;
}

/** Running activity types: "Run", "TrailRun", "Løb", … → "Løb"; else the raw type. */
function typeLabel(type: string): string {
  return /run|løb/i.test(type) ? "Løb" : type;
}

export function ActivityCard({ activity }: { activity: ChatActivity }) {
  const km = activity.distance / 1000;
  const pace = formatPace(activity.movingTime > 0 ? activity.distance / activity.movingTime : null);
  const hr = activity.averageHeartrate ? Math.round(activity.averageHeartrate) : null;
  const date = dateLabel(activity.startDate);

  return (
    <Link
      href={activityRoute(activity.id)}
      className="cg-interactive cg-glass block rounded-[14px] px-4 py-3 transition-colors hover:bg-white/[0.58]"
    >
      <div className="flex items-center gap-3">
        <div
          className="flex size-9 flex-none items-center justify-center rounded-full bg-cobalt/10 text-cobalt"
          aria-hidden="true"
        >
          <Footprints size={17} strokeWidth={2} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold text-cobalt">{typeLabel(activity.type)}</div>
          {date ? <div className="mt-0.5 text-[12px] text-ink">{date}</div> : null}
        </div>

        <div className="grid flex-none auto-cols-[2.5rem] grid-flow-col items-end gap-2.5 text-right font-cg-mono">
          <div>
            <div className="text-[15px] font-bold tracking-[-0.02em] text-cobalt">
              {formatDanish(km, 1)}
            </div>
            <div className="text-[10px] text-ink">km</div>
          </div>
          <div>
            <div className="text-[15px] font-bold tracking-[-0.02em] text-cobalt">{pace}</div>
            <div className="text-[10px] text-ink">/km</div>
          </div>
          {hr !== null ? (
            <div>
              <div className="text-[15px] font-bold tracking-[-0.02em] text-cobalt">{hr}</div>
              <div className="flex items-center justify-end gap-0.5 text-[10px] text-ink">
                <HeartPulse size={10} strokeWidth={2} className="text-red" aria-hidden="true" />
                bpm
              </div>
            </div>
          ) : null}
        </div>

        <ChevronRight
          size={16}
          className={cn("flex-none text-ink/50")}
          strokeWidth={2}
          aria-hidden="true"
        />
      </div>
    </Link>
  );
}

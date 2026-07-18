import { GlassCard } from "@/components/cobalt/GlassCard";
import type { PhaseMarker, PhaseSegment } from "@/lib/cobalt/plan";

// Segment fills for the timeline bar. "active" is half cobalt / half muted to
// show progress through the current phase.
const SEGMENT_STYLE: Record<PhaseSegment["fill"], string> = {
  done: "var(--color-cobalt)",
  active:
    "linear-gradient(90deg, var(--color-cobalt) 55%, color-mix(in srgb, var(--color-cobalt) 15%, transparent) 55%)",
  upcoming: "color-mix(in srgb, var(--color-cobalt) 15%, transparent)",
};

// Label colour per phase state.
const LABEL_TONE: Record<PhaseMarker["state"], string> = {
  done: "text-cobalt",
  active: "text-red",
  upcoming: "text-ink",
  race: "text-red",
};

// Dot colour per phase state — done/active are filled, upcoming is a hollow
// muted marker, race reads red.
const DOT_STYLE: Record<PhaseMarker["state"], string> = {
  done: "bg-cobalt",
  active: "bg-red",
  upcoming: "border-[1.5px] border-cobalt/30 bg-silver",
  race: "bg-red",
};

// Phase timeline — Base ✓ / Build · nu / Peak / Taper / Race. A row of mono
// labels over a 4-segment progress bar, with a dot marking each phase boundary.
// When `started`, the dots pop in staggered along the line.
export function PhaseTimeline({
  markers,
  segments,
  started,
}: {
  markers: PhaseMarker[];
  segments: PhaseSegment[];
  started: boolean;
}) {
  return (
    <GlassCard className="rounded-card px-6 py-5" data-testid="phase-timeline">
      <div className="mb-2.5 flex justify-between font-cg-mono text-[9px] uppercase tracking-[0.06em] sm:text-[10px] sm:tracking-[0.14em]">
        {/* Six labels don't fit a 375px row, so below sm each falls back to its
            short form ("Race" rather than "Race 13. sep"). */}
        {markers.map((m) => (
          <span key={m.label} className={LABEL_TONE[m.state]}>
            <span className="sm:hidden">{m.shortLabel}</span>
            <span className="hidden sm:inline">{m.label}</span>
          </span>
        ))}
      </div>

      <div className="relative">
        <div className="flex h-2 gap-[5px]">
          {segments.map((seg) => (
            <div
              key={seg.id}
              data-testid="phase-segment"
              className="rounded-pill"
              style={{ flex: seg.flex, background: SEGMENT_STYLE[seg.fill] }}
            />
          ))}
        </div>

        {/* Phase dots, centred on the bar at each boundary. */}
        <div className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2">
          {markers.map((m, i) => (
            <span
              key={m.label}
              className={`absolute size-[9px] -translate-x-1/2 rounded-full transition-transform duration-500 ease-out motion-reduce:transition-none ${DOT_STYLE[m.state]} ${
                m.state === "active"
                  ? "[animation:cg-pulse-dot_1.8s_ease-in-out_infinite] motion-reduce:animate-none"
                  : ""
              }`}
              style={{
                left: `${m.position * 100}%`,
                top: "50%",
                transform: `translate(-50%, -50%) scale(${started ? 1 : 0})`,
                transitionDelay: `${0.1 + i * 0.08}s`,
              }}
            />
          ))}
        </div>
      </div>
    </GlassCard>
  );
}

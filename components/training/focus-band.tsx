import { ZONE_COLOR, type ZoneKey } from "@/lib/training/goals";

const ALL_ZONES: ZoneKey[] = ["z1", "z2", "z3", "z4", "z5"];

/** The FOCUS row: five zone pips with the plan's emphasised zones lit up. */
export function FocusBand({ band }: { band: ZoneKey[] }) {
  return (
    <span className="flex items-center gap-[7px]">
      <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-muted">Focus</span>
      {ALL_ZONES.map((zone) => {
        const on = band.includes(zone);
        return (
          <span
            key={zone}
            className="h-[5px] w-[14px] rounded-[3px]"
            style={{
              background: on ? ZONE_COLOR[zone] : "var(--color-border-2)",
              opacity: on ? 1 : 0.6,
            }}
          />
        );
      })}
    </span>
  );
}

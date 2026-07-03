import { type IntensityTone, intensityBarTone } from "@/lib/cobalt/format";
import { cn } from "@/lib/utils";

// 5-bar intensity "brik" (never a number). Active bars 1–2 read cobalt, active
// bars 3–5 read red, inactive bars sit at 15% opacity. `level` (1–5) sets how
// many bars light up.
const BAR_HEIGHTS = [7, 11, 15, 19, 23];
const BAR_IDS = ["b1", "b2", "b3", "b4", "b5"];

const TONE_COLOR: Record<IntensityTone, string> = {
  cobalt: "var(--color-cobalt)",
  red: "var(--color-red)",
  inactive: "rgba(27, 41, 192, 0.15)",
};

export function IntensityMeter({
  level,
  size = 42,
  className,
  label,
}: {
  level: number;
  size?: number;
  className?: string;
  label?: string;
}) {
  return (
    <div
      role="img"
      aria-label={label ?? `Intensitet ${level} af 5`}
      title={label}
      className={cn(
        "flex flex-none items-end justify-center gap-[2.5px] rounded-tile border pb-[9px]",
        className
      )}
      style={{
        width: size,
        height: size,
        background: "rgba(255, 255, 255, 0.55)",
        borderColor: "rgba(27, 41, 192, 0.15)",
      }}
    >
      {BAR_HEIGHTS.map((height, i) => (
        <span
          key={BAR_IDS[i]}
          className="w-1 rounded-[2px]"
          style={{ height, background: TONE_COLOR[intensityBarTone(i + 1, level)] }}
        />
      ))}
    </div>
  );
}

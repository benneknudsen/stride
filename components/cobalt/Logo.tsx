import { RunnerGlyph } from "@/components/cobalt/RunnerGlyph";
import { cn } from "@/lib/utils";

// The nav "brik": a cobalt gradient tile holding the silver runner glyph.
export function Logo({
  size = 34,
  radius = 11,
  className,
}: {
  size?: number;
  radius?: number;
  className?: string;
}) {
  return (
    <div
      className={cn("flex flex-none items-center justify-center", className)}
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: "linear-gradient(150deg, var(--color-cobalt-light), var(--color-cobalt-dark))",
      }}
    >
      <RunnerGlyph
        size={Math.round(size * 0.62)}
        stroke="var(--color-silver)"
        head="var(--color-red)"
        title="Stride"
      />
    </div>
  );
}

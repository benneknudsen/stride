import { Card } from "@/components/ui/card";

interface StatCardProps {
  label: string;
  value: string;
  unit: string;
  accent?: "volt" | "signal" | "aqua";
}

/** A single summary metric tile (label, big number, unit). */
export function StatCard({ label, value, unit, accent = "volt" }: StatCardProps) {
  const accentColor = {
    volt: "text-volt",
    signal: "text-signal",
    aqua: "text-aqua",
  }[accent];

  return (
    <Card className="flex-1">
      <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted">{label}</p>
      <div className="mt-2 flex items-baseline gap-2">
        <span className={`tabular text-3xl font-semibold ${accentColor}`}>{value}</span>
        <span className="text-sm text-sub">{unit}</span>
      </div>
    </Card>
  );
}

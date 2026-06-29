import { ArrowLeft } from "lucide-react";
import { LoadingCard } from "@/components/dashboard/loading-card";
import { Card } from "@/components/ui/card";

function Bar({ className }: { className?: string }) {
  return <span className={`block animate-pulse rounded-md bg-card-2 ${className ?? ""}`} />;
}

export default function ActivityLoading() {
  return (
    <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-8">
      <span className="inline-flex items-center gap-1.5 text-sm text-muted">
        <ArrowLeft className="size-4" />
        Back to Dashboard
      </span>

      <div className="mt-6 mb-8">
        <Bar className="h-8 w-64" />
        <Bar className="mt-3 h-4 w-40" />
      </div>

      <Card hover={false} className="mb-6">
        <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-6">
          {["distance", "duration", "pace", "hr", "max-hr", "cadence"].map((stat) => (
            <div key={stat} className="flex flex-col gap-2">
              <Bar className="h-3 w-16" />
              <Bar className="h-6 w-20" />
            </div>
          ))}
        </div>
        <div className="mt-6 border-t border-border pt-4">
          <div className="flex flex-col gap-2">
            <Bar className="h-3 w-24" />
            <Bar className="h-6 w-20" />
          </div>
        </div>
      </Card>

      <div className="space-y-6">
        <LoadingCard label="Loading route…" />
        <LoadingCard label="Loading splits…" />
        <LoadingCard label="Loading heart rate…" />
      </div>
    </main>
  );
}

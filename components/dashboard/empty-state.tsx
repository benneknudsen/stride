import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  action?: React.ReactNode;
  className?: string;
}

/** Centered empty/zero-data state: icon, headline, supporting copy, optional CTA. */
export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center px-6 py-12 text-center", className)}>
      <span className="flex size-12 items-center justify-center rounded-full border border-border bg-card-2 text-muted">
        <Icon className="size-5" />
      </span>
      <h3 className="mt-4 font-heading text-base font-semibold text-fg">{title}</h3>
      <p className="mt-1 max-w-xs text-sm text-sub">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

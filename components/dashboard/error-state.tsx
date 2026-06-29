"use client";

import { RotateCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ErrorStateProps {
  title?: string;
  description?: string;
  /** Retry handler — typically the `reset` from an error boundary. */
  onRetry?: () => void;
  retryLabel?: string;
  /** Extra action rendered next to retry, e.g. a "Back to dashboard" link. */
  action?: React.ReactNode;
  className?: string;
}

/** Shared error UI for route error boundaries: icon, message, and a retry CTA. */
export function ErrorState({
  title = "Something went wrong",
  description = "We couldn't load this just now. Please try again.",
  onRetry,
  retryLabel = "Try again",
  action,
  className,
}: ErrorStateProps) {
  return (
    <div className={className}>
      <div className="flex flex-col items-center px-6 py-12 text-center">
        <span className="flex size-12 items-center justify-center rounded-full border border-destructive/30 bg-destructive/10 text-destructive">
          <TriangleAlert className="size-5" />
        </span>
        <h3 className="mt-4 font-heading text-base font-semibold text-fg">{title}</h3>
        <p className="mt-1 max-w-sm text-sm text-sub">{description}</p>
        {(onRetry || action) && (
          <div className="mt-5 flex items-center gap-3">
            {onRetry && (
              <Button size="sm" onClick={onRetry}>
                <RotateCw />
                {retryLabel}
              </Button>
            )}
            {action}
          </div>
        )}
      </div>
    </div>
  );
}

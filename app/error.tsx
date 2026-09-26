"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/dashboard/error-state";
import { Card } from "@/components/ui/card";
import { captureError } from "@/lib/observability";

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Route through the repo's single observability choke point, which logs only
    // name/message/cause and forwards the sanitized error to Sentry — a raw
    // console.error(error) can print token or connection data (issue #281).
    captureError("error.root", error);
  }, [error]);

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 items-center justify-center px-6 py-16">
      <Card hover={false} className="w-full max-w-md p-0">
        <ErrorState
          title="This page hit a snag"
          description="An unexpected error stopped your dashboard from loading. Retrying usually fixes it."
          onRetry={reset}
        />
      </Card>
    </main>
  );
}

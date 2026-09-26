"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/dashboard/error-state";
import { Card } from "@/components/ui/card";
import { captureError } from "@/lib/observability";

export default function AuthError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // captureError, not console.error(error): it is the one choke point that
    // serialises only name/message/cause and forwards the sanitized error to
    // Sentry (#135, #143), so nothing sensitive reaches the log (issue #281).
    captureError("error.auth", error);
  }, [error]);

  return (
    <Card hover={false} className="w-full max-w-sm p-0">
      <ErrorState
        title="Sign-in unavailable"
        description="We couldn't load the sign-in page. Please try again in a moment."
        onRetry={reset}
      />
    </Card>
  );
}

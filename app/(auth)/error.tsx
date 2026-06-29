"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/dashboard/error-state";
import { Card } from "@/components/ui/card";

export default function AuthError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
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

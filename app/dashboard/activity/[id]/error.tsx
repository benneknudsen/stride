"use client";

import Link from "next/link";
import { useEffect } from "react";
import { ErrorState } from "@/components/dashboard/error-state";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function ActivityError({
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
    <main className="mx-auto flex w-full max-w-7xl flex-1 items-center justify-center px-6 py-16">
      <Card hover={false} className="w-full max-w-md p-0">
        <ErrorState
          title="Couldn't load this activity"
          description="Something went wrong fetching this run. Try again, or head back to your dashboard."
          onRetry={reset}
          action={
            <Link href="/" className={buttonVariants({ variant: "outline", size: "sm" })}>
              Back to Dashboard
            </Link>
          }
        />
      </Card>
    </main>
  );
}

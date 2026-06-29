import { SearchX } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/dashboard/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function ActivityNotFound() {
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 items-center justify-center px-6 py-16">
      <Card hover={false} className="w-full max-w-md p-0">
        <EmptyState
          icon={SearchX}
          title="Activity not found"
          description="This run doesn't exist, or it isn't part of your training history."
          action={
            <Link href="/" className={buttonVariants({ size: "sm" })}>
              Back to Dashboard
            </Link>
          }
        />
      </Card>
    </main>
  );
}

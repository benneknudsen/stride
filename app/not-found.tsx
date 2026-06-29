import { Compass } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/dashboard/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 items-center justify-center px-6 py-16">
      <Card hover={false} className="w-full max-w-md p-0">
        <EmptyState
          icon={Compass}
          title="Page not found"
          description="The page you're looking for doesn't exist or may have moved."
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

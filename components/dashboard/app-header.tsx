import { CircleCheck } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { ConnectStravaButton } from "@/components/dashboard/connect-strava-button";
import { DemoToggle } from "@/components/dashboard/demo-toggle";
import { ThemeToggle } from "@/components/dashboard/theme-toggle";
import { Button } from "@/components/ui/button";
import { StrideLogo } from "@/components/ui/StrideLogo";
import { auth } from "@/lib/auth";
import { getUserById } from "@/lib/db/queries";

export async function AppHeader() {
  const session = await auth();
  const userId = session?.user?.id;
  const user = userId ? await getUserById(userId) : null;
  const isStravaConnected = user?.stravaAthleteId != null;

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-bg/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-3 sm:px-6">
        <StrideLogo size={22} tone="duo" />
        <nav className="flex items-center gap-1 sm:gap-2">
          <Button variant="ghost" size="sm" className="hidden sm:inline-flex">
            Dashboard
          </Button>
          <Button variant="ghost" size="sm" className="hidden sm:inline-flex">
            Activities
          </Button>
          <Button variant="ghost" size="sm" className="hidden sm:inline-flex">
            Coach
          </Button>
          <DemoToggle />
          <ThemeToggle />
          {isStravaConnected ? (
            <span className="ml-2 flex items-center gap-1.5 text-sm text-volt">
              <CircleCheck className="size-4" />
              Strava connected
            </span>
          ) : (
            <ConnectStravaButton />
          )}
          <Link
            href="/dashboard/profile"
            aria-label="Profile"
            className="ml-1 flex size-8 items-center justify-center overflow-hidden rounded-full border border-border transition-opacity hover:opacity-80"
          >
            {user?.image ? (
              <Image
                src={user.image}
                alt={user.name ?? "Avatar"}
                width={32}
                height={32}
                className="size-full object-cover"
              />
            ) : (
              <StrideLogo size={16} tone="duo" />
            )}
          </Link>
        </nav>
      </div>
    </header>
  );
}

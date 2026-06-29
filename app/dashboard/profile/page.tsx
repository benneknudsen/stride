import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ConnectStravaButton } from "@/components/dashboard/connect-strava-button";
import { GitHubIcon, GoogleIcon, StravaIcon } from "@/components/dashboard/provider-icons";
import { SignOutButton } from "@/components/dashboard/sign-out-button";
import { StatCard } from "@/components/dashboard/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StrideLogo } from "@/components/ui/StrideLogo";
import { auth } from "@/lib/auth";
import { getAccountsByUserId, getActivities, getUserById } from "@/lib/db/queries";
import { formatDistance, formatPace } from "@/lib/metrics";

export const metadata: Metadata = {
  title: "Profile · Stride",
};

/**
 * Aggregate lifetime running totals. `averageSpeed` from individual activities
 * is ignored in favour of an overall distance/time ratio so the average pace is
 * volume-weighted rather than a mean of per-run averages.
 */
function summarize(activities: { distance: number; movingTime: number }[]) {
  const totalDistance = activities.reduce((sum, a) => sum + a.distance, 0);
  const totalTime = activities.reduce((sum, a) => sum + a.movingTime, 0);
  const avgSpeed = totalTime > 0 ? totalDistance / totalTime : null;
  return { totalDistance, totalRuns: activities.length, avgSpeed };
}

interface ConnectedAccountProps {
  name: string;
  icon: React.ReactNode;
  connected: boolean;
  detail?: string | null;
  action?: React.ReactNode;
}

/** One provider tile in the Connected Accounts grid. */
function ConnectedAccount({ name, icon, connected, detail, action }: ConnectedAccountProps) {
  return (
    <Card hover={false} className="flex flex-col gap-4 p-5">
      <div className="flex items-start justify-between">
        <div className="flex size-11 items-center justify-center rounded-xl border border-border bg-bg-2">
          {icon}
        </div>
        {connected ? (
          <span className="flex items-center gap-1.5 text-xs font-medium text-volt">
            <span className="size-2 rounded-full bg-volt shadow-[0_0_8px_var(--color-volt)]" />
            Connected
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-xs font-medium text-muted">
            <span className="size-2 rounded-full bg-muted/50" />
            Not connected
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-0.5">
        <span className="text-sm font-semibold text-fg">{name}</span>
        <span className="text-xs text-muted">
          {connected ? (detail ?? "Linked to Stride") : "Not linked"}
        </span>
      </div>
      {action ? <div>{action}</div> : null}
    </Card>
  );
}

export default async function ProfilePage() {
  const session = await auth();
  const userId = session?.user?.id;

  if (!userId) {
    redirect("/login");
  }

  const [user, accounts, activities] = await Promise.all([
    getUserById(userId),
    getAccountsByUserId(userId),
    getActivities(userId, { limit: 10_000 }),
  ]);

  // Fallback to session data when DB is unavailable (dev mode / no DB)
  const name = user?.name ?? session.user?.name ?? "Runner";
  const email = user?.email ?? session.user?.email ?? "";
  const image = user?.image ?? session.user?.image ?? null;

  const linkedProviders = new Set(accounts.map((a) => a.provider));
  const isStravaConnected = user?.stravaAthleteId != null;
  const stravaAthleteId = user?.stravaAthleteId;
  const { totalDistance, totalRuns, avgSpeed } = summarize(activities);

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-8">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-fg"
      >
        <ArrowLeft className="size-4" />
        Back to Dashboard
      </Link>

      {/* Profile header */}
      <section className="relative mt-6 overflow-hidden rounded-[24px] border border-border bg-card p-8 shadow-float">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-volt/20 via-aqua/[0.06] to-transparent" />
        <div className="pointer-events-none absolute -top-20 -right-16 size-64 rounded-full bg-volt/10 blur-3xl" />
        <div className="relative flex flex-col items-center gap-5 text-center sm:flex-row sm:gap-6 sm:text-left">
          {image ? (
            <Image
              src={image}
              alt={name ?? "Avatar"}
              width={96}
              height={96}
              className="size-24 rounded-full border-2 border-volt/40 object-cover shadow-float"
            />
          ) : (
            <div className="flex size-24 items-center justify-center rounded-full border-2 border-volt/40 bg-gradient-to-br from-volt to-volt-dim shadow-float">
              <StrideLogo size={40} tone="duo" />
            </div>
          )}
          <div className="flex flex-col gap-1">
            <h1 className="font-heading text-3xl font-bold tracking-tight text-fg">{name}</h1>
            <p className="text-sm text-sub">{email}</p>
          </div>
        </div>
      </section>

      {/* Lifetime stats */}
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label="Total Distance"
          value={totalRuns > 0 ? formatDistance(totalDistance) : "0"}
          unit="km"
          accent="volt"
        />
        <StatCard label="Total Runs" value={String(totalRuns)} unit="runs" accent="aqua" />
        <StatCard label="Average Pace" value={formatPace(avgSpeed)} unit="/km" accent="signal" />
      </div>

      {/* Connected accounts */}
      <section className="mt-8">
        <h2 className="mb-4 font-heading text-lg font-semibold tracking-tight text-fg">
          Connected Accounts
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <ConnectedAccount
            name="Strava"
            icon={<StravaIcon className="size-6" />}
            connected={isStravaConnected}
            detail={isStravaConnected ? `Athlete #${stravaAthleteId}` : null}
            action={isStravaConnected ? undefined : <ConnectStravaButton />}
          />
          <ConnectedAccount
            name="GitHub"
            icon={<GitHubIcon className="size-6 text-fg" />}
            connected={linkedProviders.has("github")}
          />
          <ConnectedAccount
            name="Google"
            icon={<GoogleIcon className="size-6" />}
            connected={linkedProviders.has("google")}
          />
        </div>
      </section>

      {/* Sign out */}
      <Card
        hover={false}
        className="mt-8 flex flex-col gap-4 border-destructive/30 sm:flex-row sm:items-center sm:justify-between"
      >
        <CardHeader className="mb-0">
          <CardTitle>Sign out</CardTitle>
          <p className="mt-1 text-sm text-sub">End your Stride session on this device.</p>
        </CardHeader>
        <CardContent>
          <SignOutButton />
        </CardContent>
      </Card>
    </main>
  );
}

import { cn } from "@/lib/utils";

function retrySeconds(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return null;
  return parsed;
}

/**
 * The home-page notice for a Strava connect that did not complete (issue #366).
 *
 * The callback route redirects with `strava_error` (and `strava_retry` in
 * seconds when the per-user sync budget was spent). Before this component the
 * user landed on Hjem with no explanation at all.
 */
export function StravaCallbackNotice({
  stravaError,
  stravaRetry,
  className,
}: {
  stravaError?: string;
  stravaRetry?: string;
  className?: string;
}) {
  if (!stravaError) return null;

  const rateLimited = stravaError === "rate_limited";
  const seconds = retrySeconds(stravaRetry);

  const message = rateLimited
    ? seconds !== null
      ? `Strava-forbindelsen blev ikke gennemført — prøv igen om ${seconds} sekunder.`
      : "Strava-forbindelsen blev ikke gennemført — prøv igen om lidt."
    : "Strava-forbindelsen blev ikke gennemført. Prøv igen.";

  return (
    <div
      role={rateLimited ? "status" : "alert"}
      className={cn(
        "mb-4 flex items-start gap-3 rounded-2xl border px-4 py-3 font-cg-mono text-[11px] tracking-[0.04em]",
        rateLimited ? "text-ink" : "text-red-ink",
        className
      )}
      style={{
        borderColor: rateLimited
          ? "color-mix(in srgb, var(--color-ink) 25%, transparent)"
          : "color-mix(in srgb, var(--color-red) 35%, transparent)",
        backgroundColor: rateLimited
          ? "color-mix(in srgb, var(--color-ink) 6%, transparent)"
          : "color-mix(in srgb, var(--color-red) 6%, transparent)",
      }}
    >
      <span
        aria-hidden="true"
        className={cn(
          "mt-[3px] size-[7px] shrink-0 rounded-full",
          rateLimited ? "bg-ink/50" : "bg-red"
        )}
      />
      <span>{message}</span>
    </div>
  );
}

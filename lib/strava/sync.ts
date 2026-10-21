import { sql } from "drizzle-orm";
import { activities } from "@/drizzle/schema";
import { revalidateProgression } from "@/lib/coach/dashboard-data";
import { db, getPool } from "@/lib/db";
import { revalidateDashboardActivities } from "@/lib/db/queries";
import { captureError } from "@/lib/observability";
import { withTokenRefresh } from "@/lib/strava/client";
import { mapStravaSummaryToDb } from "@/lib/strava/mappers";

/** Activities requested per list-endpoint page. */
const SYNC_PAGE_SIZE = 100;

/**
 * Hard ceiling on list-endpoint pages per sync (issue #272). The loop below
 * otherwise terminates solely on Strava's pagination semantics; a pathological
 * upstream (e.g. a response that never shrinks) would spin until the function
 * timeout. 100 pages × 100 activities covers the largest plausible history many
 * times over — a healthy account pages out long before this.
 */
export const MAX_SYNC_PAGES = 100;

/**
 * Soft deadline for a single sync (issue #338).
 *
 * The route exports `maxDuration = 300`, so the platform would cut the
 * function off after five minutes — long enough to lose everything the sync
 * had not written yet, with the client seeing a bare 500. The sync stops
 * itself a minute earlier instead, so it can still answer "I got most of your
 * history" instead of dying mid-page.
 */
export const SYNC_DEADLINE_MS = 240_000;

/** Why a sync stopped before it reached the end of the history. */
export type StravaSyncPartialReason = "paginationCap" | "deadline";

/**
 * What a sync actually did (issue #338).
 *
 * `inserted` counts upserted rows — it says nothing about coverage, so it can
 * never double as a "the whole history is in" signal. The status does:
 * `complete` covers the whole history, `partial` says the history was cut
 * short, and `busy` says another sync for the same user was already running.
 */
export type StravaSyncResult =
  | { status: "complete"; inserted: number }
  | { status: "partial"; inserted: number; reason: StravaSyncPartialReason }
  | { status: "busy"; inserted: 0 };

/** A held, session-scoped advisory lock for one user. */
type UserSyncLock = {
  release: () => Promise<void>;
};

/** One activity row, ready for the upsert. */
type ActivityRow = ReturnType<typeof mapStravaSummaryToDb>;

/** 32-bit FNV-1a with a caller-chosen seed. */
function fnv1a32(input: string, seed: number): number {
  let hash = seed;
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * The user id hashed into the two 32-bit halves that Postgres' two-argument
 * advisory-lock key space takes. Two seeds give the pair ~64 bits of
 * discrimination, so two users never share a lock.
 */
function userLockKey(userId: string): [number, number] {
  return [fnv1a32(userId, 0x811c9dc5) | 0, fnv1a32(userId, 0x9e3779b9) | 0];
}

/**
 * Take the user-scoped lock that keeps two syncs for the same user from
 * running at the same time (issue #338).
 *
 * The lock is session-scoped and rides on a dedicated pooled connection: a
 * transaction would have to stay open across the whole network paging, and a
 * transaction held open for minutes is exactly what the database must not do.
 * A session-scoped lock on its own connection gives the same exclusion with no
 * open transaction.
 *
 * `pg_try_advisory_lock` never waits — a sync that cannot get the lock gives
 * up at once with a `busy` result instead of queueing behind the other one.
 * Two-argument advisory locks live in their own key space, so this lock can
 * never collide with the webhook's activity-scoped locks.
 */
async function tryAcquireUserLock(userId: string): Promise<UserSyncLock | null> {
  const client = await getPool().connect();
  const [classId, objectId] = userLockKey(userId);
  try {
    const result = await client.query<{ locked: boolean }, [number, number]>({
      text: "select pg_try_advisory_lock($1::int, $2::int) as locked",
      values: [classId, objectId],
    });
    if (result.rows[0]?.locked !== true) {
      client.release();
      return null;
    }
    return {
      release: async () => {
        try {
          await client.query("select pg_advisory_unlock($1::int, $2::int)", [classId, objectId]);
          client.release();
        } catch (err) {
          // A session-scoped lock lives as long as its session, so a failed
          // unlock would hand the lock to whoever gets this pooled connection
          // next. Destroying the connection kills the lock with it.
          client.release(true);
          captureError("strava.sync.lockRelease", err);
        }
      },
    };
  } catch (err) {
    client.release(true);
    throw err;
  }
}

/**
 * Write one page of activities.
 *
 * The webhook serializes its deliveries on an activity-scoped advisory lock
 * (issue #64); the sync takes the very same lock, in the very same key space,
 * so a webhook delivery and a sync cannot interleave on the same row (#338).
 * The lock is transaction-scoped and sits in the same transaction as the
 * upsert, so it releases the moment the rows are written.
 *
 * Activity ids are locked in ascending order: a deterministic order across
 * writers is what keeps two batches from waiting for each other in a cycle.
 */
async function writeBatch(rows: ActivityRow[]): Promise<void> {
  const ids = rows.map((row) => row.stravaActivityId).sort((a, b) => a - b);

  await db.transaction(async (tx) => {
    for (const id of ids) {
      await tx.execute(sql`select pg_advisory_xact_lock(${id})`);
    }

    await tx
      .insert(activities)
      .values(rows)
      .onConflictDoUpdate({
        target: [activities.userId, activities.stravaActivityId],
        set: {
          name: sql`excluded.name`,
          type: sql`excluded.type`,
          startDate: sql`excluded.start_date`,
          distance: sql`excluded.distance`,
          movingTime: sql`excluded.moving_time`,
          elapsedTime: sql`excluded.elapsed_time`,
          totalElevationGain: sql`excluded.total_elevation_gain`,
          averageSpeed: sql`excluded.average_speed`,
          maxSpeed: sql`excluded.max_speed`,
          averageHeartrate: sql`excluded.average_heartrate`,
          maxHeartrate: sql`excluded.max_heartrate`,
          averageCadence: sql`excluded.average_cadence`,
          averageWatts: sql`excluded.average_watts`,
          summaryPolyline: sql`excluded.summary_polyline`,
          // splits / calories / hr_zones / raw are NOT updated here: the
          // summary payload can't carry them, so overwriting would blank out
          // the richer values the webhook's detail fetch already stored (#101).
          updatedAt: new Date(),
        },
      });
  });
}

/**
 * Why the sync has to stop paging now — or null to keep going.
 *
 * Two bounds end the loop early: the page cap (issue #272) and the soft
 * deadline (issue #338). Both are recorded, because a sync that stopped short
 * has not covered the history and must not pass for a complete one.
 */
function stopReason(
  page: number,
  deadline: number,
  userId: string
): StravaSyncPartialReason | null {
  if (page > MAX_SYNC_PAGES) {
    captureError(
      "strava.sync.paginationCap",
      new Error(
        `Strava sync hit the ${MAX_SYNC_PAGES}-page cap for user ${userId}; continuing with collected activities`
      )
    );
    return "paginationCap";
  }
  if (Date.now() > deadline) {
    captureError(
      "strava.sync.deadline",
      new Error(
        `Strava sync hit its ${SYNC_DEADLINE_MS}ms deadline for user ${userId}; continuing with collected activities`
      )
    );
    return "deadline";
  }
  return null;
}

/**
 * Full historical Strava sync for one user (issue #183).
 *
 * Extracted from the POST /api/strava/sync route so the same logic backs both a
 * manual re-sync (the route, with its auth + rate-limit shell) and the initial
 * sync fired automatically after an OAuth connect (`handleStravaCallback`).
 *
 * Fetches every activity page-by-page from the list endpoint and upserts each as
 * a row. The list response is a full `SummaryActivity` — it already carries every
 * column the dashboard reads — so it maps directly via {@link mapStravaSummaryToDb}
 * instead of an N+1 per-activity detail fetch (issue #76 B7). `splits`, `calories`
 * and `hr_zones` are deliberately left out of the update `set`: a summary can't
 * carry them, so overwriting would blank out the richer values the webhook's
 * detail fetch already stored (issue #101).
 *
 * At most one sync per user runs at a time (issue #338): the sync holds a
 * session-scoped advisory lock on a dedicated connection for its duration, and
 * a sync that cannot get it returns `busy` instead of running in parallel. The
 * rows themselves are written under the webhook's activity-scoped lock.
 *
 * Returns how many activities were upserted and whether the whole history was
 * covered — the caller has to be able to tell a complete sync from a cut-short
 * one.
 */
export async function syncStravaActivities(userId: string): Promise<StravaSyncResult> {
  const lock = await tryAcquireUserLock(userId);
  if (!lock) {
    // Another sync for this user is already running. That is a handleable
    // outcome, not an error: the caller decides what to tell the user.
    return { status: "busy", inserted: 0 };
  }

  try {
    const client = await withTokenRefresh(userId);
    const deadline = Date.now() + SYNC_DEADLINE_MS;

    let page = 1;
    let inserted = 0;
    let partialReason: StravaSyncPartialReason | null = null;

    while (true) {
      // Issue #272: bound upstream pathology — stop paging and continue with the
      // activities already collected (best-effort, matching the per-activity
      // error tolerance below) instead of looping until the function timeout.
      // Issue #338: stop before the platform's own timeout, so the sync can
      // still report that the history was not fully covered.
      const stop = stopReason(page, deadline, userId);
      if (stop) {
        partialReason = stop;
        break;
      }

      const batch = await client.getActivities(page, SYNC_PAGE_SIZE);
      if (batch.length === 0) break;

      const rows: ActivityRow[] = [];
      for (const summary of batch) {
        try {
          rows.push(mapStravaSummaryToDb(summary, userId));
        } catch {
          // Skip individual failures — continue with remaining activities.
        }
      }

      if (rows.length > 0) {
        await writeBatch(rows);
        inserted += rows.length;
      }

      if (batch.length < SYNC_PAGE_SIZE) break;
      page++;
    }

    if (inserted > 0) {
      revalidateProgression();
      revalidateDashboardActivities(userId);
    }

    return partialReason
      ? { status: "partial", inserted, reason: partialReason }
      : { status: "complete", inserted };
  } finally {
    await lock.release();
  }
}

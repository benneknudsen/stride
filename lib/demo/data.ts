/**
 * Demo fixture data — realistic running activities for the public demo mode.
 *
 * Shaped to match the columns that the dashboard components read from real
 * `activities` rows (see drizzle/schema.ts), so the exact same presentational
 * components render demo and live data without branching. Values are
 * deterministic (no Math.random) so the server-rendered HTML and the client
 * hydration agree — a mismatch here would throw a hydration error.
 */

export interface DemoActivity {
  id: string;
  name: string;
  type: string;
  /**
   * Ingesting provider. The fixtures stand in for a Strava-synced history, and
   * `sourceOf()` falls back to "strava" when the field is absent — so no fixture
   * sets it. It exists so a DemoActivity is assignable where a live row is (#35).
   */
  source?: string | null;
  /**
   * Google-encoded GPS route. The fixtures have no GPS streams to encode, so no
   * fixture sets it — the Hjem route card falls back to its own stand-in loop
   * for demo mode (issue #114), and the activity detail page shows its
   * "no route saved" placeholder. It exists so a DemoActivity stays assignable
   * where a live row is.
   */
  summaryPolyline?: string | null;
  /** Distance in meters. */
  distance: number;
  /** Moving time in seconds. */
  movingTime: number;
  /** Elapsed time in seconds. */
  elapsedTime: number;
  /** Total elevation gain in meters. */
  totalElevationGain: number;
  startDate: Date;
  /** Average speed in meters/second (Strava convention). */
  averageSpeed: number;
  /** Max speed in meters/second. */
  maxSpeed: number;
  averageHeartrate: number;
  maxHeartrate: number;
  /** Average cadence (single-leg, Strava convention — multiply by 2 for spm). */
  averageCadence: number;
  averageWatts: number;
  calories: number;
}

type Seed = {
  daysAgo: number;
  name: string;
  km: number;
  /** Pace in minutes per km. */
  pace: number;
  hr: number;
  /** Steps per minute (both legs). */
  spm: number;
  type?: string;
};

/**
 * Midnight (local) today, used as the anchor for every activity date. Anchoring
 * to a day boundary keeps the day/week buckets stable between server render and
 * client hydration even if a few milliseconds elapse between them.
 */
function startOfToday(): Date {
  const d = new Date();
  d.setHours(7, 30, 0, 0);
  return d;
}

function buildActivity(seed: Seed, index: number): DemoActivity {
  const { daysAgo, name, km, pace, hr, spm, type = "Run" } = seed;

  const date = startOfToday();
  date.setDate(date.getDate() - daysAgo);

  const distance = Math.round(km * 1000);
  const paceSecondsPerKm = pace * 60;
  const movingTime = Math.round(km * paceSecondsPerKm);
  // A little stoppage time scaled off the index so it varies without randomness.
  const elapsedTime = movingTime + 20 + (index % 5) * 12;
  const averageSpeed = distance / movingTime;
  const maxSpeed = averageSpeed * 1.35;
  const isTrail = type === "TrailRun";
  const totalElevationGain = Math.round(km * (isTrail ? 42 : 8));
  const maxHeartrate = hr + 12 + (index % 4) * 3;
  // Strava reports single-leg cadence, so store half of steps-per-minute.
  const averageCadence = spm / 2;
  const averageWatts = Math.round(km * 12 + hr * 1.1);
  const calories = Math.round(km * 64 + movingTime * 0.08);

  return {
    id: `demo-${String(index + 1).padStart(2, "0")}`,
    name,
    type,
    distance,
    movingTime,
    elapsedTime,
    totalElevationGain,
    startDate: date,
    averageSpeed,
    maxSpeed,
    averageHeartrate: hr,
    maxHeartrate,
    averageCadence,
    averageWatts,
    calories,
  };
}

// 30 activities spanning ~6 weeks of structured training (easy, tempo, long,
// intervals, recovery, trail). Ordered newest-first to match getActivities().
const seeds: Seed[] = [
  { daysAgo: 0, name: "Morning Easy Run", km: 8.2, pace: 5.35, hr: 142, spm: 178 },
  { daysAgo: 1, name: "Tempo Tuesday", km: 10.0, pace: 4.45, hr: 165, spm: 184 },
  { daysAgo: 2, name: "Recovery Jog", km: 5.0, pace: 6.1, hr: 128, spm: 172 },
  { daysAgo: 4, name: "Long Run Sunday", km: 21.1, pace: 5.25, hr: 152, spm: 180 },
  { daysAgo: 5, name: "Hill Repeats", km: 7.5, pace: 5.05, hr: 168, spm: 176, type: "TrailRun" },
  { daysAgo: 7, name: "Easy Miles", km: 9.0, pace: 5.4, hr: 140, spm: 178 },
  { daysAgo: 8, name: "Track Session", km: 8.0, pace: 4.3, hr: 172, spm: 188, type: "TrackRun" },
  { daysAgo: 9, name: "Recovery Run", km: 6.0, pace: 6.0, hr: 132, spm: 174 },
  { daysAgo: 11, name: "Long Run", km: 18.5, pace: 5.3, hr: 150, spm: 180 },
  { daysAgo: 12, name: "Fartlek Fun", km: 10.5, pace: 5.0, hr: 158, spm: 182 },
  { daysAgo: 14, name: "Easy Run", km: 7.0, pace: 5.45, hr: 138, spm: 176 },
  { daysAgo: 15, name: "Progression Run", km: 12.0, pace: 5.15, hr: 155, spm: 182 },
  { daysAgo: 16, name: "Recovery", km: 5.5, pace: 6.05, hr: 130, spm: 172 },
  { daysAgo: 18, name: "Sunday Long", km: 22.5, pace: 5.28, hr: 154, spm: 180 },
  {
    daysAgo: 19,
    name: "Trail Adventure",
    km: 14.0,
    pace: 5.55,
    hr: 148,
    spm: 174,
    type: "TrailRun",
  },
  { daysAgo: 21, name: "Morning Run", km: 8.0, pace: 5.38, hr: 144, spm: 178 },
  { daysAgo: 22, name: "Speed Work", km: 9.0, pace: 4.4, hr: 170, spm: 186, type: "TrackRun" },
  { daysAgo: 23, name: "Easy Recovery", km: 5.0, pace: 6.12, hr: 126, spm: 170 },
  { daysAgo: 25, name: "Long Run", km: 20.0, pace: 5.32, hr: 152, spm: 180 },
  { daysAgo: 26, name: "Tempo Effort", km: 11.0, pace: 4.5, hr: 164, spm: 184 },
  { daysAgo: 28, name: "Easy Miles", km: 7.5, pace: 5.42, hr: 140, spm: 176 },
  { daysAgo: 29, name: "Morning Shakeout", km: 6.0, pace: 5.5, hr: 136, spm: 174 },
  { daysAgo: 30, name: "Recovery Jog", km: 4.5, pace: 6.08, hr: 128, spm: 172 },
  { daysAgo: 32, name: "Weekend Long", km: 19.0, pace: 5.35, hr: 150, spm: 178 },
  { daysAgo: 33, name: "Hill Training", km: 8.5, pace: 5.2, hr: 162, spm: 176, type: "TrailRun" },
  { daysAgo: 35, name: "Easy Run", km: 7.0, pace: 5.48, hr: 138, spm: 176 },
  { daysAgo: 36, name: "Track 800s", km: 7.5, pace: 4.35, hr: 174, spm: 188, type: "TrackRun" },
  { daysAgo: 37, name: "Recovery", km: 5.0, pace: 6.05, hr: 130, spm: 172 },
  { daysAgo: 39, name: "Long Slow Distance", km: 24.0, pace: 5.4, hr: 148, spm: 178 },
  { daysAgo: 40, name: "Progression", km: 13.0, pace: 5.1, hr: 158, spm: 182 },
];

export const demoActivities: DemoActivity[] = seeds.map(buildActivity);

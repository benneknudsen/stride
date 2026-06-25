export interface Activity {
  id: string;
  name: string;
  type: "Run" | "TrailRun" | "TrackRun";
  date: string;
  distance: number; // meters
  duration: number; // seconds
  avgPace: number; // seconds per km
  avgHeartRate: number;
  maxHeartRate: number;
  avgCadence: number;
  elevationGain: number;
  calories: number;
}

function generateActivity(
  daysAgo: number,
  name: string,
  distanceKm: number,
  paceMinPerKm: number,
  avgHr: number,
  cadence: number,
  type: Activity["type"] = "Run"
): Activity {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  const distance = distanceKm * 1000;
  const avgPace = paceMinPerKm * 60;
  const duration = (distance / 1000) * avgPace;

  return {
    id: `act_${daysAgo}_${Math.random().toString(36).slice(2, 8)}`,
    name,
    type,
    date: date.toISOString(),
    distance,
    duration,
    avgPace,
    avgHeartRate: avgHr,
    maxHeartRate: avgHr + Math.floor(Math.random() * 15) + 10,
    avgCadence: cadence,
    elevationGain: type === "TrailRun" ? Math.floor(distanceKm * 40) : Math.floor(distanceKm * 8),
    calories: Math.floor(distanceKm * 65 + duration * 0.08),
  };
}

export const demoActivities: Activity[] = [
  generateActivity(0, "Morning Easy Run", 8.2, 5.35, 142, 178),
  generateActivity(1, "Tempo Tuesday", 10.0, 4.45, 165, 184),
  generateActivity(2, "Recovery Jog", 5.0, 6.10, 128, 172),
  generateActivity(4, "Long Run Sunday", 21.1, 5.25, 152, 180),
  generateActivity(5, "Hill Repeats", 7.5, 5.05, 168, 176, "TrailRun"),
  generateActivity(7, "Easy Miles", 9.0, 5.40, 140, 178),
  generateActivity(8, "Track Session", 8.0, 4.30, 172, 188, "TrackRun"),
  generateActivity(9, "Recovery Run", 6.0, 6.00, 132, 174),
  generateActivity(11, "Long Run", 18.5, 5.30, 150, 180),
  generateActivity(12, "Fartlek Fun", 10.5, 5.00, 158, 182),
  generateActivity(14, "Easy Run", 7.0, 5.45, 138, 176),
  generateActivity(15, "Progression Run", 12.0, 5.15, 155, 182),
  generateActivity(16, "Recovery", 5.5, 6.05, 130, 172),
  generateActivity(18, "Sunday Long", 22.5, 5.28, 154, 180),
  generateActivity(19, "Trail Adventure", 14.0, 5.55, 148, 174, "TrailRun"),
  generateActivity(21, "Morning Run", 8.0, 5.38, 144, 178),
  generateActivity(22, "Speed Work", 9.0, 4.40, 170, 186, "TrackRun"),
  generateActivity(23, "Easy Recovery", 5.0, 6.12, 126, 170),
  generateActivity(25, "Long Run", 20.0, 5.32, 152, 180),
  generateActivity(26, "Tempo Effort", 11.0, 4.50, 164, 184),
  generateActivity(28, "Easy Miles", 7.5, 5.42, 140, 176),
  generateActivity(29, "Morning Shakeout", 6.0, 5.50, 136, 174),
  generateActivity(30, "Recovery Jog", 4.5, 6.08, 128, 172),
  generateActivity(32, "Weekend Long", 19.0, 5.35, 150, 178),
  generateActivity(33, "Hill Training", 8.5, 5.20, 162, 176, "TrailRun"),
  generateActivity(35, "Easy Run", 7.0, 5.48, 138, 176),
  generateActivity(36, "Track 800s", 7.5, 4.35, 174, 188, "TrackRun"),
  generateActivity(37, "Recovery", 5.0, 6.05, 130, 172),
  generateActivity(39, "Long Slow Distance", 24.0, 5.40, 148, 178),
  generateActivity(40, "Progression", 13.0, 5.10, 158, 182),
];

export function formatPace(secondsPerKm: number): string {
  const mins = Math.floor(secondsPerKm / 60);
  const secs = Math.round(secondsPerKm % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function formatDuration(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.round(seconds % 60);
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function formatDistance(meters: number): string {
  return (meters / 1000).toFixed(1);
}

export function getWeeklyVolume(activities: Activity[], weeksAgo: number): number {
  const now = new Date();
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay() - weeksAgo * 7);
  startOfWeek.setHours(0, 0, 0, 0);
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 7);

  return activities
    .filter((a) => {
      const d = new Date(a.date);
      return d >= startOfWeek && d < endOfWeek;
    })
    .reduce((sum, a) => sum + a.distance, 0);
}

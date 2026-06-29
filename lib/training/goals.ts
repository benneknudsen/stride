// Stride — training-plan goal config. Single source of truth for the
// "Pick your plan" screen and the committed dashboard. Each goal drives the
// fit verdict, the recommended next run, and the week plan.

export type GoalKey = "c25k" | "marathon" | "zone2" | "efficient";
export type ZoneKey = "z1" | "z2" | "z3" | "z4" | "z5";

export const ZONE_COLOR: Record<ZoneKey, string> = {
  z1: "#9CA3AF",
  z2: "#C6F432",
  z3: "#06B6D4",
  z4: "#F97316",
  z5: "#EF4444",
};

export interface NextRun {
  tag: string;
  type: string;
  distance: string;
  pace: string;
  duration: string;
  zone: string;
  why: string;
}

export interface Goal {
  key: GoalKey;
  title: string;
  desc: string;
  short: string;
  /** zones this plan emphasizes — drives the FOCUS band + target band */
  band: ZoneKey[];
  fit: { score: string; pct: number; verdict: string; note: string };
  next: NextRun;
  /** Mon–Sun session labels */
  week: string[];
}

export const GOALS: Record<GoalKey, Goal> = {
  c25k: {
    key: "c25k",
    title: "Couch to 5K",
    desc: "Build from walking to a full 5K, week by week.",
    short: "Couch-to-5K",
    band: ["z2", "z3"],
    fit: {
      score: "A",
      pct: 90,
      verdict: "Right effort",
      note: "Comfortable aerobic effort with short pushes — exactly where a 5K build wants you.",
    },
    next: {
      tag: "Tomorrow · week 4",
      type: "Run / Walk Intervals",
      distance: "3.5 km",
      pace: "Run 4' / Walk 1'",
      duration: "~30 min",
      zone: "Zone 2–3",
      why: "You've completed 3 sessions this week without missing one. You're ready to extend the run intervals — 5×(4 min run / 1 min walk). Next week we drop the walks.",
    },
    week: ["R/Walk", "Rest", "R/Walk", "Rest", "R/Walk", "Rest", "Rest"],
  },
  marathon: {
    key: "marathon",
    title: "Marathon",
    desc: "Endurance and weekly mileage toward 42.2K.",
    short: "marathon base",
    band: ["z2", "z3"],
    fit: {
      score: "A-",
      pct: 84,
      verdict: "Solid aerobic base",
      note: "Plenty of easy time with a touch of tempo — right profile for marathon volume.",
    },
    next: {
      tag: "Tomorrow · key session",
      type: "Long Run",
      distance: "22 km",
      pace: "5:30/km",
      duration: "~2:00",
      zone: "Zone 2",
      why: "Volume is trending up +8% and you're well recovered — time for the week's anchor long run. Keep it conversational; the distance is the work, not the pace.",
    },
    week: ["Easy", "Tempo", "Rest", "Easy", "Rest", "Long", "Recovery"],
  },
  zone2: {
    key: "zone2",
    title: "Zone 2 · Fat-burn",
    desc: "Easy aerobic only — build your fat-burning base.",
    short: "Zone 2 base",
    band: ["z1", "z2"],
    fit: {
      score: "B+",
      pct: 78,
      verdict: "Mostly on target",
      note: "78% easy, but 14% slipped into Tempo. Keep climbs slower to stay strictly Zone 2.",
    },
    next: {
      tag: "Tomorrow · fresh",
      type: "Easy Aerobic Run",
      distance: "9 km",
      pace: "5:15/km",
      duration: "~47 min",
      zone: "Zone 2",
      why: "You're rested after 2 easy days and your last run drifted into Z3. Lock this one strictly into Zone 2 — keep HR under 152 — to keep building the fat-burning base your plan is built on.",
    },
    week: ["Easy", "Rest", "Easy", "Easy", "Rest", "Long·easy", "Rest"],
  },
  efficient: {
    key: "efficient",
    title: "Efficient / Race-sharp",
    desc: "Polarized: easy volume plus sharp quality work.",
    short: "race sharpness",
    band: ["z2", "z4"],
    fit: {
      score: "C+",
      pct: 60,
      verdict: "Too much grey zone",
      note: "This was neither easy nor hard. For efficiency, make easy days easier and quality days sharper.",
    },
    next: {
      tag: "Tomorrow · quality",
      type: "Tempo Intervals",
      distance: "8 km",
      pace: "4:30/km reps",
      duration: "~40 min",
      zone: "Zone 3–4",
      why: "Your easy volume is solid and you're rested, but recent runs sat in the grey zone. A focused threshold session — 4×6 min at tempo — sharpens efficiency without piling on fatigue.",
    },
    week: ["Tempo", "Easy", "Rest", "Intervals", "Rest", "Long", "Recovery"],
  },
};

export const GOAL_LIST = Object.values(GOALS);

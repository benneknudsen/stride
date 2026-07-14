import { describe, expect, it } from "vitest";
import {
  formatPaceClock,
  formatPaceRange,
  formatRaceTime,
  goalTimeFor,
  HALF_MARATHON_KM,
  minBasisKm,
  PACE_ZONE_SPEED_FRACTION,
  type PaceZone,
  type PredictionActivity,
  predictRace,
  type RacePrediction,
  zonePaceSeconds,
  zonePaces,
} from "@/lib/training/prediction";

// The race predictor (issue #115) — the engine the plan's pace targets derive
// from, now with the heart-rate effort discount (#116) and the locked result
// that says why it couldn't predict (#117). Everything here is pure: `now` is
// injected, so no test depends on the wall clock.

const NOW = new Date(2026, 6, 8, 9, 0); // Wed 8 Jul 2026
const DAY_MS = 86_400_000;
/** A race far longer than the half the predictor defaults to — the 25% bar's whole point. */
const MARATHON_KM = 42.195;

function run(
  daysAgo: number,
  km: number,
  paceSecPerKm: number,
  type = "Run",
  hr?: number
): PredictionActivity {
  return {
    type,
    distance: km * 1000,
    movingTime: Math.round(km * paceSecPerKm),
    startDate: new Date(NOW.getTime() - daysAgo * DAY_MS),
    ...(hr !== undefined ? { averageHeartrate: hr } : {}),
  };
}

/** The prediction, or a test failure — most cases here expect one. */
function predicted(activities: PredictionActivity[], hrMax?: number | null): RacePrediction {
  const { prediction } = predictRace(activities, NOW, undefined, hrMax);
  if (!prediction) throw new Error("expected a prediction");
  return prediction;
}

describe("predictRace", () => {
  it("extrapolates a race time from a recent effort via Riegel", () => {
    // A 10 km at 4:30/km → half marathon a touch slower per km, never faster.
    const prediction = predicted([run(3, 10, 270)]);
    expect(prediction.raceDistanceKm).toBe(HALF_MARATHON_KM);
    expect(prediction.paceSecPerKm).toBeGreaterThan(270);
    expect(prediction.timeSeconds).toBe(Math.round(2700 * (HALF_MARATHON_KM / 10) ** 1.06));
  });

  it("anchors on the runner's best effort, not their easy days", () => {
    const easyOnly = predicted([run(2, 8, 360), run(5, 10, 355)]);
    const withQuality = predicted([run(2, 8, 360), run(5, 10, 355), run(4, 10, 270)]);
    // The hard 10 km must pull the prediction faster — an average would not.
    expect(withQuality.paceSecPerKm).toBeLessThan(easyOnly.paceSecPerKm);
    expect(withQuality.basisKm).toBe(10);
  });

  it("ignores efforts too short to extrapolate from", () => {
    // A blistering 2 km would project an absurd half — it must not anchor.
    const prediction = predicted([run(1, 2, 200), run(6, 10, 300)]);
    expect(prediction.basisKm).toBe(10);
    expect(prediction.sampleRuns).toBe(1);
  });

  it("is deterministic — the same input always predicts the same race", () => {
    const activities = [run(2, 12, 300), run(6, 10, 275)];
    expect(predictRace(activities, NOW)).toEqual(predictRace(activities, NOW));
  });

  it("rates confidence by how much data — and how close a basis — it had", () => {
    expect(predicted([run(3, 10, 270)]).confidence).toBe("low");
    expect(predicted([run(1, 6, 300), run(3, 6, 300), run(5, 6, 300)]).confidence).toBe("medium");
    // Six qualifying runs, and the best of them is a long run near the race
    // distance — a short Riegel hop, so the prediction is worth trusting.
    const many = [
      run(1, 8, 330),
      run(3, 8, 330),
      run(5, 8, 330),
      run(7, 8, 330),
      run(9, 8, 330),
      run(11, 18, 300),
    ];
    const prediction = predicted(many);
    expect(prediction.basisKm).toBe(18);
    expect(prediction.confidence).toBe("high");
  });
});

describe("predictRace — heart-rate effort discount (issue #116)", () => {
  it("leaves a prediction untouched when the effort carried no heart rate", () => {
    const prediction = predicted([run(3, 10, 270)]);
    expect(prediction.hrAdjustment).toBe(1);
    expect(prediction.hrMax).toBeNull();
    expect(prediction.hrMaxSource).toBe("unknown");
  });

  it("slows the prediction down when the anchor was run well below race effort", () => {
    // The same 10 km, once anonymous and once revealed as a 140 bpm jog against a
    // 190 bpm ceiling — a jog is weaker evidence of a race time, so it predicts slower.
    const blind = predicted([run(3, 10, 270)]);
    const jog = predicted([run(3, 10, 270, "Run", 140)], 190);
    expect(jog.timeSeconds).toBeGreaterThan(blind.timeSeconds);
    expect(jog.hrAdjustment).toBeGreaterThan(1);
    expect(jog.hrMax).toBe(190);
  });

  it("takes an effort at race heart rate at face value", () => {
    // 175 of 190 bpm is 92% — at or above race effort, so Riegel stands as-is.
    const raced = predicted([run(3, 10, 270, "Run", 175)], 190);
    expect(raced.hrAdjustment).toBe(1);
    expect(raced.timeSeconds).toBe(predicted([run(3, 10, 270)]).timeSeconds);
  });

  it("never speeds a prediction up — Riegel's projection is the ceiling", () => {
    // Even a maximal effort (HR at the ceiling) can only leave the projection alone.
    for (const hr of [120, 150, 175, 190]) {
      expect(predicted([run(3, 10, 270, "Run", hr)], 190).hrAdjustment).toBeGreaterThanOrEqual(1);
    }
  });

  it("caps the discount, so an easy run stays weak evidence rather than useless", () => {
    const crawl = predicted([run(3, 10, 270, "Run", 100)], 190);
    expect(crawl.hrAdjustment).toBeLessThanOrEqual(1.12);
  });

  it("stops a fast-looking easy run from out-bidding a genuinely hard one", () => {
    // Raw Riegel makes the steady 16 km the better anchor than the 10 km, by a
    // minute. But the 16 was jogged at 138 bpm and the 10 was raced at 175, so
    // once effort is priced in the hard run takes the anchor back.
    expect(predicted([run(2, 16, 298), run(4, 10, 292)]).basisKm).toBe(16);
    const withHr = predicted([run(2, 16, 298, "Run", 138), run(4, 10, 292, "Run", 175)], 190);
    expect(withHr.basisKm).toBe(10);
    expect(withHr.hrAdjustment).toBe(1); // the anchor itself was a race effort
  });

  it("measures effort against hrMaxOverride rather than the hardest run it can see", () => {
    // Observed ceiling is the 168 bpm run itself → it looks like a max effort.
    const observed = predicted([run(3, 10, 270, "Run", 168)]);
    expect(observed.hrMax).toBe(168);
    expect(observed.hrMaxSource).toBe("observations");
    expect(observed.hrAdjustment).toBe(1);
    // Against the runner's real 200 bpm max, the same run was only 84% effort.
    const overridden = predicted([run(3, 10, 270, "Run", 168)], 200);
    expect(overridden.hrMax).toBe(200);
    expect(overridden.hrMaxSource).toBe("database");
    expect(overridden.hrAdjustment).toBeGreaterThan(1);
    expect(overridden.timeSeconds).toBeGreaterThan(observed.timeSeconds);
  });

  it("takes the database ceiling even when the runner's window is all easy running", () => {
    // The whole 90-day window is easy: the hardest run in it averaged 145 bpm.
    // Without the ceiling from the full history, 145 *is* the ceiling and the jog
    // passes for a race effort — the too-conservative bid this issue is about.
    const easyBlock = [
      run(3, 10, 330, "Run", 142),
      run(8, 12, 335, "Run", 145),
      run(15, 10, 340, "Run", 140),
    ];
    const blind = predicted(easyBlock);
    expect(blind.hrMaxSource).toBe("observations");
    expect(blind.hrAdjustment).toBe(1); // 145/145 — "max effort", which it wasn't

    const withHistory = predicted(easyBlock, 192);
    expect(withHistory.hrMaxSource).toBe("database");
    expect(withHistory.hrAdjustment).toBeGreaterThan(1);
    expect(withHistory.timeSeconds).toBeGreaterThan(blind.timeSeconds);
  });

  it("ignores an implausible override — a resting HR is not a ceiling", () => {
    const prediction = predicted([run(3, 10, 270, "Run", 150)], 55);
    expect(prediction.hrMax).toBe(150); // fell back to the observed average
    expect(prediction.hrMaxSource).toBe("observations");
  });

  it("falls back to the observed ceiling when there is no override (demo/visitor)", () => {
    // Demo fixtures and visitors never carry a database max — the predictor must
    // still work, measuring effort against what it can see.
    for (const override of [undefined, null]) {
      const prediction = predicted([run(3, 10, 270, "Run", 160)], override);
      expect(prediction.hrMax).toBe(160);
      expect(prediction.hrMaxSource).toBe("observations");
    }
  });
});

describe("predictRace — locked result (issue #117)", () => {
  it("says there are no runs at all rather than guessing", () => {
    const empty = predictRace([], NOW);
    expect(empty.prediction).toBeNull();
    expect(empty.reason).toBe("no-runs");
    expect(empty.message).toMatch(/Strava|Garmin/);

    // A ride is not a run — the runner still has nothing to predict from.
    expect(predictRace([run(3, 20, 280, "Ride")], NOW).reason).toBe("no-runs");
  });

  it("says the runs are stale when nothing falls inside the lookback window", () => {
    const stale = predictRace([run(200, 10, 260)], NOW);
    expect(stale.prediction).toBeNull();
    expect(stale.reason).toBe("stale-runs");
    expect(stale.message).toContain("84 dage");

    // A run in the future (a clock skew) can't inform today's fitness either.
    expect(predictRace([run(-2, 10, 260)], NOW).reason).toBe("stale-runs");
  });

  it("says the runs are too short when none can anchor a Riegel extrapolation", () => {
    const short = predictRace([run(1, 2, 200), run(4, 3, 300)], NOW);
    expect(short.prediction).toBeNull();
    expect(short.reason).toBe("runs-too-short");
    expect(short.requiredKm).toBe(minBasisKm(HALF_MARATHON_KM));
    expect(short.message).toContain("5,5 km");
  });

  it("names the unlocking distance on every lock, so the card can always ask for it", () => {
    for (const activities of [[], [run(200, 10, 260)], [run(1, 2, 200)]]) {
      expect(predictRace(activities, NOW, MARATHON_KM).requiredKm).toBe(10.5);
    }
  });

  it("carries no reason, message or required distance once it can actually predict", () => {
    const result = predictRace([run(3, 10, 270)], NOW);
    expect(result.prediction).not.toBeNull();
    expect(result.reason).toBeNull();
    expect(result.message).toBeNull();
    expect(result.requiredKm).toBeNull();
  });
});

describe("predictRace — the bar scales with the race (issue #117)", () => {
  it("asks for a quarter of the race, never less than the 5 km floor", () => {
    expect(minBasisKm(10)).toBe(5); // 2,5 km would anchor nothing — the floor holds
    expect(minBasisKm(HALF_MARATHON_KM)).toBe(5.5);
    expect(minBasisKm(MARATHON_KM)).toBe(10.5);
    // Rounded to a distance a runner would actually go out and run.
    expect(minBasisKm(37) % 0.5).toBe(0);
  });

  it("won't let one 5 km unlock a marathon estimate", () => {
    // The very run that anchors a 10 km prediction is far too short a hop to
    // extrapolate 42 km from — Riegel would promise a time nobody has earned.
    const single5k = [run(3, 5, 270)];
    expect(predictRace(single5k, NOW, 10).prediction).not.toBeNull();

    const marathon = predictRace(single5k, NOW, MARATHON_KM);
    expect(marathon.prediction).toBeNull();
    expect(marathon.reason).toBe("runs-too-short");
    // And the copy asks for the distance that *would* unlock it, not the floor.
    expect(marathon.message).toContain("10,5 km");
  });

  it("unlocks the same marathon the moment the runner clears its own bar", () => {
    const result = predictRace([run(3, 11, 300)], NOW, MARATHON_KM);
    expect(result.prediction?.basisKm).toBe(11);
    expect(result.prediction?.raceDistanceKm).toBe(MARATHON_KM);
  });

  it("unlocks at exactly the distance it asked for — the gate and the copy agree", () => {
    const required = minBasisKm(MARATHON_KM);
    expect(predictRace([run(3, required, 300)], NOW, MARATHON_KM).prediction).not.toBeNull();
  });
});

describe("zone paces", () => {
  const prediction = predicted([run(3, 10, 270)]);

  it("orders the zones by effort — only intervals beat race pace", () => {
    const paces = zonePaces(prediction);
    // Higher seconds/km = slower.
    expect(paces.recovery).toBeGreaterThan(paces.easy);
    expect(paces.easy).toBeGreaterThan(paces.long);
    expect(paces.long).toBeGreaterThan(paces.tempo);
    expect(paces.tempo).toBeGreaterThan(prediction.paceSecPerKm);
    expect(paces.interval).toBeLessThan(prediction.paceSecPerKm);
  });

  it.each(
    Object.keys(PACE_ZONE_SPEED_FRACTION) as PaceZone[]
  )("derives %s pace as a fraction of race speed", (zone) => {
    const expected = prediction.paceSecPerKm / PACE_ZONE_SPEED_FRACTION[zone];
    // Rounded to the 5-second grid a coach actually says out loud.
    expect(zonePaceSeconds(prediction, zone)).toBe(Math.round(expected / 5) * 5);
    expect(zonePaceSeconds(prediction, zone) % 5).toBe(0);
  });
});

describe("formatting", () => {
  it("formats a pace as m:ss and a target as a range", () => {
    expect(formatPaceClock(330)).toBe("5:30");
    expect(formatPaceRange(330)).toBe("5:20–5:40");
  });

  it("formats a race time as h:mm, zero-padding the minutes", () => {
    expect(formatRaceTime(5900)).toBe("1:38");
    expect(formatRaceTime(3660)).toBe("1:01");
  });

  it("rounds a goal time up to the next 5 minutes, so the estimate sits under it", () => {
    expect(goalTimeFor(5900)).toBe("1:40"); // 1:38:20 → 1:40
    expect(goalTimeFor(6000)).toBe("1:40"); // exactly 1:40 stays put
  });
});

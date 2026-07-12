/**
 * Garmin Connect Developer Program response types. Field names match the
 * Activity API / Health API payloads exactly (Garmin suffixes every measure
 * with its unit — `distanceInMeters`, not `distance`).
 */

export type GarminTokensResponse = {
  access_token: string;
  token_type: string;
  /** Access-token lifetime in seconds (Garmin: 24h). */
  expires_in: number;
  refresh_token: string;
  /** Refresh-token lifetime in seconds (Garmin: ~3 months). */
  refresh_token_expires_in?: number;
  scope?: string;
  jti?: string;
};

/** `GET /user/id` — the stable, app-scoped Garmin user identifier. */
export type GarminUserIdResponse = {
  userId: string;
};

/**
 * One activity summary from `GET /activities` or a push notification.
 *
 * Only `summaryId`, `startTimeInSeconds`, `activityType` and `durationInSeconds`
 * are guaranteed; everything else depends on the device and the athlete's
 * settings (no strap → no heart rate; no footpod → no cadence).
 */
export type GarminActivitySummary = {
  /** Stable id of this summary — the sync's dedup key. */
  summaryId: string;
  /** Numeric Garmin Connect activity id. Absent on some manual entries. */
  activityId?: number;
  activityName?: string | null;
  /** Garmin's enum: "RUNNING", "TRAIL_RUNNING", "TREADMILL_RUNNING", "CYCLING", … */
  activityType: string;
  /** Activity start, epoch seconds UTC. */
  startTimeInSeconds: number;
  /** Seconds to add to `startTimeInSeconds` to get the athlete's local wall clock. */
  startTimeOffsetInSeconds?: number;
  /** Elapsed duration in seconds. */
  durationInSeconds: number;
  /** Duration excluding pauses. Absent when the device reported none. */
  movingDurationInSeconds?: number | null;
  distanceInMeters?: number | null;
  averageSpeedInMetersPerSecond?: number | null;
  maxSpeedInMetersPerSecond?: number | null;
  averageHeartRateInBeatsPerMinute?: number | null;
  maxHeartRateInBeatsPerMinute?: number | null;
  /** Steps per minute, counting *both* legs — unlike Strava's single-leg cadence. */
  averageRunCadenceInStepsPerMinute?: number | null;
  averagePowerInWatts?: number | null;
  totalElevationGainInMeters?: number | null;
  activeKilocalories?: number | null;
  deviceName?: string | null;
  /** True when the athlete deleted the activity in Garmin Connect. */
  isWebUpload?: boolean;
  manual?: boolean;
};

/**
 * A push-notification item. Garmin fans out two shapes on the same endpoint:
 *
 *  - **Push**: the full activity summary inline (every field above).
 *  - **Ping**: only a `callbackURL` plus the upload window, which the receiver
 *    must call back to collect the summaries.
 *
 * The webhook handles both, so the union is modelled as one optional field.
 */
export type GarminPushItem = Partial<GarminActivitySummary> & {
  userId: string;
  userAccessToken?: string;
  /** Present on ping-style notifications only. */
  callbackURL?: string;
  uploadStartTimeInSeconds?: number;
  uploadEndTimeInSeconds?: number;
};

export type GarminPushPayload = {
  activities?: GarminPushItem[];
  activityDetails?: GarminPushItem[];
  /** Sent when a user revokes the app's access from Garmin Connect. */
  deregistrations?: { userId: string; userAccessToken?: string }[];
};

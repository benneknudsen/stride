/** Strava API v3 response types. Field names match the Strava API exactly. */

export type StravaTokensResponse = {
  token_type: string;
  expires_at: number;
  expires_in: number;
  refresh_token: string;
  access_token: string;
  athlete?: StravaAthlete;
};

export type RefreshTokenResponse = {
  token_type: string;
  access_token: string;
  expires_at: number;
  expires_in: number;
  refresh_token: string;
};

export type StravaAthlete = {
  id: number;
  username: string | null;
  firstname: string;
  lastname: string;
  city: string | null;
  state: string | null;
  country: string | null;
  sex: "M" | "F" | null;
  profile_medium: string | null;
  profile: string | null;
};

export type StravaMap = {
  id: string;
  summary_polyline: string | null;
  resource_state: number;
};

export type Split = {
  distance: number;
  elapsed_time: number;
  elevation_difference: number | null;
  moving_time: number;
  split: number;
  average_speed: number;
  average_grade_adjusted_speed: number | null;
  average_heartrate: number | null;
  pace_zone: number | null;
};

export type SummaryActivity = {
  id: number;
  name: string;
  distance: number;
  moving_time: number;
  elapsed_time: number;
  total_elevation_gain: number;
  type: string;
  sport_type: string;
  start_date: string;
  start_date_local: string;
  timezone: string;
  average_speed: number | null;
  max_speed: number | null;
  average_heartrate: number | null;
  max_heartrate: number | null;
  average_cadence: number | null;
  /** True when the athlete hid their heart-rate data — HR fields are absent. */
  heartrate_opt_out?: boolean | null;
  map: StravaMap | null;
  trainer: boolean;
  commute: boolean;
  manual: boolean;
  private: boolean;
  visibility: string | null;
  flagged: boolean;
  gear_id: string | null;
  kilojoules: number | null;
  average_watts: number | null;
  device_watts: boolean | null;
  max_watts: number | null;
  weighted_average_watts: number | null;
  elev_high: number | null;
  elev_low: number | null;
};

export type DetailedActivity = SummaryActivity & {
  description: string | null;
  calories: number | null;
  splits_metric: Split[];
  splits_standard: Split[];
  laps: StravLap[];
  segment_efforts: unknown[];
  photos: { count: number; primary: unknown | null } | null;
  device_name: string | null;
  embed_token: string | null;
};

export type StravLap = {
  id: number;
  name: string;
  elapsed_time: number;
  moving_time: number;
  start_date: string;
  distance: number;
  average_speed: number;
  average_heartrate: number | null;
  lap_index: number;
  split: number;
};

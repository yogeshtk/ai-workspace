// Types shared by the server, providers, planner and browser client.

/** Where a piece of timing information came from. */
export type DataSource = 'live' | 'scheduled' | 'demo';

export interface StationRef {
  crs: string;
  name: string;
}

/**
 * A timed event (departure or arrival) at a station.
 * `estimated` is null when no prediction exists; `delayedUnknown` means the
 * feed says "Delayed" without giving a time.
 */
export interface TimePoint {
  scheduled: number; // epoch ms
  estimated: number | null; // epoch ms (live prediction or actual)
  actual: boolean; // estimated is an actual (already happened) time
  delayedUnknown: boolean;
}

/** One train ride between two stations. */
export interface Leg {
  serviceId: string; // provider-unique id for the train (used for dedup)
  from: StationRef;
  to: StationRef;
  dep: TimePoint;
  arr: TimePoint;
  platform: string | null;
  platformConfirmed: boolean;
  operator: string | null;
  headsign: string | null; // the train's final destination
  cancelled: boolean;
  cancelReason: string | null;
  delayReason: string | null;
  source: DataSource;
}

export type ConnectionRisk = 'ok' | 'tight' | 'at-risk' | 'uncertain';

export interface Connection {
  station: StationRef;
  scheduledMinutes: number; // planned interchange time
  expectedMinutes: number; // interchange time using live predictions where known
  requiredMinutes: number; // user's minimum transfer (+ walking) time
  risk: ConnectionRisk;
}

export type JourneyStatus = 'on-time' | 'delayed' | 'cancelled' | 'risky' | 'unknown';

export interface Journey {
  id: string;
  kind: 'direct' | 'change';
  changes: number;
  legs: Leg[];
  departure: TimePoint; // first leg departure
  arrival: TimePoint; // last leg arrival
  scheduledDurationMinutes: number;
  expectedDurationMinutes: number;
  connection: Connection | null;
  status: JourneyStatus;
  source: DataSource; // weakest source of any leg ("scheduled" if any leg is scheduled)
  warnings: string[];
}

export interface PlannerOptions {
  minTransferMinutes: number; // minimum connection time at C
  walkingMinutes: number; // extra personal walking/transfer time at C
  maxChanges: 0 | 1;
  preferDirect: boolean;
  maxConnectionWaitMinutes: number; // ignore connections with longer waits
  count: number; // number of journeys to return
  earliestDeparture: number; // epoch ms – no journey departs before this
  latestDeparture: number; // epoch ms – no journey departs after this
}

export type Direction = 'work' | 'home';

export interface JourneyQuery {
  from: string;
  to: string;
  via: string | null;
  date: string; // YYYY-MM-DD, London calendar date
  time: string; // HH:MM London wall clock (start of window)
  windowMinutes: number;
  minTransferMinutes: number;
  walkingMinutes: number;
  maxChanges: 0 | 1;
  preferDirect: boolean;
  count: number;
  earliest: string | null; // HH:MM earliest acceptable departure
  latest: string | null; // HH:MM latest acceptable departure
}

export interface SourceInfo {
  provider: string; // e.g. "National Rail Darwin (LDBWS)"
  kind: DataSource;
  fetchedAt: number; // epoch ms the upstream data was fetched
  fromCache: boolean; // served from server cache
  stale: boolean; // older than its freshness target (e.g. upstream failed)
  note: string | null;
}

export interface JourneyResponse {
  query: JourneyQuery;
  generatedAt: number;
  mode: 'live' | 'scheduled' | 'mixed' | 'demo';
  journeys: Journey[];
  cancelled: Journey[]; // cancelled options in the window, shown separately
  explanation: string | null; // e.g. why fewer than five results
  sources: SourceInfo[];
  notices: string[]; // disruption messages, data limitations, bank holidays…
  windowEnd: number; // epoch ms the search window ended at
}

export interface ProviderStatus {
  mode: 'live' | 'scheduled-only' | 'demo';
  live: { name: string; configured: boolean; missing: string[] };
  scheduled: { name: string; configured: boolean; missing: string[]; detail: string | null };
  demo: boolean;
  messages: string[];
}

export interface ApiError {
  error: string;
  code: 'bad-request' | 'no-data' | 'upstream' | 'rate-limited' | 'auth' | 'internal';
  retryAfterSeconds?: number;
}

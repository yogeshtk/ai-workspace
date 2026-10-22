// Provider abstraction. The journey service only talks to these interfaces,
// so a different timetable/live source (e.g. a licensed journey planner) can
// be dropped in without touching the planner or the UI.

import type { DataSource, Leg, SourceInfo } from '../../shared/types.ts';

export type LegRole = 'direct' | 'first' | 'second';

export interface LegRequest {
  from: string; // CRS
  to: string; // CRS
  date: string; // London calendar date of the search
  startMs: number; // earliest departure from `from`
  endMs: number; // latest departure from `from`
  role: LegRole;
}

export interface LegResult {
  legs: Leg[];
  source: SourceInfo;
  coveredUntil: number; // departures up to this instant are complete in `legs`
  notices: string[];
}

export interface LegProvider {
  readonly name: string;
  readonly kind: DataSource;
  getLegs(req: LegRequest): Promise<LegResult>;
}

/** Live providers only cover a short window around "now". */
export interface LiveLegProvider extends LegProvider {
  /** Latest departure instant the live feed can return, given the current time. */
  liveHorizon(nowMs: number): number;
  /** Earliest instant the live feed can look back to. */
  liveLookback(nowMs: number): number;
}

/** Scheduled providers can answer any date they hold data for. */
export interface ScheduledLegProvider extends LegProvider {
  coversDate(date: string): boolean;
  coversStations(crs: string[]): boolean;
  describe(): string | null;
}

export class ProviderError extends Error {
  readonly code: 'auth' | 'rate-limited' | 'upstream' | 'no-data';
  readonly retryAfterSeconds: number | undefined;
  constructor(message: string, code: ProviderError['code'], retryAfterSeconds?: number) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

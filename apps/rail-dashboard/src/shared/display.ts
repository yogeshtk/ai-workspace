// Presentation decisions that are worth unit-testing: which label a result
// set gets (live / scheduled / demo / cached), pruning departed trains from
// cached results, and what to show when a refresh fails.

import { effective } from './planner.ts';
import type { Journey, JourneyResponse } from './types.ts';
import { formatLondonTime, minutesBetween } from './time.ts';

export type FreshnessKind = 'live' | 'scheduled' | 'demo' | 'mixed' | 'cached' | 'stale';

export interface Freshness {
  kind: FreshnessKind;
  badge: string; // short uppercase label
  text: string; // sentence for the footer
}

/** Drop journeys that have already left (by best-known time) — used for cached results. */
export function pruneDeparted(resp: JourneyResponse, nowMs: number): JourneyResponse {
  const keep = (j: Journey) => effective(j.departure) >= nowMs - 60_000;
  return { ...resp, journeys: resp.journeys.filter(keep), cancelled: resp.cancelled.filter(keep) };
}

export function describeFreshness(resp: JourneyResponse, nowMs: number, local: { fromDeviceCache: boolean; savedAt: number | null }): Freshness {
  const updated = formatLondonTime(resp.generatedAt);
  if (local.fromDeviceCache) {
    const age = Math.max(0, minutesBetween(local.savedAt ?? resp.generatedAt, nowMs));
    return {
      kind: 'cached',
      badge: 'Cached',
      text: `Cached on this device ${age <= 0 ? 'just now' : `${age} min ago`} (from ${updated}). Live status may have changed.`,
    };
  }
  if (resp.sources.some((s) => s.stale)) {
    const oldest = Math.min(...resp.sources.map((s) => s.fetchedAt));
    return { kind: 'stale', badge: 'Stale', text: `Live feed unavailable — showing data from ${formatLondonTime(oldest)}.` };
  }
  switch (resp.mode) {
    case 'live':
      return { kind: 'live', badge: 'Live', text: `Live data · updated ${updated}` };
    case 'mixed':
      return { kind: 'mixed', badge: 'Live + timetable', text: `Live for the next ~2 hours, timetable after · updated ${updated}` };
    case 'scheduled':
      return { kind: 'scheduled', badge: 'Timetable', text: `Planned timetable (no live updates) · generated ${updated}` };
    default:
      return { kind: 'demo', badge: 'Demo', text: `DEMO data — simulated, not real trains · generated ${updated}` };
  }
}

export interface FailureDecision {
  showCached: boolean;
  message: string;
  retryAfterSeconds: number | null;
}

export function decideOnFailure(
  error: { status: number | null; message: string; retryAfterSeconds?: number | null },
  cached: { savedAt: number } | null,
  nowMs: number,
): FailureDecision {
  const offline = error.status === null;
  const base = offline
    ? 'No connection.'
    : error.status === 429
      ? 'Too many requests — pausing updates briefly.'
      : error.message || 'Could not update.';
  if (cached) {
    const age = Math.max(0, minutesBetween(cached.savedAt, nowMs));
    return {
      showCached: true,
      message: `${base} Showing cached results from ${formatLondonTime(cached.savedAt)} (${age} min old) — check before you travel.`,
      retryAfterSeconds: error.retryAfterSeconds ?? null,
    };
  }
  return { showCached: false, message: base, retryAfterSeconds: error.retryAfterSeconds ?? null };
}

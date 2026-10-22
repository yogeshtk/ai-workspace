// National Rail Darwin "Live Departure Board" (LDBWS) via the Rail Data
// Marketplace REST gateway. Provides live departures, delays, cancellations
// and platforms for roughly the next two hours (timeOffset -120..119,
// timeWindow ≤ 120). It is a departure board, not a journey planner: we use
// GetDepBoardWithDetails filtered "to" the destination and read the arrival
// time from each service's subsequent calling points. Connections are then
// built and validated by our own planner.
//
// Registration: https://raildata.org.uk → subscribe to "Live Departure Board"
// (LDBWS) and copy the consumer key into DARWIN_API_KEY.

import type { Leg, SourceInfo, TimePoint } from '../../shared/types.ts';
import { minutesBetween, resolveAfter, resolveNearTime } from '../../shared/time.ts';
import { TtlCache } from '../cache.ts';
import { stationName } from '../stations.ts';
import { type LegRequest, type LegResult, type LiveLegProvider, ProviderError } from './types.ts';

export const DEFAULT_DARWIN_BASE_URL = 'https://api1.raildata.org.uk/1010-live-departure-board-dep/LDBWS/api/20220120';
const PROVIDER_NAME = 'National Rail Darwin (live departure boards)';
const MAX_ROWS = 9; // "WithDetails" requests are capped below 10 rows
const MAX_PAGES = 4;
const LIVE_TTL_MS = 30_000;
const STALE_KEEP_MS = 15 * 60_000;

export interface DarwinOptions {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

// --- Raw response shape (tolerant: RDM returns camelCase JSON mirroring the
// LDBWS schema; PascalCase variants are accepted too). ---
type Raw = Record<string, unknown>;

function field<T = unknown>(obj: unknown, ...names: string[]): T | undefined {
  if (!obj || typeof obj !== 'object') return undefined;
  const o = obj as Raw;
  for (const n of names) {
    if (n in o) return o[n] as T;
    const pascal = n.charAt(0).toUpperCase() + n.slice(1);
    if (pascal in o) return o[pascal] as T;
  }
  return undefined;
}

function asArray(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (v && typeof v === 'object') {
    // SOAP→JSON conversions sometimes wrap lists: { service: [...] }
    const inner = Object.values(v as Raw).find(Array.isArray);
    if (inner) return inner as unknown[];
  }
  return [];
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Convert Darwin's estimate text ("On time", "07:45", "Delayed", "Cancelled") into a TimePoint. */
export function parseEstimate(scheduled: number, estimateText: string | null, actualText: string | null): TimePoint & { cancelled: boolean } {
  const tp = { scheduled, estimated: null as number | null, actual: false, delayedUnknown: false, cancelled: false };
  const actual = str(actualText);
  if (actual && actual.toLowerCase() !== 'on time' && /\d/.test(actual)) {
    tp.estimated = resolveNearTime(actual, scheduled);
    tp.actual = true;
    return tp;
  }
  if (actual && actual.toLowerCase() === 'on time') {
    tp.estimated = scheduled;
    tp.actual = true;
    return tp;
  }
  const e = (str(estimateText) ?? '').toLowerCase();
  if (e === 'on time') tp.estimated = scheduled;
  else if (e === 'cancelled') tp.cancelled = true;
  else if (e === 'delayed') tp.delayedUnknown = true;
  else if (/^\d{1,2}:\d{2}/.test(e)) tp.estimated = resolveNearTime(e, scheduled);
  // "No report", "Starts here", empty → no estimate.
  return tp;
}

/** Map one GetDepBoardWithDetails response to legs ending at `toCrs`. */
export function boardToLegs(board: unknown, fromCrs: string, toCrs: string, nowMs: number): { legs: Leg[]; messages: string[] } {
  const generated = Date.parse(String(field(board, 'generatedAt') ?? ''));
  const ref = Number.isFinite(generated) ? generated : nowMs;
  const legs: Leg[] = [];
  for (const svc of asArray(field(board, 'trainServices'))) {
    const std = str(field(svc, 'std'));
    const depSched = resolveNearTime(std, ref);
    if (depSched === null) continue;
    const depParsed = parseEstimate(depSched, str(field(svc, 'etd')), str(field(svc, 'atd')));

    const callingPoints = asArray(field(svc, 'subsequentCallingPoints')).flatMap((list) => asArray(field(list, 'callingPoint') ?? list));
    const cp = callingPoints.find((c) => str(field(c, 'crs')) === toCrs);
    if (!cp) continue;
    const arrSched = resolveAfter(str(field(cp, 'st')), depSched);
    if (arrSched === null) continue;
    const arrParsed = parseEstimate(arrSched, str(field(cp, 'et')), str(field(cp, 'at')));
    // Keep arrival estimates on the right side of midnight.
    if (arrParsed.estimated !== null && arrParsed.estimated < depSched - 60 * 60_000) {
      arrParsed.estimated = resolveAfter(str(field(cp, 'et')) ?? str(field(cp, 'at')), depSched);
    }

    const cancelled =
      field(svc, 'isCancelled') === true ||
      field(svc, 'filterLocationCancelled') === true ||
      depParsed.cancelled ||
      field(cp, 'isCancelled') === true ||
      arrParsed.cancelled;

    const destination = asArray(field(svc, 'destination'))[0];
    const { cancelled: _d, ...dep } = depParsed;
    const { cancelled: _a, ...arr } = arrParsed;
    legs.push({
      serviceId: `darwin:${str(field(svc, 'serviceID', 'serviceId')) ?? `${fromCrs}-${std}`}`,
      from: { crs: fromCrs, name: str(field(board, 'locationName')) ?? stationName(fromCrs) },
      to: { crs: toCrs, name: str(field(cp, 'locationName')) ?? stationName(toCrs) },
      dep,
      arr,
      platform: str(field(svc, 'platform')),
      platformConfirmed: str(field(svc, 'platform')) !== null,
      operator: str(field(svc, 'operator')),
      headsign: str(field(destination, 'locationName')),
      cancelled,
      cancelReason: cancelled ? str(field(svc, 'cancelReason')) : null,
      delayReason: str(field(svc, 'delayReason')),
      source: 'live',
    });
  }
  const messages = asArray(field(board, 'nrccMessages'))
    .map((m) => str(typeof m === 'string' ? m : field(m, 'value', 'Value', 'message')))
    .filter((m): m is string => m !== null)
    .map(stripHtml);
  return { legs, messages };
}

export class DarwinProvider implements LiveLegProvider {
  readonly name = PROVIDER_NAME;
  readonly kind = 'live' as const;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly cache: TtlCache<unknown>;

  constructor(opts: DarwinOptions) {
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? DEFAULT_DARWIN_BASE_URL).replace(/\/$/, '');
    this.timeoutMs = opts.timeoutMs ?? 4000;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.now = opts.now ?? Date.now;
    this.cache = new TtlCache<unknown>(300, this.now);
  }

  liveHorizon(nowMs: number): number {
    return nowMs + 119 * 60_000;
  }

  liveLookback(nowMs: number): number {
    return nowMs - 5 * 60_000;
  }

  /** Fetch a board; returns cached copy when fresh and a stale copy on upstream failure. */
  async fetchBoard(crs: string, filterCrs: string, timeOffset: number, timeWindow: number): Promise<{ board: unknown; fetchedAt: number; fromCache: boolean; stale: boolean }> {
    const offset = Math.max(-120, Math.min(119, Math.round(timeOffset)));
    const window = Math.max(1, Math.min(120, Math.round(timeWindow)));
    const key = `${crs}>${filterCrs}@${offset}/${window}`;
    const hit = this.cache.get(key);
    if (hit) return { board: hit.value, fetchedAt: hit.storedAt, fromCache: true, stale: false };

    const url = `${this.baseUrl}/GetDepBoardWithDetails/${encodeURIComponent(crs)}?numRows=${MAX_ROWS}&filterCrs=${encodeURIComponent(filterCrs)}&filterType=to&timeOffset=${offset}&timeWindow=${window}`;
    try {
      const res = await this.fetchImpl(url, {
        headers: { 'x-apikey': this.apiKey, accept: 'application/json', 'user-agent': 'rail-dashboard/1.0' },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (res.status === 401 || res.status === 403) throw new ProviderError('Darwin rejected the API key (check DARWIN_API_KEY and your Rail Data Marketplace subscription).', 'auth');
      if (res.status === 429) {
        const retry = Number(res.headers.get('retry-after')) || 60;
        throw new ProviderError('Darwin rate limit reached.', 'rate-limited', retry);
      }
      if (!res.ok) throw new ProviderError(`Darwin returned HTTP ${res.status}.`, 'upstream');
      const board = (await res.json()) as unknown;
      this.cache.set(key, board, LIVE_TTL_MS, STALE_KEEP_MS);
      // Keyed without the (relative) offset so a later failure can fall back to it.
      this.cache.set(`${crs}>${filterCrs}@last`, board, LIVE_TTL_MS, STALE_KEEP_MS);
      return { board, fetchedAt: this.now(), fromCache: false, stale: false };
    } catch (err) {
      const stale = this.cache.getStale(key) ?? this.cache.getStale(`${crs}>${filterCrs}@last`);
      if (stale && !(err instanceof ProviderError && err.code === 'auth')) {
        return { board: stale.value, fetchedAt: stale.storedAt, fromCache: true, stale: true };
      }
      if (err instanceof ProviderError) throw err;
      const msg = err instanceof Error && err.name === 'TimeoutError' ? 'Darwin request timed out.' : `Darwin request failed: ${err instanceof Error ? err.message : String(err)}`;
      throw new ProviderError(msg, 'upstream');
    }
  }

  async getLegs(req: LegRequest): Promise<LegResult> {
    const now = this.now();
    const horizon = this.liveHorizon(now);
    const start = Math.max(req.startMs, this.liveLookback(now));
    const end = Math.min(req.endMs, horizon);
    const legs: Leg[] = [];
    const messages = new Set<string>();
    let fetchedAt = now;
    let fromCache = true;
    let stale = false;
    let coveredUntil = end;

    let offset = minutesBetween(now, start);
    for (let page = 0; page < MAX_PAGES && offset <= 119; page++) {
      const window = Math.min(120, minutesBetween(now, end) - offset + 1);
      if (window <= 0) break;
      const r = await this.fetchBoard(req.from, req.to, offset, window);
      fetchedAt = Math.min(fetchedAt, r.fetchedAt);
      fromCache &&= r.fromCache;
      stale ||= r.stale;
      const parsed = boardToLegs(r.board, req.from, req.to, now);
      parsed.messages.forEach((m) => messages.add(m));
      const rows = asArray(field(r.board, 'trainServices')).length;
      for (const l of parsed.legs) if (!legs.some((x) => x.serviceId === l.serviceId)) legs.push(l);
      if (rows < MAX_ROWS) break;
      // Board was full: page on from the last scheduled departure.
      const last = Math.max(...parsed.legs.map((l) => l.dep.scheduled), start);
      const nextOffset = minutesBetween(now, last) + 1;
      if (nextOffset <= offset) break;
      if (page === MAX_PAGES - 1) coveredUntil = last;
      offset = nextOffset;
    }

    const source: SourceInfo = {
      provider: this.name,
      kind: 'live',
      fetchedAt,
      fromCache,
      stale,
      note: stale ? 'Live feed unavailable — showing the last live data received.' : null,
    };
    return { legs, source, coveredUntil, notices: [...messages] };
  }
}

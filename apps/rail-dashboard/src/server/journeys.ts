// Journey service: fetches the legs needed for a query from the configured
// providers (live first, scheduled timetable for the rest, or demo), then runs
// the planner. Live and scheduled data are never blended inside one leg; each
// leg keeps the source it came from so the UI can label it.

import { isBankHoliday, isNoServiceDay } from '../shared/calendar.ts';
import { queryKey } from '../shared/commute.ts';
import { explainShortfall, planJourneys } from '../shared/planner.ts';
import type { JourneyQuery, JourneyResponse, Leg, SourceInfo } from '../shared/types.ts';
import { londonParts, londonWallToEpoch, parseHhmm } from '../shared/time.ts';
import { TtlCache } from './cache.ts';
import { type LegProvider, type LegRequest, type LegRole, type LiveLegProvider, ProviderError, type ScheduledLegProvider } from './providers/types.ts';
import { stationName } from './stations.ts';

const MINUTE = 60_000;
export const MAX_CONNECTION_WAIT_MINUTES = 90;

export interface ProviderSet {
  live: LiveLegProvider | null;
  scheduled: ScheduledLegProvider | null;
  demo: LegProvider | null; // only set when running in demo mode
  now: () => number;
}

interface RoleResult {
  legs: Leg[];
  sources: SourceInfo[];
  notices: string[];
  liveUsed: boolean;
  liveLimited: boolean;
}

async function fetchRole(req: LegRequest, set: ProviderSet): Promise<RoleResult> {
  if (set.demo) {
    const r = await set.demo.getLegs(req);
    return { legs: r.legs, sources: [r.source], notices: r.notices, liveUsed: false, liveLimited: false };
  }
  const now = set.now();
  const out: RoleResult = { legs: [], sources: [], notices: [], liveUsed: false, liveLimited: false };
  let liveStart = Infinity;
  let liveEnd = -Infinity;
  let liveError: ProviderError | null = null;

  const live = set.live;
  if (live && req.endMs >= live.liveLookback(now) && req.startMs <= live.liveHorizon(now)) {
    try {
      const r = await live.getLegs(req);
      out.legs.push(...r.legs);
      out.sources.push(r.source);
      out.notices.push(...r.notices);
      out.liveUsed = true;
      liveStart = Math.max(req.startMs, live.liveLookback(now));
      liveEnd = r.coveredUntil;
    } catch (err) {
      liveError = err instanceof ProviderError ? err : new ProviderError(String(err), 'upstream');
    }
  }

  const needScheduled = !out.liveUsed || req.startMs < liveStart || req.endMs > liveEnd;
  const sched = set.scheduled;
  if (needScheduled && sched && sched.coversStations([req.from, req.to]) && sched.coversDate(req.date)) {
    const r = await sched.getLegs(req);
    const extra = r.legs.filter((l) => {
      if (l.dep.scheduled >= liveStart && l.dep.scheduled <= liveEnd) return false; // live covers this span
      return !out.legs.some((x) => x.to.crs === l.to.crs && Math.abs(x.dep.scheduled - l.dep.scheduled) < MINUTE);
    });
    out.legs.push(...extra);
    out.sources.push(r.source);
    if (liveError) out.notices.push(`Live data unavailable (${liveError.message}) — showing the planned timetable instead.`);
  } else if (needScheduled && out.liveUsed && req.endMs > liveEnd) {
    out.liveLimited = true;
  } else if (!out.liveUsed) {
    if (liveError) throw liveError;
    throw new ProviderError(noDataMessage(req, set), 'no-data');
  }
  return out;
}

function noDataMessage(req: LegRequest, set: ProviderSet): string {
  if (set.scheduled && !set.scheduled.coversStations([req.from, req.to])) {
    return `The imported timetable does not include ${stationName(req.from)} → ${stationName(req.to)}. Re-run the timetable import with these stations.`;
  }
  if (set.scheduled && !set.scheduled.coversDate(req.date)) {
    return `The imported timetable does not cover ${req.date}. Re-run the timetable import to refresh it.`;
  }
  if (set.live) {
    return 'Live data only covers about the next two hours. To plan other times or dates, import the Network Rail timetable (see README → "Scheduled timetable").';
  }
  return 'No timetable source is configured.';
}

export class JourneyService {
  private readonly set: ProviderSet;
  private readonly cache = new TtlCache<JourneyResponse>(200);
  private readonly cacheMs: number;

  constructor(set: ProviderSet, opts: { cacheMs?: number } = {}) {
    this.set = set;
    this.cacheMs = opts.cacheMs ?? 15_000;
  }

  async find(q: JourneyQuery): Promise<JourneyResponse> {
    const now = this.set.now();
    const key = `${queryKey(q)}#${Math.floor(now / 15_000)}`;
    const hit = this.cacheMs > 0 ? this.cache.get(key) : undefined;
    if (hit) return hit.value;

    const startMs = londonWallToEpoch(q.date, parseHhmm(q.time) ?? 0);
    const windowEnd = startMs + q.windowMinutes * MINUTE;
    const earliestMs = q.earliest ? Math.max(startMs, londonWallToEpoch(q.date, parseHhmm(q.earliest) ?? 0)) : startMs;
    const latestMs = q.latest ? Math.min(windowEnd, londonWallToEpoch(q.date, parseHhmm(q.latest) ?? 1439)) : windowEnd;
    const useVia = Boolean(q.via) && q.maxChanges >= 1;

    const req = (from: string, to: string, role: LegRole, endMs: number): LegRequest => ({ from, to, date: q.date, startMs, endMs, role });
    const secondEnd = windowEnd + (MAX_CONNECTION_WAIT_MINUTES + 30) * MINUTE;
    const empty: RoleResult = { legs: [], sources: [], notices: [], liveUsed: false, liveLimited: false };

    // Fetch all boards in parallel. A missing via-leg should not sink the direct results.
    const [direct, first, second] = await Promise.all([
      fetchRole(req(q.from, q.to, 'direct', windowEnd), this.set),
      useVia ? fetchRole(req(q.from, q.via!, 'first', windowEnd), this.set).catch(() => empty) : Promise.resolve(empty),
      useVia ? fetchRole(req(q.via!, q.to, 'second', secondEnd), this.set).catch(() => empty) : Promise.resolve(empty),
    ]);

    const result = planJourneys(
      { direct: direct.legs, first: first.legs, second: second.legs },
      {
        minTransferMinutes: q.minTransferMinutes,
        walkingMinutes: q.walkingMinutes,
        maxChanges: q.maxChanges,
        preferDirect: q.preferDirect,
        maxConnectionWaitMinutes: MAX_CONNECTION_WAIT_MINUTES,
        count: q.count,
        earliestDeparture: earliestMs,
        latestDeparture: latestMs,
      },
    );

    const allSources = dedupeSources([...direct.sources, ...first.sources, ...second.sources]);
    const kinds = new Set(allSources.map((s) => s.kind));
    const mode: JourneyResponse['mode'] = kinds.has('demo') ? 'demo' : kinds.size > 1 ? 'mixed' : kinds.has('live') ? 'live' : 'scheduled';
    const notices = [...new Set([...direct.notices, ...first.notices, ...second.notices])];
    const today = londonParts(now).date;

    if (mode === 'demo') notices.unshift('DEMO MODE — simulated trains, not real services. See "Data sources" below to connect real data.');
    if (isNoServiceDay(q.date)) notices.push('Normally no National Rail services run on 25 and 26 December.');
    else if (isBankHoliday(q.date)) notices.push('Bank holiday: a reduced or special timetable may apply.');
    if (q.date > today) notices.push('Future date: showing the planned timetable. Live times, platforms and disruption information appear on the day.');
    else if (mode === 'scheduled' && !this.set.demo) notices.push('Showing the planned timetable. Live times are available for about the next two hours.');
    if (direct.liveLimited || first.liveLimited || second.liveLimited) notices.push('Live data covers about two hours ahead; later trains are not shown until they enter the live window.');
    if (q.via && q.maxChanges >= 1 && first.legs.length === 0 && second.legs.length === 0 && !this.set.demo) {
      notices.push(`No connecting services via ${stationName(q.via)} were found in this window.`);
    }

    const response: JourneyResponse = {
      query: q,
      generatedAt: now,
      mode,
      journeys: result.journeys,
      cancelled: result.cancelled,
      explanation: explainShortfall({
        found: result.journeys.length,
        wanted: q.count,
        windowStart: earliestMs,
        windowEnd: latestMs,
        maxChanges: q.maxChanges,
        cancelledCount: result.cancelled.length,
        liveWindowLimited: direct.liveLimited,
        extraReasons: isNoServiceDay(q.date) ? ['No trains are scheduled on this date.'] : [],
      }),
      sources: allSources,
      notices,
      windowEnd: latestMs,
    };
    if (this.cacheMs > 0) this.cache.set(key, response, this.cacheMs);
    return response;
  }
}

function dedupeSources(sources: SourceInfo[]): SourceInfo[] {
  const byProvider = new Map<string, SourceInfo>();
  for (const s of sources) {
    const prev = byProvider.get(s.provider);
    if (!prev) byProvider.set(s.provider, { ...s });
    else {
      prev.fetchedAt = Math.min(prev.fetchedAt, s.fetchedAt);
      prev.fromCache &&= s.fromCache;
      prev.stale ||= s.stale;
      if (s.stale && s.note) prev.note = s.note;
    }
  }
  return [...byProvider.values()];
}

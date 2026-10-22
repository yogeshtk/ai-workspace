// DEMO provider: a synthetic, clearly-labelled timetable so the app can be
// tried without credentials. Every leg it returns has source "demo" and the
// UI labels it as simulated. Nothing here represents a real train.
//
// Pattern (identical for any station trio):
//   direct  A→B  weekdays every 30 min (:12, :42) 06:12–23:12, 49 min; also calls at C after 20 min
//   first   A→C  weekdays every 15 min (:03, :18, :33, :48), 17 min
//   second  C→B  weekdays every 10 min (:04, :14, …), 23 min
// Saturdays run half as often; Sundays and bank holidays hourly from 08:00;
// no service on 25/26 December. Scenario "disrupted" adds simulated delays
// and cancellations to demonstrate the warnings.

import { isBankHoliday, isNoServiceDay } from '../../shared/calendar.ts';
import type { Leg, SourceInfo } from '../../shared/types.ts';
import { addDays, londonParts, londonWallToEpoch, weekdayOf } from '../../shared/time.ts';
import { stationName } from '../stations.ts';
import type { LegProvider, LegRequest, LegResult } from './types.ts';

export type DemoScenario = 'normal' | 'disrupted';

interface Pattern {
  firstMinute: number; // first departure (minutes after midnight)
  lastMinute: number;
  headway: number;
  runMinutes: number;
}

function dayType(date: string): 'weekday' | 'saturday' | 'sunday' | 'none' {
  if (isNoServiceDay(date)) return 'none';
  if (isBankHoliday(date)) return 'sunday';
  const wd = weekdayOf(date);
  return wd === 0 ? 'sunday' : wd === 6 ? 'saturday' : 'weekday';
}

function pattern(kind: 'direct' | 'first' | 'second', day: ReturnType<typeof dayType>): Pattern | null {
  if (day === 'none') return null;
  const base: Record<typeof kind, Pattern> = {
    direct: { firstMinute: 6 * 60 + 12, lastMinute: 23 * 60 + 12, headway: 30, runMinutes: 49 },
    first: { firstMinute: 5 * 60 + 48, lastMinute: 23 * 60 + 48, headway: 15, runMinutes: 17 },
    second: { firstMinute: 6 * 60 + 4, lastMinute: 24 * 60 + 34, headway: 10, runMinutes: 23 },
  };
  const p = { ...base[kind] };
  if (day === 'saturday') p.headway *= 2;
  if (day === 'sunday') {
    p.headway = 60;
    p.firstMinute = 8 * 60 + (p.firstMinute % 60);
    p.lastMinute = 22 * 60 + (p.lastMinute % 60);
  }
  return p;
}

export class DemoProvider implements LegProvider {
  readonly name = 'DEMO timetable (simulated — not real trains)';
  readonly kind = 'demo' as const;
  private readonly scenario: DemoScenario;
  private readonly latencyMs: number;
  private readonly now: () => number;

  constructor(opts: { scenario?: DemoScenario; latencyMs?: number; now?: () => number } = {}) {
    this.scenario = opts.scenario ?? 'normal';
    this.latencyMs = opts.latencyMs ?? 0;
    this.now = opts.now ?? Date.now;
  }

  private legsFor(kind: 'direct' | 'first' | 'second', req: LegRequest, runDate: string): Leg[] {
    const p = pattern(kind, dayType(runDate));
    if (!p) return [];
    const out: Leg[] = [];
    let index = 0;
    for (let m = p.firstMinute; m <= p.lastMinute; m += p.headway, index++) {
      const dep = londonWallToEpoch(runDate, m);
      if (dep < req.startMs || dep > req.endMs) continue;
      const arr = londonWallToEpoch(runDate, m + p.runMinutes);
      const id = kind === 'direct' ? `demo:direct:${req.from}:${runDate}:${m}` : `demo:${kind}:${req.from}:${req.to}:${runDate}:${m}`;
      out.push(this.makeLeg(id, req, dep, arr, index, kind));
    }
    return out;
  }

  private makeLeg(serviceId: string, req: LegRequest, dep: number, arr: number, index: number, kind: string): Leg {
    const leg: Leg = {
      serviceId,
      from: { crs: req.from, name: stationName(req.from) },
      to: { crs: req.to, name: stationName(req.to) },
      dep: { scheduled: dep, estimated: null, actual: false, delayedUnknown: false },
      arr: { scheduled: arr, estimated: null, actual: false, delayedUnknown: false },
      platform: String((index % 4) + 1),
      platformConfirmed: false,
      operator: 'Demo Railway',
      headsign: stationName(req.to),
      cancelled: false,
      cancelReason: null,
      delayReason: null,
      source: 'demo',
    };
    // Simulated disruption only for today's near-term trains, and only when asked.
    const now = this.now();
    if (this.scenario === 'disrupted' && dep >= now - 10 * 60_000 && dep <= now + 3 * 3600_000) {
      if ((kind === 'direct' || kind === 'direct-via') && index % 3 === 1) {
        leg.cancelled = true;
        leg.cancelReason = 'Simulated cancellation (demo).';
      } else if (kind === 'first' && index % 2 === 0) {
        leg.dep.estimated = dep + 8 * 60_000;
        leg.arr.estimated = arr + 8 * 60_000;
        leg.delayReason = 'Simulated delay (demo).';
      }
    }
    return leg;
  }

  async getLegs(req: LegRequest): Promise<LegResult> {
    if (this.latencyMs > 0) await new Promise((r) => setTimeout(r, this.latencyMs));
    const legs: Leg[] = [];
    const first = addDays(londonParts(req.startMs).date, -1);
    const last = londonParts(req.endMs).date;
    for (let d = first; d <= last; d = addDays(d, 1)) {
      legs.push(...this.legsFor(req.role, req, d));
      // Direct trains also call at the transfer station: expose them as A→C legs
      // (same service id) so de-duplication is exercised like real data.
      if (req.role === 'first') {
        const p = pattern('direct', dayType(d));
        if (!p) continue;
        let index = 0;
        for (let m = p.firstMinute; m <= p.lastMinute; m += p.headway, index++) {
          const dep = londonWallToEpoch(d, m);
          if (dep < req.startMs || dep > req.endMs) continue;
          legs.push(this.makeLeg(`demo:direct:${req.from}:${d}:${m}`, req, dep, londonWallToEpoch(d, m + 20), index, 'direct-via'));
        }
      }
    }
    legs.sort((a, b) => a.dep.scheduled - b.dep.scheduled);
    const source: SourceInfo = {
      provider: this.name,
      kind: 'demo',
      fetchedAt: this.now(),
      fromCache: false,
      stale: false,
      note: this.scenario === 'disrupted' ? 'Demo mode with simulated disruption.' : 'Demo mode: simulated timetable.',
    };
    return { legs, source, coveredUntil: req.endMs, notices: [] };
  }
}

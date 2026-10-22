import type { DataSource, Leg, PlannerOptions } from '../src/shared/types.ts';
import { londonWallToEpoch, parseHhmm } from '../src/shared/time.ts';

export const DATE = '2026-10-22'; // a Thursday (BST)

export const at = (hhmm: string, date = DATE): number => londonWallToEpoch(date, parseHhmm(hhmm)!);

export interface LegSpec {
  id: string;
  from: string;
  to: string;
  dep: string;
  arr: string;
  depEst?: string | 'delayed';
  arrEst?: string | 'delayed';
  cancelled?: boolean;
  source?: DataSource;
  date?: string;
  arrDate?: string;
}

export function leg(s: LegSpec): Leg {
  const date = s.date ?? DATE;
  const arrDate = s.arrDate ?? date;
  const tp = (sched: string, est: string | undefined, d: string) => ({
    scheduled: at(sched, d),
    estimated: est && est !== 'delayed' ? at(est, d) : s.source === 'live' && est === undefined ? at(sched, d) : null,
    actual: false,
    delayedUnknown: est === 'delayed',
  });
  return {
    serviceId: s.id,
    from: { crs: s.from, name: s.from },
    to: { crs: s.to, name: s.to },
    dep: tp(s.dep, s.depEst, date),
    arr: tp(s.arr, s.arrEst, arrDate),
    platform: null,
    platformConfirmed: false,
    operator: null,
    headsign: null,
    cancelled: s.cancelled ?? false,
    cancelReason: s.cancelled ? 'Test cancellation' : null,
    delayReason: null,
    source: s.source ?? 'scheduled',
  };
}

export function opts(over: Partial<PlannerOptions> = {}): PlannerOptions {
  return {
    minTransferMinutes: 5,
    walkingMinutes: 0,
    maxChanges: 1,
    preferDirect: false,
    maxConnectionWaitMinutes: 90,
    count: 5,
    earliestDeparture: at('07:00'),
    latestDeparture: at('09:00'),
    ...over,
  };
}

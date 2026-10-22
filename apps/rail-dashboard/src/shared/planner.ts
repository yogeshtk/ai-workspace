// Pure journey planning: combines direct legs (A→B) and two-leg journeys via
// a transfer station (A→C, C→B) into a ranked, de-duplicated list.
//
// Connection validation is deliberately conservative: a connection is only
// planned when the *timetabled* interchange is at least the user's minimum
// transfer time (plus walking time). Live delays are then applied on top, and
// a connection that live data says will be missed is re-planned onto the next
// feasible onward train, with a warning. We never invent onward services: only
// legs supplied by the data provider are used.

import type { Connection, ConnectionRisk, DataSource, Journey, JourneyStatus, Leg, PlannerOptions, TimePoint } from './types.ts';
import { formatLondonTime, minutesBetween } from './time.ts';

const MINUTE = 60_000;
const DELAY_THRESHOLD_MINUTES = 2; // under this we still call it "on time"
const DIRECT_PREFERENCE_TOLERANCE_MINUTES = 5;

export interface PlannerInput {
  direct: Leg[]; // A → B
  first: Leg[]; // A → C
  second: Leg[]; // C → B
}

export interface PlannerResult {
  journeys: Journey[];
  cancelled: Journey[];
  consideredCount: number; // valid journeys before trimming to `count`
  latestDepartureSeen: number | null;
}

export function effective(tp: TimePoint): number {
  return tp.estimated ?? tp.scheduled;
}

function delayMinutes(tp: TimePoint): number {
  return tp.estimated === null ? 0 : minutesBetween(tp.scheduled, tp.estimated);
}

function weakestSource(legs: Leg[]): DataSource {
  if (legs.some((l) => l.source === 'demo')) return 'demo';
  if (legs.some((l) => l.source === 'scheduled')) return 'scheduled';
  return 'live';
}

function journeyId(legs: Leg[]): string {
  return legs.map((l) => `${l.serviceId}@${l.dep.scheduled}`).join('+');
}

function legStatus(legs: Leg[], risk: ConnectionRisk | null): JourneyStatus {
  if (legs.some((l) => l.cancelled)) return 'cancelled';
  if (risk === 'at-risk' || risk === 'uncertain') return 'risky';
  const late = legs.some(
    (l) => l.dep.delayedUnknown || l.arr.delayedUnknown || delayMinutes(l.dep) >= DELAY_THRESHOLD_MINUTES || delayMinutes(l.arr) >= DELAY_THRESHOLD_MINUTES,
  );
  if (late) return 'delayed';
  if (legs.every((l) => l.source === 'live')) return 'on-time';
  return 'unknown';
}

function legWarnings(leg: Leg): string[] {
  const out: string[] = [];
  if (leg.cancelled) out.push(`The ${formatLondonTime(leg.dep.scheduled)} ${leg.from.name} → ${leg.to.name} is cancelled${leg.cancelReason ? `: ${leg.cancelReason}` : '.'}`);
  else if (leg.dep.delayedUnknown) out.push(`The ${formatLondonTime(leg.dep.scheduled)} from ${leg.from.name} is delayed (no estimate yet).`);
  if (!leg.cancelled && leg.delayReason) out.push(leg.delayReason);
  return out;
}

function makeDirect(leg: Leg): Journey {
  const status = legStatus([leg], null);
  return {
    id: journeyId([leg]),
    kind: 'direct',
    changes: 0,
    legs: [leg],
    departure: leg.dep,
    arrival: leg.arr,
    scheduledDurationMinutes: minutesBetween(leg.dep.scheduled, leg.arr.scheduled),
    expectedDurationMinutes: minutesBetween(effective(leg.dep), effective(leg.arr)),
    connection: null,
    status,
    source: weakestSource([leg]),
    warnings: legWarnings(leg),
  };
}

function classifyConnection(first: Leg, second: Leg, required: number): { scheduled: number; expected: number; risk: ConnectionRisk } {
  const scheduled = minutesBetween(first.arr.scheduled, second.dep.scheduled);
  const expected = minutesBetween(effective(first.arr), effective(second.dep));
  let risk: ConnectionRisk = 'ok';
  if (first.arr.delayedUnknown || first.dep.delayedUnknown) risk = 'uncertain';
  else if (expected < required) risk = 'at-risk';
  else if (expected < scheduled && expected < required + 3) risk = 'tight';
  return { scheduled, expected, risk };
}

function makeConnecting(first: Leg, second: Leg, required: number, extraWarnings: string[]): Journey {
  const c = classifyConnection(first, second, required);
  const connection: Connection = {
    station: first.to,
    scheduledMinutes: c.scheduled,
    expectedMinutes: c.expected,
    requiredMinutes: required,
    risk: c.risk,
  };
  const warnings = [...extraWarnings, ...legWarnings(first), ...legWarnings(second)];
  if (c.risk === 'at-risk') {
    warnings.unshift(
      c.expected < 0
        ? `Connection at ${first.to.name} will be missed: the first train is expected after the ${formatLondonTime(second.dep.scheduled)} leaves.`
        : `Risky connection: only ${c.expected} min to change at ${first.to.name} (you need ${required}).`,
    );
  } else if (c.risk === 'uncertain') {
    warnings.unshift(`Connection at ${first.to.name} uncertain: first train delayed with no estimate.`);
  } else if (c.risk === 'tight') {
    warnings.unshift(`Tight connection: ${c.expected} min to change at ${first.to.name}.`);
  }
  const legs = [first, second];
  return {
    id: journeyId(legs),
    kind: 'change',
    changes: 1,
    legs,
    departure: first.dep,
    arrival: second.arr,
    scheduledDurationMinutes: minutesBetween(first.dep.scheduled, second.arr.scheduled),
    expectedDurationMinutes: minutesBetween(effective(first.dep), effective(second.arr)),
    connection,
    status: legStatus(legs, c.risk),
    source: weakestSource(legs),
    warnings,
  };
}

/**
 * Pick the onward train for a first leg. Returns null when no valid onward
 * service exists within the allowed wait.
 */
export function chooseConnection(
  first: Leg,
  seconds: Leg[],
  opts: Pick<PlannerOptions, 'minTransferMinutes' | 'walkingMinutes' | 'maxConnectionWaitMinutes'>,
): { second: Leg; warnings: string[] } | null {
  const required = opts.minTransferMinutes + opts.walkingMinutes;
  const maxWait = opts.maxConnectionWaitMinutes;
  const onward = seconds
    .filter((s) => s.serviceId !== first.serviceId && s.from.crs === first.to.crs)
    .sort((a, b) => a.dep.scheduled - b.dep.scheduled);

  // 1. The timetabled connection: earliest onward train meeting the minimum
  //    transfer time by the timetable (cancelled ones included so we can say so).
  const planned = onward.find((s) => {
    const gap = minutesBetween(first.arr.scheduled, s.dep.scheduled);
    return gap >= required && gap <= maxWait;
  });
  const warnings: string[] = [];
  if (planned && !planned.cancelled) {
    const expected = minutesBetween(effective(first.arr), effective(planned.dep));
    // Still makeable (possibly at risk) — keep the planned connection.
    if (expected >= 0 && !(first.arr.delayedUnknown && expected < required)) {
      if (expected < required || first.arr.delayedUnknown) {
        const fallback = onward.find((s) => s !== planned && !s.cancelled && minutesBetween(effective(first.arr), effective(s.dep)) >= required);
        if (fallback) warnings.push(`If you miss it, the next train from ${first.to.name} is at ${formatLondonTime(effective(fallback.dep))}.`);
      }
      return { second: planned, warnings };
    }
    warnings.push(`Delay means the ${formatLondonTime(planned.dep.scheduled)} from ${first.to.name} will probably be missed; re-planned onto the next train.`);
  } else if (planned?.cancelled) {
    warnings.push(`The ${formatLondonTime(planned.dep.scheduled)} from ${first.to.name} is cancelled; using the next connection.`);
  }

  // 2. Re-plan using live predictions: earliest running onward train leaving at
  //    least `required` minutes after the first train is expected to arrive.
  const arriveAt = effective(first.arr);
  const replanned = onward.find((s) => {
    if (s.cancelled) return false;
    const gap = minutesBetween(arriveAt, effective(s.dep));
    return gap >= required && gap <= maxWait;
  });
  if (!replanned) return null;
  return { second: replanned, warnings };
}

function dominates(k: Journey, j: Journey): boolean {
  if (k === j) return false;
  // A risky journey must never hide a safe one.
  if (k.connection && (k.connection.risk === 'at-risk' || k.connection.risk === 'uncertain')) return false;
  const kDep = effective(k.departure);
  const jDep = effective(j.departure);
  const kArr = effective(k.arrival);
  const jArr = effective(j.arrival);
  if (kDep < jDep || kArr > jArr || k.changes > j.changes) return false;
  return kDep > jDep || kArr < jArr || k.changes < j.changes;
}

function preferredDirectHides(k: Journey, j: Journey): boolean {
  return (
    k.kind === 'direct' &&
    j.kind === 'change' &&
    effective(k.departure) >= effective(j.departure) &&
    effective(k.arrival) <= effective(j.arrival) + DIRECT_PREFERENCE_TOLERANCE_MINUTES * MINUTE
  );
}

export function rankJourneys(a: Journey, b: Journey): number {
  return (
    effective(a.departure) - effective(b.departure) ||
    effective(a.arrival) - effective(b.arrival) ||
    a.changes - b.changes
  );
}

export function planJourneys(input: PlannerInput, opts: PlannerOptions): PlannerResult {
  const required = opts.minTransferMinutes + opts.walkingMinutes;
  const inWindow = (leg: Leg) => {
    const dep = effective(leg.dep);
    // A delayed train whose scheduled time has passed is still catchable.
    return dep >= opts.earliestDeparture && Math.min(dep, leg.dep.scheduled) <= opts.latestDeparture && !leg.dep.actual;
  };

  const candidates: Journey[] = [];
  const cancelled: Journey[] = [];

  for (const leg of input.direct) {
    if (!inWindow(leg) && !(leg.cancelled && leg.dep.scheduled >= opts.earliestDeparture && leg.dep.scheduled <= opts.latestDeparture)) continue;
    const j = makeDirect(leg);
    (leg.cancelled ? cancelled : candidates).push(j);
  }

  if (opts.maxChanges >= 1) {
    const directIds = new Set(input.direct.map((l) => l.serviceId));
    for (const first of input.first) {
      if (first.cancelled) {
        // Only report a cancelled first leg if it is not also a direct train
        // (that cancellation is already listed).
        if (!directIds.has(first.serviceId) && first.dep.scheduled >= opts.earliestDeparture && first.dep.scheduled <= opts.latestDeparture) {
          cancelled.push({ ...makeDirect(first), kind: 'change', changes: 1 });
        }
        continue;
      }
      if (!inWindow(first)) continue;
      const choice = chooseConnection(first, input.second, opts);
      if (!choice) continue;
      candidates.push(makeConnecting(first, choice.second, required, choice.warnings));
    }
  }

  // De-duplicate identical leg combinations.
  const unique = new Map<string, Journey>();
  for (const j of candidates) if (!unique.has(j.id)) unique.set(j.id, j);
  let list = [...unique.values()];

  // Drop journeys that are strictly worse than another (leave no later, arrive
  // no earlier, no fewer changes) and, if requested, connecting journeys that
  // a direct train makes pointless.
  list = list.filter((j) => !list.some((k) => dominates(k, j) || (opts.preferDirect && preferredDirectHides(k, j))));
  list.sort(rankJourneys);

  const latestDepartureSeen = list.length ? effective(list[list.length - 1]!.departure) : null;
  cancelled.sort(rankJourneys);
  const cancelledUnique = [...new Map(cancelled.map((j) => [j.id, j])).values()];
  return {
    journeys: list.slice(0, opts.count),
    cancelled: cancelledUnique,
    consideredCount: list.length,
    latestDepartureSeen,
  };
}

export interface ShortfallContext {
  found: number;
  wanted: number;
  windowStart: number;
  windowEnd: number;
  maxChanges: 0 | 1;
  cancelledCount: number;
  liveWindowLimited: boolean; // live data only covers ~2 hours ahead
  extraReasons: string[];
}

export function explainShortfall(ctx: ShortfallContext): string | null {
  if (ctx.found >= ctx.wanted) return null;
  const range = `${formatLondonTime(ctx.windowStart)}–${formatLondonTime(ctx.windowEnd)}`;
  const head = ctx.found === 0 ? `No journeys found departing ${range}.` : `Only ${ctx.found} journey${ctx.found === 1 ? '' : 's'} found departing ${range}.`;
  const reasons: string[] = [...ctx.extraReasons];
  if (ctx.cancelledCount > 0) reasons.push(`${ctx.cancelledCount} service${ctx.cancelledCount === 1 ? ' is' : 's are'} cancelled.`);
  if (ctx.maxChanges === 0) reasons.push('Connecting journeys are switched off (max changes = 0).');
  if (ctx.liveWindowLimited) reasons.push('Live data only covers about two hours ahead.');
  const startHour = Number(formatLondonTime(ctx.windowStart).slice(0, 2));
  const endHour = Number(formatLondonTime(ctx.windowEnd).slice(0, 2));
  if (startHour >= 22 || endHour < 5 || startHour < 5) reasons.push('Services are sparse late at night and early in the morning.');
  if (reasons.length === 0) reasons.push('There are no more trains in the search window — try a later time or a wider window.');
  return `${head} ${reasons.join(' ')}`;
}

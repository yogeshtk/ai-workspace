import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { chooseConnection, explainShortfall, planJourneys } from '../../src/shared/planner.ts';
import { formatLondonTime } from '../../src/shared/time.ts';
import type { Journey } from '../../src/shared/types.ts';
import { at, leg, opts } from '../helpers.ts';

const summary = (js: Journey[]) =>
  js.map((j) => `${formatLondonTime(j.departure.scheduled)}-${formatLondonTime(j.arrival.scheduled)}${j.kind === 'change' ? `@${formatLondonTime(j.legs[1]!.dep.scheduled)}` : ''}`);

describe('planJourneys — journey patterns', () => {
  it('direct-only journeys, sorted by departure, limited to five', () => {
    const direct = ['07:02', '07:12', '07:32', '07:42', '08:02', '08:12', '08:32'].map((t, i) =>
      leg({ id: `D${i}`, from: 'A', to: 'B', dep: t, arr: formatLondonTime(at(t) + 49 * 60_000) }),
    );
    const r = planJourneys({ direct: direct.reverse(), first: [], second: [] }, opts());
    assert.deepEqual(summary(r.journeys), ['07:02-07:51', '07:12-08:01', '07:32-08:21', '07:42-08:31', '08:02-08:51']);
    assert.ok(r.journeys.every((j) => j.kind === 'direct' && j.changes === 0 && j.connection === null));
    assert.equal(r.journeys[0]!.scheduledDurationMinutes, 49);
  });

  it('connecting journeys through C use the earliest onward train meeting the minimum transfer time', () => {
    const first = [leg({ id: 'F1', from: 'A', to: 'C', dep: '07:48', arr: '08:05' })];
    const second = [
      leg({ id: 'S0', from: 'C', to: 'B', dep: '08:08', arr: '08:31' }), // only 3 min — too tight
      leg({ id: 'S1', from: 'C', to: 'B', dep: '08:14', arr: '08:37' }),
      leg({ id: 'S2', from: 'C', to: 'B', dep: '08:24', arr: '08:47' }),
    ];
    const r = planJourneys({ direct: [], first, second }, opts());
    assert.equal(r.journeys.length, 1);
    const j = r.journeys[0]!;
    assert.equal(j.kind, 'change');
    assert.equal(j.legs[1]!.serviceId, 'S1');
    assert.equal(j.connection!.scheduledMinutes, 9);
    assert.equal(j.connection!.risk, 'ok');
    assert.equal(j.scheduledDurationMinutes, 49);
  });

  it('respects extra walking time on top of the minimum transfer', () => {
    const first = [leg({ id: 'F1', from: 'A', to: 'C', dep: '07:48', arr: '08:05' })];
    const second = [leg({ id: 'S1', from: 'C', to: 'B', dep: '08:12', arr: '08:35' }), leg({ id: 'S2', from: 'C', to: 'B', dep: '08:20', arr: '08:43' })];
    const r = planJourneys({ direct: [], first, second }, opts({ walkingMinutes: 4 }));
    assert.equal(r.journeys[0]!.legs[1]!.serviceId, 'S2', '7 min is less than 5 + 4');
  });

  it('mixes direct and connecting options in one ranked list', () => {
    const direct = [leg({ id: 'D1', from: 'A', to: 'B', dep: '07:42', arr: '08:31' }), leg({ id: 'D2', from: 'A', to: 'B', dep: '08:12', arr: '09:01' })];
    const first = [leg({ id: 'F1', from: 'A', to: 'C', dep: '07:48', arr: '08:05' }), leg({ id: 'F2', from: 'A', to: 'C', dep: '07:33', arr: '07:50' })];
    const second = [leg({ id: 'S1', from: 'C', to: 'B', dep: '07:56', arr: '08:19' }), leg({ id: 'S2', from: 'C', to: 'B', dep: '08:14', arr: '08:37' })];
    const r = planJourneys({ direct, first, second }, opts());
    assert.deepEqual(summary(r.journeys), ['07:33-08:19@07:56', '07:42-08:31', '07:48-08:37@08:14', '08:12-09:01']);
  });

  it('never pairs a train with itself and de-duplicates a direct train that also calls at C', () => {
    const direct = [leg({ id: 'X', from: 'A', to: 'B', dep: '07:42', arr: '08:31' })];
    const first = [leg({ id: 'X', from: 'A', to: 'C', dep: '07:42', arr: '08:02' })];
    const second = [leg({ id: 'X', from: 'C', to: 'B', dep: '08:03', arr: '08:31' }), leg({ id: 'Y', from: 'C', to: 'B', dep: '08:14', arr: '08:37' })];
    const r = planJourneys({ direct, first, second }, opts());
    // X→Y arrives later than staying on X, so it is dominated and removed.
    assert.deepEqual(summary(r.journeys), ['07:42-08:31']);
  });

  it('removes journeys that leave earlier but arrive no sooner (dominated)', () => {
    const first = [leg({ id: 'F1', from: 'A', to: 'C', dep: '07:33', arr: '07:50' }), leg({ id: 'F2', from: 'A', to: 'C', dep: '07:40', arr: '07:57' })];
    const second = [leg({ id: 'S1', from: 'C', to: 'B', dep: '08:04', arr: '08:27' })];
    const r = planJourneys({ direct: [], first, second }, opts());
    assert.deepEqual(summary(r.journeys), ['07:40-08:27@08:04']);
  });

  it('prefers a direct train over a marginally faster connection when asked', () => {
    const direct = [leg({ id: 'D1', from: 'A', to: 'B', dep: '07:42', arr: '08:31' })];
    const first = [leg({ id: 'F1', from: 'A', to: 'C', dep: '07:33', arr: '07:50' })];
    const second = [leg({ id: 'S1', from: 'C', to: 'B', dep: '08:04', arr: '08:27' })];
    const withPref = planJourneys({ direct, first, second }, opts({ preferDirect: true }));
    assert.deepEqual(summary(withPref.journeys), ['07:42-08:31']);
    const without = planJourneys({ direct, first, second }, opts({ preferDirect: false }));
    assert.deepEqual(summary(without.journeys), ['07:33-08:27@08:04', '07:42-08:31']);
  });

  it('maxChanges = 0 returns direct trains only', () => {
    const direct = [leg({ id: 'D1', from: 'A', to: 'B', dep: '07:42', arr: '08:31' })];
    const first = [leg({ id: 'F1', from: 'A', to: 'C', dep: '07:33', arr: '07:50' })];
    const second = [leg({ id: 'S1', from: 'C', to: 'B', dep: '07:56', arr: '08:19' })];
    const r = planJourneys({ direct, first, second }, opts({ maxChanges: 0 }));
    assert.deepEqual(summary(r.journeys), ['07:42-08:31']);
  });

  it('skips connections with an excessive wait', () => {
    const first = [leg({ id: 'F1', from: 'A', to: 'C', dep: '07:00', arr: '07:17' })];
    const second = [leg({ id: 'S1', from: 'C', to: 'B', dep: '09:30', arr: '09:53' })];
    const r = planJourneys({ direct: [], first, second }, opts({ maxConnectionWaitMinutes: 90 }));
    assert.equal(r.journeys.length, 0);
  });
});

describe('planJourneys — live disruption', () => {
  it('lists a cancelled direct train separately, not as a usable option', () => {
    const direct = [
      leg({ id: 'D1', from: 'A', to: 'B', dep: '07:42', arr: '08:31', cancelled: true, source: 'live' }),
      leg({ id: 'D2', from: 'A', to: 'B', dep: '08:12', arr: '09:01', source: 'live' }),
    ];
    const r = planJourneys({ direct, first: [], second: [] }, opts());
    assert.deepEqual(summary(r.journeys), ['08:12-09:01']);
    assert.equal(r.cancelled.length, 1);
    assert.equal(r.cancelled[0]!.status, 'cancelled');
    assert.equal(r.journeys[0]!.status, 'on-time');
  });

  it('a cancelled first leg is never used for a connection', () => {
    const first = [
      leg({ id: 'F1', from: 'A', to: 'C', dep: '07:48', arr: '08:05', cancelled: true, source: 'live' }),
      leg({ id: 'F2', from: 'A', to: 'C', dep: '08:03', arr: '08:20', source: 'live' }),
    ];
    const second = [leg({ id: 'S1', from: 'C', to: 'B', dep: '08:14', arr: '08:37', source: 'live' }), leg({ id: 'S2', from: 'C', to: 'B', dep: '08:28', arr: '08:51', source: 'live' })];
    const r = planJourneys({ direct: [], first, second }, opts());
    assert.deepEqual(summary(r.journeys), ['08:03-08:51@08:28']);
    assert.equal(r.cancelled.length, 1);
    assert.equal(r.cancelled[0]!.legs[0]!.serviceId, 'F1');
  });

  it('flags a delayed first leg that leaves less than the minimum change time as risky, and names the fallback', () => {
    const first = [leg({ id: 'F1', from: 'A', to: 'C', dep: '07:48', arr: '08:05', depEst: '07:53', arrEst: '08:11', source: 'live' })];
    const second = [leg({ id: 'S1', from: 'C', to: 'B', dep: '08:14', arr: '08:37', source: 'live' }), leg({ id: 'S2', from: 'C', to: 'B', dep: '08:24', arr: '08:47', source: 'live' })];
    const r = planJourneys({ direct: [], first, second }, opts());
    const j = r.journeys[0]!;
    assert.equal(j.legs[1]!.serviceId, 'S1');
    assert.equal(j.connection!.risk, 'at-risk');
    assert.equal(j.connection!.expectedMinutes, 3);
    assert.equal(j.status, 'risky');
    assert.match(j.warnings[0]!, /Risky connection: only 3 min/);
    assert.ok(j.warnings.some((w) => /next train from C is at 08:24/.test(w)));
  });

  it('re-plans onto the next train when the delay makes the connection impossible', () => {
    const first = [leg({ id: 'F1', from: 'A', to: 'C', dep: '07:48', arr: '08:05', depEst: '08:00', arrEst: '08:17', source: 'live' })];
    const second = [leg({ id: 'S1', from: 'C', to: 'B', dep: '08:14', arr: '08:37', source: 'live' }), leg({ id: 'S2', from: 'C', to: 'B', dep: '08:24', arr: '08:47', source: 'live' })];
    const r = planJourneys({ direct: [], first, second }, opts());
    const j = r.journeys[0]!;
    assert.equal(j.legs[1]!.serviceId, 'S2');
    assert.equal(j.connection!.expectedMinutes, 7);
    assert.equal(j.status, 'delayed');
    assert.ok(j.warnings.some((w) => /08:14 .* will probably be missed/.test(w)));
  });

  it('a connection survives when the onward train is delayed too', () => {
    const first = [leg({ id: 'F1', from: 'A', to: 'C', dep: '07:48', arr: '08:05', arrEst: '08:13', source: 'live' })];
    const second = [leg({ id: 'S1', from: 'C', to: 'B', dep: '08:14', arr: '08:37', depEst: '08:20', arrEst: '08:43', source: 'live' })];
    const r = planJourneys({ direct: [], first, second }, opts());
    assert.equal(r.journeys[0]!.legs[1]!.serviceId, 'S1');
    assert.equal(r.journeys[0]!.connection!.expectedMinutes, 7);
    // Still above the 5-minute minimum, but delays ate into it: flagged "tight", not risky.
    assert.equal(r.journeys[0]!.connection!.risk, 'tight');
    assert.notEqual(r.journeys[0]!.status, 'risky');
  });

  it('marks the connection uncertain when the first train is "Delayed" without an estimate', () => {
    const first = [leg({ id: 'F1', from: 'A', to: 'C', dep: '07:48', arr: '08:05', depEst: 'delayed', arrEst: 'delayed', source: 'live' })];
    const second = [leg({ id: 'S1', from: 'C', to: 'B', dep: '08:14', arr: '08:37', source: 'live' }), leg({ id: 'S2', from: 'C', to: 'B', dep: '08:24', arr: '08:47', source: 'live' })];
    const r = planJourneys({ direct: [], first, second }, opts());
    assert.equal(r.journeys[0]!.connection!.risk, 'uncertain');
    assert.equal(r.journeys[0]!.status, 'risky');
  });

  it('skips a cancelled onward train and says so', () => {
    const first = leg({ id: 'F1', from: 'A', to: 'C', dep: '07:48', arr: '08:05', source: 'live' });
    const second = [leg({ id: 'S1', from: 'C', to: 'B', dep: '08:14', arr: '08:37', cancelled: true, source: 'live' }), leg({ id: 'S2', from: 'C', to: 'B', dep: '08:24', arr: '08:47', source: 'live' })];
    const choice = chooseConnection(first, second, { minTransferMinutes: 5, walkingMinutes: 0, maxConnectionWaitMinutes: 90 });
    assert.equal(choice!.second.serviceId, 'S2');
    assert.match(choice!.warnings[0]!, /08:14 from C is cancelled/);
  });

  it('a risky journey never hides a safe later one', () => {
    // F2 leaves later and nominally arrives at the same time, but its connection is at risk,
    // so it must not remove the safe F1 option.
    const first = [
      leg({ id: 'F1', from: 'A', to: 'C', dep: '07:48', arr: '08:05', source: 'live' }),
      leg({ id: 'F2', from: 'A', to: 'C', dep: '07:55', arr: '08:07', arrEst: '08:11', depEst: '07:59', source: 'live' }),
    ];
    const second = [leg({ id: 'S1', from: 'C', to: 'B', dep: '08:14', arr: '08:37', source: 'live' })];
    const r = planJourneys({ direct: [], first, second }, opts());
    assert.deepEqual(summary(r.journeys), ['07:48-08:37@08:14', '07:55-08:37@08:14']);
  });

  it('still offers a delayed train whose scheduled time has passed', () => {
    const direct = [leg({ id: 'D1', from: 'A', to: 'B', dep: '06:58', arr: '07:47', depEst: '07:06', arrEst: '07:55', source: 'live' })];
    const r = planJourneys({ direct, first: [], second: [] }, opts({ earliestDeparture: at('07:02') }));
    assert.equal(r.journeys.length, 1);
    assert.equal(r.journeys[0]!.status, 'delayed');
  });
});

describe('planJourneys — fewer results and midnight', () => {
  it('returns what exists and explains the shortfall', () => {
    const direct = [leg({ id: 'D1', from: 'A', to: 'B', dep: '23:12', arr: '00:01', arrDate: '2026-10-23' })];
    const r = planJourneys({ direct, first: [], second: [] }, opts({ earliestDeparture: at('23:00'), latestDeparture: at('01:00', '2026-10-23') }));
    assert.equal(r.journeys.length, 1);
    assert.equal(r.journeys[0]!.scheduledDurationMinutes, 49, 'duration across midnight');
    const text = explainShortfall({
      found: 1, wanted: 5, windowStart: at('23:00'), windowEnd: at('01:00', '2026-10-23'), maxChanges: 1, cancelledCount: 0, liveWindowLimited: false, extraReasons: [],
    });
    assert.match(text!, /^Only 1 journey found departing 23:00–01:00\./);
    assert.match(text!, /late at night/);
  });

  it('connects across midnight', () => {
    const first = [leg({ id: 'F1', from: 'A', to: 'C', dep: '23:40', arr: '23:57' })];
    const second = [leg({ id: 'S1', from: 'C', to: 'B', dep: '00:04', arr: '00:27', date: '2026-10-23' })];
    const r = planJourneys({ direct: [], first, second }, opts({ earliestDeparture: at('23:30'), latestDeparture: at('23:59') }));
    assert.equal(r.journeys.length, 1);
    assert.equal(r.journeys[0]!.connection!.scheduledMinutes, 7);
  });

  it('explains when nothing is found', () => {
    const text = explainShortfall({ found: 0, wanted: 5, windowStart: at('10:00'), windowEnd: at('12:00'), maxChanges: 0, cancelledCount: 2, liveWindowLimited: true, extraReasons: [] });
    assert.match(text!, /^No journeys found departing 10:00–12:00\./);
    assert.match(text!, /2 services are cancelled/);
    assert.match(text!, /max changes = 0/);
    assert.match(text!, /two hours ahead/);
    assert.equal(explainShortfall({ found: 5, wanted: 5, windowStart: 0, windowEnd: 0, maxChanges: 1, cancelledCount: 0, liveWindowLimited: false, extraReasons: [] }), null);
  });
});

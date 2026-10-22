// Network Rail SCHEDULE (CIF JSON) import + scheduled provider, using a small
// hand-written extract (test/fixtures/cif-sample.ndjson — synthetic data in
// the feed's format, not a real timetable).

import assert from 'node:assert/strict';
import { createReadStream } from 'node:fs';
import { before, describe, it } from 'node:test';
import { cifTime, importCifStream } from '../../src/server/timetable/cif-import.ts';
import { applicableSchedule, ScheduleStore, type StoredSchedule } from '../../src/server/timetable/schedule-store.ts';
import { JourneyService } from '../../src/server/journeys.ts';
import { DarwinProvider } from '../../src/server/providers/darwin.ts';
import { formatLondonTime } from '../../src/shared/time.ts';
import type { JourneyQuery } from '../../src/shared/types.ts';
import { at } from '../helpers.ts';

const FIXTURE = new URL('../fixtures/cif-sample.ndjson', import.meta.url);
let store: ScheduleStore;
let schedules: StoredSchedule[];

before(async () => {
  const { file, stats } = await importCifStream(createReadStream(FIXTURE), ['WOK', 'CLJ', 'WAT'], 'test');
  schedules = file.schedules;
  store = new ScheduleStore(file);
  assert.equal(stats.tiplocs, 6);
});

const legsFor = async (from: string, to: string, date: string, start: string, end: string, endDate = date) =>
  (await store.getLegs({ from, to, date, startMs: at(start, date), endMs: at(end, endDate), role: 'direct' })).legs.map(
    (l) => `${l.serviceId.split(':')[1]} ${formatLondonTime(l.dep.scheduled)}-${formatLondonTime(l.arr.scheduled)}`,
  );

describe('CIF import', () => {
  it('keeps passenger schedules calling at two or more chosen stations, plus their STP cancellations', () => {
    const uids = [...new Set(schedules.map((s) => s.uid))].sort();
    assert.deepEqual(uids, ['W10001', 'W10002', 'W10003', 'W10004', 'W10005', 'W10006', 'W10007', 'W10008']);
    assert.ok(!uids.includes('F20001'), 'freight excluded');
    assert.ok(!uids.includes('W10009'), 'only one wanted station');
    assert.equal(schedules.filter((s) => s.stp === 'C').length, 1);
  });

  it('maps multiple TIPLOCs to one station, drops passing points and set-down-only boarding', () => {
    const shuttle = schedules.find((s) => s.uid === 'W10005')!;
    assert.equal(shuttle.calls[0]![0], 'CLJ');
    const fast = schedules.find((s) => s.uid === 'W10006')!;
    assert.deepEqual(fast.calls.map((c) => c[0]), ['WOK', 'WAT'], 'passes CLJ without stopping');
    const setDown = schedules.find((s) => s.uid === 'W10007')!;
    assert.deepEqual(setDown.calls.find((c) => c[0] === 'CLJ'), ['CLJ', 8 * 60 + 25, null, null]);
  });

  it('makes times after midnight monotonic', () => {
    const late = schedules.find((s) => s.uid === 'W10004')!;
    assert.deepEqual(late.calls.map((c) => [c[1], c[2]]), [[null, 23 * 60 + 40], [24 * 60 + 7, 24 * 60 + 8], [24 * 60 + 26, null]]);
  });

  it('treats CIF "0000" public times as not advertised', () => {
    assert.equal(cifTime('0000'), null);
    assert.equal(cifTime('0742'), 462);
    assert.equal(cifTime(null), null);
  });
});

describe('Scheduled timetable queries', () => {
  it('future weekday: permanent schedules', async () => {
    assert.deepEqual(await legsFor('WOK', 'WAT', '2026-10-27', '07:00', '09:00'), ['W10001 07:42-08:31', 'W10006 07:50-08:20', 'W10007 07:55-08:36', 'W10002 08:12-09:01']);
  });

  it('STP overlay replaces the permanent schedule on its date (engineering works)', async () => {
    assert.deepEqual(await legsFor('WOK', 'WAT', '2026-10-29', '07:00', '08:00'), ['W10001 07:45-08:40', 'W10006 07:50-08:20', 'W10007 07:55-08:36']);
  });

  it('STP cancellation removes a train on its date only', async () => {
    assert.ok(!(await legsFor('WOK', 'WAT', '2026-10-30', '08:00', '09:00')).some((l) => l.startsWith('W10002')));
    assert.ok((await legsFor('WOK', 'WAT', '2026-11-02', '08:00', '09:00')).some((l) => l.startsWith('W10002')));
  });

  it('weekend: only weekend schedules run', async () => {
    assert.deepEqual(await legsFor('WOK', 'WAT', '2026-10-24', '06:00', '12:00'), ['W10003 09:12-10:03']);
    assert.deepEqual(await legsFor('WOK', 'WAT', '2026-10-25', '06:00', '12:00'), ['W10003 09:12-10:03'], 'Sunday of the clock change');
  });

  it('bank holiday: "does not run on bank holidays" services are dropped', async () => {
    const legs = await legsFor('WOK', 'WAT', '2026-08-31', '07:00', '09:00');
    assert.ok(legs.some((l) => l.startsWith('W10001')));
    assert.ok(!legs.some((l) => l.startsWith('W10002')));
  });

  it('services that start before midnight are found after midnight, and vice versa', async () => {
    assert.deepEqual(await legsFor('WOK', 'WAT', '2026-10-27', '23:00', '01:00', '2026-10-28'), ['W10004 23:40-00:26']);
    assert.deepEqual(await legsFor('CLJ', 'WAT', '2026-10-28', '00:00', '01:00'), ['W10004 00:08-00:26', 'W10008 00:05-00:15'].sort((a, b) => a.slice(7).localeCompare(b.slice(7))));
  });

  it('only returns trains that call at both stations in order', async () => {
    assert.deepEqual(await legsFor('WAT', 'WOK', '2026-10-27', '00:00', '23:59'), []);
  });

  it('knows which dates and stations it covers', () => {
    assert.ok(store.coversDate('2026-10-27'));
    assert.ok(!store.coversDate('2027-03-01'));
    assert.ok(store.coversStations(['WOK', 'CLJ']));
    assert.ok(!store.coversStations(['WOK', 'BTN']));
  });

  it('STP precedence picks C over O over N over P', () => {
    const base = { uid: 'X', start: '2026-01-01', end: '2026-12-31', days: '1111111', bhx: null, atoc: null, headcode: null, calls: [] };
    const p = { ...base, stp: 'P' as const };
    const o = { ...base, stp: 'O' as const, start: '2026-06-01', end: '2026-06-01' };
    const c = { ...base, stp: 'C' as const, start: '2026-06-02', end: '2026-06-02' };
    assert.equal(applicableSchedule([p, o, c], '2026-06-01'), o);
    assert.equal(applicableSchedule([p, o, c], '2026-06-02'), null);
    assert.equal(applicableSchedule([p, o, c], '2026-06-03'), p);
  });
});

describe('JourneyService with the scheduled timetable', () => {
  const q = (over: Partial<JourneyQuery>): JourneyQuery => ({
    from: 'WOK', to: 'WAT', via: 'CLJ', date: '2026-10-27', time: '07:30', windowMinutes: 120, minTransferMinutes: 5, walkingMinutes: 0,
    maxChanges: 1, preferDirect: false, count: 5, earliest: null, latest: null, ...over,
  });

  it('plans a future weekday with direct and connecting options, labelled as timetable data', async () => {
    const service = new JourneyService({ live: null, scheduled: store, demo: null, now: () => at('20:00', '2026-10-22') });
    const r = await service.find(q({}));
    assert.equal(r.mode, 'scheduled');
    assert.ok(r.journeys.every((j) => j.source === 'scheduled' && j.status === 'unknown'));
    const rows = r.journeys.map((j) => `${j.kind} ${formatLondonTime(j.departure.scheduled)}-${formatLondonTime(j.arrival.scheduled)}`);
    // 07:42 to CLJ (08:12) + 08:14 shuttle arrives 08:24 — but the 07:50 fast direct (08:20) dominates it.
    assert.deepEqual(rows, ['direct 07:50-08:20', 'direct 07:55-08:36', 'direct 08:12-09:01']);
    assert.ok(r.notices.some((n) => /Future date/.test(n)));
    assert.match(r.explanation!, /Only 3 journeys/);
  });

  it('weekend dates return the weekend timetable and explain the shortfall', async () => {
    const service = new JourneyService({ live: null, scheduled: store, demo: null, now: () => at('20:00', '2026-10-22') });
    const r = await service.find(q({ date: '2026-10-24', time: '08:00', windowMinutes: 240 }));
    assert.deepEqual(r.journeys.map((j) => formatLondonTime(j.departure.scheduled)), ['09:12']);
    assert.match(r.explanation!, /^Only 1 journey found departing 08:00–12:00\./);
  });

  it('falls back to the timetable, with a notice, when the live feed is down', async () => {
    const now = at('07:30', '2026-10-27');
    const failing = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    const live = new DarwinProvider({ apiKey: 'k', fetchImpl: failing, now: () => now });
    const service = new JourneyService({ live, scheduled: store, demo: null, now: () => now });
    const r = await service.find(q({}));
    assert.equal(r.mode, 'scheduled');
    assert.ok(r.journeys.length > 0);
    assert.ok(r.notices.some((n) => /Live data unavailable \(Darwin request failed: fetch failed\)/.test(n)));
  });

  it('merges live data (next two hours) with the timetable beyond it', async () => {
    const now = at('07:30', '2026-10-27');
    const board = {
      generatedAt: new Date(now).toISOString(),
      trainServices: [{ std: '07:42', etd: '07:46', serviceID: 'L1', platform: '3', subsequentCallingPoints: [{ callingPoint: [{ crs: 'WAT', st: '08:31', et: '08:35' }] }] }],
    };
    const fetchImpl = (async (u: string) => {
      const url = new URL(u);
      return Response.json(url.pathname.endsWith('/WOK') && url.searchParams.get('filterCrs') === 'WAT' ? board : { generatedAt: board.generatedAt, trainServices: [] });
    }) as unknown as typeof fetch;
    const live = new DarwinProvider({ apiKey: 'k', fetchImpl, now: () => now });
    const service = new JourneyService({ live, scheduled: store, demo: null, now: () => now });
    const r = await service.find(q({ windowMinutes: 90, time: '07:30', via: null, maxChanges: 0 }));
    // Only the 07:42 is live; the timetable's 07:42 for the same slot is not duplicated.
    // Within the live window the board is authoritative, so timetable trains inside it are not added.
    assert.equal(r.mode, 'live');
    assert.deepEqual(r.journeys.map((j) => `${formatLondonTime(j.departure.scheduled)}:${j.source}`), ['07:42:live']);

    const later = await service.find(q({ date: '2026-10-27', time: '09:00', windowMinutes: 240, via: null, maxChanges: 0 }));
    assert.equal(later.mode, 'mixed');
  });
});

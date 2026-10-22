// Integration tests for the Darwin (LDBWS via Rail Data Marketplace) adapter
// and the journey service on top of it. The fixtures in test/fixtures are
// hand-written in the LDBWS GetDepBoardWithDetails JSON shape — synthetic
// test data, not recorded real services.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { boardToLegs, DarwinProvider, parseEstimate } from '../../src/server/providers/darwin.ts';
import { JourneyService } from '../../src/server/journeys.ts';
import { ProviderError } from '../../src/server/providers/types.ts';
import { formatLondonTime } from '../../src/shared/time.ts';
import { at } from '../helpers.ts';

const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'));
const BOARDS: Record<string, string> = { 'WOK>WAT': 'darwin-wok-to-wat.json', 'WOK>CLJ': 'darwin-wok-to-clj.json', 'CLJ>WAT': 'darwin-clj-to-wat.json' };

interface Call { url: URL; headers: Record<string, string> }

function stubFetch(handler?: (url: URL) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    if (handler) return handler(url);
    const crs = url.pathname.split('/').pop()!;
    const name = BOARDS[`${crs}>${url.searchParams.get('filterCrs')}`];
    return name ? Response.json(fixture(name)) : Response.json({ trainServices: [] });
  }) as typeof fetch;
  return { impl, calls };
}

const NOW = at('07:40');

describe('Darwin board parsing', () => {
  it('maps services to legs with live times, platforms, delays and cancellations', () => {
    const { legs, messages } = boardToLegs(fixture('darwin-wok-to-wat.json'), 'WOK', 'WAT', NOW);
    assert.equal(legs.length, 4);
    const [onTime, delayed, cancelled, unknown] = legs as [typeof legs[0], typeof legs[0], typeof legs[0], typeof legs[0]];

    assert.equal(onTime.serviceId, 'darwin:SVC1');
    assert.equal(formatLondonTime(onTime.dep.scheduled), '07:42');
    assert.equal(onTime.dep.estimated, onTime.dep.scheduled);
    assert.equal(formatLondonTime(onTime.arr.scheduled), '08:31');
    assert.equal(onTime.platform, '3');
    assert.equal(onTime.headsign, 'London Waterloo');
    assert.equal(onTime.source, 'live');

    assert.equal(formatLondonTime(delayed.dep.estimated!), '08:04');
    assert.equal(formatLondonTime(delayed.arr.estimated!), '08:48');
    assert.match(delayed.delayReason!, /signalling/);

    assert.equal(cancelled.cancelled, true);
    assert.match(cancelled.cancelReason!, /train crew/);

    assert.equal(unknown.dep.delayedUnknown, true);
    assert.equal(unknown.dep.estimated, null);

    assert.deepEqual(messages, ['Disruption between Surbiton and London Waterloo.']);
  });

  it('resolves times across midnight', () => {
    const { legs } = boardToLegs(fixture('darwin-midnight.json'), 'WAT', 'WOK', at('23:50'));
    assert.equal(legs.length, 2);
    const late = legs[0]!;
    assert.equal(new Date(late.dep.scheduled).toISOString(), '2026-10-22T22:55:00.000Z');
    assert.equal(new Date(late.dep.estimated!).toISOString(), '2026-10-22T23:02:00.000Z', 'estimate 00:02 is the next day');
    assert.equal(new Date(late.arr.scheduled).toISOString(), '2026-10-22T23:28:00.000Z');
    assert.equal(new Date(late.arr.estimated!).toISOString(), '2026-10-22T23:35:00.000Z');
    assert.equal(new Date(legs[1]!.dep.scheduled).toISOString(), '2026-10-22T23:15:00.000Z');
  });

  it('parses estimate strings', () => {
    const s = at('08:00');
    assert.equal(parseEstimate(s, 'On time', null).estimated, s);
    assert.equal(parseEstimate(s, 'Cancelled', null).cancelled, true);
    assert.equal(parseEstimate(s, 'Delayed', null).delayedUnknown, true);
    assert.equal(parseEstimate(s, 'No report', null).estimated, null);
    assert.equal(parseEstimate(s, null, '08:03').actual, true);
  });

  it('ignores services that do not reach the destination', () => {
    const { legs } = boardToLegs(fixture('darwin-wok-to-clj.json'), 'WOK', 'XXX', NOW);
    assert.equal(legs.length, 0);
  });
});

describe('DarwinProvider', () => {
  const req = { from: 'WOK', to: 'WAT', date: '2026-10-22', startMs: NOW, endMs: NOW + 120 * 60_000, role: 'direct' as const };

  it('calls GetDepBoardWithDetails with the key in a header (never in the URL) and caches the board', async () => {
    const { impl, calls } = stubFetch();
    const p = new DarwinProvider({ apiKey: 'secret-key', fetchImpl: impl, now: () => NOW });
    const r1 = await p.getLegs(req);
    assert.equal(calls.length, 1);
    const { url, headers } = calls[0]!;
    assert.match(url.pathname, /\/LDBWS\/api\/20220120\/GetDepBoardWithDetails\/WOK$/);
    assert.equal(url.searchParams.get('filterCrs'), 'WAT');
    assert.equal(url.searchParams.get('filterType'), 'to');
    assert.equal(url.searchParams.get('numRows'), '9');
    assert.equal(url.searchParams.get('timeOffset'), '0');
    assert.equal(url.searchParams.get('timeWindow'), '120');
    assert.ok(!url.toString().includes('secret-key'));
    assert.equal(headers['x-apikey'], 'secret-key');
    assert.equal(r1.legs.length, 4);
    assert.equal(r1.source.kind, 'live');
    assert.equal(r1.source.fromCache, false);

    const r2 = await p.getLegs(req);
    assert.equal(calls.length, 1, 'second call served from cache');
    assert.equal(r2.source.fromCache, true);
  });

  it('uses a time offset for searches later today and clamps to the live horizon', async () => {
    const { impl, calls } = stubFetch();
    const p = new DarwinProvider({ apiKey: 'k', fetchImpl: impl, now: () => NOW });
    const r = await p.getLegs({ ...req, startMs: NOW + 60 * 60_000, endMs: NOW + 240 * 60_000 });
    assert.equal(calls[0]!.url.searchParams.get('timeOffset'), '60');
    assert.equal(calls[0]!.url.searchParams.get('timeWindow'), '60');
    assert.equal(r.coveredUntil, NOW + 119 * 60_000);
  });

  it('pages when a board is full (9 rows)', async () => {
    const svc = (i: number) => ({
      std: formatLondonTime(NOW + (i + 1) * 5 * 60_000), etd: 'On time', serviceID: `P${i}`,
      subsequentCallingPoints: [{ callingPoint: [{ crs: 'WAT', st: formatLondonTime(NOW + (i + 1) * 5 * 60_000 + 40 * 60_000), et: 'On time' }] }],
    });
    const { impl, calls } = stubFetch((url) => {
      const offset = Number(url.searchParams.get('timeOffset'));
      const start = offset === 0 ? 0 : 9;
      const count = offset === 0 ? 9 : 3;
      return Response.json({ generatedAt: new Date(NOW).toISOString(), trainServices: Array.from({ length: count }, (_, i) => svc(start + i)) });
    });
    const p = new DarwinProvider({ apiKey: 'k', fetchImpl: impl, now: () => NOW });
    const r = await p.getLegs(req);
    assert.equal(calls.length, 2);
    assert.equal(calls[1]!.url.searchParams.get('timeOffset'), '46');
    assert.equal(r.legs.length, 12);
  });

  it('reports rate limiting with Retry-After', async () => {
    const { impl } = stubFetch(() => new Response('slow down', { status: 429, headers: { 'retry-after': '42' } }));
    const p = new DarwinProvider({ apiKey: 'k', fetchImpl: impl, now: () => NOW });
    await assert.rejects(p.getLegs(req), (e: unknown) => e instanceof ProviderError && e.code === 'rate-limited' && e.retryAfterSeconds === 42);
  });

  it('reports a rejected key as an auth error', async () => {
    const { impl } = stubFetch(() => new Response('no', { status: 401 }));
    const p = new DarwinProvider({ apiKey: 'bad', fetchImpl: impl, now: () => NOW });
    await assert.rejects(p.getLegs(req), (e: unknown) => e instanceof ProviderError && e.code === 'auth');
  });

  it('falls back to the last good board, flagged stale, when the network fails', async () => {
    let now = NOW;
    let fail = false;
    const { impl } = stubFetch((url) => {
      if (fail) throw new TypeError('fetch failed');
      return Response.json(fixture(BOARDS[`WOK>${url.searchParams.get('filterCrs')}`]!));
    });
    const p = new DarwinProvider({ apiKey: 'k', fetchImpl: impl, now: () => now });
    await p.getLegs(req);
    fail = true;
    now += 60_000; // cache no longer fresh
    const r = await p.getLegs(req);
    assert.equal(r.source.stale, true);
    assert.equal(r.legs.length, 4);
    assert.match(r.source.note!, /last live data/);
  });

  it('raises an upstream error on network failure with nothing cached', async () => {
    const { impl } = stubFetch(() => {
      throw new TypeError('fetch failed');
    });
    const p = new DarwinProvider({ apiKey: 'k', fetchImpl: impl, now: () => NOW });
    await assert.rejects(p.getLegs(req), (e: unknown) => e instanceof ProviderError && e.code === 'upstream');
  });
});

describe('JourneyService with live Darwin data', () => {
  const query = {
    from: 'WOK', to: 'WAT', via: 'CLJ', date: '2026-10-22', time: '07:40', windowMinutes: 120, minTransferMinutes: 5, walkingMinutes: 0,
    maxChanges: 1 as const, preferDirect: true, count: 5, earliest: null, latest: null,
  };

  it('combines direct and connecting live journeys, flags risk and lists cancellations', async () => {
    const { impl, calls } = stubFetch();
    const live = new DarwinProvider({ apiKey: 'k', fetchImpl: impl, now: () => NOW });
    const service = new JourneyService({ live, scheduled: null, demo: null, now: () => NOW });
    const r = await service.find(query);
    assert.equal(calls.length, 3, 'three boards, fetched in parallel');
    assert.equal(r.mode, 'live');

    const rows = r.journeys.map((j) => `${j.kind}:${formatLondonTime(j.departure.scheduled)}>${j.legs.map((l) => l.serviceId.replace('darwin:', '')).join('+')}:${j.status}`);
    assert.deepEqual(rows, [
      'direct:07:42>SVC1:on-time',
      // SVC5 is 7 min late into Clapham (08:12); its planned connection (SVC1, 08:13) is still physically possible but only 1 min → risky.
      'change:07:48>SVC5+SVC1:risky',
      'direct:07:57>SVC2:delayed',
      'direct:08:27>SVC4:delayed',
    ]);
    const risky = r.journeys[1]!;
    assert.equal(risky.connection!.expectedMinutes, 1);
    assert.match(risky.warnings[0]!, /Risky connection: only 1 min to change at Clapham Junction \(you need 5\)/);
    assert.ok(risky.warnings.some((w) => /next train from Clapham Junction is at 08:20/.test(w)));
    assert.match(r.journeys[3]!.warnings[0]!, /delayed \(no estimate yet\)/);

    assert.deepEqual(r.cancelled.map((j) => j.legs[0]!.serviceId), ['darwin:SVC8', 'darwin:SVC3']);
    assert.ok(r.notices.includes('Disruption between Surbiton and London Waterloo.'));
    assert.match(r.explanation!, /Only 4 journeys/);
    assert.match(r.explanation!, /2 services are cancelled/);
  });

  it('without the direct preference, shows a connection that beats a delayed direct train', async () => {
    const { impl } = stubFetch();
    const live = new DarwinProvider({ apiKey: 'k', fetchImpl: impl, now: () => NOW });
    const service = new JourneyService({ live, scheduled: null, demo: null, now: () => NOW });
    const r = await service.find({ ...query, preferDirect: false });
    const swap = r.journeys.find((j) => j.legs.map((l) => l.serviceId).join('+') === 'darwin:SVC2+darwin:SVC9')!;
    assert.equal(formatLondonTime(swap.arrival.scheduled), '08:44', 'vs 08:48 expected on the delayed direct train');
    assert.equal(swap.connection!.risk, 'tight');
  });

  it('cannot plan a future date with only live data, and says why', async () => {
    const { impl } = stubFetch();
    const live = new DarwinProvider({ apiKey: 'k', fetchImpl: impl, now: () => NOW });
    const service = new JourneyService({ live, scheduled: null, demo: null, now: () => NOW });
    await assert.rejects(service.find({ ...query, date: '2026-10-29', time: '07:30' }), (e: unknown) => e instanceof ProviderError && e.code === 'no-data' && /two hours/.test(e.message));
  });
});

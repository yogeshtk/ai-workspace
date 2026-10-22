import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decideOnFailure, describeFreshness, pruneDeparted } from '../../src/shared/display.ts';
import { planJourneys } from '../../src/shared/planner.ts';
import type { JourneyResponse } from '../../src/shared/types.ts';
import { at, leg, opts } from '../helpers.ts';

function response(mode: JourneyResponse['mode'], stale = false): JourneyResponse {
  const direct = ['07:12', '07:42', '08:12'].map((t, i) => leg({ id: `D${i}`, from: 'A', to: 'B', dep: t, arr: ['08:01', '08:31', '09:01'][i]!, source: mode === 'live' ? 'live' : 'scheduled' }));
  const r = planJourneys({ direct, first: [], second: [] }, opts({ preferDirect: false }));
  return {
    query: { from: 'A', to: 'B', via: null, date: '2026-10-22', time: '07:00', windowMinutes: 120, minTransferMinutes: 5, walkingMinutes: 0, maxChanges: 1, preferDirect: true, count: 5, earliest: null, latest: null },
    generatedAt: at('07:00'),
    mode,
    journeys: r.journeys,
    cancelled: [],
    explanation: null,
    sources: [{ provider: 'p', kind: mode === 'live' ? 'live' : 'scheduled', fetchedAt: at('06:58'), fromCache: false, stale, note: null }],
    notices: [],
    windowEnd: at('09:00'),
  };
}

describe('cached results', () => {
  it('drops trains that have already left', () => {
    const pruned = pruneDeparted(response('live'), at('07:30'));
    assert.equal(pruned.journeys.length, 2);
  });

  it('labels device-cached results as cached with their age', () => {
    const f = describeFreshness(response('live'), at('07:10'), { fromDeviceCache: true, savedAt: at('07:01') });
    assert.equal(f.kind, 'cached');
    assert.match(f.text, /9 min ago/);
  });

  it('labels live, scheduled, demo and stale data distinctly', () => {
    assert.equal(describeFreshness(response('live'), at('07:01'), { fromDeviceCache: false, savedAt: null }).kind, 'live');
    assert.equal(describeFreshness(response('scheduled'), at('07:01'), { fromDeviceCache: false, savedAt: null }).kind, 'scheduled');
    assert.equal(describeFreshness(response('demo'), at('07:01'), { fromDeviceCache: false, savedAt: null }).badge, 'Demo');
    assert.equal(describeFreshness(response('live', true), at('07:01'), { fromDeviceCache: false, savedAt: null }).kind, 'stale');
  });
});

describe('refresh failures', () => {
  it('falls back to cached results on network failure, saying how old they are', () => {
    const d = decideOnFailure({ status: null, message: 'Network error.' }, { savedAt: at('07:00') }, at('07:12'));
    assert.equal(d.showCached, true);
    assert.match(d.message, /^No connection\. Showing cached results from 07:00 \(12 min old\)/);
  });

  it('reports the error when nothing is cached', () => {
    const d = decideOnFailure({ status: 502, message: 'Darwin request timed out.' }, null, at('07:12'));
    assert.equal(d.showCached, false);
    assert.equal(d.message, 'Darwin request timed out.');
  });

  it('pauses on rate limiting', () => {
    const d = decideOnFailure({ status: 429, message: 'x', retryAfterSeconds: 30 }, null, at('07:12'));
    assert.equal(d.retryAfterSeconds, 30);
    assert.match(d.message, /Too many requests/);
  });
});

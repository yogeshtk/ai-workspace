// HTTP-level tests: provider configuration (missing credentials → demo),
// the journeys API in demo mode, error handling and auth.

import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer, get, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { createApp } from '../../src/server/app.ts';
import { buildProviders, readConfig } from '../../src/server/config.ts';
import { JourneyService } from '../../src/server/journeys.ts';
import { DemoProvider } from '../../src/server/providers/demo.ts';
import { formatLondonTime } from '../../src/shared/time.ts';
import type { JourneyResponse, ProviderStatus } from '../../src/shared/types.ts';
import { at } from '../helpers.ts';

async function serve(handler: ReturnType<typeof createApp>): Promise<{ server: Server; base: string }> {
  const server = createServer((req, res) => void handler(req, res));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return { server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

const NOW = at('07:40'); // Thursday 22 Oct 2026
const publicDir = mkdtempSync(join(tmpdir(), 'rd-public-'));
writeFileSync(join(publicDir, 'index.html'), '<!doctype html><title>Next Train</title>');

describe('configuration without credentials', () => {
  it('falls back to clearly-labelled demo mode and lists what is missing', () => {
    const cfg = readConfig({ TIMETABLE_FILE: join(publicDir, 'missing.json') });
    const { set, status } = buildProviders(cfg);
    assert.equal(status.mode, 'demo');
    assert.equal(status.demo, true);
    assert.equal(set.live, null);
    assert.equal(set.scheduled, null);
    assert.ok(set.demo);
    assert.match(status.live.missing[0]!, /DARWIN_API_KEY/);
    assert.match(status.scheduled.missing[0]!, /timetable:import/);
    assert.match(status.messages[0]!, /not real trains/);
  });

  it('uses live mode when a Darwin key is present (timetable optional)', () => {
    const { status, set } = buildProviders(readConfig({ DARWIN_API_KEY: 'abc', TIMETABLE_FILE: join(publicDir, 'missing.json') }));
    assert.equal(status.mode, 'live');
    assert.ok(set.live);
    assert.equal(set.demo, null);
    assert.ok(!JSON.stringify(status).includes('abc'), 'the key never appears in the status payload');
  });

  it('DEMO_MODE=true forces demo even with credentials', () => {
    const { status } = buildProviders(readConfig({ DARWIN_API_KEY: 'abc', DEMO_MODE: 'true' }));
    assert.equal(status.mode, 'demo');
  });
});

describe('HTTP API (demo provider)', () => {
  let server: Server;
  let base: string;
  const status: ProviderStatus = buildProviders(readConfig({ TIMETABLE_FILE: join(publicDir, 'missing.json') })).status;

  before(async () => {
    const journeys = new JourneyService({ live: null, scheduled: null, demo: new DemoProvider({ now: () => NOW }), now: () => NOW });
    ({ server, base } = await serve(createApp({ journeys, status, publicDir, basicAuth: null })));
  });
  after(() => server.close());

  const getJson = async (path: string) => {
    const res = await fetch(base + path);
    return { res, body: (await res.json()) as JourneyResponse & { error?: string; code?: string } };
  };
  const journeysPath = (extra = '') => `/api/journeys?from=WOK&to=WAT&via=CLJ&date=2026-10-22&time=07:40&window=120&mt=5&walk=0&changes=1&direct=1&count=5${extra}`;

  it('returns five demo journeys, direct and via the transfer station, all labelled demo', async () => {
    const { res, body } = await getJson(journeysPath());
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(body.mode, 'demo');
    assert.equal(body.journeys.length, 5);
    assert.ok(body.journeys.every((j) => j.source === 'demo'));
    assert.ok(body.journeys.some((j) => j.kind === 'direct'));
    assert.ok(body.journeys.some((j) => j.kind === 'change' && j.connection?.station.crs === 'CLJ'));
    assert.match(body.notices[0]!, /^DEMO MODE/);
    const first = body.journeys[0]!;
    assert.ok(first.departure.scheduled >= NOW);
    const times = body.journeys.map((j) => j.departure.scheduled);
    assert.deepEqual(times, [...times].sort((a, b) => a - b), 'ranked by departure');
  });

  it('plans future weekday and weekend dates (demo timetable)', async () => {
    const weekday = await getJson('/api/journeys?from=WOK&to=WAT&via=CLJ&date=2026-11-03&time=07:00');
    assert.equal(weekday.body.journeys.length, 5);
    assert.ok(weekday.body.notices.some((n) => /Future date/.test(n)));
    const sunday = await getJson('/api/journeys?from=WOK&to=WAT&via=CLJ&date=2026-11-01&time=07:00');
    assert.equal(formatLondonTime(sunday.body.journeys[0]!.departure.scheduled), '08:12', 'Sunday service starts later');
  });

  it('explains when no trains run (Christmas Day)', async () => {
    const { body } = await getJson('/api/journeys?from=WOK&to=WAT&via=CLJ&date=2026-12-25&time=08:00');
    assert.equal(body.journeys.length, 0);
    assert.match(body.explanation!, /No journeys found/);
    assert.ok(body.notices.some((n) => /25 and 26 December/.test(n)));
  });

  it('shows fewer than five late at night and explains why', async () => {
    const { body } = await getJson('/api/journeys?from=WOK&to=WAT&via=CLJ&date=2026-10-22&time=22:50&window=120');
    assert.ok(body.journeys.length > 0 && body.journeys.length < 5);
    assert.match(body.explanation!, /late at night/);
  });

  it('rejects bad input with a 400 and a readable message', async () => {
    const { res, body } = await getJson('/api/journeys?from=WOK&to=WOK&date=2026-10-22&time=07:00');
    assert.equal(res.status, 400);
    assert.equal(body.code, 'bad-request');
    assert.match(body.error!, /must be different/);
  });

  it('searches stations by name or code', async () => {
    const res = await fetch(`${base}/api/stations?q=clapham`);
    const body = (await res.json()) as { stations: { crs: string; name: string }[] };
    assert.ok(body.stations.some((s) => s.crs === 'CLJ' && s.name === 'Clapham Junction'));
    const byCode = (await (await fetch(`${base}/api/stations?q=wat`)).json()) as { stations: { crs: string }[] };
    assert.equal(byCode.stations[0]!.crs, 'WAT');
  });

  it('serves the app shell with security headers', async () => {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-security-policy')!, /default-src 'self'/);
    assert.match(await res.text(), /Next Train/);
    // Encoded traversal must not escape the public directory.
    const traversal = await new Promise<number>((resolve) => get(`${base}/..%2f..%2f..%2fetc%2fpasswd`, (r) => resolve(r.statusCode!)));
    assert.equal(traversal, 403);
  });

  it('exposes status without secrets', async () => {
    const res = await fetch(`${base}/api/status`);
    const body = (await res.json()) as ProviderStatus;
    assert.equal(body.mode, 'demo');
  });
});

describe('HTTP API errors and auth', () => {
  it('maps "no data" provider errors to 422 with an explanation', async () => {
    const journeys = new JourneyService({ live: null, scheduled: null, demo: null, now: () => NOW });
    const { server, base } = await serve(createApp({ journeys, status: {} as ProviderStatus, publicDir, basicAuth: null }));
    try {
      const res = await fetch(`${base}/api/journeys?from=WOK&to=WAT&date=2026-10-22&time=07:00`);
      assert.equal(res.status, 422);
      const body = (await res.json()) as { code: string; error: string };
      assert.equal(body.code, 'no-data');
    } finally {
      server.close();
    }
  });

  it('enforces optional basic auth (health check stays open)', async () => {
    const journeys = new JourneyService({ live: null, scheduled: null, demo: new DemoProvider(), now: () => NOW });
    const { server, base } = await serve(createApp({ journeys, status: {} as ProviderStatus, publicDir, basicAuth: { user: 'me', pass: 's3cret' } }));
    try {
      assert.equal((await fetch(`${base}/api/status`)).status, 401);
      assert.equal((await fetch(`${base}/api/health`)).status, 200);
      const ok = await fetch(`${base}/api/status`, { headers: { authorization: `Basic ${Buffer.from('me:s3cret').toString('base64')}` } });
      assert.equal(ok.status, 200);
    } finally {
      server.close();
    }
  });

  it('rate-limits abusive clients', async () => {
    const journeys = new JourneyService({ live: null, scheduled: null, demo: new DemoProvider(), now: () => NOW });
    const { server, base } = await serve(createApp({ journeys, status: {} as ProviderStatus, publicDir, basicAuth: null, rateLimitPerMinute: 3 }));
    try {
      const codes: number[] = [];
      for (let i = 0; i < 5; i++) codes.push((await fetch(`${base}/api/status`)).status);
      assert.deepEqual(codes, [200, 200, 200, 429, 429]);
    } finally {
      server.close();
    }
  });
});

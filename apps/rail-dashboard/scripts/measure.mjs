// Measures time-to-useful-results in a real (headless) Chromium on an
// emulated phone with a throttled "slow 4G" network (150 ms RTT, 1.6 Mbps
// down, 750 kbps up — the Lighthouse mobile profile).
//
//   npm run build && npm run measure
//   npm run measure -- --upstream-latency 1500 --runs 7
//
// The server runs in DEMO mode; --upstream-latency adds an artificial delay to
// every provider call to approximate a real Darwin round-trip. The server's
// short response cache is disabled so every run pays the full latency. Real Darwin
// latency can only be measured with credentials (use --base-url against your
// own running server instead).
//
// Requires a Chromium for playwright-core (set CHROMIUM_PATH, or run
// `npx playwright install chromium` once).

import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { chromium, devices } from 'playwright-core';

const { values } = parseArgs({
  options: {
    runs: { type: 'string', default: '5' },
    'upstream-latency': { type: 'string', default: '0' },
    'base-url': { type: 'string' },
    port: { type: 'string', default: '8791' },
    'no-throttle': { type: 'boolean', default: false },
  },
});
const runs = Number(values.runs);
const latency = Number(values['upstream-latency']);

let serverProc = null;
let base = values['base-url'];
if (!base) {
  base = `http://127.0.0.1:${values.port}`;
  serverProc = spawn(process.execPath, ['src/server/main.ts'], {
    env: { ...process.env, PORT: values.port, HOST: '127.0.0.1', DEMO_MODE: 'true', DEMO_LATENCY_MS: String(latency), RESPONSE_CACHE_MS: '0' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise((resolve, reject) => {
    serverProc.stdout.on('data', (d) => String(d).includes('Rail dashboard on') && resolve());
    serverProc.on('exit', (c) => reject(new Error(`server exited ${c}`)));
  });
}

const SETTINGS = {
  home: { crs: 'WOK', name: 'Woking' },
  work: { crs: 'WAT', name: 'London Waterloo' },
  transfer: { crs: 'CLJ', name: 'Clapham Junction' },
};

const launchOpts = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};
const browser = await chromium.launch(launchOpts);

async function newPage(ctx) {
  const page = await ctx.newPage();
  if (!values['no-throttle']) {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  }
  return page;
}

const waitFresh = (page) => page.waitForFunction(() => window.__rd && window.__rd.firstFreshResultsMs !== null, null, { timeout: 30_000 });

const results = { cold: [], coldFresh: [], warm: [], warmFresh: [], tap: [] };
for (let i = 0; i < runs; i++) {
  const ctx = await browser.newContext({ ...devices['Pixel 7'], timezoneId: 'Europe/London', serviceWorkers: 'allow' });
  await ctx.addInitScript((s) => {
    if (!localStorage.getItem('rd:settings:v1')) localStorage.setItem('rd:settings:v1', JSON.stringify(s));
  }, SETTINGS);

  // 1. Cold start: empty HTTP cache, no service worker, no cached results.
  let page = await newPage(ctx);
  await page.goto(base, { waitUntil: 'commit' });
  await waitFresh(page);
  const cold = await page.evaluate(() => window.__rd);
  results.cold.push(cold.firstResultsMs);
  results.coldFresh.push(cold.firstFreshResultsMs);
  // let the service worker install
  await page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller !== null, null, { timeout: 10_000 }).catch(() => page.reload().then(() => page.waitForTimeout(500)));
  await page.close();

  // 2. Warm start: app shell from the service worker, last results from localStorage.
  page = await newPage(ctx);
  await page.goto(base, { waitUntil: 'commit' });
  await waitFresh(page);
  const warm = await page.evaluate(() => window.__rd);
  results.warm.push(warm.firstResultsMs);
  results.warmFresh.push(warm.firstFreshResultsMs);

  // 3. Tap GO HOME (not cached yet) → time until fresh results are painted.
  const tap = await page.evaluate(async () => {
    const before = window.__rd.lastFreshMs;
    const t0 = performance.now();
    document.getElementById('go-home').click();
    while (window.__rd.lastFreshMs === before) await new Promise((r) => setTimeout(r, 10));
    return window.__rd.lastFreshMs - t0;
  });
  results.tap.push(tap);
  await ctx.close();
}
await browser.close();
serverProc?.kill();

const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const fmt = (a) => `median ${(median(a) / 1000).toFixed(2)} s · max ${(Math.max(...a) / 1000).toFixed(2)} s`;
console.log(`\nTime to useful results — ${runs} runs, Pixel 7 emulation, ${values['no-throttle'] ? 'no throttling' : 'slow-4G network + 4x CPU slowdown'}, upstream latency ${latency} ms (${values['base-url'] ? 'external server' : 'demo server'})`);
console.log(`  Cold start  → first journey cards       ${fmt(results.cold)}`);
console.log(`  Cold start  → fresh results              ${fmt(results.coldFresh)}`);
console.log(`  Warm start  → first cards (device cache) ${fmt(results.warm)}`);
console.log(`  Warm start  → fresh results              ${fmt(results.warmFresh)}`);
console.log(`  Tap GO HOME → fresh results              ${fmt(results.tap)}`);
const worst = Math.max(median(results.coldFresh), median(results.warmFresh), median(results.tap));
console.log(`\n  Under-5-second target (median, fresh results): ${worst < 5000 ? 'MET' : 'NOT MET'} in this configuration.`);

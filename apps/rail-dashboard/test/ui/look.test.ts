// UI tests in a real (headless) Chromium against the built app (dist/public)
// and an in-process demo server. Run with `npm run test:ui` (builds first).
//
// The browser clock and the server clock are both pinned to Thu 22 Oct 2026
// 07:20 London time, with the demo "disrupted" scenario, so the same trains,
// delays and risky connections appear on every run.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { gzipSync } from 'node:zlib';
import { chromium, devices, type Browser, type Page } from 'playwright-core';
import { createApp } from '../../src/server/app.ts';
import { JourneyService } from '../../src/server/journeys.ts';
import { DemoProvider } from '../../src/server/providers/demo.ts';
import type { ProviderStatus } from '../../src/shared/types.ts';

const NOW = Date.parse('2026-10-22T07:20:00+01:00');
const PUBLIC_DIR = resolve('dist/public');
const SETTINGS = {
  home: { crs: 'WOK', name: 'Woking' },
  work: { crs: 'WAT', name: 'London Waterloo' },
  transfer: { crs: 'CLJ', name: 'Clapham Junction' },
};
const STATUS: ProviderStatus = {
  mode: 'demo',
  live: { name: 'Darwin', configured: false, missing: [] },
  scheduled: { name: 'Network Rail', configured: false, missing: [], detail: null },
  demo: true,
  messages: [],
};

// MUI default theme values (https://mui.com/material-ui/customization/default-theme/).
const MUI = {
  primary: 'rgb(25, 118, 210)', // #1976d2
  secondary: 'rgb(156, 39, 176)', // #9c27b0
  darkBackground: 'rgb(18, 18, 18)', // #121212
  errorSoftBg: 'rgb(253, 237, 237)', // standard Alert, severity error
  errorSoftText: 'rgb(95, 33, 32)',
  warningSoftBg: 'rgb(255, 244, 229)', // standard Alert, severity warning
  warningSoftText: 'rgb(102, 60, 0)',
};

let server: Server;
let base: string;
let browser: Browser;

before(async () => {
  const journeys = new JourneyService(
    { live: null, scheduled: null, demo: new DemoProvider({ scenario: 'disrupted', now: () => NOW }), now: () => NOW },
    { cacheMs: 0 },
  );
  const handler = createApp({ journeys, status: STATUS, publicDir: PUBLIC_DIR, basicAuth: null, rateLimitPerMinute: 10_000 });
  server = createServer((req, res) => void handler(req, res));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
});

after(async () => {
  await browser?.close();
  server?.close();
});

interface Opened {
  page: Page;
  requests: string[];
  errors: string[];
  close: () => Promise<void>;
}

async function open(opts: { viewport?: { width: number; height: number }; colorScheme?: 'light' | 'dark' } = {}): Promise<Opened> {
  const ctx = await browser.newContext({
    ...devices['Pixel 7'],
    ...(opts.viewport ? { viewport: opts.viewport } : {}),
    colorScheme: opts.colorScheme ?? 'light',
    timezoneId: 'Europe/London',
    locale: 'en-GB',
    serviceWorkers: 'block',
  });
  await ctx.addInitScript((s) => localStorage.setItem('rd:settings:v1', JSON.stringify(s)), SETTINGS);
  const page = await ctx.newPage();
  const requests: string[] = [];
  const errors: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.clock.install({ time: NOW });
  await page.goto(base);
  await page.waitForSelector('article.card');
  await page.evaluate(() => document.fonts.ready);
  return { page, requests, errors, close: () => ctx.close() };
}

const style = (page: Page, selector: string, prop: string) =>
  page.$eval(selector, (el, p) => getComputedStyle(el).getPropertyValue(p), prop);

function luminance(rgb: string): number {
  const [r, g, b] = (rgb.match(/[\d.]+/g) ?? []).slice(0, 3).map((v) => {
    const c = Number(v) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

/** Text colour and the first opaque background behind an element. */
const colours = (page: Page, selector: string) =>
  page.$eval(selector, (el) => {
    let bg = 'rgb(255, 255, 255)';
    for (let n: Element | null = el; n; n = n.parentElement) {
      const c = getComputedStyle(n).backgroundColor;
      if (c && c !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(c)) {
        bg = c;
        break;
      }
    }
    return { fg: getComputedStyle(el).color, bg };
  });

// ---------------------------------------------------------------------------
// MUI look — these FAIL until the restyle is done.
// ---------------------------------------------------------------------------
describe('MUI look', () => {
  it('uses the Roboto font, served from our own origin', async () => {
    const { page, requests, close } = await open();
    try {
      assert.match(await style(page, 'body', 'font-family'), /^"?Roboto"?/);
      assert.ok(await page.evaluate(() => document.fonts.check('500 16px Roboto')), 'Roboto 500 is loaded');
      assert.ok(requests.some((u) => u.startsWith(base) && /\/fonts\/.*\.woff2$/.test(u)), 'font file requested from our server');
      assert.deepEqual(requests.filter((u) => !u.startsWith(base) && !u.startsWith('data:')), [], 'no third-party requests');
    } finally {
      await close();
    }
  });

  it('header is an MUI primary app bar with elevation', async () => {
    const { page, close } = await open();
    try {
      assert.equal(await style(page, 'header.top', 'background-color'), MUI.primary);
      assert.notEqual(await style(page, 'header.top', 'box-shadow'), 'none');
    } finally {
      await close();
    }
  });

  it('the active direction button is MUI primary blue', async () => {
    const { page, close } = await open();
    try {
      assert.equal(await style(page, '.dir-btn[aria-pressed="true"]', 'background-color'), MUI.primary);
      assert.equal(await style(page, '.dir-btn[aria-pressed="true"]', 'color'), 'rgb(255, 255, 255)');
    } finally {
      await close();
    }
  });

  it('journey cards are MUI cards: 4px corners, elevation, no coloured stripe', async () => {
    const { page, close } = await open();
    try {
      assert.equal(await style(page, 'article.card', 'border-top-left-radius'), '4px');
      assert.notEqual(await style(page, 'article.card', 'box-shadow'), 'none');
      assert.equal(await style(page, 'article.card', 'border-left-width'), '0px');
    } finally {
      await close();
    }
  });

  it('risk and delay use MUI error/warning soft (standard Alert) colours', async () => {
    const { page, close } = await open();
    try {
      const risk = page.locator('article.card .badge', { hasText: 'Connection risk' }).first();
      assert.equal(await risk.evaluate((e) => getComputedStyle(e).backgroundColor), MUI.errorSoftBg);
      assert.equal(await risk.evaluate((e) => getComputedStyle(e).color), MUI.errorSoftText);
      assert.equal(await style(page, '.c-conn.risk-at-risk', 'background-color'), MUI.errorSoftBg);
      const banner = await style(page, '#banner', 'border-top-color');
      assert.equal(banner, MUI.secondary, 'demo banner uses secondary');
      // Delay styling is checked on the warning list colour in a delayed card, if present.
      const warn = page.locator('.badge', { hasText: 'Delayed' });
      if (await warn.count()) {
        assert.equal(await warn.first().evaluate((e) => getComputedStyle(e).backgroundColor), MUI.warningSoftBg);
        assert.equal(await warn.first().evaluate((e) => getComputedStyle(e).color), MUI.warningSoftText);
      }
    } finally {
      await close();
    }
  });

  it('DEMO badge uses MUI secondary purple', async () => {
    const { page, close } = await open();
    try {
      assert.equal(await style(page, '#mode-badge', 'background-color'), MUI.secondary);
    } finally {
      await close();
    }
  });

  it('dark mode uses the MUI dark palette', async () => {
    const { page, close } = await open({ colorScheme: 'dark' });
    try {
      assert.equal(await style(page, 'body', 'background-color'), MUI.darkBackground);
    } finally {
      await close();
    }
  });
});

// ---------------------------------------------------------------------------
// Guards — must stay true before and after the restyle.
// ---------------------------------------------------------------------------
describe('layout and accessibility guards', () => {
  for (const viewport of [{ width: 412, height: 915 }, { width: 360, height: 640 }]) {
    it(`GO TO WORK / GO HOME are fully visible without scrolling at ${viewport.width}×${viewport.height}`, async () => {
      const { page, close } = await open({ viewport });
      try {
        for (const id of ['#go-work', '#go-home']) {
          const box = (await page.locator(id).boundingBox())!;
          assert.ok(box.y >= 0 && box.y + box.height <= viewport.height, `${id} bottom ${box.y + box.height} > ${viewport.height}`);
        }
      } finally {
        await close();
      }
    });
  }

  it('every tappable control on the dashboard is at least 44×44 px', async () => {
    const { page, close } = await open();
    try {
      const small = await page.$$eval('body > :not(dialog) :is(button, summary, input, select, [role="button"])', (els) =>
        els
          .filter((e) => (e as HTMLElement).offsetParent !== null)
          .map((e) => ({ el: `${e.tagName.toLowerCase()}#${e.id}.${(e as HTMLElement).className}:${(e.textContent ?? '').trim().slice(0, 20)}`, r: e.getBoundingClientRect() }))
          .filter((x) => x.r.height < 44 || x.r.width < 44)
          .map((x) => `${x.el} ${Math.round(x.r.width)}×${Math.round(x.r.height)}`),
      );
      assert.deepEqual(small, []);
    } finally {
      await close();
    }
  });

  it('no horizontal scrolling at 360 px', async () => {
    const { page, close } = await open({ viewport: { width: 360, height: 640 } });
    try {
      const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
      assert.ok(sw <= cw, `scrollWidth ${sw} > clientWidth ${cw}`);
    } finally {
      await close();
    }
  });

  for (const colorScheme of ['light', 'dark'] as const) {
    it(`departure times have at least 4.5:1 contrast (${colorScheme})`, async () => {
      const { page, close } = await open({ colorScheme });
      try {
        const { fg, bg } = await colours(page, 'article.card .c-time');
        assert.ok(contrast(fg, bg) >= 4.5, `${fg} on ${bg} = ${contrast(fg, bg).toFixed(2)}`);
      } finally {
        await close();
      }
    });
  }

  it('no console errors or security-policy violations', async () => {
    const { page, errors, close } = await open();
    try {
      await page.click('#settings-btn');
      await page.waitForSelector('dialog[open]');
      assert.deepEqual(errors, []);
    } finally {
      await close();
    }
  });

  it('app script stays under 40 KB gzipped', () => {
    const size = gzipSync(readFileSync(resolve(PUBLIC_DIR, 'app.js'))).length;
    assert.ok(size < 40 * 1024, `app.js is ${(size / 1024).toFixed(1)} KB gzipped`);
  });
});

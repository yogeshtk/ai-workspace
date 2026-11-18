// Exports the dashboard (light mode) as PNG and SVG for importing into Figma.
//
//   npm run build && npm run design:export
//
// Uses the built app, an in-process demo server ("disrupted" scenario) and a
// pinned clock (Thu 22 Oct 2026, 07:20 London) so the screen is the same on
// every run: GO TO WORK, a risky connection, a delay and a cancellation.
// Output (design/):
//   dashboard-light.png       phone screen, 412×915 at 2x
//   dashboard-light-full.png  whole scrolling page at 2x
//   dashboard-light.svg       whole page as vectors (via PDF → pdftocairo)
// The SVG needs `pdftocairo` (poppler-utils). Text in it is outlined glyphs,
// not editable text.

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { chromium, devices } from 'playwright-core';
import { createApp } from '../src/server/app.ts';
import { JourneyService } from '../src/server/journeys.ts';
import { DemoProvider } from '../src/server/providers/demo.ts';

const NOW = Date.parse('2026-10-22T07:20:00+01:00');
const OUT = resolve('design');
const SETTINGS = {
  home: { crs: 'WOK', name: 'Woking' },
  work: { crs: 'WAT', name: 'London Waterloo' },
  transfer: { crs: 'CLJ', name: 'Clapham Junction' },
};
const VIEWPORT = { width: 412, height: 915 };

const ICON_PATHS = {
  warning: 'M12 5.99 19.53 19H4.47L12 5.99M12 2 1 21h22L12 2zm1 14h-2v2h2v-2zm0-6h-2v4h2v-4z',
  error: 'M11 15h2v2h-2zm0-8h2v6h-2zm.99-5C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z',
  info: 'M11 7h2v2h-2zm0 4h2v6h-2zm1-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z',
  expand: 'M16.59 8.59 12 13.17 7.41 8.59 6 10l6 6 6-6z',
};
const icon = (name, colour) =>
  `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path fill='${colour}' d='${ICON_PATHS[name]}'/></svg>`)}") center / contain no-repeat`;
const PRINT_ICON_CSS = `
  .banner::before, .c-warn li::before, .card summary::after, .sources summary::after { -webkit-mask: none !important; mask: none !important; }
  .banner::before { background: ${icon('warning', '#ed6c02')} !important; }
  .banner.banner-bad::before { background: ${icon('error', '#d32f2f')} !important; }
  .banner.banner-demo::before { background: ${icon('info', '#9c27b0')} !important; }
  .c-warn li::before { background: ${icon('warning', '#ed6c02')} !important; }
  .c-warn.bad li::before { background: ${icon('error', '#d32f2f')} !important; }
  .card summary::after, .sources summary::after { background: ${icon('expand', '#1976d2')} !important; }
`;

const journeys = new JourneyService(
  { live: null, scheduled: null, demo: new DemoProvider({ scenario: 'disrupted', now: () => NOW }), now: () => NOW },
  { cacheMs: 0 },
);
const status = { mode: 'demo', live: { name: 'Darwin', configured: false, missing: [] }, scheduled: { name: 'Network Rail', configured: false, missing: [], detail: null }, demo: true, messages: [] };
const handler = createApp({ journeys, status, publicDir: resolve('dist/public'), basicAuth: null });
const server = createServer((req, res) => void handler(req, res));
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
try {
  mkdirSync(OUT, { recursive: true });

  async function openPage(deviceScaleFactor) {
    const ctx = await browser.newContext({
      ...devices['Pixel 7'],
      viewport: VIEWPORT,
      deviceScaleFactor,
      colorScheme: 'light',
      timezoneId: 'Europe/London',
      locale: 'en-GB',
      serviceWorkers: 'block',
      bypassCSP: true, // lets the export inject its print-only icon styles
    });
    await ctx.addInitScript((s) => localStorage.setItem('rd:settings:v1', JSON.stringify(s)), SETTINGS);
    const page = await ctx.newPage();
    await page.clock.install({ time: NOW });
    await page.goto(base);
    await page.waitForSelector('article.card');
    await page.evaluate(() => document.fonts.ready);
    return { ctx, page };
  }

  // PNGs at 2x.
  {
    const { ctx, page } = await openPage(2);
    await page.screenshot({ path: `${OUT}/dashboard-light.png` });
    await page.screenshot({ path: `${OUT}/dashboard-light-full.png`, fullPage: true });
    await ctx.close();
  }

  // SVG: print the page to a single-page PDF the size of the phone layout, then convert.
  {
    const { ctx, page } = await openPage(1);
    await page.emulateMedia({ media: 'screen' });
    // CSS mask icons don't survive printing to PDF; use pre-coloured SVG images instead.
    await page.addStyleTag({ content: PRINT_ICON_CSS });
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    const pdf = `${OUT}/dashboard-light.tmp.pdf`;
    await page.pdf({ path: pdf, width: `${VIEWPORT.width}px`, height: `${height}px`, printBackground: true, pageRanges: '1', margin: { top: '0', right: '0', bottom: '0', left: '0' } });
    await ctx.close();
    const svgPath = `${OUT}/dashboard-light.svg`;
    execFileSync('pdftocairo', ['-svg', pdf, svgPath]);
    rmSync(pdf);
    // PDF works in points (0.75 px): restore the CSS-pixel size so Figma imports a 412-wide frame.
    const svg = readFileSync(svgPath, 'utf8').replace(/<svg([^>]*?) width="[\d.]+" height="[\d.]+"/, `<svg$1 width="${VIEWPORT.width}" height="${height}"`);
    writeFileSync(svgPath, svg);
  }
  console.log(`Wrote ${OUT}/dashboard-light.png, dashboard-light-full.png and dashboard-light.svg`);
} finally {
  await browser.close();
  server.close();
}

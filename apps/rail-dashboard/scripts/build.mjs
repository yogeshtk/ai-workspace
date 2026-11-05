// Builds the browser bundle into dist/public: app.js, sw.js, static files and
// a compact station list for offline autocomplete.
import { build } from 'esbuild';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';

const FONT_WEIGHTS = [400, 500, 700];

const out = 'dist/public';
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync('public', out, { recursive: true });

const require = createRequire(import.meta.url);
const stations = JSON.parse(readFileSync(require.resolve('uk-railway-stations/stations.json'), 'utf8'))
  .filter((s) => /^[A-Z]{3}$/.test(s.crsCode))
  .map((s) => [s.crsCode, s.stationName])
  .sort((a, b) => a[1].localeCompare(b[1]));
writeFileSync(`${out}/stations.json`, JSON.stringify(stations));

// Self-hosted Roboto (SIL OFL 1.1) — MUI's typeface, served from our own origin.
mkdirSync(`${out}/fonts`, { recursive: true });
const fontDir = dirname(require.resolve('@fontsource/roboto/package.json'));
for (const weight of FONT_WEIGHTS) cpSync(`${fontDir}/files/roboto-latin-${weight}-normal.woff2`, `${out}/fonts/roboto-latin-${weight}-normal.woff2`);
cpSync(`${fontDir}/LICENSE`, `${out}/fonts/LICENSE.txt`);

const common = { bundle: true, minify: true, target: ['es2020', 'safari15', 'chrome100', 'firefox100'], legalComments: 'none', logLevel: 'warning' };
await build({ ...common, entryPoints: ['src/client/main.ts'], outfile: `${out}/app.js`, format: 'esm', sourcemap: true });

// Version the service-worker cache by the content of the shell.
const hash = createHash('sha256');
for (const f of ['app.js', 'index.html', 'styles.css', 'manifest.webmanifest']) hash.update(readFileSync(`${out}/${f}`));
const buildId = hash.digest('hex').slice(0, 12);
await build({ ...common, entryPoints: ['src/client/sw.ts'], outfile: `${out}/sw.js`, format: 'iife', define: { __BUILD_ID__: JSON.stringify(buildId) } });

const size = (f) => (readFileSync(`${out}/${f}`).length / 1024).toFixed(1);
console.log(`Built ${out} (build ${buildId}): app.js ${size('app.js')} KB, styles.css ${size('styles.css')} KB, stations.json ${size('stations.json')} KB`);

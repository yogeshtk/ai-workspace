// Usage:
//   npm run timetable:import -- --file ~/Downloads/toc-full.json.gz --stations WOK,CLJ,WAT
//   npm run timetable:import -- --download --stations WOK,CLJ,WAT   (needs NROD_USERNAME / NROD_PASSWORD)
// Stations default to TIMETABLE_STATIONS from .env. Output: data/timetable.json
// (or TIMETABLE_FILE). Restart the server afterwards (or it reloads on next start).

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { downloadCif, importCifStream, openCifFile } from './cif-import.ts';

if (existsSync('.env')) process.loadEnvFile('.env');

const { values } = parseArgs({
  options: {
    file: { type: 'string' },
    download: { type: 'boolean', default: false },
    stations: { type: 'string' },
    out: { type: 'string' },
  },
});

const stations = (values.stations ?? process.env.TIMETABLE_STATIONS ?? '')
  .split(',')
  .map((s) => s.trim().toUpperCase())
  .filter((s) => /^[A-Z]{3}$/.test(s));
if (stations.length < 2) {
  console.error('Give at least two station CRS codes with --stations A,B,C (or TIMETABLE_STATIONS in .env).');
  process.exit(1);
}
const out = resolve(values.out ?? process.env.TIMETABLE_FILE ?? 'data/timetable.json');

let input;
let label: string;
if (values.file) {
  input = openCifFile(values.file);
  label = `file:${values.file}`;
} else if (values.download) {
  const user = process.env.NROD_USERNAME;
  const pass = process.env.NROD_PASSWORD;
  if (!user || !pass) {
    console.error('--download needs NROD_USERNAME and NROD_PASSWORD (register at https://publicdatafeeds.networkrail.co.uk).');
    process.exit(1);
  }
  console.log('Downloading Network Rail SCHEDULE full extract…');
  input = await downloadCif(user, pass);
  label = 'nrod:CIF_ALL_FULL_DAILY/toc-full';
} else {
  console.error('Pass --file <path to CIF JSON (.gz)> or --download.');
  process.exit(1);
}

const started = Date.now();
const { file, stats } = await importCifStream(input, stations, label);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(file));
console.log(
  `Imported ${stats.schedulesKept} schedules (+${stats.cancellationsKept} STP cancellations) for ${stations.join(', ')} ` +
    `from ${stats.schedulesSeen} schedules / ${stats.tiplocs} TIPLOCs in ${((Date.now() - started) / 1000).toFixed(1)}s → ${out}`,
);
if (stats.schedulesKept === 0) console.warn('Warning: no services found. Check the CRS codes and that the file is the CIF JSON extract.');

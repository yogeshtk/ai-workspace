// Station names and CRS codes for search/autocomplete. Data: the
// `uk-railway-stations` package (ODbL, © its contributors; derived from
// trainline-eu/stations), limited to stations Darwin can query.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { searchStations as search, type Station } from '../shared/station-search.ts';

export type { Station };

let cache: Station[] | null = null;

export function allStations(): Station[] {
  if (cache) return cache;
  const require = createRequire(import.meta.url);
  const path = require.resolve('uk-railway-stations/stations.json');
  const raw = JSON.parse(readFileSync(path, 'utf8')) as { stationName: string; crsCode: string }[];
  cache = raw
    .filter((s) => /^[A-Z]{3}$/.test(s.crsCode))
    .map((s) => ({ crs: s.crsCode, name: s.stationName }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return cache;
}

const byCrs = new Map<string, Station>();

export function stationName(crs: string): string {
  if (byCrs.size === 0) for (const s of allStations()) byCrs.set(s.crs, s);
  return byCrs.get(crs)?.name ?? crs;
}

export function isKnownStation(crs: string): boolean {
  stationName(crs);
  return byCrs.has(crs);
}

export function searchStations(query: string, limit = 10, list: Station[] = allStations()): Station[] {
  return search(query, list, limit);
}

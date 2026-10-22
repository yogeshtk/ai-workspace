// localStorage persistence. Every access is guarded: private mode or blocked
// storage must never stop the dashboard from rendering.

import { normaliseSettings, routeKey, type Selection, type Settings } from '../shared/commute.ts';
import type { Direction, JourneyQuery, JourneyResponse } from '../shared/types.ts';

const KEYS = {
  settings: 'rd:settings:v1',
  selection: 'rd:selection:v1',
  direction: 'rd:direction:v1',
  cacheIndex: 'rd:cache-index:v1',
  cachePrefix: 'rd:cache:v1:',
};
const MAX_CACHED = 12;

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or unavailable — non-fatal */
  }
}

function remove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function loadSettings(): Settings {
  return normaliseSettings(read(KEYS.settings));
}

export function saveSettings(s: Settings): void {
  write(KEYS.settings, s);
}

export function loadSelection(): Selection | null {
  return read<Selection>(KEYS.selection);
}

export function saveSelection(sel: Selection): void {
  write(KEYS.selection, sel);
}

export function loadLastDirection(): { direction: Direction; at: number } | null {
  return read(KEYS.direction);
}

export function saveLastDirection(direction: Direction): void {
  write(KEYS.direction, { direction, at: Date.now() });
}

export interface CachedResult {
  response: JourneyResponse;
  savedAt: number;
}

export function getCachedResult(q: JourneyQuery): CachedResult | null {
  return read<CachedResult>(KEYS.cachePrefix + routeKey(q));
}

export function cacheResult(q: JourneyQuery, response: JourneyResponse): void {
  const key = routeKey(q);
  write(KEYS.cachePrefix + key, { response, savedAt: Date.now() } satisfies CachedResult);
  const index = (read<string[]>(KEYS.cacheIndex) ?? []).filter((k) => k !== key);
  index.unshift(key);
  for (const old of index.splice(MAX_CACHED)) remove(KEYS.cachePrefix + old);
  write(KEYS.cacheIndex, index);
}

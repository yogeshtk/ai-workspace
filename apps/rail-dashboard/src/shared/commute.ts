// Commute preferences, default direction and date/time selection. Pure
// functions so they can be unit-tested and shared by client and server.

import type { Direction, JourneyQuery } from './types.ts';
import { addDays, formatMinutes, londonParts, parseHhmm, weekdayOf } from './time.ts';

export interface StationSetting {
  crs: string;
  name: string;
}

export interface Settings {
  home: StationSetting | null; // Station A
  work: StationSetting | null; // Station B
  transfer: StationSetting | null; // Station C
  morningWindow: { start: string; end: string };
  eveningWindow: { start: string; end: string };
  earliestDeparture: string; // HH:MM
  latestDeparture: string; // HH:MM ("23:59" = no limit)
  minTransferMinutes: number;
  walkingMinutes: number;
  preferDirect: boolean;
  maxChanges: 0 | 1;
  arriveWorkBy: string | null; // HH:MM
  defaultDirection: 'auto' | Direction;
  refreshSeconds: number;
  windowMinutes: number;
}

export const DEFAULT_SETTINGS: Settings = {
  home: null,
  work: null,
  transfer: null,
  morningWindow: { start: '06:30', end: '09:30' },
  eveningWindow: { start: '16:30', end: '19:30' },
  earliestDeparture: '00:00',
  latestDeparture: '23:59',
  minTransferMinutes: 5,
  walkingMinutes: 0,
  preferDirect: true,
  maxChanges: 1,
  arriveWorkBy: '09:00',
  defaultDirection: 'auto',
  refreshSeconds: 60,
  windowMinutes: 120,
};

export function normaliseSettings(raw: unknown): Settings {
  const s = { ...DEFAULT_SETTINGS, ...(typeof raw === 'object' && raw ? (raw as Partial<Settings>) : {}) };
  const station = (v: unknown): StationSetting | null => {
    if (!v || typeof v !== 'object') return null;
    const { crs, name } = v as StationSetting;
    return typeof crs === 'string' && /^[A-Z]{3}$/.test(crs) ? { crs, name: typeof name === 'string' ? name : crs } : null;
  };
  const hhmm = (v: unknown, fallback: string) => (typeof v === 'string' && parseHhmm(v) !== null ? v : fallback);
  const int = (v: unknown, min: number, max: number, fallback: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback;
  return {
    home: station(s.home),
    work: station(s.work),
    transfer: station(s.transfer),
    morningWindow: {
      start: hhmm(s.morningWindow?.start, DEFAULT_SETTINGS.morningWindow.start),
      end: hhmm(s.morningWindow?.end, DEFAULT_SETTINGS.morningWindow.end),
    },
    eveningWindow: {
      start: hhmm(s.eveningWindow?.start, DEFAULT_SETTINGS.eveningWindow.start),
      end: hhmm(s.eveningWindow?.end, DEFAULT_SETTINGS.eveningWindow.end),
    },
    earliestDeparture: hhmm(s.earliestDeparture, DEFAULT_SETTINGS.earliestDeparture),
    latestDeparture: hhmm(s.latestDeparture, DEFAULT_SETTINGS.latestDeparture),
    minTransferMinutes: int(s.minTransferMinutes, 0, 60, DEFAULT_SETTINGS.minTransferMinutes),
    walkingMinutes: int(s.walkingMinutes, 0, 30, DEFAULT_SETTINGS.walkingMinutes),
    preferDirect: typeof s.preferDirect === 'boolean' ? s.preferDirect : DEFAULT_SETTINGS.preferDirect,
    maxChanges: s.maxChanges === 0 ? 0 : 1,
    arriveWorkBy: s.arriveWorkBy === null ? null : hhmm(s.arriveWorkBy, DEFAULT_SETTINGS.arriveWorkBy ?? '09:00'),
    defaultDirection: s.defaultDirection === 'work' || s.defaultDirection === 'home' ? s.defaultDirection : 'auto',
    refreshSeconds: int(s.refreshSeconds, 15, 600, DEFAULT_SETTINGS.refreshSeconds),
    windowMinutes: int(s.windowMinutes, 30, 360, DEFAULT_SETTINGS.windowMinutes),
  };
}

export function isConfigured(s: Settings): boolean {
  return Boolean(s.home && s.work);
}

/**
 * Pick GO TO WORK or GO HOME from the London clock. Before the midpoint
 * between the end of the morning window and the start of the evening window
 * we assume you are heading to work; after it, home.
 */
export function defaultDirection(nowMs: number, s: Settings): Direction {
  if (s.defaultDirection !== 'auto') return s.defaultDirection;
  const now = londonParts(nowMs).minutes;
  const morningEnd = parseHhmm(s.morningWindow.end) ?? 570;
  const eveningStart = parseHhmm(s.eveningWindow.start) ?? 990;
  const pivot = morningEnd < eveningStart ? (morningEnd + eveningStart) / 2 : 13 * 60;
  return now < pivot ? 'work' : 'home';
}

/** A date/time selection. `mode: 'now'` is the live commute view. */
export type Selection =
  | { mode: 'now' }
  | { mode: 'planned'; date: string; time: string; savedAt: number };

/** Saved planner selections expire so the app opens on the live commute. */
export const SELECTION_TTL_MS = 30 * 60_000;

export function restoreSelection(saved: Selection | null, nowMs: number): Selection {
  if (!saved || saved.mode === 'now') return { mode: 'now' };
  if (nowMs - saved.savedAt > SELECTION_TTL_MS) return { mode: 'now' };
  const today = londonParts(nowMs).date;
  if (saved.date < today) return { mode: 'now' };
  return saved;
}

export interface ResolvedSelection {
  date: string;
  time: string;
  isNow: boolean;
}

export function resolveSelection(sel: Selection, nowMs: number): ResolvedSelection {
  if (sel.mode === 'now') {
    const p = londonParts(nowMs);
    return { date: p.date, time: p.hhmm, isNow: true };
  }
  return { date: sel.date, time: sel.time, isNow: false };
}

export interface DateChip {
  label: string;
  date: string;
  weekday: number;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Today, tomorrow, then the next five weekdays (quick weekday selection). */
export function dateChips(nowMs: number): DateChip[] {
  const today = londonParts(nowMs).date;
  const chips: DateChip[] = [
    { label: 'Today', date: today, weekday: weekdayOf(today) },
    { label: 'Tomorrow', date: addDays(today, 1), weekday: weekdayOf(addDays(today, 1)) },
  ];
  for (let i = 2; chips.length < 7 && i < 14; i++) {
    const d = addDays(today, i);
    const wd = weekdayOf(d);
    if (wd === 0 || wd === 6) continue;
    chips.push({ label: `${DAY_NAMES[wd]} ${Number(d.slice(8))}`, date: d, weekday: wd });
  }
  return chips;
}

/** The time to pre-fill when planning another day: the start of that commute window. */
export function suggestedTime(direction: Direction, s: Settings): string {
  const w = direction === 'work' ? s.morningWindow : s.eveningWindow;
  return w.start;
}

export function directionStations(direction: Direction, s: Settings): { from: StationSetting; to: StationSetting; via: StationSetting | null } | null {
  if (!s.home || !s.work) return null;
  return direction === 'work'
    ? { from: s.home, to: s.work, via: s.transfer }
    : { from: s.work, to: s.home, via: s.transfer };
}

export function buildQuery(direction: Direction, s: Settings, sel: ResolvedSelection, count = 5): JourneyQuery | null {
  const st = directionStations(direction, s);
  if (!st) return null;
  return {
    from: st.from.crs,
    to: st.to.crs,
    via: st.via && st.via.crs !== st.from.crs && st.via.crs !== st.to.crs ? st.via.crs : null,
    date: sel.date,
    time: sel.time,
    windowMinutes: s.windowMinutes,
    minTransferMinutes: s.minTransferMinutes,
    walkingMinutes: s.walkingMinutes,
    maxChanges: s.maxChanges,
    preferDirect: s.preferDirect,
    count,
    earliest: s.earliestDeparture === '00:00' ? null : s.earliestDeparture,
    latest: s.latestDeparture === '23:59' ? null : s.latestDeparture,
  };
}

export function queryKey(q: JourneyQuery): string {
  return [q.from, q.via ?? '-', q.to, q.date, q.time, q.windowMinutes, q.minTransferMinutes, q.walkingMinutes, q.maxChanges, q.preferDirect ? 1 : 0, q.count, q.earliest ?? '', q.latest ?? ''].join('|');
}

/** Cache key ignoring the start time — used to show the last result for the same route/day instantly. */
export function routeKey(q: JourneyQuery): string {
  return [q.from, q.via ?? '-', q.to, q.date].join('|');
}

export function minutesLabel(mins: number): string {
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`;
}

export { formatMinutes };

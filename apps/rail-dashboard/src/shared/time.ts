// UK (Europe/London) time helpers. All instants are epoch milliseconds; all
// wall-clock values are interpreted in Europe/London regardless of the host
// timezone, so a server running in UTC and a phone in BST agree.

export const LONDON_TZ = 'Europe/London';
const MINUTE = 60_000;
const DAY_MINUTES = 24 * 60;

const partsFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: LONDON_TZ,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  weekday: 'short',
});

export interface LondonParts {
  date: string; // YYYY-MM-DD
  minutes: number; // minutes since local midnight
  weekday: number; // 0 = Sunday … 6 = Saturday
  hhmm: string;
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function londonParts(epochMs: number): LondonParts {
  const parts: Record<string, string> = {};
  for (const p of partsFormatter.formatToParts(new Date(epochMs))) parts[p.type] = p.value;
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: hour * 60 + minute,
    weekday: WEEKDAYS[parts.weekday ?? 'Sun'] ?? 0,
    hhmm: `${parts.hour}:${parts.minute}`,
  };
}

/** UTC offset of London at the given instant, in minutes (0 for GMT, 60 for BST). */
export function londonOffsetMinutes(epochMs: number): number {
  const p = londonParts(epochMs);
  const [y, m, d] = p.date.split('-').map(Number) as [number, number, number];
  const asUtc = Date.UTC(y, m - 1, d) + p.minutes * MINUTE;
  const truncated = Math.floor(epochMs / MINUTE) * MINUTE;
  return Math.round((asUtc - truncated) / MINUTE);
}

/**
 * Convert a London wall-clock time to an instant. `minutes` may exceed 1440 or
 * be negative (rail schedules run past midnight); it is applied as wall-clock
 * days, so 25:10 on 2026-03-28 means 01:10 on 2026-03-29 local time.
 */
export function londonWallToEpoch(date: string, minutes: number): number {
  const dayShift = Math.floor(minutes / DAY_MINUTES);
  const mins = minutes - dayShift * DAY_MINUTES;
  const day = addDays(date, dayShift);
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const naive = Date.UTC(y, m - 1, d) + mins * MINUTE;
  // Two passes resolve the offset either side of a DST boundary.
  let guess = naive - londonOffsetMinutes(naive) * MINUTE;
  guess = naive - londonOffsetMinutes(guess) * MINUTE;
  return guess;
}

export function parseHhmm(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = /^(\d{1,2}):?(\d{2})/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 47 || min > 59) return null;
  return h * 60 + min;
}

export function formatMinutes(minutes: number): string {
  const m = ((minutes % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export function formatLondonTime(epochMs: number): string {
  return londonParts(epochMs).hhmm;
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

/** Day of week (0 = Sunday) for a calendar date, independent of timezone. */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/**
 * Resolve a bare "HH:MM" from a live feed to an instant, choosing the calendar
 * day that puts it closest to `referenceMs` (within -6h/+18h). Darwin boards
 * only give HH:MM, so a 00:05 departure seen at 23:50 belongs to tomorrow.
 */
export function resolveNearTime(hhmm: string | null | undefined, referenceMs: number): number | null {
  const minutes = parseHhmm(hhmm);
  if (minutes === null) return null;
  const ref = londonParts(referenceMs);
  let delta = minutes - ref.minutes;
  if (delta < -6 * 60) delta += DAY_MINUTES;
  else if (delta > 18 * 60) delta -= DAY_MINUTES;
  return londonWallToEpoch(ref.date, ref.minutes + delta);
}

/**
 * Resolve "HH:MM" that must not be earlier than `previousMs` (a later stop on
 * the same train). Rolls forward a day when the clock wraps past midnight.
 */
export function resolveAfter(hhmm: string | null | undefined, previousMs: number): number | null {
  const minutes = parseHhmm(hhmm);
  if (minutes === null) return null;
  const prev = londonParts(previousMs);
  let candidate = londonWallToEpoch(prev.date, minutes);
  // Allow small negative drift (estimates can be a minute "early"), but a big
  // jump backwards means we crossed midnight.
  if (candidate < previousMs - 3 * 60 * MINUTE) candidate = londonWallToEpoch(addDays(prev.date, 1), minutes);
  return candidate;
}

export function minutesBetween(fromMs: number, toMs: number): number {
  return Math.round((toMs - fromMs) / MINUTE);
}

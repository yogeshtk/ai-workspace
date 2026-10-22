// Encode/decode a JourneyQuery to/from URL search params (client ↔ server).

import type { JourneyQuery } from './types.ts';
import { isIsoDate, parseHhmm } from './time.ts';

export function encodeQuery(q: JourneyQuery): string {
  const p = new URLSearchParams({
    from: q.from,
    to: q.to,
    date: q.date,
    time: q.time,
    window: String(q.windowMinutes),
    mt: String(q.minTransferMinutes),
    walk: String(q.walkingMinutes),
    changes: String(q.maxChanges),
    direct: q.preferDirect ? '1' : '0',
    count: String(q.count),
  });
  if (q.via) p.set('via', q.via);
  if (q.earliest) p.set('earliest', q.earliest);
  if (q.latest) p.set('latest', q.latest);
  return p.toString();
}

export class QueryError extends Error {}

export function decodeQuery(params: URLSearchParams): JourneyQuery {
  const crs = (name: string, required: boolean): string | null => {
    const v = (params.get(name) ?? '').trim().toUpperCase();
    if (!v && !required) return null;
    if (!/^[A-Z]{3}$/.test(v)) throw new QueryError(`"${name}" must be a 3-letter station (CRS) code.`);
    return v;
  };
  const int = (name: string, min: number, max: number, fallback: number): number => {
    const raw = params.get(name);
    if (raw === null || raw === '') return fallback;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < min || n > max) throw new QueryError(`"${name}" must be a whole number between ${min} and ${max}.`);
    return n;
  };
  const time = (name: string, required: boolean): string | null => {
    const v = params.get(name);
    if (!v) {
      if (required) throw new QueryError(`"${name}" is required (HH:MM).`);
      return null;
    }
    const m = parseHhmm(v);
    if (m === null || m >= 1440 || !/^\d{2}:\d{2}$/.test(v)) throw new QueryError(`"${name}" must be HH:MM.`);
    return v;
  };
  const from = crs('from', true)!;
  const to = crs('to', true)!;
  const via = crs('via', false);
  if (from === to) throw new QueryError('"from" and "to" must be different stations.');
  const date = params.get('date') ?? '';
  if (!isIsoDate(date)) throw new QueryError('"date" must be YYYY-MM-DD.');
  return {
    from,
    to,
    via: via && via !== from && via !== to ? via : null,
    date,
    time: time('time', true)!,
    windowMinutes: int('window', 15, 360, 120),
    minTransferMinutes: int('mt', 0, 60, 5),
    walkingMinutes: int('walk', 0, 30, 0),
    maxChanges: int('changes', 0, 1, 1) as 0 | 1,
    preferDirect: params.get('direct') !== '0',
    count: int('count', 1, 15, 5),
    earliest: time('earliest', false),
    latest: time('latest', false),
  };
}

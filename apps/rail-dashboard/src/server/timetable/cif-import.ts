// Import the Network Rail SCHEDULE feed (CIF "JSON" full extract,
// newline-delimited JSON, optionally gzipped) into a compact timetable file
// containing only passenger services that call at two or more of the
// configured stations.
//
// Feed: https://publicdatafeeds.networkrail.co.uk (NROD, free registration;
// also listed on the Rail Data Marketplace). Type CIF_ALL_FULL_DAILY, day=toc-full.

import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';
import type { StoredCall, StoredSchedule, TimetableFile } from './schedule-store.ts';

const PASSENGER_STATUS = new Set(['P', '1']); // passenger & parcels (permanent / STP)
const BOARDING = /\b(T|TB|U)\b/; // activity: stops to take up passengers
const ALIGHTING = /\b(T|TF|D)\b/; // activity: stops to set down passengers

interface RawLocation {
  location_type?: string;
  tiploc_code?: string;
  public_arrival?: string | null;
  public_departure?: string | null;
  platform?: string | null;
  activity?: string | null;
}

/** CIF public time "HHMM" → minutes. "0000" means "not advertised" in CIF. */
export function cifTime(v: string | null | undefined): number | null {
  if (!v || !/^\d{4}$/.test(v) || v === '0000') return null;
  return Number(v.slice(0, 2)) * 60 + Number(v.slice(2, 4));
}

/** Convert raw locations to public calls with monotonic minutes (crossing midnight). */
export function toCalls(locations: RawLocation[], tiplocToCrs: Map<string, string>): StoredCall[] {
  const calls: StoredCall[] = [];
  let lastMinute = -1;
  let dayOffset = 0;
  const norm = (m: number | null) => {
    if (m === null) return null;
    let v = m + dayOffset;
    if (v < lastMinute - 6 * 60) {
      dayOffset += 1440;
      v += 1440;
    }
    lastMinute = Math.max(lastMinute, v);
    return v;
  };
  for (const loc of locations) {
    const crs = loc.tiploc_code ? tiplocToCrs.get(loc.tiploc_code.trim()) : undefined;
    let arr = cifTime(loc.public_arrival);
    let dep = cifTime(loc.public_departure);
    if (arr === null && dep === null) continue;
    // Respect pick-up / set-down only stops when the activity field is present.
    if (typeof loc.activity === 'string' && loc.activity.trim()) {
      const act = loc.activity.replace(/(.{2})/g, '$1 ').trim();
      if (!BOARDING.test(act)) dep = null;
      if (!ALIGHTING.test(act)) arr = null;
    }
    if (loc.location_type === 'LO') arr = null;
    if (loc.location_type === 'LT') dep = null;
    const a = norm(arr);
    const d = norm(dep);
    if (!crs || (a === null && d === null)) continue;
    calls.push([crs, a, d, loc.platform?.trim() || null]);
  }
  return calls;
}

export interface ImportStats {
  lines: number;
  tiplocs: number;
  schedulesSeen: number;
  schedulesKept: number;
  cancellationsKept: number;
}

export async function importCifStream(input: Readable, stations: string[], sourceLabel: string): Promise<{ file: TimetableFile; stats: ImportStats }> {
  const wanted = new Set(stations.map((s) => s.toUpperCase()));
  const tiplocToCrs = new Map<string, string>();
  const kept: StoredSchedule[] = [];
  const cancellations: StoredSchedule[] = [];
  const stats: ImportStats = { lines: 0, tiplocs: 0, schedulesSeen: 0, schedulesKept: 0, cancellationsKept: 0 };
  let extractDate: string | null = null;

  const rl = createInterface({ input, crlfDelay: Infinity });
  for await (const line of rl) {
    stats.lines++;
    if (!line.trim()) continue;
    let rec: Record<string, unknown>;
    try {
      rec = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (rec.JsonTimetableV1) {
      const ts = Number((rec.JsonTimetableV1 as { timestamp?: number }).timestamp);
      if (Number.isFinite(ts)) extractDate = new Date(ts * 1000).toISOString().slice(0, 10);
    } else if (rec.TiplocV1) {
      const t = rec.TiplocV1 as { tiploc_code?: string; crs_code?: string | null };
      if (t.tiploc_code && t.crs_code && /^[A-Z]{3}$/.test(t.crs_code.trim())) {
        tiplocToCrs.set(t.tiploc_code.trim(), t.crs_code.trim());
        stats.tiplocs++;
      }
    } else if (rec.JsonScheduleV1) {
      stats.schedulesSeen++;
      const s = rec.JsonScheduleV1 as {
        CIF_train_uid: string;
        schedule_start_date: string;
        schedule_end_date: string;
        schedule_days_runs: string;
        CIF_stp_indicator: string;
        CIF_bank_holiday_running?: string | null;
        train_status?: string;
        atoc_code?: string | null;
        transaction_type?: string;
        schedule_segment?: { signalling_id?: string | null; schedule_location?: RawLocation[] };
      };
      if (s.transaction_type && s.transaction_type !== 'Create') continue;
      const stp = s.CIF_stp_indicator as StoredSchedule['stp'];
      if (!['P', 'N', 'O', 'C'].includes(stp)) continue;
      const base = {
        uid: s.CIF_train_uid,
        start: s.schedule_start_date,
        end: s.schedule_end_date,
        days: s.schedule_days_runs,
        stp,
        bhx: s.CIF_bank_holiday_running ?? null,
        atoc: s.atoc_code ?? null,
        headcode: s.schedule_segment?.signalling_id ?? null,
      };
      if (stp === 'C') {
        cancellations.push({ ...base, calls: [] });
        continue;
      }
      if (!PASSENGER_STATUS.has(s.train_status ?? '')) continue;
      const calls = toCalls(s.schedule_segment?.schedule_location ?? [], tiplocToCrs);
      const hits = new Set(calls.map((c) => c[0]).filter((c) => wanted.has(c)));
      if (hits.size < 2) continue;
      kept.push({ ...base, calls });
    }
  }
  const keptUids = new Set(kept.map((s) => s.uid));
  const relevantCancellations = cancellations.filter((c) => keptUids.has(c.uid));
  stats.schedulesKept = kept.length;
  stats.cancellationsKept = relevantCancellations.length;
  return {
    file: {
      version: 1,
      importedAt: new Date().toISOString(),
      source: sourceLabel,
      extractDate,
      stations: [...wanted].sort(),
      schedules: [...kept, ...relevantCancellations],
    },
    stats,
  };
}

export function openCifFile(path: string): Readable {
  const raw = createReadStream(path);
  return path.endsWith('.gz') ? raw.pipe(createGunzip()) : raw;
}

export const NROD_SCHEDULE_URL = 'https://publicdatafeeds.networkrail.co.uk/ntrod/CifFileAuthenticate?type=CIF_ALL_FULL_DAILY&day=toc-full';

export async function downloadCif(username: string, password: string, url = NROD_SCHEDULE_URL): Promise<Readable> {
  const res = await fetch(url, { headers: { authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}` }, redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`Network Rail SCHEDULE download failed: HTTP ${res.status}`);
  const body = Readable.fromWeb(res.body as import('node:stream/web').ReadableStream);
  // The feed is gzip-compressed regardless of extension.
  return body.pipe(createGunzip());
}

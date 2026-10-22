// Scheduled timetable provider backed by a compact file built from the
// Network Rail SCHEDULE feed (CIF JSON full extract). Handles any date the
// extract covers, including short-term planned changes (STP overlays,
// engineering-works cancellations) and the "does not run on bank holidays" flag.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { isBankHoliday } from '../../shared/calendar.ts';
import type { Leg, SourceInfo } from '../../shared/types.ts';
import { addDays, londonParts, londonWallToEpoch, weekdayOf } from '../../shared/time.ts';
import { stationName } from '../stations.ts';
import type { LegRequest, LegResult, ScheduledLegProvider } from '../providers/types.ts';

/** [crs, publicArrivalMinutes|null, publicDepartureMinutes|null, platform|null] — minutes from run-date midnight, may exceed 1440. */
export type StoredCall = [string, number | null, number | null, string | null];

export interface StoredSchedule {
  uid: string;
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD
  days: string; // 7 chars, Monday first, "1" = runs
  stp: 'P' | 'N' | 'O' | 'C';
  bhx: string | null; // "X" = does not run on bank holidays
  atoc: string | null;
  headcode: string | null;
  calls: StoredCall[];
}

export interface TimetableFile {
  version: 1;
  importedAt: string; // ISO timestamp
  source: string;
  extractDate: string | null;
  stations: string[]; // CRS codes the import was filtered to
  schedules: StoredSchedule[];
}

const STP_PRIORITY: Record<StoredSchedule['stp'], number> = { C: 0, O: 1, N: 2, P: 3 };

const OPERATORS: Record<string, string> = {
  AW: 'Transport for Wales', CC: 'c2c', CH: 'Chiltern Railways', CS: 'Caledonian Sleeper', EM: 'East Midlands Railway',
  ES: 'Eurostar', GC: 'Grand Central', GN: 'Great Northern', GR: 'LNER', GW: 'Great Western Railway', GX: 'Gatwick Express',
  HT: 'Hull Trains', HX: 'Heathrow Express', IL: 'Island Line', LE: 'Greater Anglia', LM: 'West Midlands Railway',
  LO: 'London Overground', LT: 'London Underground', ME: 'Merseyrail', NT: 'Northern', SE: 'Southeastern', SN: 'Southern',
  SR: 'ScotRail', SW: 'South Western Railway', TL: 'Thameslink', TP: 'TransPennine Express', VT: 'Avanti West Coast',
  XC: 'CrossCountry', XR: 'Elizabeth line', LD: 'Lumo',
};

export function dayRuns(days: string, date: string): boolean {
  const idx = (weekdayOf(date) + 6) % 7; // Monday = 0
  return days.charAt(idx) === '1';
}

/** Choose the schedule that applies to a train UID on a date (STP precedence C > O > N > P). */
export function applicableSchedule(variants: StoredSchedule[], date: string): StoredSchedule | null {
  let best: StoredSchedule | null = null;
  for (const s of variants) {
    if (date < s.start || date > s.end || !dayRuns(s.days, date)) continue;
    if (!best || STP_PRIORITY[s.stp] < STP_PRIORITY[best.stp]) best = s;
  }
  if (!best || best.stp === 'C') return null;
  if (best.bhx === 'X' && isBankHoliday(date)) return null;
  return best;
}

export class ScheduleStore implements ScheduledLegProvider {
  readonly name = 'Network Rail timetable (SCHEDULE feed)';
  readonly kind = 'scheduled' as const;
  private readonly byUid = new Map<string, StoredSchedule[]>();
  private readonly byStation = new Map<string, Set<string>>();
  private readonly file: TimetableFile;
  private readonly minDate: string;
  private readonly maxDate: string;

  constructor(file: TimetableFile) {
    this.file = file;
    let min = '9999-12-31';
    let max = '0000-01-01';
    for (const s of file.schedules) {
      const list = this.byUid.get(s.uid) ?? [];
      list.push(s);
      this.byUid.set(s.uid, list);
      for (const [crs] of s.calls) {
        const set = this.byStation.get(crs) ?? new Set<string>();
        set.add(s.uid);
        this.byStation.set(crs, set);
      }
      if (s.stp === 'P') {
        if (s.start < min) min = s.start;
        if (s.end > max) max = s.end;
      }
    }
    this.minDate = min;
    this.maxDate = max;
  }

  static load(path: string): ScheduleStore | null {
    if (!existsSync(path)) return null;
    const file = JSON.parse(readFileSync(path, 'utf8')) as TimetableFile;
    if (file.version !== 1 || !Array.isArray(file.schedules)) throw new Error(`Unrecognised timetable file: ${path}`);
    return new ScheduleStore(file);
  }

  static fileAge(path: string): number | null {
    return existsSync(path) ? Date.now() - statSync(path).mtimeMs : null;
  }

  coversDate(date: string): boolean {
    return this.file.schedules.length > 0 && date >= this.minDate && date <= this.maxDate;
  }

  coversStations(crs: string[]): boolean {
    return crs.every((c) => this.file.stations.includes(c));
  }

  describe(): string {
    return `Imported ${this.file.importedAt.slice(0, 10)} for ${this.file.stations.join(', ')} (${this.file.schedules.length} schedules, ${this.minDate} → ${this.maxDate}).`;
  }

  get importedAt(): number {
    return Date.parse(this.file.importedAt);
  }

  async getLegs(req: LegRequest): Promise<LegResult> {
    const legs: Leg[] = [];
    const fromUids = this.byStation.get(req.from) ?? new Set<string>();
    const toUids = this.byStation.get(req.to) ?? new Set<string>();
    // Trains that started the previous day can depart after midnight; trains
    // on the next day matter when the window crosses midnight.
    const firstDay = addDays(londonParts(req.startMs).date, -1);
    const lastDay = londonParts(req.endMs).date;
    for (let runDate = firstDay; runDate <= lastDay; runDate = addDays(runDate, 1)) {
      for (const uid of fromUids) {
        if (!toUids.has(uid)) continue;
        const sched = applicableSchedule(this.byUid.get(uid) ?? [], runDate);
        if (!sched) continue;
        const fromIdx = sched.calls.findIndex((c) => c[0] === req.from && c[2] !== null);
        if (fromIdx < 0) continue;
        const toCall = sched.calls.slice(fromIdx + 1).find((c) => c[0] === req.to && c[1] !== null);
        if (!toCall) continue;
        const fromCall = sched.calls[fromIdx]!;
        const dep = londonWallToEpoch(runDate, fromCall[2]!);
        if (dep < req.startMs || dep > req.endMs) continue;
        const arr = londonWallToEpoch(runDate, toCall[1]!);
        const last = sched.calls[sched.calls.length - 1]!;
        legs.push({
          serviceId: `nr:${uid}:${runDate}`,
          from: { crs: req.from, name: stationName(req.from) },
          to: { crs: req.to, name: stationName(req.to) },
          dep: { scheduled: dep, estimated: null, actual: false, delayedUnknown: false },
          arr: { scheduled: arr, estimated: null, actual: false, delayedUnknown: false },
          platform: fromCall[3],
          platformConfirmed: false,
          operator: sched.atoc ? (OPERATORS[sched.atoc] ?? sched.atoc) : null,
          headsign: stationName(last[0]),
          cancelled: false,
          cancelReason: null,
          delayReason: null,
          source: 'scheduled',
        });
      }
    }
    legs.sort((a, b) => a.dep.scheduled - b.dep.scheduled);
    const source: SourceInfo = {
      provider: this.name,
      kind: 'scheduled',
      fetchedAt: this.importedAt,
      fromCache: true,
      stale: Date.now() - this.importedAt > 8 * 24 * 3600_000,
      note: `Timetable imported ${this.file.importedAt.slice(0, 10)}. Planned platforms only; late changes may be missing.`,
    };
    return { legs, source, coveredUntil: req.endMs, notices: [] };
  }
}

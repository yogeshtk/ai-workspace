import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  addDays, formatLondonTime, isIsoDate, londonOffsetMinutes, londonParts, londonWallToEpoch, parseHhmm, resolveAfter, resolveNearTime, weekdayOf,
} from '../../src/shared/time.ts';

describe('London time', () => {
  it('converts wall-clock times in BST and GMT', () => {
    assert.equal(new Date(londonWallToEpoch('2026-07-01', 8 * 60)).toISOString(), '2026-07-01T07:00:00.000Z');
    assert.equal(new Date(londonWallToEpoch('2026-12-01', 8 * 60)).toISOString(), '2026-12-01T08:00:00.000Z');
  });

  it('handles the autumn clock change (BST → GMT on 2026-10-25)', () => {
    const before = londonWallToEpoch('2026-10-25', 0); // 00:00 BST = 23:00Z previous day
    const after = londonWallToEpoch('2026-10-25', 3 * 60); // 03:00 GMT
    assert.equal(new Date(before).toISOString(), '2026-10-24T23:00:00.000Z');
    assert.equal(new Date(after).toISOString(), '2026-10-25T03:00:00.000Z');
    assert.equal((after - before) / 60_000, 240, 'the night is an hour longer');
    assert.equal(londonOffsetMinutes(before), 60);
    assert.equal(londonOffsetMinutes(after), 0);
  });

  it('handles the spring clock change (GMT → BST on 2026-03-29)', () => {
    const before = londonWallToEpoch('2026-03-29', 0);
    const after = londonWallToEpoch('2026-03-29', 3 * 60);
    assert.equal((after - before) / 60_000, 120, 'the night is an hour shorter');
  });

  it('treats minutes beyond 24h as the following day (rail schedules past midnight)', () => {
    assert.equal(londonWallToEpoch('2026-10-22', 25 * 60 + 10), londonWallToEpoch('2026-10-23', 70));
  });

  it('reports London date/time regardless of host timezone', () => {
    const p = londonParts(Date.parse('2026-10-22T23:30:00Z')); // 00:30 BST next day
    assert.equal(p.date, '2026-10-23');
    assert.equal(p.hhmm, '00:30');
    assert.equal(p.weekday, 5);
  });

  it('resolves bare HH:MM across midnight relative to a reference', () => {
    const ref = londonWallToEpoch('2026-10-22', 23 * 60 + 50);
    assert.equal(resolveNearTime('00:05', ref), londonWallToEpoch('2026-10-23', 5));
    assert.equal(resolveNearTime('23:40', ref), londonWallToEpoch('2026-10-22', 23 * 60 + 40));
    const early = londonWallToEpoch('2026-10-23', 10); // 00:10, a late train still showing 23:58
    assert.equal(resolveNearTime('23:58', early), londonWallToEpoch('2026-10-22', 23 * 60 + 58));
  });

  it('keeps later stops after earlier ones when the clock wraps', () => {
    const dep = londonWallToEpoch('2026-10-22', 23 * 60 + 45);
    assert.equal(resolveAfter('00:20', dep), londonWallToEpoch('2026-10-23', 20));
    assert.equal(resolveAfter('23:59', dep), londonWallToEpoch('2026-10-22', 23 * 60 + 59));
  });

  it('parses and validates helpers', () => {
    assert.equal(parseHhmm('07:42'), 462);
    assert.equal(parseHhmm('0742'), 462);
    assert.equal(parseHhmm('On time'), null);
    assert.equal(formatLondonTime(londonWallToEpoch('2026-10-22', 462)), '07:42');
    assert.equal(addDays('2026-12-31', 1), '2027-01-01');
    assert.equal(weekdayOf('2026-10-24'), 6);
    assert.ok(isIsoDate('2028-02-29'));
    assert.ok(!isIsoDate('2026-02-30'));
  });
});

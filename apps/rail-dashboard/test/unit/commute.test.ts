import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildQuery, DEFAULT_SETTINGS, dateChips, defaultDirection, normaliseSettings, queryKey, resolveSelection, restoreSelection, SELECTION_TTL_MS, suggestedTime,
  type Settings,
} from '../../src/shared/commute.ts';
import { decodeQuery, encodeQuery, QueryError } from '../../src/shared/query.ts';
import { at } from '../helpers.ts';

const settings: Settings = normaliseSettings({
  home: { crs: 'WOK', name: 'Woking' },
  work: { crs: 'WAT', name: 'London Waterloo' },
  transfer: { crs: 'CLJ', name: 'Clapham Junction' },
});

describe('default direction', () => {
  it('goes to work in the morning and home in the evening (London time)', () => {
    assert.equal(defaultDirection(at('07:10'), settings), 'work');
    assert.equal(defaultDirection(at('12:30'), settings), 'work');
    assert.equal(defaultDirection(at('13:30'), settings), 'home');
    assert.equal(defaultDirection(at('17:45'), settings), 'home');
    assert.equal(defaultDirection(at('00:30'), settings), 'work');
  });

  it('uses London time even near midnight UTC in BST', () => {
    // 23:30Z on 22 Oct is 00:30 on 23 Oct in London → morning side.
    assert.equal(defaultDirection(Date.parse('2026-10-22T23:30:00Z'), settings), 'work');
  });

  it('honours a fixed default direction', () => {
    assert.equal(defaultDirection(at('07:10'), { ...settings, defaultDirection: 'home' }), 'home');
  });
});

describe('date selection', () => {
  it('offers today, tomorrow and the next five weekdays', () => {
    const chips = dateChips(at('08:00', '2026-10-23')); // Friday
    assert.deepEqual(chips.map((c) => c.label), ['Today', 'Tomorrow', 'Mon 26', 'Tue 27', 'Wed 28', 'Thu 29', 'Fri 30']);
    assert.equal(chips[1]!.date, '2026-10-24');
    assert.equal(chips[1]!.weekday, 6, 'tomorrow is Saturday and is still offered');
  });

  it('rolls "today" over at London midnight, not UTC midnight', () => {
    assert.equal(dateChips(Date.parse('2026-10-22T23:30:00Z'))[0]!.date, '2026-10-23');
  });

  it('"now" resolves to the current London date and minute', () => {
    const sel = resolveSelection({ mode: 'now' }, at('07:42'));
    assert.deepEqual(sel, { date: '2026-10-22', time: '07:42', isNow: true });
  });

  it('remembers a planned selection briefly, then returns to the live commute', () => {
    const saved = { mode: 'planned' as const, date: '2026-10-30', time: '08:00', savedAt: at('07:00') };
    assert.deepEqual(restoreSelection(saved, at('07:10')), saved);
    assert.deepEqual(restoreSelection(saved, at('07:00') + SELECTION_TTL_MS + 1), { mode: 'now' });
    assert.deepEqual(restoreSelection({ ...saved, date: '2026-10-21', savedAt: at('07:05') }, at('07:10')), { mode: 'now' }, 'past dates are dropped');
    assert.deepEqual(restoreSelection(null, at('07:10')), { mode: 'now' });
  });

  it('suggests the commute window start when planning another day', () => {
    assert.equal(suggestedTime('work', settings), DEFAULT_SETTINGS.morningWindow.start);
    assert.equal(suggestedTime('home', settings), DEFAULT_SETTINGS.eveningWindow.start);
  });
});

describe('query building', () => {
  it('builds GO TO WORK and GO HOME queries from settings', () => {
    const sel = resolveSelection({ mode: 'now' }, at('07:42'));
    const work = buildQuery('work', settings, sel)!;
    assert.equal(work.from, 'WOK');
    assert.equal(work.to, 'WAT');
    assert.equal(work.via, 'CLJ');
    const home = buildQuery('home', settings, sel)!;
    assert.equal(home.from, 'WAT');
    assert.equal(home.to, 'WOK');
    assert.equal(home.via, 'CLJ');
    assert.equal(buildQuery('work', { ...settings, home: null }, sel), null);
  });

  it('drops a transfer station equal to either end', () => {
    const sel = resolveSelection({ mode: 'now' }, at('07:42'));
    assert.equal(buildQuery('work', { ...settings, transfer: { crs: 'WAT', name: 'x' } }, sel)!.via, null);
  });

  it('round-trips through URL parameters', () => {
    const q = buildQuery('work', { ...settings, earliestDeparture: '06:00' }, { date: '2026-10-30', time: '08:15', isNow: false })!;
    const decoded = decodeQuery(new URLSearchParams(encodeQuery(q)));
    assert.deepEqual(decoded, q);
    assert.equal(queryKey(decoded), queryKey(q));
  });

  it('rejects malformed queries', () => {
    const bad = (s: string) => assert.throws(() => decodeQuery(new URLSearchParams(s)), QueryError);
    bad('from=WOK&to=WOK&date=2026-10-22&time=07:00');
    bad('from=WOKING&to=WAT&date=2026-10-22&time=07:00');
    bad('from=WOK&to=WAT&date=2026-02-30&time=07:00');
    bad('from=WOK&to=WAT&date=2026-10-22&time=25:00');
    bad('from=WOK&to=WAT&date=2026-10-22&time=07:00&count=99');
  });

  it('normalises corrupt saved settings to safe defaults', () => {
    const s = normaliseSettings({ home: { crs: 'bad' }, minTransferMinutes: 999, refreshSeconds: 'x', maxChanges: 7 });
    assert.equal(s.home, null);
    assert.equal(s.minTransferMinutes, 60);
    assert.equal(s.refreshSeconds, DEFAULT_SETTINGS.refreshSeconds);
    assert.equal(s.maxChanges, 1);
  });
});

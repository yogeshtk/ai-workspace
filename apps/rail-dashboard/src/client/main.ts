// Dashboard controller: picks a sensible default (direction + "now"), paints
// cached results instantly, fetches fresh results, and refreshes live data
// while the page is visible.

import {
  buildQuery, dateChips, defaultDirection, isConfigured, normaliseSettings, resolveSelection, restoreSelection,
  suggestedTime, type Selection, type Settings,
} from '../shared/commute.ts';
import { decideOnFailure, describeFreshness, pruneDeparted } from '../shared/display.ts';
import { encodeQuery } from '../shared/query.ts';
import { searchStations, type Station } from '../shared/station-search.ts';
import type { ApiError, Direction, JourneyQuery, JourneyResponse, ProviderStatus } from '../shared/types.ts';
import { londonParts, londonWallToEpoch, parseHhmm } from '../shared/time.ts';
import { cancelledBlock, esc, journeyCard, skeleton } from './render.ts';
import { cacheResult, getCachedResult, loadLastDirection, loadSelection, loadSettings, saveLastDirection, saveSelection, saveSettings } from './storage.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const FETCH_TIMEOUT_MS = 10_000;
// Material "Event" icon (Apache-2.0).
const CALENDAR_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M17 12h-5v5h5v-5zM16 1v2H8V1H6v2H5a2 2 0 0 0-1.99 2L3 19a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-1V1h-2zm3 18H5V8h14v11z"/></svg>';

type Filter = 'all' | 'direct' | 'change';

interface State {
  settings: Settings;
  direction: Direction;
  selection: Selection;
  response: JourneyResponse | null;
  fromDeviceCache: boolean;
  cacheSavedAt: number | null;
  lastSuccess: number | null;
  loading: boolean;
  error: string | null;
  more: number; // 0..2 — "show more options" level
  filter: Filter;
  status: ProviderStatus | null;
  pausedUntil: number;
}

const state: State = {
  settings: loadSettings(),
  direction: 'work',
  selection: { mode: 'now' },
  response: null,
  fromDeviceCache: false,
  cacheSavedAt: null,
  lastSuccess: null,
  loading: false,
  error: null,
  more: 0,
  filter: 'all',
  status: null,
  pausedUntil: 0,
};

// Performance marks for time-to-useful-results (read by scripts/measure.mjs).
const perf = {
  firstResultsMs: null as number | null, // first time any journey card (cached or fresh) was painted
  firstFreshResultsMs: null as number | null, // first time server results were painted
  lastResultsRenderMs: null as number | null,
  lastFreshMs: null as number | null,
};
(window as unknown as { __rd: typeof perf }).__rd = perf;

let requestSeq = 0;
let refreshTimer: number | undefined;

// ---------------------------------------------------------------- query

function currentQuery(): JourneyQuery | null {
  const sel = resolveSelection(state.selection, Date.now());
  const q = buildQuery(state.direction, state.settings, sel, 5 + state.more * 5);
  if (q) q.windowMinutes = Math.min(360, state.settings.windowMinutes + state.more * 60);
  return q;
}

async function fetchJourneys(q: JourneyQuery): Promise<JourneyResponse> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`/api/journeys?${encodeQuery(q)}`, { signal: ctrl.signal, headers: { accept: 'application/json' } });
    const body = (await res.json().catch(() => null)) as JourneyResponse | ApiError | null;
    if (!res.ok || !body || 'error' in body) {
      const err = body && 'error' in body ? body : null;
      throw Object.assign(new Error(err?.error ?? `Server error ${res.status}`), { status: res.status, retryAfterSeconds: err?.retryAfterSeconds ?? null });
    }
    return body;
  } catch (e) {
    if (e instanceof Error && 'status' in e) throw e;
    throw Object.assign(new Error(ctrl.signal.aborted ? 'The request timed out.' : 'Network error.'), { status: null, retryAfterSeconds: null });
  } finally {
    clearTimeout(timer);
  }
}

async function load(opts: { userInitiated?: boolean } = {}): Promise<void> {
  const q = currentQuery();
  if (!q) {
    renderAll();
    return;
  }
  const seq = ++requestSeq;

  // Paint something useful immediately: cached results for this route & day.
  if (!state.response || state.response.query.from !== q.from || state.response.query.date !== q.date || opts.userInitiated) {
    const cached = getCachedResult(q);
    if (cached && cached.response.query.to === q.to) {
      state.response = pruneDeparted(cached.response, Date.now());
      state.fromDeviceCache = true;
      state.cacheSavedAt = cached.savedAt;
    } else if (opts.userInitiated) {
      state.response = null;
    }
  }
  state.loading = true;
  state.error = null;
  renderAll();

  try {
    const resp = await fetchJourneys(q);
    if (seq !== requestSeq) return;
    state.response = resp;
    state.fromDeviceCache = false;
    state.cacheSavedAt = null;
    state.lastSuccess = Date.now();
    cacheResult(q, resp);
  } catch (e) {
    if (seq !== requestSeq) return;
    const err = e as Error & { status: number | null; retryAfterSeconds: number | null };
    const cached = getCachedResult(q);
    const decision = decideOnFailure(err, cached && cached.response.query.to === q.to ? cached : null, Date.now());
    if (decision.showCached && cached) {
      state.response = pruneDeparted(cached.response, Date.now());
      state.fromDeviceCache = true;
      state.cacheSavedAt = cached.savedAt;
    }
    state.error = decision.message;
    if (decision.retryAfterSeconds) state.pausedUntil = Date.now() + decision.retryAfterSeconds * 1000;
  } finally {
    if (seq === requestSeq) {
      state.loading = false;
      renderAll();
      if (!state.fromDeviceCache && state.response?.journeys.length) {
        perf.lastFreshMs = performance.now();
        if (perf.firstFreshResultsMs === null) perf.firstFreshResultsMs = perf.lastFreshMs;
      }
    }
  }
}

function scheduleRefresh(): void {
  window.clearInterval(refreshTimer);
  refreshTimer = window.setInterval(() => {
    if (document.visibilityState !== 'visible' || state.loading || Date.now() < state.pausedUntil) return;
    const sel = resolveSelection(state.selection, Date.now());
    const today = londonParts(Date.now()).date;
    // Only today's searches change minute to minute; future dates are timetable-only.
    if (sel.date !== today) return;
    void load();
  }, state.settings.refreshSeconds * 1000);
}

// ---------------------------------------------------------------- rendering

function renderClock(): void {
  const now = new Date();
  const p = londonParts(now.getTime());
  $('now-time').textContent = p.hhmm;
  $('now-date').textContent = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short' }).format(now);
}

function renderDirection(): void {
  const s = state.settings;
  $('go-work').setAttribute('aria-pressed', String(state.direction === 'work'));
  $('go-home').setAttribute('aria-pressed', String(state.direction === 'home'));
  const via = s.transfer ? ` (via ${s.transfer.name})` : '';
  $('work-route').textContent = s.home && s.work ? `${s.home.name} → ${s.work.name}` : 'Set stations';
  $('home-route').textContent = s.home && s.work ? `${s.work.name} → ${s.home.name}` : 'Set stations';
  $('go-work').title = s.home && s.work ? `${s.home.name} → ${s.work.name}${via}` : '';
  $('go-home').title = s.home && s.work ? `${s.work.name} → ${s.home.name}${via}` : '';
  $('filter-via').textContent = s.transfer ? `Via ${s.transfer.name}` : 'Via change';
}

function renderWhen(): void {
  const now = Date.now();
  const sel = resolveSelection(state.selection, now);
  const chips = dateChips(now);
  const isNow = state.selection.mode === 'now';
  const html = [
    `<button type="button" class="chip chip-live" data-date="now" aria-pressed="${isNow}">● Now</button>`,
    ...chips.map((c) => `<button type="button" class="chip" data-date="${c.date}" aria-pressed="${!isNow && sel.date === c.date}">${esc(c.label)}</button>`),
    `<button type="button" class="chip" data-date="pick" aria-pressed="${!isNow && !chips.some((c) => c.date === sel.date)}">${CALENDAR_ICON}${!isNow && !chips.some((c) => c.date === sel.date) ? esc(sel.date) : 'Pick date'}</button>`,
  ].join('');
  const box = $('date-chips');
  if (box.innerHTML !== html) box.innerHTML = html;
  $('when-row').hidden = isNow;
  if (!isNow) {
    ($('date-input') as HTMLInputElement).value = sel.date;
    const t = $('time-input') as HTMLInputElement;
    if (document.activeElement !== t) t.value = sel.time;
  }
}

function renderBanner(): void {
  const b = $('banner');
  const parts: string[] = [];
  let cls = 'banner';
  const r = state.response;
  if (state.error) {
    parts.push(state.error);
    cls += ' banner-bad';
  }
  if (r) {
    for (const n of r.notices) parts.push(n);
    if (r.mode === 'demo' && !state.error) cls += ' banner-demo';
  } else if (state.status?.demo && !state.error) {
    parts.push('DEMO MODE — simulated trains, not real services.');
    cls += ' banner-demo';
  }
  b.className = cls;
  b.hidden = parts.length === 0;
  b.innerHTML = parts.map((p) => `<p>${esc(p)}</p>`).join('');
}

function renderResults(): void {
  const main = $('results');
  main.setAttribute('aria-busy', String(state.loading));
  $('refresh-btn').classList.toggle('spinning', state.loading);

  if (!isConfigured(state.settings)) {
    main.innerHTML = `<div class="empty"><h3>Set up your commute</h3><p>Choose your home, work and (optional) change station once. They're saved on this phone.</p><button type="button" class="btn-primary" id="setup-btn">Choose stations</button></div>`;
    $('setup-btn').addEventListener('click', () => openSettings(true));
    $('more-btn').hidden = true;
    return;
  }
  const r = state.response;
  if (!r) {
    main.innerHTML = state.loading ? skeleton(3) : `<div class="empty"><h3>No results</h3><p>${esc(state.error ?? 'Tap refresh to try again.')}</p></div>`;
    $('more-btn').hidden = true;
    return;
  }
  const now = Date.now();
  const sel = resolveSelection(state.selection, now);
  const arriveBy =
    state.direction === 'work' && state.settings.arriveWorkBy ? londonWallToEpoch(sel.date, parseHhmm(state.settings.arriveWorkBy) ?? 540) : null;
  const ctx = { nowMs: now, showCountdown: sel.date === londonParts(now).date, arriveBy, cached: state.fromDeviceCache };
  const list = r.journeys.filter((j) => state.filter === 'all' || j.kind === state.filter);
  let html = list.map((j, i) => journeyCard(j, i, ctx)).join('');
  if (list.length === 0) {
    const msg = r.journeys.length && state.filter !== 'all' ? 'No options of this type in the list — try "All".' : (r.explanation ?? 'No journeys found.');
    html = `<div class="empty"><h3>No trains to show</h3><p>${esc(msg)}</p></div>`;
  } else if (r.explanation && state.filter === 'all') {
    html += `<div class="empty"><p>${esc(r.explanation)}</p></div>`;
  }
  html += cancelledBlock(r.cancelled);
  main.innerHTML = html;
  $('more-btn').hidden = state.more >= 2 || r.journeys.length < r.query.count;

  if (r.journeys.length > 0) {
    perf.lastResultsRenderMs = performance.now();
    if (perf.firstResultsMs === null) perf.firstResultsMs = perf.lastResultsRenderMs;
  }
}

function renderFooter(): void {
  const r = state.response;
  const f = $('freshness');
  if (!r) {
    f.textContent = state.loading ? 'Loading…' : '';
  } else {
    const fr = describeFreshness(r, Date.now(), { fromDeviceCache: state.fromDeviceCache, savedAt: state.cacheSavedAt });
    const last = state.lastSuccess ? ` · last successful update ${new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(state.lastSuccess)}` : '';
    f.textContent = `${fr.text}${last}${state.loading ? ' · updating…' : ''}`;
    const badge = $('mode-badge');
    badge.hidden = false;
    badge.textContent = fr.badge;
    badge.className = `badge ${fr.kind === 'live' || fr.kind === 'mixed' ? 'badge-live' : fr.kind === 'demo' ? 'badge-demo' : fr.kind === 'scheduled' ? 'badge-scheduled' : 'badge-cached'}`;
  }
  const sources = r?.sources ?? [];
  const st = state.status;
  $('sources-detail').innerHTML = `
    <ul>${sources.map((s) => `<li><strong>${esc(s.provider)}</strong> — ${s.kind}${s.stale ? ' (stale)' : ''}${s.note ? ` · ${esc(s.note)}` : ''}</li>`).join('')}</ul>
    ${st ? `<ul>${st.messages.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>` : ''}
    <p>Connections are checked against your minimum change time using the timetable, then re-checked with live delays where available. Guaranteed-connection rules and station-specific minimum connection times are not available from these feeds, so allow extra time at large stations.</p>
    <p>Station list © uk-railway-stations contributors (ODbL).${perf.firstResultsMs !== null ? ` First results shown after ${(perf.firstResultsMs / 1000).toFixed(2)} s.` : ''}</p>`;
}

function renderAll(): void {
  renderClock();
  renderDirection();
  renderWhen();
  renderBanner();
  renderResults();
  renderFooter();
}

// ---------------------------------------------------------------- settings

let stationList: Station[] | null = null;
async function stations(): Promise<Station[]> {
  if (stationList) return stationList;
  try {
    const res = await fetch('/stations.json');
    const raw = (await res.json()) as [string, string][];
    stationList = raw.map(([crs, name]) => ({ crs, name }));
  } catch {
    stationList = [];
  }
  return stationList;
}

const pendingStations: Partial<Record<'home' | 'work' | 'transfer', Station | null>> = {};

function setupStationField(field: HTMLElement): void {
  const key = field.dataset.key as 'home' | 'work' | 'transfer';
  const input = field.querySelector('input')!;
  const list = field.querySelector('ul')!;
  let active = -1;
  let results: Station[] = [];
  const choose = (s: Station) => {
    pendingStations[key] = s;
    input.value = `${s.name} (${s.crs})`;
    input.setCustomValidity('');
    list.innerHTML = '';
  };
  const show = async () => {
    const q = input.value.replace(/\s*\([A-Z]{3}\)\s*$/, '');
    pendingStations[key] = q.trim() === '' && key === 'transfer' ? null : undefined;
    results = searchStations(q, await stations(), 8);
    active = -1;
    list.innerHTML = results.map((s, i) => `<li role="option" data-i="${i}"><span>${esc(s.name)}</span><span class="crs">${s.crs}</span></li>`).join('');
  };
  input.addEventListener('input', () => void show());
  input.addEventListener('focus', () => {
    void stations();
    input.select();
  });
  input.addEventListener('keydown', (e) => {
    if (!results.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length;
      list.querySelectorAll('li').forEach((li, i) => li.setAttribute('aria-selected', String(i === active)));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(results[Math.max(0, active)]!);
    }
  });
  list.addEventListener('pointerdown', (e) => {
    const li = (e.target as HTMLElement).closest('li');
    if (!li) return;
    e.preventDefault();
    choose(results[Number(li.dataset.i)]!);
  });
  input.addEventListener('blur', () => setTimeout(() => (list.innerHTML = ''), 150));
}

function fillSettingsForm(): void {
  const s = state.settings;
  const form = $('settings-form') as HTMLFormElement;
  const set = (name: string, v: string) => {
    const el = form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | null;
    if (el) el.value = v;
  };
  for (const key of ['home', 'work', 'transfer'] as const) {
    const st = s[key];
    ($(`st-${key}`) as HTMLInputElement).value = st ? `${st.name} (${st.crs})` : '';
    delete pendingStations[key];
  }
  set('morningStart', s.morningWindow.start);
  set('morningEnd', s.morningWindow.end);
  set('eveningStart', s.eveningWindow.start);
  set('eveningEnd', s.eveningWindow.end);
  set('earliestDeparture', s.earliestDeparture);
  set('latestDeparture', s.latestDeparture);
  set('arriveWorkBy', s.arriveWorkBy ?? '');
  set('defaultDirection', s.defaultDirection);
  set('minTransferMinutes', String(s.minTransferMinutes));
  set('walkingMinutes', String(s.walkingMinutes));
  set('maxChanges', String(s.maxChanges));
  set('refreshSeconds', String(s.refreshSeconds));
  set('windowMinutes', String(s.windowMinutes));
  (form.elements.namedItem('preferDirect') as HTMLInputElement).checked = s.preferDirect;

  const st = state.status;
  $('status-box').innerHTML = st
    ? `<strong>Data mode: ${st.mode === 'demo' ? 'DEMO (simulated)' : st.mode === 'live' ? 'Live' : 'Timetable only'}</strong>
       <ul>
         <li>Live (Darwin): ${st.live.configured ? 'configured' : `not configured — needs ${esc(st.live.missing.join(', '))}`}</li>
         <li>Timetable (Network Rail): ${st.scheduled.configured ? esc(st.scheduled.detail ?? 'loaded') : `not loaded — needs ${esc(st.scheduled.missing.join(', '))}`}</li>
       </ul>`
    : '';
}

function readSettingsForm(): Settings | null {
  const form = $('settings-form') as HTMLFormElement;
  const v = (name: string) => (form.elements.namedItem(name) as HTMLInputElement).value;
  const s = state.settings;
  const resolveStation = (key: 'home' | 'work' | 'transfer'): Station | null | undefined => {
    if (key in pendingStations && pendingStations[key] !== undefined) return pendingStations[key];
    const input = $(`st-${key}`) as HTMLInputElement;
    const text = input.value.trim();
    if (!text) return null;
    const current = s[key];
    if (current && text === `${current.name} (${current.crs})`) return current;
    // Accept a typed CRS or an exact name.
    const match = (stationList ?? []).find((x) => x.crs === text.toUpperCase() || x.name.toLowerCase() === text.toLowerCase());
    return match ?? undefined;
  };
  const home = resolveStation('home');
  const work = resolveStation('work');
  const transfer = resolveStation('transfer');
  let ok = true;
  for (const [key, val, required] of [['home', home, true], ['work', work, true], ['transfer', transfer, false]] as const) {
    const input = $(`st-${key}`) as HTMLInputElement;
    if (val === undefined || (required && !val)) {
      input.setCustomValidity('Pick a station from the list.');
      ok = false;
    } else input.setCustomValidity('');
  }
  if (ok && home && work && home.crs === work.crs) {
    ($('st-work') as HTMLInputElement).setCustomValidity('Work must differ from home.');
    ok = false;
  }
  if (!ok) {
    form.reportValidity();
    return null;
  }
  return normaliseSettings({
    home,
    work,
    transfer: transfer ?? null,
    morningWindow: { start: v('morningStart'), end: v('morningEnd') },
    eveningWindow: { start: v('eveningStart'), end: v('eveningEnd') },
    earliestDeparture: v('earliestDeparture') || '00:00',
    latestDeparture: v('latestDeparture') || '23:59',
    arriveWorkBy: v('arriveWorkBy') || null,
    defaultDirection: v('defaultDirection'),
    minTransferMinutes: Number(v('minTransferMinutes')),
    walkingMinutes: Number(v('walkingMinutes')),
    maxChanges: Number(v('maxChanges')),
    preferDirect: (form.elements.namedItem('preferDirect') as HTMLInputElement).checked,
    refreshSeconds: Number(v('refreshSeconds')),
    windowMinutes: Number(v('windowMinutes')),
  });
}

function openSettings(firstRun = false): void {
  fillSettingsForm();
  $('settings-intro').hidden = !firstRun;
  ($('settings') as HTMLDialogElement).showModal();
  if (firstRun) ($('st-home') as HTMLInputElement).focus();
}

// ---------------------------------------------------------------- events

function setDirection(d: Direction): void {
  state.direction = d;
  state.more = 0;
  saveLastDirection(d);
  if (state.selection.mode === 'planned' && state.selection.date !== londonParts(Date.now()).date) {
    // Planning another day: jump to the start of that commute window.
    state.selection = { ...state.selection, time: suggestedTime(d, state.settings), savedAt: Date.now() };
    saveSelection(state.selection);
  }
  void load({ userInitiated: true });
}

function setSelection(sel: Selection): void {
  state.selection = sel;
  state.more = 0;
  saveSelection(sel);
  void load({ userInitiated: true });
}

function wire(): void {
  $('go-work').addEventListener('click', () => setDirection('work'));
  $('go-home').addEventListener('click', () => setDirection('home'));
  $('refresh-btn').addEventListener('click', () => {
    state.pausedUntil = 0;
    void load();
  });
  $('settings-btn').addEventListener('click', () => openSettings());
  $('more-btn').addEventListener('click', () => {
    state.more = Math.min(2, state.more + 1);
    void load();
  });
  $('back-live').addEventListener('click', () => setSelection({ mode: 'now' }));

  $('date-chips').addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('button');
    if (!btn) return;
    const d = btn.dataset.date!;
    if (d === 'now') return setSelection({ mode: 'now' });
    const today = londonParts(Date.now()).date;
    if (d === 'pick') {
      const input = $('date-input') as HTMLInputElement;
      $('when-row').hidden = false;
      input.min = today;
      if (typeof input.showPicker === 'function') {
        try {
          input.showPicker();
          return;
        } catch {
          /* fall through */
        }
      }
      input.focus();
      return;
    }
    const time = d === today ? londonParts(Date.now()).hhmm : suggestedTime(state.direction, state.settings);
    setSelection({ mode: 'planned', date: d, time, savedAt: Date.now() });
  });
  $('date-input').addEventListener('change', (e) => {
    const v = (e.target as HTMLInputElement).value;
    if (!v) return;
    const cur = resolveSelection(state.selection, Date.now());
    setSelection({ mode: 'planned', date: v, time: state.selection.mode === 'planned' ? cur.time : suggestedTime(state.direction, state.settings), savedAt: Date.now() });
  });
  $('time-input').addEventListener('change', (e) => {
    const v = (e.target as HTMLInputElement).value;
    if (!v) return;
    const cur = resolveSelection(state.selection, Date.now());
    setSelection({ mode: 'planned', date: cur.date, time: v, savedAt: Date.now() });
  });

  $('route-filter').addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('button');
    if (!btn) return;
    state.filter = btn.dataset.filter as Filter;
    $('route-filter').querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
    renderResults();
  });

  document.querySelectorAll<HTMLElement>('.station-field').forEach(setupStationField);
  const dialog = $('settings') as HTMLDialogElement;
  ($('settings-form') as HTMLFormElement).addEventListener('submit', (e) => {
    const submitter = (e as SubmitEvent).submitter as HTMLButtonElement | null;
    if (submitter?.value !== 'save') return;
    e.preventDefault();
    const next = readSettingsForm();
    if (!next) return;
    state.settings = next;
    saveSettings(next);
    dialog.close();
    state.direction = pickDirection();
    scheduleRefresh();
    void load({ userInitiated: true });
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    // Returning to the app: drop expired planner selections and refresh stale data.
    const restored = restoreSelection(state.selection, Date.now());
    if (restored.mode !== state.selection.mode) state.selection = restored;
    if (!state.lastSuccess || Date.now() - state.lastSuccess > 20_000) void load();
    else renderAll();
  });
  window.addEventListener('online', () => void load());
  setInterval(() => {
    if (document.visibilityState === 'visible' && !state.loading) {
      renderClock();
      renderResults(); // update countdowns
      renderFooter();
    }
  }, 15_000);
}

function pickDirection(): Direction {
  // Home-screen shortcuts open with ?go=work / ?go=home.
  const go = new URLSearchParams(location.search).get('go');
  if (go === 'work' || go === 'home') return go;
  if (state.settings.defaultDirection !== 'auto') return state.settings.defaultDirection;
  // If you tapped a direction in the last 20 minutes, keep it (e.g. reopening the app on the platform).
  const last = loadLastDirection();
  if (last && Date.now() - last.at < 20 * 60_000) return last.direction;
  return defaultDirection(Date.now(), state.settings);
}

async function loadStatus(): Promise<void> {
  try {
    const res = await fetch('/api/status');
    state.status = (await res.json()) as ProviderStatus;
    renderBanner();
    renderFooter();
  } catch {
    /* offline — fine */
  }
}

function init(): void {
  state.selection = restoreSelection(loadSelection(), Date.now());
  state.direction = pickDirection();
  wire();
  scheduleRefresh();
  void load();
  void loadStatus();
  if (!isConfigured(state.settings)) openSettings(true);
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', () => void navigator.serviceWorker.register('/sw.js').catch(() => undefined));
  }
}

init();

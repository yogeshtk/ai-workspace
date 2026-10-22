// HTML rendering for journey cards. Plain template strings with escaping —
// small, fast and dependency-free.

import { minutesLabel } from '../shared/commute.ts';
import { effective } from '../shared/planner.ts';
import type { Journey, Leg, TimePoint } from '../shared/types.ts';
import { formatLondonTime, minutesBetween } from '../shared/time.ts';

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

const SOURCE_LABEL = { live: 'Live', scheduled: 'Timetable', demo: 'Demo' } as const;

function timeHtml(tp: TimePoint, cancelled: boolean, big: boolean): string {
  const sched = formatLondonTime(tp.scheduled);
  const cls = big ? 'c-time' : 'strong';
  if (cancelled) return `<span class="${cls}">${sched}</span> <span class="c-cancel">CANCELLED</span>`;
  if (tp.delayedUnknown) return `<span class="${cls}">${sched}</span> <span class="c-exp">Delayed</span>`;
  if (tp.estimated !== null && minutesBetween(tp.scheduled, tp.estimated) >= 1) {
    return `<span class="${cls}">${formatLondonTime(tp.estimated)}</span> <span class="c-old">${sched}</span>`;
  }
  return `<span class="${cls}">${sched}</span>`;
}

function shortTime(tp: TimePoint): string {
  if (tp.estimated !== null && minutesBetween(tp.scheduled, tp.estimated) >= 1) {
    return `${formatLondonTime(tp.estimated)} <span class="c-old c-old-sm">${formatLondonTime(tp.scheduled)}</span>`;
  }
  return formatLondonTime(tp.scheduled);
}

function platformHtml(leg: Leg): string {
  if (!leg.platform) return '';
  const title = leg.platformConfirmed ? 'Platform' : 'Planned platform (may change)';
  return `<span class="c-plat${leg.platformConfirmed ? '' : ' unconfirmed'}" title="${title}" aria-label="${title} ${esc(leg.platform)}">${esc(leg.platform)}</span>`;
}

function countdown(dep: number, nowMs: number): string {
  const mins = minutesBetween(nowMs, dep);
  if (mins < -1 || mins > 180) return '';
  if (mins <= 0) return 'due now';
  return `in ${minutesLabel(mins)}`;
}

export interface CardContext {
  nowMs: number;
  showCountdown: boolean;
  arriveBy: number | null; // epoch ms, work direction only
  cached: boolean;
}

export function journeyCard(j: Journey, index: number, ctx: CardContext): string {
  const first = j.legs[0]!;
  const last = j.legs[j.legs.length - 1]!;
  const cancelled = j.status === 'cancelled';
  const dep = effective(j.departure);
  const arr = effective(j.arrival);
  const kind = j.kind === 'direct' ? 'Direct' : `Via ${esc(j.connection?.station.name ?? last.from.name)}`;
  const srcLabel = ctx.cached ? 'Cached' : SOURCE_LABEL[j.source];
  const srcClass = ctx.cached ? 'badge-cached' : `badge-${j.source}`;
  const duration = j.expectedDurationMinutes !== j.scheduledDurationMinutes && !cancelled
    ? `${minutesLabel(j.expectedDurationMinutes)} <span class="muted">(planned ${minutesLabel(j.scheduledDurationMinutes)})</span>`
    : minutesLabel(j.scheduledDurationMinutes);

  let arriveBy = '';
  if (ctx.arriveBy !== null && !cancelled) {
    arriveBy = arr <= ctx.arriveBy
      ? ` · <span class="c-arrive-ok">✓ in by ${formatLondonTime(ctx.arriveBy)}</span>`
      : ` · <span class="c-arrive-late">after ${formatLondonTime(ctx.arriveBy)}</span>`;
  }

  let conn = '';
  if (j.connection && j.legs.length === 2) {
    const c = j.connection;
    const second = j.legs[1]!;
    const wait = c.expectedMinutes !== c.scheduledMinutes ? `${c.expectedMinutes} min <span class="muted">(planned ${c.scheduledMinutes})</span>` : `${c.scheduledMinutes} min`;
    const riskText = c.risk === 'at-risk' ? ' · RISKY' : c.risk === 'uncertain' ? ' · UNCERTAIN' : c.risk === 'tight' ? ' · TIGHT' : '';
    conn = `<div class="c-conn risk-${c.risk}">
      Arrive ${esc(c.station.name)} <strong>${shortTime(first.arr)}</strong> · change ${wait}${riskText}<br>
      Depart ${esc(c.station.name)} <strong>${shortTime(second.dep)}</strong> ${platformHtml(second)}${second.cancelled ? ' <span class="c-cancel">CANCELLED</span>' : ''}
    </div>`;
  }

  const warnings = j.warnings.length
    ? `<ul class="c-warn${j.status === 'risky' || cancelled ? ' bad' : ''}">${j.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>`
    : '';

  const legsDetail = j.legs
    .map((l) => `<li>${formatLondonTime(l.dep.scheduled)} ${esc(l.from.name)} → ${formatLondonTime(l.arr.scheduled)} ${esc(l.to.name)}${l.operator ? ` · ${esc(l.operator)}` : ''}${l.headsign ? ` · train to ${esc(l.headsign)}` : ''}${l.platform ? ` · plat ${esc(l.platform)}${l.platformConfirmed ? '' : ' (planned)'}` : ''} · ${SOURCE_LABEL[l.source]}</li>`)
    .join('');

  const statusBadge =
    j.status === 'risky' ? '<span class="badge badge-bad">Connection risk</span>'
    : j.status === 'delayed' ? '<span class="badge badge-warn">Delayed</span>'
    : j.status === 'cancelled' ? '<span class="badge badge-bad">Cancelled</span>'
    : j.status === 'on-time' ? '<span class="badge badge-live">On time</span>'
    : '';

  return `<article class="card st-${j.status}${j.source === 'demo' ? ' is-demo' : ''}" aria-label="Option ${index + 1}">
    <div class="c-row">
      <div class="c-dep">${timeHtml(j.departure, cancelled || first.cancelled, true)}${ctx.showCountdown && !cancelled ? `<span class="c-in">${countdown(dep, ctx.nowMs)}</span>` : ''}</div>
      <div class="c-tags"><span class="tag-kind">${kind}</span><span class="badge ${srcClass}">${srcLabel}</span>${statusBadge}</div>
    </div>
    <div class="c-line">${platformHtml(first)}${esc(first.from.name)} → <strong>${esc(last.to.name)}</strong> ${shortTime(j.arrival)}</div>
    <div class="c-line"><span class="muted">${duration} · ${j.changes === 0 ? 'no changes' : `${j.changes} change`}</span>${arriveBy}</div>
    ${conn}
    ${warnings}
    <details><summary>Details</summary><ol>${legsDetail}</ol></details>
  </article>`;
}

export function cancelledBlock(list: Journey[]): string {
  if (!list.length) return '';
  const items = list
    .map((j) => {
      const l = j.legs[0]!;
      return `<li>${formatLondonTime(l.dep.scheduled)} ${esc(l.from.name)} → ${esc(l.to.name)}${l.cancelReason ? ` — ${esc(l.cancelReason)}` : ''}</li>`;
    })
    .join('');
  return `<section class="cancelled-list" aria-label="Cancelled services"><strong>Cancelled</strong><ul>${items}</ul></section>`;
}

export function skeleton(n = 3): string {
  return Array.from({ length: n }, () => '<div class="card skeleton" aria-hidden="true"></div>').join('');
}

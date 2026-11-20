from lib import *

SCREENS = [  # id, file, nav label, icon, title, subtitle, audience
    ('overview', 'Main', 'Command centre', 'grid', 'Command centre', 'All transaction reporting regimes · T+1 run for business date Wed 18 Nov 2026', 'Ops'),
    ('emir', 'EmirRefit', 'EMIR Refit', 'layers', 'EMIR Refit', 'Trade repository submissions, UTI pairing and matching, validation rejections', 'Ops'),
    ('mifir', 'Mifir', 'MiFIR / UK MiFIR', 'file', 'MiFIR / UK MiFIR', 'ARM and NCA submissions, reportability decisions, field-level rejections', 'Ops'),
    ('sftrcftc', 'SftrCftc', 'SFTR & CFTC', 'swap', 'SFTR & CFTC', 'Securities financing reporting and US swap data reporting (Parts 43 and 45)', 'Ops'),
    ('exceptions', 'Exceptions', 'Exceptions', 'inbox', 'Exceptions workbench', 'Open breaks and rejections to repair, by owner, age and SLA', 'Ops'),
    ('rejections', 'Rejections', 'Rejection analytics', 'xcircle', 'Rejection analytics', 'Why reports fail, where they come from and how fast they are fixed', 'Ops'),
    ('completeness', 'Completeness', 'Completeness & recs', 'scale', 'Completeness & reconciliation', 'Front office population vs reported vs accepted: over-, under- and mis-reporting', 'Ops · Compliance'),
    ('pipeline', 'Pipeline', 'Pipeline health', 'activity', 'Pipeline health', 'Solace, Kafka, enrichment, MongoDB, S3 and regulator gateways', 'Tech'),
    ('dq', 'DataQuality', 'Data quality', 'database', 'Data quality & reference data', 'Critical data element quality, LEI/UPI/ISIN coverage and lineage', 'Tech · Ops'),
    ('controls', 'Controls', 'Controls & attestation', 'shield', 'Controls & attestation', 'Control testing, sign-offs, breach register and audit trail', 'Compliance'),
]

DAYS30 = [f'{d} {m}' for d, m in
          [(20, 'Oct'), (21, 'Oct'), (22, 'Oct'), (23, 'Oct'), (24, 'Oct'), (27, 'Oct'), (28, 'Oct'), (29, 'Oct'), (30, 'Oct'), (31, 'Oct'),
           (3, 'Nov'), (4, 'Nov'), (5, 'Nov'), (6, 'Nov'), (7, 'Nov'), (10, 'Nov'), (11, 'Nov'), (12, 'Nov'), (13, 'Nov'), (14, 'Nov'),
           (17, 'Nov'), (18, 'Nov')]]  # 22 business days


def href(sid):
    f = [s for s in SCREENS if s[0] == sid][0][1]
    return f'{f}.dc.html' if MODE['v'] == 'dc' else f'#{sid}'


def shell(active, body):
    sc = [s for s in SCREENS if s[0] == active][0]
    nav = []
    for sid, f, lab, ic, *_ in SCREENS:
        on = sid == active
        style = (f'display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:9px;font-size:13px;text-decoration:none;'
                 + (f'background:{NAVY};color:{WHITE};font-weight:600' if on else f'color:{INK2};font-weight:500'))
        cur = ' aria-current="page"' if on else ''
        nav.append(f'<a href="{href(sid)}" data-nav="{sid}"{cur} style="{style}">{icon(ic, 17)}<span>{esc(lab)}</span></a>')
        if sid == 'sftrcftc':
            nav.append(f'<div style="font-size:11px;color:{MUTED};font-weight:600;letter-spacing:0.06em;padding:14px 12px 4px">WORKFLOW</div>')
        if sid == 'completeness':
            nav.append(f'<div style="font-size:11px;color:{MUTED};font-weight:600;letter-spacing:0.06em;padding:14px 12px 4px">PLATFORM &amp; GOVERNANCE</div>')
    side = (f'<nav aria-label="Dashboards" style="flex:1 1 232px;max-width:100%;background:{WHITE};border-right:1px solid {LINE};padding:20px 14px;display:flex;flex-direction:column;gap:2px;box-sizing:border-box">'
            f'<div style="display:flex;align-items:center;gap:10px;padding:2px 10px 18px">'
            f'<span style="width:30px;height:30px;border-radius:8px;background:{NAVY};display:flex;align-items:center;justify-content:center">{icon("scale", 17, WHITE, 2)}</span>'
            f'<span style="display:flex;flex-direction:column;line-height:1.2"><span style="font-size:14px;font-weight:700;color:{NAVY};letter-spacing:-0.01em">RegOps</span>'
            f'<span style="font-size:11px;color:{MUTED}">Transaction reporting</span></span></div>'
            f'<div style="font-size:11px;color:{MUTED};font-weight:600;letter-spacing:0.06em;padding:4px 12px 4px">REGIMES</div>'
            + ''.join(nav) +
            f'<div style="margin-top:auto;padding:16px 12px 0;font-size:11.5px;color:{MUTED};line-height:1.5">Illustrative data only.<br>Last refresh 20:54 UTC</div>'
            '</nav>')

    def chip(label, ic='chev'):
        return (f'<button type="button" style="display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 12px;border:1px solid {LINE};'
                f'border-radius:9px;background:{WHITE};font:inherit;font-size:12.5px;color:{INK};cursor:pointer;white-space:nowrap">{label}{icon(ic, 14, MUTED)}</button>')
    if MODE['v'] == 'proto':
        regime_ctl = ('<label style="display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 10px;border:1px solid ' + LINE +
                      ';border-radius:9px;background:#fff;font-size:12.5px;color:' + INK2 + '">Regime'
                      '<select class="regime-filter" style="border:0;background:transparent;font:inherit;font-size:12.5px;color:' + INK + ';font-weight:600;outline:none;cursor:pointer">'
                      '<option value="">All</option>' + ''.join(f'<option value="{r}">{r}</option>' for r in REG) + '</select></label>')
    else:
        regime_ctl = chip(f'<span style="color:{INK2}">Regime</span> <b style="font-weight:600">All</b>')
    filters = (regime_ctl + chip(f'<span style="color:{INK2}">Entity</span> <b style="font-weight:600">All legal entities</b>')
               + chip(f'<span style="color:{INK2}">Period</span> <b style="font-weight:600">Last 30 business days</b>'))
    countdown = ('<span class="countdown">3h 05m</span>')
    top = (f'<header style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-end;gap:16px">'
           f'<div style="display:flex;flex-direction:column;gap:4px;min-width:0">'
           f'<div style="font-size:12px;color:{MUTED};font-weight:500">{esc(sc[6])} view</div>'
           f'<h1 style="margin:0;font-size:24px;font-weight:650;color:{INK};letter-spacing:-0.02em">{esc(sc[4])}</h1>'
           f'<p style="margin:0;font-size:13px;color:{INK2}">{esc(sc[5])}</p></div>'
           f'<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">'
           f'<span style="display:inline-flex;align-items:center;gap:7px;height:34px;padding:0 12px;border-radius:9px;background:{NAVY_T};color:{NAVY};font-size:12.5px;font-weight:600;white-space:nowrap">'
           f'{icon("clock", 15, NAVY, 2)}T+1 window closes in {countdown}</span>'
           f'<button type="button" aria-label="Search" style="width:34px;height:34px;border:1px solid {LINE};border-radius:9px;background:{WHITE};display:flex;align-items:center;justify-content:center;cursor:pointer">{icon("search", 16, INK2)}</button>'
           f'<button type="button" aria-label="Notifications" style="width:34px;height:34px;border:1px solid {LINE};border-radius:9px;background:{WHITE};display:flex;align-items:center;justify-content:center;cursor:pointer">{icon("bell", 16, INK2)}</button>'
           f'<span aria-label="Signed in user" style="width:34px;height:34px;border-radius:999px;background:{NAVY};color:{WHITE};font-size:12px;font-weight:600;display:flex;align-items:center;justify-content:center">YK</span>'
           '</div></header>'
           f'<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">{filters}'
           f'<span style="flex:1"></span>'
           f'<button type="button" style="display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 12px;border:1px solid {LINE};border-radius:9px;background:{WHITE};font:inherit;font-size:12.5px;color:{INK};cursor:pointer">{icon("download", 14, INK2)}Export</button></div>')
    main = (f'<main style="flex:999 1 560px;min-width:0;padding:24px 28px 40px;display:flex;flex-direction:column;gap:18px;box-sizing:border-box">'
            f'{top}{body}</main>')
    return (f'<div style="min-height:100%;background:{BG};display:flex;flex-wrap:wrap;align-items:stretch;font-family:{FONT};color:{INK};-webkit-font-smoothing:antialiased">'
            f'{side}{main}</div>')


# ======================= 1. COMMAND CENTRE =======================
DATA = {
    'MiFIR': dict(sub=1284610, acc=99.62, rej=4882, status=('good', 'On track')),
    'EMIR': dict(sub=642318, acc=98.91, rej=7001, status=('warning', 'At risk')),
    'SFTR': dict(sub=88402, acc=99.18, rej=725, status=('good', 'On track')),
    'CFTC': dict(sub=213577, acc=99.74, rej=555, status=('good', 'Submitted')),
}
TOTAL = sum(d['sub'] for d in DATA.values())
REJ = sum(d['rej'] for d in DATA.values())
ACC_SERIES = {
    'MiFIR': series(1, 22, 99.55, 0, 0.06, 99.3, 99.85, 99.62),
    'EMIR': series(2, 22, 98.6, 0.01, 0.12, 98.2, 99.3, 98.91),
    'SFTR': series(3, 22, 99.1, 0, 0.1, 98.7, 99.6, 99.18),
    'CFTC': series(4, 22, 99.7, 0, 0.05, 99.5, 99.9, 99.74),
}


def s_overview():
    acc_all = (TOTAL - REJ) / TOTAL * 100
    hero = (f'<section data-span="4" style="grid-column:span 4;min-width:0;background:{NAVY};border-radius:14px;padding:22px 24px;display:flex;flex-direction:column;gap:12px;color:{WHITE}">'
            f'<div style="display:flex;justify-content:space-between;align-items:center"><span style="font-size:12.5px;font-weight:500;color:#C9D6EE">Reports accepted by regulators</span>'
            f'<span style="display:inline-flex;align-items:center;gap:5px;padding:3px 10px 3px 7px;border-radius:999px;background:rgba(255,255,255,0.12);font-size:12px;font-weight:600">{icon("check", 13, "#7CD67C", 2.4)}Within appetite</span></div>'
            f'<div style="font-size:56px;font-weight:650;letter-spacing:-0.03em;line-height:1">{acc_all:.2f}%</div>'
            f'<div style="font-size:13px;color:#C9D6EE">{fmt_int(TOTAL-REJ)} of {fmt_int(TOTAL)} reports · appetite ≥ 99.00%</div>'
            f'<div style="display:flex;gap:2px;height:8px;margin-top:4px">'
            + ''.join(f'<div title="{r}: {fmt_int(DATA[r]["sub"])} reports" style="flex:{DATA[r]["sub"]} 1 0;background:{REG[r]};border-radius:999px"></div>' for r in REG) +
            '</div><div style="display:flex;flex-wrap:wrap;gap:4px 14px;font-size:11.5px;color:#C9D6EE">'
            + ''.join(f'<span style="display:inline-flex;align-items:center;gap:5px"><span style="width:8px;height:8px;border-radius:2px;background:{REG[r]}"></span>{r} {DATA[r]["sub"]/TOTAL*100:.0f}%</span>' for r in REG)
            + '</div></section>')
    tiles = []
    for r, d in DATA.items():
        tiles.append(
            f'<section data-span="2" data-regime="{r}" style="grid-column:span 2;min-width:0;background:{WHITE};border:1px solid {LINE};border-radius:14px;padding:18px 18px;display:flex;flex-direction:column;gap:10px">'
            f'<div style="display:flex;justify-content:space-between;align-items:center;gap:6px">{regtag(r)}{pill(d["status"][0], d["status"][1], True)}</div>'
            f'<div style="font-size:26px;font-weight:600;letter-spacing:-0.02em;line-height:1.1">{d["acc"]:.2f}%</div>'
            f'<div style="font-size:12px;color:{MUTED};line-height:1.6">{fmt_int(d["sub"])} submitted<br>{fmt_int(d["rej"])} rejected</div>'
            f'{sparkline(ACC_SERIES[r], REG[r], 200, 30)}</section>')
    row1 = grid(hero, *tiles)

    lc = line_chart([(r, REG[r], ACC_SERIES[r], r) for r in REG], DAYS30, 98.0, 100.0, [98.0, 98.5, 99.0, 99.5, 100.0],
                    lambda v: f'{v:.2f}' if v not in (98, 98.5, 99, 99.5, 100) else f'{v:.1f}%', unit='%', h=250, aria='Acceptance rate by regime, last 22 business days', w=670)
    accept = card('Acceptance rate by regime', legend([(REG_FULL[r], REG[r], r) for r in REG]) + lc, span=8,
                  sub='Share of submitted reports accepted by ARM, TR or SDR · last 22 business days',
                  right=pill('info', 'Appetite 99.00%', True))

    stages = [('Generated', NAVY), ('Validated', NAVY2), ('Submitted', '#5598e7'), ('Acknowledged', '#9ec5f4')]
    win = {'MiFIR': ([100, 100, 100, 100], 'Acknowledged 06:12', 'good'),
           'EMIR': ([100, 100, 82, 61], 'VALU batch pending · closes 23:59', 'warning'),
           'SFTR': ([100, 100, 100, 94], 'Awaiting TR feedback', 'info'),
           'CFTC': ([100, 100, 100, 100], 'Part 45 complete', 'good')}
    rows = []
    for r, (p, note, lvl) in win.items():
        bars = ''.join(f'<div title="{stages[i][0]}: {v}%" style="flex:1;display:flex;flex-direction:column;gap:4px">{progress(v, stages[i][1], "#EEF2F8", 6)}</div>' for i, v in enumerate(p))
        rows.append(f'<div data-regime="{r}" style="display:flex;flex-direction:column;gap:7px;padding:10px 0;border-bottom:1px solid {GRID}">'
                    f'<div style="display:flex;justify-content:space-between;align-items:center">{regtag(r)}<span style="font-size:12px;color:{ST[lvl][1]};font-weight:500">{esc(note)}</span></div>'
                    f'<div style="display:flex;gap:4px">{bars}</div></div>')
    stage_leg = legend([(s[0], s[1], None) for s in stages])
    window = card('Tonight\'s submission run', stage_leg + '<div>' + ''.join(rows) + '</div>', span=4, sub='Progress through each stage for T+1 deadline')

    att = [('critical', 'EMIR', '1,206 valuation reports (VALU) not yet submitted for 18 Nov', 'Late after 23:59 UTC · owner: Derivatives Ops', 'Exceptions'),
           ('serious', 'SFTR', 'Unpaired UTIs up 38% day on day, concentrated in one tri-party agent', '212 breaks · counterparty outreach started', 'Exceptions'),
           ('warning', 'MiFIR', '312 transactions with a lapsed client LEI in Buyer ID', 'Will be rejected by ARM at next submission', 'DataQuality'),
           ('warning', 'CFTC', 'Part 43 dissemination p95 latency at 11.2 s vs 10 s objective', 'Kafka partition rebalance at 18:40', 'Pipeline'),
           ('good', 'MiFIR', 'Solace backlog cleared; enrichment back within SLA at 19:42', 'No reports affected', 'Pipeline')]
    items = []
    for lvl, r, t, s, tgt in att:
        sid = [x[0] for x in SCREENS if x[1] == tgt][0]
        mark, txt, tint = ST[lvl]
        items.append(f'<a href="{href(sid)}" data-regime="{r}" style="display:flex;gap:12px;align-items:flex-start;padding:12px 4px;border-bottom:1px solid {GRID};text-decoration:none;color:inherit">'
                     f'<span style="width:30px;height:30px;border-radius:8px;background:{tint};display:flex;align-items:center;justify-content:center;flex:none">{icon(STATUS_ICON[lvl], 16, mark, 2.2)}</span>'
                     f'<span style="display:flex;flex-direction:column;gap:3px;flex:1;min-width:0"><span style="font-size:13px;font-weight:600;color:{INK}">{esc(t)}</span>'
                     f'<span style="font-size:12px;color:{MUTED};display:flex;gap:8px;flex-wrap:wrap">{regtag(r)}<span>{esc(s)}</span></span></span>'
                     f'{icon("arrowr", 16, "#94A3B8")}</a>')
    attention = card('Needs attention', '<div>' + ''.join(items) + '</div>', span=7, sub='Ranked by regulatory impact and time to deadline',
                     right=f'<a href="{href("exceptions")}" style="font-size:12.5px;font-weight:600;color:{NAVY2};text-decoration:none;white-space:nowrap">Open workbench</a>')

    age = [('0–1 days', SEQ[3]), ('2–5 days', SEQ[6]), ('6–10 days', SEQ[9]), ('Over 10 days', SEQ[12])]
    ag = {'MiFIR': [412, 198, 61, 22], 'EMIR': [388, 256, 74, 41], 'SFTR': [96, 71, 9, 3], 'CFTC': [142, 51, 12, 6]}
    sc = stacked_cols(list(ag), [(a[0], a[1], [ag[r][i] for r in ag]) for i, a in enumerate(age)], h=230, aria='Open exceptions by regime and age', w=426)
    ageing = card('Open exceptions by age', legend([(a[0], a[1], None) for a in age]) + sc, span=5,
                  sub='1,842 open · 228 older than 5 days')

    kp = grid(
        stat('Late reports, month to date', '37', sub='Across 4 regimes · under 0.001% of volume', d=delta('12 vs Oct', True, False), span=3, status=pill('good', 'Below threshold', True)),
        stat('Reportable breaches, year to date', '3', sub='All notified within 5 business days', span=3, status=pill('info', 'Notified', True)),
        stat('Key controls passing', '46 of 48', sub='1 failing · 1 not yet tested this cycle', span=3, status=pill('warning', '2 to review', True)),
        stat('Q4 attestations signed', '82%', sub='4 of 22 outstanding · due 15 Dec', span=3, spark=progress(82)),
    )
    return shell('overview', row1 + grid(accept, window) + grid(attention, ageing) + kp)


# ======================= 2. EMIR REFIT =======================
def s_emir():
    pair = series(11, 22, 96.4, 0.02, 0.25, 95.5, 97.6, 96.9)
    match = series(12, 22, 93.2, 0.05, 0.35, 92.0, 95.2, 94.2)
    tiles = grid(
        stat('Reports submitted', '642,318', sub='T+1 for 18 Nov · 2 TRs', regime='EMIR', d=delta('3.2% d/d', True, True), span=3,
             spark=sparkline(series(13, 22, 610000, 1500, 18000, end=642318), REG['EMIR'], 220, 30)),
        stat('TR acceptance', '98.91%', sub='7,001 rejected · appetite 99.00%', span=3, status=pill('warning', 'Below appetite', True),
             spark=sparkline(ACC_SERIES['EMIR'], REG['EMIR'], 220, 30)),
        stat('UTI pairing rate', '96.9%', sub='Both sides reported the same UTI', d=delta('0.4 pp w/w', True, True), span=3,
             spark=sparkline(pair, NAVY2, 220, 30)),
        stat('Matching rate', '94.2%', sub='Paired and all reconcilable fields agree', d=delta('0.6 pp w/w', True, True), span=3,
             spark=sparkline(match, NAVY2, 220, 30)),
    )
    rec = card('Reconciliation status of reportable trades', segbar([
        ('Paired and matched', 94.2, NAVY), ('Paired, unmatched', 2.7, '#5598e7'), ('Unpaired', 3.1, '#ec835a')]) +
        f'<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;font-size:12px;color:{MUTED}">'
        f'<div><b style="display:block;font-size:18px;color:{INK};font-weight:600">605,064</b>Paired and matched</div>'
        f'<div><b style="display:block;font-size:18px;color:{INK};font-weight:600">17,343</b>Paired, unmatched</div>'
        f'<div><b style="display:block;font-size:18px;color:{INK};font-weight:600">19,911</b>Unpaired</div></div>',
        span=6, sub='Inter-TR and intra-TR reconciliation feedback for 18 Nov')
    lc = line_chart([('Pairing', NAVY2, pair, None), ('Matching', '#eb6834', match, None)], DAYS30, 90, 100, [90, 92, 94, 96, 98, 100],
                    lambda v: f'{v:.1f}%' if v % 2 else f'{v:.0f}%', h=200, aria='Pairing and matching rates', w=524)
    trend = card('Pairing and matching trend', legend([('Pairing rate', NAVY2, None), ('Matching rate', '#eb6834', None)]) + lc, span=6, sub='Last 22 business days')

    fields = [('Valuation amount', 4812), ('Notional amount (leg 1)', 3206), ('Collateral portfolio code', 1944), ('Expiration date', 1207),
              ('Price', 986), ('Execution timestamp', 742), ('Clearing obligation', 455)]
    fb = card('Top unmatched fields', hbars(fields, total=17343, label_w='46%'), span=4, sub='Breaks on paired trades · one trade can break on several fields')

    rules = [('Counterparty LEI not issued or lapsed', 2104, 'Reference data', 'warning'),
             ('UPI not recognised by ANNA DSB', 1388, 'Product data', 'warning'),
             ('Collateral portfolio code missing', 1107, 'Booking', 'serious'),
             ('Valuation timestamp after reporting timestamp', 864, 'Pipeline', 'serious'),
             ('Action type / event type combination invalid', 731, 'Rules engine', 'warning'),
             ('Notional currency not ISO 4217', 402, 'Booking', 'neutral'),
             ('Other (19 rules)', 405, 'Mixed', 'neutral')]
    rows = [[esc(a), f'<span style="color:{INK2}">{esc(c)}</span>', fmt_int(b), f'{b/7001*100:.1f}%', pill(l, {'warning': 'Fix in progress', 'serious': 'Escalated', 'neutral': 'Monitoring'}[l], True)] for a, b, c, l in rules]
    rt = card('Rejections by validation rule', table(['Validation rule', 'Root cause area', 'Rejected', 'Share', 'Status'], rows,
                                                    ['left', 'left', 'right', 'right', 'left'], sortable=True, compact=True), span=8,
              sub='7,001 reports rejected by trade repositories on 18 Nov')

    acts = [('VALU', 402118), ('NEWT', 118420), ('MODI', 61005), ('COLU', 38964), ('ETRM', 12330), ('MARU', 4211), ('CORR', 3102), ('POSC', 1000), ('EROR', 812), ('REVI', 356)]
    names = {'VALU': 'Valuation', 'NEWT': 'New', 'MODI': 'Modify', 'COLU': 'Collateral update', 'ETRM': 'Early termination', 'MARU': 'Margin update',
             'CORR': 'Correct', 'POSC': 'Position component', 'EROR': 'Error', 'REVI': 'Revive'}
    ab = card('Reports by action type', hbars([(f'{a} · {names[a]}', v) for a, v in acts], total=642318, label_w='48%'), span=6, sub='642,318 reports on 18 Nov')
    ac = card('Mix by asset class', segbar([('Interest rates', 48, NAVY), ('FX', 27, NAVY2), ('Credit', 11, '#5598e7'), ('Equity', 9, '#86b6ef'), ('Commodity', 5, '#b7d3f6')]) +
              f'<div style="display:flex;flex-direction:column;gap:10px;margin-top:6px">'
              + ''.join(f'<div style="display:flex;justify-content:space-between;font-size:12.5px;padding-bottom:8px;border-bottom:1px solid {GRID}"><span style="color:{INK2}">{a}</span><span style="font-weight:600;font-variant-numeric:tabular-nums">{b}</span></div>'
                        for a, b in [('Valuations reported on time (T+1)', '99.81%'), ('Margin updates reported on time', '99.64%'), ('Reports to DTCC GTR (EU)', '412,906'), ('Reports to Regis-TR', '229,412')])
              + '</div>', span=6, sub='Share of outstanding reportable trades')
    return shell('emir', tiles + grid(rec, trend) + grid(fb, rt) + grid(ab, ac))


# ======================= 3. MIFIR =======================
def s_mifir():
    tiles = grid(
        stat('Reportable transactions', '1,284,610', sub='T+1 for 18 Nov · FCA and 3 EU NCAs', regime='MiFIR', d=delta('1.8% d/d', True, True), span=3,
             spark=sparkline(series(21, 22, 1210000, 2500, 40000, end=1284610), REG['MiFIR'], 220, 30)),
        stat('Overall acceptance', '99.62%', sub='4,882 rejected · appetite 99.50%', span=3, status=pill('good', 'Within appetite', True),
             spark=sparkline(ACC_SERIES['MiFIR'], REG['MiFIR'], 220, 30)),
        stat('ARM rejections', '3,104', sub='Caught at ARM validation', d=delta('9% d/d', True, False), span=3),
        stat('NCA rejections', '1,778', sub='Returned by FCA, BaFin, AMF, CBI', d=delta('4% d/d', False, True), span=3, status=pill('warning', 'Rising', True)),
    )
    funnel = [('Trades booked in scope systems', 1412906, '#86b6ef'), ('Out of scope (non-ToTV, exempt)', 128296, '#CBD5E1'),
              ('Reportable', 1284610, NAVY2), ('Accepted by ARM', 1281506, NAVY), ('Accepted by NCA', 1279728, NAVY)]
    fn = card('Reportability funnel', hbars([(a, b, c) for a, b, c in funnel], label_w='52%'), span=5, sub='From front-office bookings to regulator acceptance, 18 Nov')
    fields = [('Buyer identification code', 1262), ('Instrument identification code', 914), ('Investment decision within firm', 688),
              ('Execution within firm', 571), ('Venue', 503), ('Price', 432), ('Short selling indicator', 287), ('Other fields', 225)]
    fr = card('Rejections by field', hbars(fields, total=4882, label_w='50%', color=REG['MiFIR']), span=7, sub='4,882 rejected reports on 18 Nov, by the first field that failed validation')

    desks = ['Rates', 'Credit', 'Equities cash', 'Equity derivatives', 'FX', 'Prime services']
    cols = ['Buyer ID', 'Seller ID', 'Instrument', 'Price', 'Quantity', 'Venue', 'Inv. decision', 'Execution']
    rnd = random.Random(7)
    m = [[round(max(0.2, rnd.gauss(4, 3)), 1) for _ in cols] for _ in desks]
    m[2][0] = 31.4; m[2][6] = 22.8; m[5][0] = 18.9; m[3][2] = 16.2; m[1][3] = 12.7; m[4][5] = 9.6
    hm = card('Rejection rate by desk and field', heatmap(desks, cols, m, fmt=lambda v: f'{v:.1f}', label_w=130, aria='Rejection rate in basis points by desk and field'),
              span=8, sub='Basis points of each desk\'s reportable volume · hover a cell for detail')

    codes = [('CON-411', 'Buyer LEI not valid on trading date', '1,104', 'Client onboarding'),
             ('INS-201', 'ISIN not in FIRDS for trading venue', '812', 'Product control'),
             ('CON-471', 'Decision maker national ID missing', '603', 'Equities Ops'),
             ('TRD-104', 'Venue MIC not valid for instrument', '488', 'Rates Ops'),
             ('TRD-122', 'Price notation inconsistent with price', '397', 'Credit Ops')]
    ct = card('Top rejection codes', table(['Code', 'Description', 'Count', 'Owner'], [[f'<span style="font-family:ui-monospace,Menlo,monospace;white-space:nowrap;font-size:12px;color:{NAVY2}">{a}</span>', esc(b), c, f'<span style="color:{INK2}">{esc(d)}</span>'] for a, b, c, d in codes],
                                           ['left', 'left', 'right', 'left'], compact=True), span=4, sub='Illustrative code set')
    nca = card('Submissions by competent authority', hbars([('FCA (UK MiFIR)', 802114, NAVY), ('BaFin', 231870, NAVY2), ('AMF', 151339, '#5598e7'), ('Central Bank of Ireland', 99287, '#86b6ef')], total=1284610, label_w='44%'), span=6,
               sub='Routed via one ARM per jurisdiction')
    nr = series(22, 22, 0.12, 0.002, 0.03, 0.05, 0.3, 0.14)
    ar = series(23, 22, 0.28, -0.002, 0.04, 0.12, 0.45, 0.24)
    lc = line_chart([('ARM', NAVY2, ar, None), ('NCA', '#eb6834', nr, None)], DAYS30, 0, 0.5, [0, 0.1, 0.2, 0.3, 0.4, 0.5], lambda v: f'{v:.2f}%', h=190, aria='Rejection rate by layer', w=524)
    rr = card('Rejection rate by layer', legend([('ARM rejection rate', NAVY2, None), ('NCA rejection rate', '#eb6834', None)]) + lc, span=6, sub='Last 22 business days')
    return shell('mifir', tiles + grid(fn, fr) + grid(hm, ct) + grid(nca, rr))


# ======================= 4. SFTR & CFTC =======================
def s_sftrcftc():
    sec = lambda r, t: (f'<div data-span="12" style="grid-column:span 12;display:flex;align-items:center;gap:10px;margin-top:4px">'
                        f'<span style="width:10px;height:10px;border-radius:3px;background:{REG[r]}"></span>'
                        f'<h2 style="margin:0;font-size:15px;font-weight:600">{esc(t)}</h2></div>')
    s_match = series(31, 22, 92.4, -0.02, 0.5, 90, 94, 91.6)
    sftr = grid(
        sec('SFTR', 'SFTR · securities financing transactions'),
        stat('Reports submitted', '88,402', sub='T+1 for 18 Nov', regime='SFTR', span=3, spark=sparkline(series(32, 22, 86000, 80, 2500, end=88402), REG['SFTR'], 220, 30)),
        stat('TR acceptance', '99.18%', sub='725 rejected', span=3, status=pill('good', 'Within appetite', True), spark=sparkline(ACC_SERIES['SFTR'], REG['SFTR'], 220, 30)),
        stat('Matching rate', '91.6%', sub='Down 0.9 pp week on week', d=delta('0.9 pp', False, False), span=3, status=pill('serious', 'Watch', True), spark=sparkline(s_match, NAVY2, 220, 30)),
        stat('Collateral reuse reports', '100%', sub='Reported on time · 412 reports', span=3, status=pill('good', 'Complete', True)),
        card('Volume by SFT type', segbar([('Repo', 52, NAVY), ('Securities lending', 31, NAVY2), ('Buy-sell back', 12, '#5598e7'), ('Margin lending', 5, '#9ec5f4')]), span=5, sub='Share of reports, 18 Nov'),
        card('Top unmatched fields', hbars([('Collateral quality', 812), ('Haircut or margin', 604), ('Maturity date', 433), ('Principal amount', 391), ('Collateral ISIN', 255)], color=REG['SFTR'], label_w='42%'), span=7,
             sub='Paired SFTs with breaks, 18 Nov'),
    )
    lat = series(41, 22, 7.5, 0.12, 0.9, 5, 12, 11.2)
    cftc = grid(
        sec('CFTC', 'CFTC · swap data reporting'),
        stat('Part 45 messages', '213,577', sub='Creation, continuation and valuation data', regime='CFTC', span=3, spark=sparkline(series(42, 22, 205000, 300, 6000, end=213577), REG['CFTC'], 220, 30)),
        stat('SDR acceptance', '99.74%', sub='555 rejected (NACK)', span=3, status=pill('good', 'Within appetite', True), spark=sparkline(ACC_SERIES['CFTC'], REG['CFTC'], 220, 30)),
        stat('Part 43 real-time messages', '96,204', sub='Publicly disseminated swaps', span=3),
        stat('Dissemination latency, p95', '11.2 s', sub='Objective 10 s · ASATP obligation', span=3, status=pill('warning', 'Above objective', True)),
        card('Part 43 dissemination latency, p95', line_chart([('p95 latency', REG['CFTC'], lat, 'CFTC')], DAYS30, 0, 14, [0, 2, 4, 6, 8, 10, 12, 14], lambda v: f'{v:.1f}' if v % 2 else f'{v:.0f}s', unit=' s', h=200, label_w=110, area=True, aria='Part 43 p95 latency', w=589),
             span=7, sub='Seconds from execution to SDR acknowledgement · objective 10 s', right=pill('warning', 'Breached objective 3 of last 5 days', True)),
        card('Part 45 by SDR and asset class', table(['Asset class', 'DDR', 'ICE Trade Vault', 'Total'],
             [[a, fmt_int(b), fmt_int(c), f'<b style="font-weight:600">{fmt_int(b+c)}</b>'] for a, b, c in
              [('Interest rates', 98412, 21330), ('Credit', 24806, 11204), ('FX', 31277, 6418), ('Equity', 7823, 0), ('Commodity', 0, 12307)]] +
             [[f'<b style="font-weight:600">Total</b>', '<b style="font-weight:600">162,318</b>', '<b style="font-weight:600">51,259</b>', '<b style="font-weight:600">213,577</b>']],
             ['left', 'right', 'right', 'right'], compact=True), span=5, sub='Messages on 18 Nov'),
    )
    return shell('sftrcftc', sftr + cftc)


# ======================= 5. EXCEPTIONS =======================
EXC = [
    ('EX-48211', 'EMIR', 'Missing valuation', 'Rates', '0d', ('critical', '3h 05m'), 'Priya S.', 'In progress', 'breach mine'),
    ('EX-48207', 'EMIR', 'TR rejection · LEI lapsed', 'Credit', '0d', ('critical', '3h 05m'), 'Unassigned', 'New', 'breach unassigned'),
    ('EX-48163', 'SFTR', 'Unpaired UTI', 'Prime services', '1d', ('serious', '1 day'), 'Tom R.', 'Awaiting counterparty', 'breach'),
    ('EX-48102', 'MiFIR', 'NCA rejection · CON-471', 'Equities cash', '1d', ('serious', '1 day'), 'Yogesh K.', 'In progress', 'mine'),
    ('EX-47986', 'MiFIR', 'Under-reported trade', 'Equity derivatives', '3d', ('warning', '2 days'), 'Ana M.', 'Root cause found', ''),
    ('EX-47911', 'CFTC', 'SDR NACK · UPI', 'Rates', '3d', ('warning', '2 days'), 'Unassigned', 'New', 'unassigned'),
    ('EX-47855', 'EMIR', 'Unmatched · notional', 'FX', '4d', ('warning', '1 day'), 'Wei L.', 'Awaiting FO', ''),
    ('EX-47640', 'SFTR', 'Collateral ISIN invalid', 'Prime services', '6d', ('serious', 'Overdue 1d'), 'Tom R.', 'In progress', 'aged'),
    ('EX-47518', 'MiFIR', 'Over-reported trade', 'Credit', '7d', ('serious', 'Overdue 2d'), 'Yogesh K.', 'Ready to cancel', 'aged mine'),
    ('EX-47302', 'EMIR', 'Unmatched · collateral code', 'Rates', '9d', ('critical', 'Overdue 4d'), 'Priya S.', 'Escalated', 'aged mine'),
    ('EX-46977', 'CFTC', 'Late Part 45 continuation', 'Commodities', '12d', ('critical', 'Overdue 7d'), 'Ana M.', 'Breach review', 'aged'),
    ('EX-46815', 'MiFIR', 'Instrument not in FIRDS', 'Equities cash', '14d', ('serious', 'Overdue 9d'), 'Unassigned', 'New', 'aged unassigned'),
]


def s_exceptions():
    views = [('all', 'All open', '1,842'), ('mine', 'My queue', '46'), ('breach', 'Breaching today', '128'), ('aged', 'Older than 5 days', '228'), ('unassigned', 'Unassigned', '311')]
    vb = '<div role="tablist" style="display:flex;flex-wrap:wrap;gap:6px">' + ''.join(
        f'<button type="button" role="tab" data-view="{k}" aria-selected="{"true" if k=="all" else "false"}" style="display:inline-flex;align-items:center;gap:8px;height:34px;padding:0 12px;border-radius:9px;font:inherit;font-size:12.5px;cursor:pointer;'
        + (f'background:{NAVY};color:{WHITE};border:1px solid {NAVY};font-weight:600' if k == 'all' else f'background:{WHITE};color:{INK};border:1px solid {LINE};font-weight:500')
        + f'">{esc(lab)}<span style="font-size:11.5px;padding:1px 7px;border-radius:999px;background:{"rgba(255,255,255,0.18)" if k=="all" else "#F1F5F9"};font-weight:600">{n}</span></button>'
        for k, lab, n in views) + '</div>'
    stcol = {'New': 'neutral', 'In progress': 'info', 'Escalated': 'critical', 'Breach review': 'critical', 'Awaiting counterparty': 'warning', 'Awaiting FO': 'warning',
             'Root cause found': 'info', 'Ready to cancel': 'good'}
    rows, attrs = [], []
    for e in EXC:
        lvl, sla = e[5]
        owner = f'<span style="color:{MUTED};font-style:italic">Unassigned</span>' if e[6] == 'Unassigned' else (
            f'<span style="display:inline-flex;align-items:center;gap:7px"><span style="width:22px;height:22px;border-radius:999px;background:{NAVY_T};color:{NAVY};font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center">{"".join(w[0] for w in e[6].split())}</span>{esc(e[6])}</span>')
        rows.append([f'<span style="font-family:ui-monospace,Menlo,monospace;white-space:nowrap;font-size:12px;color:{NAVY2};font-weight:500">{e[0]}</span>', regtag(e[1]), esc(e[2]),
                     f'<span style="color:{INK2}">{esc(e[3])}</span>', e[4], pill(lvl, sla, True), owner,
                     f'<span style="font-size:12px;color:{ST[stcol[e[7]]][1]};font-weight:500">{esc(e[7])}</span>'])
        attrs.append(f'data-tags="all {e[8]}" data-regime="{e[1]}"')
    tb = card('Queue', vb + table(['ID', 'Regime', 'Type', 'Desk', 'Age', 'SLA', 'Owner', 'Status'], rows,
                                  ['left', 'left', 'left', 'left', 'right', 'left', 'left', 'left'], row_attrs=attrs, sortable=True, compact=True),
              span=12, sub='Showing 12 of 1,842 · sorted by SLA risk', right=f'<button type="button" style="height:34px;padding:0 14px;border-radius:9px;border:0;background:{NAVY};color:{WHITE};font:inherit;font-size:12.5px;font-weight:600;cursor:pointer">Bulk assign</button>')
    opened = [142, 168, 151, 133, 177, 160, 149, 171, 182, 158, 139, 164, 188, 196]
    closed = [151, 160, 157, 149, 166, 171, 158, 162, 170, 169, 141, 145, 162, 171]
    d14 = ['5 Nov', '6 Nov', '7 Nov', '8 Nov', '9 Nov', '10 Nov', '11 Nov', '12 Nov', '13 Nov', '14 Nov', '15 Nov', '16 Nov', '17 Nov', '18 Nov']
    flow = card('Opened vs closed per day', legend([('Opened', '#eb6834', None), ('Closed', NAVY2, None)]) +
                line_chart([('Opened', '#eb6834', opened, None), ('Closed', NAVY2, closed, None)], d14, 100, 220, [100, 140, 180, 220], lambda v: f'{v:.0f}', h=200, label_w=90, aria='Exceptions opened and closed', w=426),
                span=5, sub='Last 14 days · net +46 over the period')
    rc = card('Root cause of open exceptions', hbars([('Reference data (LEI, UPI, ISIN)', 34), ('Booking or static error', 22), ('Upstream feed delay', 17), ('Validation rule change', 11), ('Counterparty data', 10), ('Other', 6)],
                                                     fmt=lambda v: f'{v}%', label_w='50%'), span=4, sub='Share of 1,842 open items')
    team = [('Priya S.', 58, 9), ('Tom R.', 51, 6), ('Yogesh K.', 46, 4), ('Ana M.', 44, 7), ('Wei L.', 39, 2)]
    tw = ''.join(f'<div style="display:flex;flex-direction:column;gap:5px"><div style="display:flex;justify-content:space-between;font-size:12.5px"><span style="color:{INK2}">{n}</span>'
                 f'<span style="font-weight:600">{a} <span style="color:{ST["critical"][1]};font-weight:500">· {o} overdue</span></span></div>{progress(a/60*100, NAVY2, "#EEF2F8", 6)}</div>' for n, a, o in team)
    tm = card('Team workload', f'<div style="display:flex;flex-direction:column;gap:12px">{tw}</div>', span=3, sub='Assigned items per analyst')
    return shell('exceptions', grid(
        stat('Open exceptions', '1,842', sub='Across 4 regimes', d=delta('46 over 14 days', False, True), span=3),
        stat('Breaching SLA today', '128', sub='Must be resolved before 23:59 UTC', span=3, status=pill('critical', 'Act now', True)),
        stat('Median time to resolve', '1.6 days', sub='Target 2 days', d=delta('0.3 days', True, False), span=3),
        stat('First-time fix rate', '87%', sub='Resubmissions accepted first time', d=delta('2 pp', True, True), span=3),
    ) + grid(tb) + grid(flow, rc, tm))


# ======================= 6. REJECTIONS =======================
def s_rejections():
    par = [('Counterparty LEI invalid or lapsed', 3790), ('Instrument / UPI not recognised', 2614), ('Collateral data missing', 1855), ('Decision maker / trader ID', 1291),
           ('Timestamp sequencing', 1128), ('Action or event type invalid', 951), ('Venue / MIC invalid', 733), ('Price or notional format', 589), ('Other', 212)]
    tot = sum(v for _, v in par)  # 13,163
    cum = 0; rows = []
    for a, v in par:
        cum += v
        rows.append([esc(a), f'<div style="display:flex;align-items:center;gap:8px;min-width:140px"><span style="height:10px;width:{v/par[0][1]*100:.0f}%;max-width:120px;background:{NAVY2};border-radius:0 4px 4px 0"></span></div>',
                     fmt_int(v), f'{v/tot*100:.1f}%', f'<b style="font-weight:600;color:{NAVY if cum/tot<=0.81 else MUTED}">{cum/tot*100:.0f}%</b>'])
    pr = card('Rejection Pareto', table(['Reason', '', 'Rejected', 'Share', 'Cumulative'], rows, ['left', 'left', 'right', 'right', 'right'], compact=True), span=7,
              sub=f'{fmt_int(tot)} rejections on 18 Nov · top 4 reasons drive 72%', right=pill('info', 'Fix top 4 → acceptance 99.84%', True))
    d90 = [f'W{w}' for w in range(34, 47)]
    ser = {'MiFIR': series(51, 13, 0.55, -0.01, 0.05, 0.3, 0.8, 0.38), 'EMIR': series(52, 13, 1.6, -0.04, 0.12, 0.9, 2.2, 1.09),
           'SFTR': series(53, 13, 1.1, -0.02, 0.1, 0.6, 1.5, 0.82), 'CFTC': series(54, 13, 0.4, -0.01, 0.05, 0.15, 0.6, 0.26)}
    tr = card('Rejection rate by regime', legend([(REG_FULL[r], REG[r], r) for r in REG]) +
              line_chart([(r, REG[r], ser[r], r) for r in REG], d90, 0, 2.5, [0, 0.5, 1.0, 1.5, 2.0, 2.5], lambda v: f'{v:.2f}%', h=230, aria='Weekly rejection rate by regime', w=426),
              span=5, sub='Weekly average · last 13 weeks')
    src = card('Rejections by source system', hbars([('Murex', 4512), ('Calypso', 3104), ('Atlas OMS (equities)', 2617), ('Summit', 1388), ('Collateral manager', 1129), ('Manual adjustments', 413)], total=tot, label_w='44%'),
               span=6, sub='Where the failing data originated')
    res = card('What happens to rejections', segbar([('Fixed and resubmitted', 71, NAVY), ('Repair in progress', 18, '#5598e7'), ('Awaiting front office', 8, '#fab219'), ('Not reportable, closed', 3, '#94A3B8')]) +
               f'<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin-top:6px">'
               + ''.join(f'<div style="display:flex;flex-direction:column;gap:2px"><span style="font-size:20px;font-weight:600">{a}</span><span style="font-size:12px;color:{MUTED}">{b}</span></div>'
                         for a, b in [('5.4 h', 'Median time to resubmit'), ('87%', 'Accepted on first resubmission'), ('2.1%', 'Rejected more than twice'), ('£0', 'Fines this year from repeat rejections')])
               + '</div>', span=6, sub='Outcome of rejections raised in the last 30 days')
    rep = card('Repeat offenders', table(['Rule', 'Days seen', 'Fix', 'ETA'],
               [[esc(a), b, esc(c), pill(d, e, True)] for a, b, c, d, e in [
                   ('LEI lapsed on client', '22 of 22', 'Auto-block at onboarding', 'warning', '12 Dec'),
                   ('UPI not recognised', '19 of 22', 'DSB lookup at booking', 'info', '5 Dec'),
                   ('Collateral code missing', '15 of 22', 'Default from CSA', 'good', 'Deployed'),
                   ('Decision maker ID', '11 of 22', 'HR feed mapping', 'serious', 'Unplanned')]],
               ['left', 'right', 'left', 'left'], compact=True), span=12, sub='Same rule failing on many days')
    return shell('rejections', grid(pr, tr) + grid(src, res) + grid(rep))


# ======================= 7. COMPLETENESS =======================
def s_completeness():
    rec = [('MiFIR', 1284830, 1284610, 1279728, 21, 241, 498), ('EMIR', 642497, 642318, 635317, 64, 243, 352),
           ('SFTR', 88431, 88402, 87677, 18, 47, 131), ('CFTC', 213600, 213577, 213022, 35, 58, 86)]
    rows = []
    for r, fo, rep, acc, over, under, mis in rec:
        comp = (rep - over - mis) / fo * 100
        rows.append([regtag(r), fmt_int(fo), fmt_int(rep), fmt_int(acc), fmt_int(over), fmt_int(under), fmt_int(mis),
                     f'<b style="font-weight:600">{comp:.3f}%</b>'])
    T = [sum(x[i] for x in rec) for i in range(1, 7)]
    rows.append(['<b style="font-weight:600">Total</b>'] + [f'<b style="font-weight:600">{fmt_int(v)}</b>' for v in T] + [f'<b style="font-weight:600">{(T[1]-T[3]-T[5])/T[0]*100:.3f}%</b>'])
    tb = card('Three-way reconciliation', table(['Regime', 'Front-office eligible', 'Reported', 'Accepted', 'Over-reported', 'Under-reported', 'Mis-reported', 'Completeness'], rows,
                                               ['left'] + ['right'] * 7, row_attrs=[f'data-regime="{x[0]}"' for x in rec] + [''], compact=True),
              span=12, sub='Front office → reporting engine → regulator, business date 18 Nov · completeness = correctly reported ÷ eligible')
    flow_steps = [('Front office bookings', '2,229,358', 'Murex, Calypso, Summit, Atlas OMS'), ('Reporting engine', '2,228,907', 'Eligibility rules and enrichment'),
                  ('Submitted', '2,228,907', 'ARM · TR · SDR'), ('Accepted', '2,215,744', '99.41% of submitted')]
    fl = '<div style="display:flex;flex-wrap:wrap;align-items:stretch;gap:8px">'
    for i, (a, b, c) in enumerate(flow_steps):
        fl += (f'<div style="flex:1 1 100px;min-width:0;border:1px solid {LINE};border-radius:12px;padding:12px;display:flex;flex-direction:column;gap:4px;background:{"#F8FAFD" if i else WHITE}">'
               f'<span style="font-size:12px;color:{MUTED}">{a}</span><span style="font-size:18px;font-weight:600;letter-spacing:-0.01em">{b}</span><span style="font-size:11.5px;color:{INK2}">{c}</span></div>')
        if i < 3:
            fl += f'<div style="display:flex;align-items:center">{icon("arrowr", 18, "#94A3B8")}</div>'
    fl += '</div>'
    gaps = [('Eligible but not reported', '589', 'Under-reporting risk', 'serious'), ('Rejected by regulator', '13,163', 'Being repaired', 'warning'), ('Reported but not in front office', '138', 'Over-reporting · cancel', 'warning')]
    fl += f'<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px">' + ''.join(
        f'<div style="display:flex;flex-direction:column;gap:6px;padding:12px;border-radius:10px;background:{ST[l][2]}"><span style="font-size:12px;color:{ST[l][1]};font-weight:600">{a}</span>'
        f'<span style="font-size:18px;font-weight:600">{b}</span><span style="font-size:11.5px;color:{INK2}">{c}</span></div>' for a, b, c, l in gaps) + '</div>'
    flow = card('Population flow, 18 Nov', fl, span=7, sub='Where reportable trades drop out between booking and acceptance')
    cs = {r: series(60 + i, 22, 99.93, 0.001, 0.015, 99.70, 99.995, [99.942, 99.907, 99.799, 99.933][i]) for i, r in enumerate(REG)}
    lc = card('Completeness trend', legend([(REG_FULL[r], REG[r], r) for r in REG]) +
              line_chart([(r, REG[r], cs[r], r) for r in REG], DAYS30, 99.70, 100.0, [99.70, 99.80, 99.90, 100.0], lambda v: f'{v:.2f}%', h=220, aria='Completeness by regime', w=426),
              span=5, sub='Correctly reported ÷ eligible · last 22 business days')
    proj = [('EMIR Refit back-reporting of outstanding trades', 99.2, 'good', 'Closing'), ('MiFIR LEI remediation (client static)', 64, 'warning', 'Behind plan'),
            ('SFTR collateral reuse look-back', 88, 'info', 'On plan'), ('CFTC historical UPI uplift', 41, 'serious', 'At risk')]
    pj = ''.join(f'<div style="display:flex;flex-direction:column;gap:7px;padding:10px 0;border-bottom:1px solid {GRID}"><div style="display:flex;justify-content:space-between;gap:10px;font-size:12.5px">'
                 f'<span style="color:{INK};font-weight:500">{a}</span>{pill(l, s, True)}</div><div style="display:flex;align-items:center;gap:10px">{progress(v, NAVY2, "#EEF2F8", 6)}'
                 f'<span style="font-size:12px;font-weight:600;min-width:42px;text-align:right">{v:g}%</span></div></div>' for a, v, l, s in proj)
    pjc = card('Remediation programmes', f'<div>{pj}</div>', span=6, sub='Back-reporting and fix-forward work')
    br = card('Trade-state reconciliation breaks', hbars([('Open at TR, closed internally', 1204), ('Open internally, missing at TR', 451), ('Lifecycle state differs', 388), ('Valuation stale > 1 day', 276), ('Duplicate UTI at TR', 61)], label_w='50%', color=REG['EMIR']),
              span=6, sub='EMIR and SFTR trade-state reports vs internal positions')
    return shell('completeness', grid(
        stat('Completeness', '99.93%', sub='Correctly reported ÷ front-office eligible', span=3, status=pill('good', 'Within appetite', True)),
        stat('Under-reported', '589', sub='Eligible trades not sent to a regulator', d=delta('64 d/d', True, False), span=3),
        stat('Over-reported', '138', sub='Reported trades not reportable', span=3, status=pill('warning', 'Cancel pending', True)),
        stat('Mis-reported', '1,067', sub='Accepted with a field error found later', span=3, status=pill('serious', 'Correct by 25 Nov', True)),
    ) + grid(tb) + grid(flow, lc) + grid(pjc, br))


# ======================= 8. PIPELINE =======================
def s_pipeline():
    comps = [('Solace trade capture', 'good', '2.1k msg/s', 'Queue depth 312'), ('Kafka enrichment topics', 'warning', 'Lag 41k', 'Rebalanced 18:40'),
             ('Enrichment service', 'good', 'p95 84 ms', '12 of 12 pods'), ('Rules engine', 'good', 'p95 22 ms', '1,412 rules live'),
             ('MongoDB reporting store', 'good', '71% disk', 'Replica lag 0.4 s'), ('S3 submission archive', 'good', '4.2 TB', 'Object lock on'),
             ('ARM gateway (SFTP)', 'good', 'Last ack 06:12', '4 of 4 ARMs'), ('TR / SDR gateways', 'warning', '1 retrying', 'Regis-TR slow ack')]
    cc = ''.join(f'<div style="border:1px solid {LINE};border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:8px;background:{WHITE}">'
                 f'<div style="display:flex;justify-content:space-between;align-items:center;gap:6px"><span style="font-size:12.5px;font-weight:600">{a}</span>'
                 f'<span title="{ {"good":"Healthy","warning":"Degraded"}[s] }" style="width:9px;height:9px;border-radius:999px;background:{ST[s][0]};box-shadow:0 0 0 3px {ST[s][2]}"></span></div>'
                 f'<span style="font-size:18px;font-weight:600;letter-spacing:-0.01em">{b}</span><span style="font-size:11.5px;color:{MUTED}">{c}</span></div>' for a, s, b, c in comps)
    topo = card('Components', f'<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px">{cc}</div>', span=12,
                sub='Trade capture to regulator, live', right=f'<span style="display:flex;gap:8px">{pill("good", "6 healthy", True)}{pill("warning", "2 degraded", True)}</span>')
    hrs = [f'{h:02d}:00' for h in range(21, 24)] + [f'{h:02d}:00' for h in range(0, 21)]
    p50 = series(71, 24, 3.2, 0, 0.5, 2, 5)
    p95 = [v * 2.4 + (6 if 15 <= i <= 17 else 0) for i, v in enumerate(series(72, 24, 3.4, 0, 0.6, 2.2, 5.5))]
    lat = card('End-to-end latency', legend([('p95', '#eb6834', None), ('p50', NAVY2, None)]) +
               line_chart([('p95', '#eb6834', p95, None), ('p50', NAVY2, p50, None)], hrs, 0, 25, [0, 5, 10, 15, 20, 25], lambda v: f'{v:.0f}' if v % 5 == 0 else f'{v:.1f}', unit=' min', h=210, label_w=96, aria='End-to-end latency, last 24 hours', w=589),
               span=7, sub='Minutes from trade booking to report ready · last 24 hours · SLO p95 < 20 min')
    thr = [round(abs(x)) for x in series(73, 24, 1500, 0, 600, 200, 3200)]
    for i in range(8, 17): thr[i] += 900
    tp = card('Throughput', vbars(thr, hrs, NAVY2, h=210, yfmt=lambda v: f'{v/1000:.1f}k' if v else '0', aria='Messages per second by hour', unit=' msg/s', w=426), span=5, sub='Messages per second into enrichment, by hour')
    lag = table(['Topic', 'Consumer group', 'Lag', 'Trend', 'Status'], [
        ['<code style="font-size:12px">trades.enriched.emir</code>', 'emir-generator', '41,206', sparkline([2, 3, 2, 5, 9, 22, 41, 38, 30, 41], '#ec835a', 90, 20), pill('warning', 'Catching up', True)],
        ['<code style="font-size:12px">trades.enriched.mifir</code>', 'mifir-generator', '1,104', sparkline([3, 2, 2, 1, 2, 1, 1, 2, 1, 1], NAVY2, 90, 20), pill('good', 'OK', True)],
        ['<code style="font-size:12px">trades.enriched.sftr</code>', 'sftr-generator', '86', sparkline([1, 1, 2, 1, 1, 1, 0, 1, 1, 1], NAVY2, 90, 20), pill('good', 'OK', True)],
        ['<code style="font-size:12px">trades.enriched.cftc</code>', 'cftc-realtime', '9,880', sparkline([1, 2, 2, 4, 6, 9, 11, 10, 9, 10], '#ec835a', 90, 20), pill('warning', 'Latency risk', True)],
        ['<code style="font-size:12px">acks.regulator</code>', 'ack-processor', '12', sparkline([1, 0, 1, 1, 0, 1, 0, 0, 1, 0], NAVY2, 90, 20), pill('good', 'OK', True)],
        ['<code style="font-size:12px">dlq.reporting</code>', 'dlq-triage', '57', sparkline([0, 0, 1, 1, 2, 3, 5, 5, 6, 6], '#d03b3b', 90, 20), pill('critical', '57 in DLQ', True)]],
        ['left', 'left', 'right', 'left', 'left'], compact=True)
    lg = card('Kafka consumer lag', lag, span=6, sub='Messages behind head of topic')
    jobs = [('Extract & snapshot', 0, 8, 'good'), ('Enrich (LEI, UPI, ISIN)', 6, 18, 'good'), ('Eligibility & validation', 15, 24, 'good'),
            ('Generate ISO 20022 XML', 22, 32, 'good'), ('Submit to ARM / TR / SDR', 30, 46, 'warning'), ('Process acks & feedback', 40, 75, 'info'), ('Reconcile & publish MI', 72, 90, 'neutral')]
    marks = ['18:00', '20:00', '22:00', '00:00', '02:00']
    g = ''.join(f'<div style="display:grid;grid-template-columns:170px 1fr;gap:10px;align-items:center;font-size:12.5px"><span style="color:{INK2}">{a}</span>'
                f'<div style="position:relative;height:16px;background:repeating-linear-gradient(90deg,{GRID} 0 1px,transparent 1px 20%)">'
                f'<div title="{a}" style="position:absolute;left:{s}%;width:{e-s}%;top:2px;bottom:2px;border-radius:4px;background:{ {"good": NAVY, "warning": "#fab219", "info": "#5598e7", "neutral": "#CBD5E1"}[l]}"></div><div style="position:absolute;left:36%;top:-5px;bottom:-5px;width:2px;background:#d03b3b"></div></div></div>' for a, s, e, l in jobs)
    g += f'<div style="display:grid;grid-template-columns:170px 1fr;gap:10px"><span></span><div style="display:flex;justify-content:space-between;font-size:11px;color:{MUTED}">' + ''.join(f'<span>{m}</span>' for m in marks) + '</div></div>'
    g += f'<div style="position:relative;display:grid;grid-template-columns:170px 1fr;gap:10px"><span></span><div style="font-size:11.5px;color:#B42323;font-weight:600;padding-left:calc(36% - 4px)">▲ Now 20:54 · submission 60% complete</div></div>'
    gt = card('Tonight\'s batch run', f'<div style="display:flex;flex-direction:column;gap:10px">{g}</div>', span=6, sub='Job chain for T+1 submissions',
              right=legend([('Done', NAVY, None), ('Running', '#fab219', None), ('Queued', '#5598e7', None)]))
    return shell('pipeline', grid(
        stat('Pipeline availability, 30 days', '99.97%', sub='SLO 99.9% · 13 min downtime', span=3, status=pill('good', 'Meeting SLO', True)),
        stat('Messages processed today', '6.84M', sub='Trades, lifecycle events and acks', d=delta('4.1% d/d', True, True), span=3),
        stat('Dead-letter queue', '57', sub='Malformed or unmapped messages', span=3, status=pill('critical', 'Triage', True)),
        stat('Deploys this week', '4', sub='0 rollbacks · change freeze from 15 Dec', span=3),
    ) + grid(topo) + grid(lat, tp) + grid(lg, gt))


# ======================= 9. DATA QUALITY =======================
def s_dq():
    dims = ['Completeness', 'Validity', 'Accuracy', 'Timeliness', 'Consistency']
    m = [[99.9, 99.6, 99.4, 99.97, 99.2], [99.7, 98.8, 98.9, 99.5, 97.6], [99.8, 99.3, 99.1, 99.9, 96.9], [99.9, 99.7, 99.5, 98.8, 99.4]]
    hm = card('Critical data element quality', heatmap(list(REG), dims, [[100 - v for v in r] for r in m], fmt=lambda v: f'{100-v:.1f}%', label_w=80, aria='Data quality score by regime and dimension') +
              f'<p style="margin:0;font-size:12px;color:{MUTED}">Darker = more failures. Scores are the share of critical data elements passing each dimension\'s rules.</p>',
              span=7, sub='Pass rate by regime and quality dimension, 18 Nov')
    ref = card('Reference data health', ''.join(
        f'<div style="display:flex;flex-direction:column;gap:7px;padding:10px 0;border-bottom:1px solid {GRID}"><div style="display:flex;justify-content:space-between;font-size:12.5px">'
        f'<span style="color:{INK};font-weight:500">{a}</span><span style="font-weight:600">{v}%</span></div>{progress(v, NAVY2 if v >= 99 else "#ec835a", "#EEF2F8", 6)}'
        f'<span style="font-size:11.5px;color:{MUTED}">{s}</span></div>' for a, v, s in [
            ('Counterparty LEIs issued and current', 98.7, '1,214 lapsed · 486 renewals due in 30 days'), ('OTC derivatives with valid UPI', 99.4, '2,906 trades awaiting DSB lookup'),
            ('Instruments found in FIRDS', 99.8, '214 ISINs not yet published'), ('Decision makers with national ID', 97.9, '61 traders missing ID — HR feed')]),
        span=5, sub='Coverage of identifiers used in reports')
    rules = [('DQ-0142', 'Client LEI status = ISSUED on trade date', 'MiFIR, EMIR', '1,516', 'serious'),
             ('DQ-0307', 'UPI present for all OTC derivatives', 'EMIR, CFTC', '1,388', 'warning'),
             ('DQ-0219', 'Collateral portfolio code when collateralised', 'EMIR, SFTR', '1,107', 'warning'),
             ('DQ-0088', 'Execution timestamp precision ≥ ms', 'MiFIR', '402', 'neutral'),
             ('DQ-0411', 'Valuation date = T or T−1', 'EMIR', '276', 'neutral')]
    rt = card('Top failing quality rules', table(['Rule', 'Check', 'Regimes', 'Failures', ''], [[f'<span style="font-family:ui-monospace,Menlo,monospace;white-space:nowrap;font-size:12px;color:{NAVY2}">{a}</span>', esc(b), f'<span style="color:{INK2}">{c}</span>', d, pill(l, {"serious": "High", "warning": "Medium", "neutral": "Low"}[l], True)] for a, b, c, d, l in rules],
              ['left', 'left', 'left', 'right', 'left'], compact=True), span=12, sub='Pre-submission rules run in the enrichment pipeline')

    def node(t, s, hl=False):
        return (f'<div style="flex:1 1 140px;border:1px solid {NAVY2 if hl else LINE};border-radius:12px;padding:12px;background:{NAVY_T if hl else WHITE};display:flex;flex-direction:column;gap:3px">'
                f'<span style="font-size:11px;color:{MUTED};font-weight:600;letter-spacing:0.04em">{s}</span><span style="font-size:13px;font-weight:600;color:{INK}">{t}</span></div>')
    arrow = f'<div style="display:flex;align-items:center">{icon("arrowr", 16, "#94A3B8")}</div>'
    lin = (f'<div style="display:flex;flex-direction:column;gap:14px">'
           f'<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:stretch">{node("Murex counterparty", "SOURCE")}{arrow}{node("Client master (golden)", "GOLDEN SOURCE")}{arrow}{node("LEI enrichment (GLEIF)", "ENRICH")}{arrow}{node("Buyer identification code", "MIFIR FIELD 7", True)}</div>'
           f'<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:stretch">{node("Calypso trade", "SOURCE")}{arrow}{node("Product master", "GOLDEN SOURCE")}{arrow}{node("ANNA DSB lookup", "ENRICH")}{arrow}{node("UPI", "EMIR REFIT · CFTC", True)}</div>'
           f'<p style="margin:0;font-size:12px;color:{MUTED}">Each reported field traces back to one golden source. Select a field to see every transformation and rule applied.</p></div>')
    lc = card('Field lineage', lin, span=12, sub='Two critical data elements, source to report')
    return shell('dq', grid(
        stat('Overall data quality score', '99.31%', sub='Weighted across 214 critical data elements', d=delta('0.08 pp w/w', True, True), span=3),
        stat('Lapsed counterparty LEIs', '1,214', sub='Trades with these clients will be rejected', span=3, status=pill('serious', 'Outreach', True)),
        stat('Quality rules live', '388', sub='12 added this month', span=3),
        stat('Records quarantined', '3,061', sub='Held before submission for repair', d=delta('9% d/d', True, False), span=3),
    ) + grid(hm, ref) + grid(rt, lc))


# ======================= 10. CONTROLS =======================
def s_controls():
    ctl = [('TR-C01', 'Daily completeness reconciliation FO vs reported', 'All', 'Daily', 'Pass', 'good', 'Reg Ops'),
           ('TR-C04', 'Rejections repaired within 5 business days', 'All', 'Daily', 'Fail', 'critical', 'Reg Ops'),
           ('TR-C07', 'EMIR valuation reported T+1', 'EMIR', 'Daily', 'Pass', 'good', 'Derivatives Ops'),
           ('TR-C11', 'MiFIR sample accuracy test (250 trades)', 'MiFIR', 'Monthly', 'Pass', 'good', 'Compliance'),
           ('TR-C15', 'Eligibility rule change approval', 'All', 'Per change', 'Pass', 'good', 'Change Board'),
           ('TR-C19', 'SFTR collateral reuse completeness', 'SFTR', 'Daily', 'Pass', 'good', 'Financing Ops'),
           ('TR-C22', 'CFTC Part 43 timeliness review', 'CFTC', 'Weekly', 'Not tested', 'neutral', 'US Compliance')]
    ct = card('Key controls', table(['ID', 'Control', 'Regime', 'Frequency', 'Result', 'Owner'],
              [[f'<span style="font-family:ui-monospace,Menlo,monospace;white-space:nowrap;font-size:12px;color:{NAVY2}">{a}</span>', esc(b), esc(c), f'<span style="color:{INK2}">{d}</span>', pill(l, e, True), f'<span style="color:{INK2}">{o}</span>'] for a, b, c, d, e, l, o in ctl],
              ['left', 'left', 'left', 'left', 'left', 'left'], compact=True, sortable=True), span=8, sub='7 of 48 shown · results from the latest run')
    att = [('MiFIR', 6, 5), ('EMIR', 7, 5), ('SFTR', 4, 4), ('CFTC', 5, 4)]
    at = ''.join(f'<div data-regime="{r}" style="display:flex;flex-direction:column;gap:7px;padding:10px 0;border-bottom:1px solid {GRID}"><div style="display:flex;justify-content:space-between;font-size:12.5px">{regtag(r)}'
                 f'<span style="font-weight:600">{d} of {t} signed</span></div>{progress(d/t*100, REG[r], "#EEF2F8", 6)}</div>' for r, t, d in att)
    atc = card('Q4 attestations', f'<div>{at}</div><p style="margin:0;font-size:12px;color:{MUTED}">Desk heads attest that reporting is complete and accurate. Due 15 Dec.</p>', span=4, sub='18 of 22 signed · 82%')
    br = card('Breach and notification register', table(['Date', 'Regime', 'Issue', 'Regulator', 'Status'], [
        ['<span style="white-space:nowrap">14 Oct 2026</span>', regtag('EMIR'), 'Valuations not reported for 2 days after a rule change', 'FCA · ESMA via NCA', pill('info', 'Remediating', True)],
        ['<span style="white-space:nowrap">22 Jul 2026</span>', regtag('MiFIR'), 'Short selling indicator mis-reported on 4,180 trades', 'FCA', pill('good', 'Closed', True)],
        ['<span style="white-space:nowrap">03 Mar 2026</span>', regtag('CFTC'), 'Part 45 continuation data late for one asset class', 'CFTC (DMO)', pill('good', 'Closed', True)]],
        ['left', 'left', 'left', 'left', 'left'], compact=True), span=7, sub='Reportable breaches notified this year')
    ev = [('20:41', 'Priya S.', 'resubmitted 1,140 EMIR valuation reports', 'info'), ('19:58', 'System', 'TR-C04 failed — 73 rejections older than 5 business days', 'critical'),
          ('19:42', 'System', 'Solace backlog cleared, enrichment within SLA', 'good'), ('18:40', 'Change Board', 'approved RC-2291: UPI default for FX swaps', 'info'),
          ('17:15', 'Yogesh K.', 'signed MiFIR Q4 attestation for Equities', 'good'), ('16:02', 'Ana M.', 'raised breach review for EX-46977 (CFTC)', 'serious')]
    evs = ''.join(f'<div style="display:grid;grid-template-columns:44px 14px 1fr;gap:8px;align-items:start;padding:8px 0;font-size:12.5px"><span style="color:{MUTED};font-variant-numeric:tabular-nums">{t}</span>'
                  f'<span style="width:8px;height:8px;border-radius:999px;background:{ST[l][0]};margin-top:5px"></span><span><b style="font-weight:600">{who}</b> <span style="color:{INK2}">{w}</span></span></div>' for t, who, w, l in ev)
    au = card('Audit trail', f'<div>{evs}</div>', span=5, sub='Today · immutable log, retained 7 years', right=f'<a href="#" style="font-size:12.5px;font-weight:600;color:{NAVY2};text-decoration:none">Full log</a>')
    chg = [('ESMA validation rules update (EMIR Refit)', 'Q1 2027 · indicative', 'Impact assessment', 'info'), ('CFTC technical specification update', 'Q2 2027 · indicative', 'Not started', 'neutral'),
           ('UK MiFIR transaction reporting review', 'TBC', 'Monitoring', 'neutral')]
    cg = card('Regulatory change pipeline', ''.join(f'<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid {GRID}">'
              f'<span style="display:flex;flex-direction:column;gap:2px"><span style="font-size:12.5px;font-weight:600">{a}</span><span style="font-size:11.5px;color:{MUTED}">{b}</span></span>{pill(l, s, True)}</div>' for a, b, s, l in chg),
              span=12, sub='Upcoming rule changes tracked against impact on reporting · dates are placeholders to confirm')
    return shell('controls', grid(
        stat('Key controls passing', '46 of 48', sub='96% · 1 fail, 1 not tested', span=3, status=pill('warning', 'Review TR-C04', True)),
        stat('Q4 attestations', '82%', sub='18 of 22 signed · due 15 Dec', span=3, spark=progress(82)),
        stat('Reportable breaches, YTD', '3', sub='2 closed · 1 remediating', span=3),
        stat('Open audit findings', '5', sub='2 high · next due 30 Nov', span=3, status=pill('serious', '2 high', True)),
    ) + grid(ct, atc) + grid(br, au) + grid(cg))


BUILDERS = {'overview': s_overview, 'emir': s_emir, 'mifir': s_mifir, 'sftrcftc': s_sftrcftc, 'exceptions': s_exceptions,
            'rejections': s_rejections, 'completeness': s_completeness, 'pipeline': s_pipeline, 'dq': s_dq, 'controls': s_controls}

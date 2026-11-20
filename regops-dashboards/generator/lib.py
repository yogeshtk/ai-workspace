"""Shared design tokens + component builders for the Reg Reporting dashboards.
Every builder returns an HTML string with inline styles, so the same markup
works inside a .dc.html artboard and inside the standalone prototype."""
import math, random

# ---------- tokens ----------
NAVY = '#0B2A5B'; NAVY2 = '#1F4FA8'; NAVY_T = '#EAF0FA'
INK = '#0F172A'; INK2 = '#475569'; MUTED = '#64748B'
LINE = '#E6EAF0'; GRID = '#EEF1F5'; BG = '#F5F7FA'; WHITE = '#FFFFFF'
FONT = "Inter, system-ui, -apple-system, 'Segoe UI', sans-serif"

REG = {  # validated categorical order (adjacent CVD ΔE ≥ 9.2)
    'MiFIR': '#1f4fa8', 'EMIR': '#eb6834', 'SFTR': '#1baf7a', 'CFTC': '#6250d6'}
REG_FULL = {'MiFIR': 'MiFIR / UK MiFIR', 'EMIR': 'EMIR Refit', 'SFTR': 'SFTR', 'CFTC': 'CFTC Part 43/45'}

ST = {  # status: mark colour, text colour, tint
    'good': ('#0ca30c', '#067306', '#E8F6E8'),
    'warning': ('#fab219', '#7A5000', '#FFF4DB'),
    'serious': ('#ec835a', '#A8401A', '#FDEDE6'),
    'critical': ('#d03b3b', '#B42323', '#FBE9E9'),
    'info': (NAVY2, NAVY2, NAVY_T),
    'neutral': ('#94A3B8', INK2, '#F1F5F9'),
}
SEQ = ['#cde2fb', '#b7d3f6', '#9ec5f4', '#86b6ef', '#6da7ec', '#5598e7', '#3987e5',
       '#2a78d6', '#256abf', '#1c5cab', '#184f95', '#104281', '#0d366b']

MODE = {'v': 'dc'}  # 'dc' or 'proto'


def esc(t):
    return str(t).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


def fmt_int(v):
    return f"{int(round(v)):,}"


# ---------- icons (inline stroke svg) ----------
ICON_PATHS = {
    'grid': '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    'layers': '<path d="M12 3 2 8l10 5 10-5-10-5Z"/><path d="m2 16 10 5 10-5"/><path d="m2 12 10 5 10-5"/>',
    'file': '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M8 13h8M8 17h5"/>',
    'swap': '<path d="M7 4 3 8l4 4"/><path d="M3 8h13"/><path d="m17 20 4-4-4-4"/><path d="M21 16H8"/>',
    'inbox': '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5h13L22 12v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z"/>',
    'xcircle': '<circle cx="12" cy="12" r="9"/><path d="m15 9-6 6M9 9l6 6"/>',
    'scale': '<path d="M12 3v18M5 7h14"/><path d="m5 7-3 7a4 4 0 0 0 6 0z"/><path d="m19 7-3 7a4 4 0 0 0 6 0z"/><path d="M8 21h8"/>',
    'activity': '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
    'database': '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
    'shield': '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
    'check': '<path d="M20 6 9 17l-5-5"/>',
    'alert': '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
    'octagon': '<path d="M7.9 2h8.2L22 7.9v8.2L16.1 22H7.9L2 16.1V7.9z"/><path d="M12 8v4M12 16h.01"/>',
    'clock': '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    'chev': '<path d="m6 9 6 6 6-6"/>',
    'search': '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
    'bell': '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
    'download': '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
    'arrowr': '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
    'up': '<path d="m6 15 6-6 6 6"/>', 'down': '<path d="m6 9 6 6 6-6"/>',
    'info': '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    'user': '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
}


def icon(name, size=16, color='currentColor', sw=1.8):
    return (f'<svg viewBox="0 0 24 24" width="{size}" height="{size}" aria-hidden="true" '
            f'style="flex:none;fill:none;stroke:{color};stroke-width:{sw};stroke-linecap:round;stroke-linejoin:round">'
            f'{ICON_PATHS[name]}</svg>')


STATUS_ICON = {'good': 'check', 'warning': 'alert', 'serious': 'alert', 'critical': 'octagon',
               'info': 'info', 'neutral': 'clock'}


def pill(level, text, small=False):
    mark, txt, tint = ST[level]
    fs = '11.5px' if small else '12px'
    pad = '2px 8px 2px 6px' if small else '3px 10px 3px 7px'
    return (f'<span style="display:inline-flex;align-items:center;gap:5px;padding:{pad};border-radius:999px;'
            f'background:{tint};color:{txt};font-size:{fs};font-weight:600;white-space:nowrap;line-height:1.5">'
            f'{icon(STATUS_ICON[level], 13, mark, 2.2)}{esc(text)}</span>')


def regtag(r):
    return (f'<span data-regime="{r}" style="display:inline-flex;align-items:center;gap:6px;font-size:12.5px;'
            f'color:{INK};font-weight:500;white-space:nowrap"><span style="width:8px;height:8px;border-radius:2px;'
            f'background:{REG[r]};flex:none"></span>{esc(r)}</span>')


def delta(text, good=True, up=True):
    col = '#067306' if good else '#B42323'
    return (f'<span style="display:inline-flex;align-items:center;gap:2px;color:{col};font-size:12px;font-weight:600">'
            f'{icon("up" if up else "down", 13, col, 2.4)}{esc(text)}</span>')


# ---------- layout ----------
def card(title, body, span=4, sub=None, right=None, pad='20px 22px', gap=14, extra=''):
    head = ''
    if title:
        head = (f'<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">'
                f'<div style="display:flex;flex-direction:column;gap:3px;min-width:0">'
                f'<h3 style="margin:0;font-size:14px;font-weight:600;color:{INK};letter-spacing:-0.005em">{esc(title)}</h3>'
                + (f'<p style="margin:0;font-size:12.5px;color:{MUTED}">{esc(sub)}</p>' if sub else '')
                + '</div>' + (right or '') + '</div>')
    return (f'<section data-span="{span}" style="grid-column:span {span};min-width:0;background:{WHITE};border:1px solid {LINE};'
            f'border-radius:14px;padding:{pad};display:flex;flex-direction:column;gap:{gap}px;{extra}">{head}{body}</section>')


def grid(*cards, gap=16):
    return (f'<div style="display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:{gap}px">'
            + ''.join(cards) + '</div>')


def stat(label, value, sub=None, d=None, spark=None, regime=None, status=None, span=3, big=False):
    dot = (f'<span style="width:8px;height:8px;border-radius:2px;background:{REG[regime]}"></span>' if regime else '')
    top = (f'<div style="display:flex;justify-content:space-between;align-items:center;gap:8px">'
           f'<span style="display:inline-flex;align-items:center;gap:7px;font-size:12.5px;color:{INK2};font-weight:500">{dot}{esc(label)}</span>'
           + (status or '') + '</div>')
    vs = '48px' if big else '26px'
    val = (f'<div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap">'
           f'<span style="font-size:{vs};font-weight:600;color:{INK};letter-spacing:-0.02em;line-height:1.1">{esc(value)}</span>'
           + (d or '') + '</div>')
    s = f'<div style="font-size:12px;color:{MUTED}">{sub}</div>' if sub else ''
    sp = spark or ''
    attr = f' data-regime="{regime}"' if regime else ''
    return (f'<section data-span="{span}"{attr} style="grid-column:span {span};min-width:0;background:{WHITE};border:1px solid {LINE};'
            f'border-radius:14px;padding:18px 20px;display:flex;flex-direction:column;gap:10px">{top}{val}{s}{sp}</section>')


# ---------- charts ----------
def sparkline(vals, color=NAVY2, w=220, h=34):
    lo, hi = min(vals), max(vals)
    rng = (hi - lo) or 1
    pts = [(i * w / (len(vals) - 1), h - 3 - (v - lo) / rng * (h - 6)) for i, v in enumerate(vals)]
    d = 'M' + ' L'.join(f'{x:.1f} {y:.1f}' for x, y in pts)
    area = d + f' L{w} {h} L0 {h} Z'
    lx, ly = pts[-1]
    return (f'<svg viewBox="0 0 {w} {h}" aria-hidden="true" style="width:100%;height:{h}px;display:block" preserveAspectRatio="none">'
            f'<path d="{area}" style="fill:{color};opacity:0.08"/>'
            f'<path d="{d}" style="fill:none;stroke:{color};stroke-width:1.6;stroke-linejoin:round;stroke-linecap:round" vector-effect="non-scaling-stroke"/>'
            f'</svg>')


def line_chart(series, xlabels, ymin, ymax, yticks, yfmt, w=720, h=240, unit='', label_w=96, area=False, aria='Line chart'):
    L, R, T, B = 46, label_w, 12, 28
    pw, ph = w - L - R, h - T - B
    n = len(xlabels)
    X = lambda i: L + i * pw / (n - 1)
    Y = lambda v: T + ph - (v - ymin) / (ymax - ymin) * ph
    o = [f'<svg viewBox="0 0 {w} {h}" role="img" aria-label="{esc(aria)}" style="width:100%;height:auto;display:block;overflow:visible">']
    for t in yticks:
        y = Y(t)
        o.append(f'<line x1="{L}" x2="{L+pw}" y1="{y:.1f}" y2="{y:.1f}" style="stroke:{GRID if t != ymin else "#D5DBE4"};stroke-width:1"/>')
        o.append(f'<text x="{L-8}" y="{y+4:.1f}" style="font-size:11px;fill:{MUTED};text-anchor:end;font-variant-numeric:tabular-nums">{esc(yfmt(t))}</text>')
    step = max(1, (n - 1) // 5)
    for i in range(0, n, step):
        o.append(f'<text x="{X(i):.1f}" y="{h-8}" style="font-size:11px;fill:{MUTED};text-anchor:middle">{esc(xlabels[i])}</text>')
    ends = []
    for name, color, vals, rg in series:
        d = 'M' + ' L'.join(f'{X(i):.1f} {Y(v):.1f}' for i, v in enumerate(vals))
        g = f'<g data-regime="{rg}">' if rg else '<g>'
        o.append(g)
        if area:
            o.append(f'<path d="{d} L{X(n-1):.1f} {T+ph} L{L} {T+ph} Z" style="fill:{color};opacity:0.08"/>')
        o.append(f'<path d="{d}" style="fill:none;stroke:{color};stroke-width:2;stroke-linejoin:round;stroke-linecap:round"/>')
        for i, v in enumerate(vals):
            tip = f'{name} · {xlabels[i]}: {yfmt(v)}{unit}'
            o.append(f'<circle cx="{X(i):.1f}" cy="{Y(v):.1f}" r="7" data-tip="{esc(tip)}" style="fill:transparent;cursor:crosshair"><title>{esc(tip)}</title></circle>')
        o.append(f'<circle cx="{X(n-1):.1f}" cy="{Y(vals[-1]):.1f}" r="4" style="fill:{color};stroke:{WHITE};stroke-width:2"/>')
        o.append('</g>')
        ends.append([Y(vals[-1]), name, vals[-1], color])
    # end labels with leader lines (no overlap)
    ends.sort(key=lambda e: e[0])
    pos = []
    for e in ends:
        y = e[0]
        if pos and y - pos[-1] < 15:
            y = pos[-1] + 15
        pos.append(y)
    shift = max(0, pos[-1] - (T + ph)) if pos else 0
    for e, y in zip(ends, pos):
        y -= shift
        x0 = X(n - 1) + 6
        if abs(y - e[0]) > 1:
            o.append(f'<path d="M{x0:.1f} {e[0]:.1f} L{x0+8:.1f} {y:.1f}" style="fill:none;stroke:#CBD5E1;stroke-width:1"/>')
        o.append(f'<text x="{x0+12:.1f}" y="{y+4:.1f}" style="font-size:11.5px;fill:{INK2}"><tspan style="font-weight:600;fill:{INK}">{esc(yfmt(e[2]))}{unit}</tspan> {esc(e[1])}</text>')
    o.append('</svg>')
    return ''.join(o)


def legend(items):
    return ('<div style="display:flex;flex-wrap:wrap;gap:6px 16px">' + ''.join(
        f'<span data-regime="{rg or ""}" style="display:inline-flex;align-items:center;gap:6px;font-size:12px;color:{INK2}">'
        f'<span style="width:10px;height:10px;border-radius:3px;background:{c}"></span>{esc(n)}</span>'
        for n, c, rg in items) + '</div>')


def hbars(rows, fmt=fmt_int, color=NAVY2, label_w='44%', total=None, suffix=None):
    mx = max(r[1] for r in rows)
    o = ['<div style="display:flex;flex-direction:column;gap:9px">']
    for r in rows:
        lab, v = r[0], r[1]
        c = r[2] if len(r) > 2 and r[2] else color
        rg = r[3] if len(r) > 3 else ''
        pct = v / mx * 80
        share = f' · {v/total*100:.1f}%' if total else ''
        tip = f'{lab}: {fmt(v)}{share}'
        extra = f'<span style="color:{MUTED};font-weight:400"> {esc(suffix(r))}</span>' if suffix else ''
        o.append(f'<div data-regime="{rg}" data-tip="{esc(tip)}" title="{esc(tip)}" style="display:flex;align-items:center;gap:10px;font-size:12.5px">'
                 f'<span style="flex:0 0 {label_w};color:{INK2};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">{esc(lab)}</span>'
                 f'<span style="flex:1;display:flex;align-items:center;gap:8px;min-width:0">'
                 f'<span style="height:12px;width:{pct:.1f}%;background:{c};border-radius:0 4px 4px 0;flex:none"></span>'
                 f'<span style="color:{INK};font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap">{fmt(v)}{extra}</span></span></div>')
    o.append('</div>')
    return ''.join(o)


def segbar(parts, fmt=lambda v: f'{v:g}%', h=28, show_legend=True):
    tot = sum(p[1] for p in parts)
    o = [f'<div role="img" aria-label="{esc(", ".join(f"{p[0]} {fmt(p[1])}" for p in parts))}" style="display:flex;gap:2px;height:{h}px;width:100%">']
    for p in parts:
        name, v, c = p[0], p[1], p[2]
        if v <= 0:
            continue
        share = v / tot * 100
        dark_text = c in ('#fab219', '#eda100', '#cde2fb', '#b7d3f6', '#9ec5f4', '#86b6ef', '#E2E8F0')
        tc = INK if dark_text else WHITE
        lab = f'<span style="font-size:12px;font-weight:600;color:{tc};padding-left:8px;white-space:nowrap">{esc(fmt(v))}</span>' if share >= 8 else ''
        tip = f'{name}: {fmt(v)}'
        o.append(f'<div data-tip="{esc(tip)}" title="{esc(tip)}" style="flex:{share:.3f} 1 0;min-width:3px;background:{c};border-radius:4px;display:flex;align-items:center;overflow:hidden">{lab}</div>')
    o.append('</div>')
    if show_legend:
        o.append(legend([(f'{p[0]}' + ('' if p[1] / tot * 100 >= 8 else f' {fmt(p[1])}'), p[2], None) for p in parts]))
    return ''.join(o)


def progress(v, color=NAVY2, track='#E8EEF7', h=8):
    return (f'<div style="height:{h}px;background:{track};border-radius:999px;overflow:hidden;width:100%">'
            f'<div style="height:100%;width:{v:.1f}%;background:{color};border-radius:999px"></div></div>')


def table(headers, rows, align=None, sortable=False, row_attrs=None, compact=False):
    align = align or ['left'] * len(headers)
    pad = '9px 12px' if compact else '11px 12px'
    cls = ' class="sortable"' if sortable else ''
    o = [f'<div style="overflow-x:auto;margin:0 -4px"><table{cls} style="width:100%;border-collapse:collapse;font-size:12.5px;min-width:440px">',
         '<thead><tr>']
    for i, h in enumerate(headers):
        o.append(f'<th style="text-align:{align[i]};padding:8px 12px;font-size:11.5px;font-weight:600;color:{MUTED};'
                 f'border-bottom:1px solid {LINE};white-space:nowrap;letter-spacing:0.01em">{esc(h)}</th>')
    o.append('</tr></thead><tbody>')
    for ri, r in enumerate(rows):
        attrs = row_attrs[ri] if row_attrs else ''
        o.append(f'<tr {attrs}>')
        for i, c in enumerate(r):
            num = 'font-variant-numeric:tabular-nums;' if align[i] == 'right' else ''
            o.append(f'<td style="text-align:{align[i]};padding:{pad};border-bottom:1px solid {GRID};color:{INK};{num}vertical-align:middle">{c}</td>')
        o.append('</tr>')
    o.append('</tbody></table></div>')
    return ''.join(o)


def heatmap(rows, cols, m, fmt=lambda v: f'{v:g}', vmax=None, label_w=120, aria='Heatmap'):
    vmax = vmax or max(max(r) for r in m)
    o = [f'<div role="img" aria-label="{esc(aria)}" style="overflow-x:auto"><div style="display:grid;grid-template-columns:{label_w}px repeat({len(cols)},minmax(52px,1fr));gap:2px;min-width:{label_w+len(cols)*54}px">',
         '<div></div>']
    for c in cols:
        o.append(f'<div style="font-size:11px;color:{MUTED};text-align:center;padding:0 2px 6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">{esc(c)}</div>')
    for ri, rname in enumerate(rows):
        o.append(f'<div style="font-size:12.5px;color:{INK2};display:flex;align-items:center;white-space:nowrap">{esc(rname)}</div>')
        for ci, v in enumerate(m[ri]):
            k = min(len(SEQ) - 1, int(v / vmax * (len(SEQ) - 1) + 0.5))
            bg = SEQ[k]
            tc = WHITE if k >= 7 else INK
            tip = f'{rname} × {cols[ci]}: {fmt(v)}'
            o.append(f'<div data-tip="{esc(tip)}" title="{esc(tip)}" style="height:34px;border-radius:4px;background:{bg};color:{tc};font-size:11.5px;font-weight:500;display:flex;align-items:center;justify-content:center;font-variant-numeric:tabular-nums">{esc(fmt(v))}</div>')
    o.append('</div></div>')
    # scale
    o.append(f'<div style="display:flex;align-items:center;gap:8px;font-size:11px;color:{MUTED}">Low<div style="display:flex;gap:2px">'
             + ''.join(f'<span style="width:18px;height:8px;border-radius:2px;background:{c}"></span>' for c in SEQ[::2])
             + '</div>High</div>')
    return ''.join(o)


def stacked_cols(cats, series, w=520, h=220, aria='Stacked columns', cat_regime=True):
    """cats: names; series: [(name,color,[vals per cat])]"""
    L, R, T, B = 40, 10, 10, 28
    pw, ph = w - L - R, h - T - B
    tot = [sum(s[2][i] for s in series) for i in range(len(cats))]
    mx = max(tot)
    step = 200 if mx <= 1000 else 500
    top = math.ceil(mx / step) * step
    Y = lambda v: T + ph - v / top * ph
    band = pw / len(cats)
    bw = min(44, band * 0.5)
    o = [f'<svg viewBox="0 0 {w} {h}" role="img" aria-label="{esc(aria)}" style="width:100%;height:auto;display:block">']
    for t in range(0, top + 1, step):
        o.append(f'<line x1="{L}" x2="{L+pw}" y1="{Y(t):.1f}" y2="{Y(t):.1f}" style="stroke:{GRID if t else "#D5DBE4"};stroke-width:1"/>')
        o.append(f'<text x="{L-8}" y="{Y(t)+4:.1f}" style="font-size:11px;fill:{MUTED};text-anchor:end">{t:,}</text>')
    for i, c in enumerate(cats):
        x = L + band * i + (band - bw) / 2
        acc = 0
        g = f'<g data-regime="{c}">' if cat_regime else '<g>'
        o.append(g)
        nseg = len(series)
        for si, (sn, sc, sv) in enumerate(series):
            v = sv[i]
            y0, y1 = Y(acc), Y(acc + v)
            hgt = y0 - y1 - (2 if si < nseg - 1 else 0)
            top_seg = si == nseg - 1
            tip = f'{c} · {sn}: {v:,}'
            if top_seg:
                r = 4
                path = (f'M{x:.1f} {y0:.1f} L{x:.1f} {y1+r:.1f} Q{x:.1f} {y1:.1f} {x+r:.1f} {y1:.1f} L{x+bw-r:.1f} {y1:.1f} '
                        f'Q{x+bw:.1f} {y1:.1f} {x+bw:.1f} {y1+r:.1f} L{x+bw:.1f} {y0:.1f} Z')
                o.append(f'<path d="{path}" data-tip="{esc(tip)}" style="fill:{sc}"><title>{esc(tip)}</title></path>')
            else:
                o.append(f'<rect x="{x:.1f}" y="{y1+2:.1f}" width="{bw:.1f}" height="{max(y0-y1-2,0):.1f}" data-tip="{esc(tip)}" style="fill:{sc}"><title>{esc(tip)}</title></rect>')
            acc += v
        o.append(f'<text x="{x+bw/2:.1f}" y="{Y(acc)-6:.1f}" style="font-size:11.5px;font-weight:600;fill:{INK};text-anchor:middle">{tot[i]:,}</text>')
        o.append(f'<text x="{x+bw/2:.1f}" y="{h-8}" style="font-size:11.5px;fill:{INK2};text-anchor:middle">{esc(c)}</text>')
        o.append('</g>')
    o.append('</svg>')
    return ''.join(o)


def vbars(vals, labels, color=NAVY2, w=520, h=160, yfmt=fmt_int, highlight=None, aria='Column chart', unit=''):
    L, R, T, B = 40, 6, 10, 24
    pw, ph = w - L - R, h - T - B
    mx = max(vals)
    mag = 10 ** int(math.log10(mx))
    top = math.ceil(mx / mag) * mag
    Y = lambda v: T + ph - v / top * ph
    band = pw / len(vals)
    bw = min(24, band - 2)
    o = [f'<svg viewBox="0 0 {w} {h}" role="img" aria-label="{esc(aria)}" style="width:100%;height:auto;display:block">']
    for t in (0, top / 2, top):
        o.append(f'<line x1="{L}" x2="{L+pw}" y1="{Y(t):.1f}" y2="{Y(t):.1f}" style="stroke:{GRID if t else "#D5DBE4"};stroke-width:1"/>')
        o.append(f'<text x="{L-8}" y="{Y(t)+4:.1f}" style="font-size:11px;fill:{MUTED};text-anchor:end">{esc(yfmt(t))}</text>')
    for i, v in enumerate(vals):
        x = L + band * i + (band - bw) / 2
        y = Y(v); r = min(4, (T + ph - y) / 2)
        c = color if highlight is None or i in highlight else '#AFC3E3'
        path = (f'M{x:.1f} {T+ph:.1f} L{x:.1f} {y+r:.1f} Q{x:.1f} {y:.1f} {x+r:.1f} {y:.1f} L{x+bw-r:.1f} {y:.1f} '
                f'Q{x+bw:.1f} {y:.1f} {x+bw:.1f} {y+r:.1f} L{x+bw:.1f} {T+ph:.1f} Z')
        tip = f'{labels[i]}: {yfmt(v)}{unit}'
        o.append(f'<path d="{path}" data-tip="{esc(tip)}" style="fill:{c}"><title>{esc(tip)}</title></path>')
        if i % max(1, len(vals) // 8) == 0:
            o.append(f'<text x="{x+bw/2:.1f}" y="{h-7}" style="font-size:11px;fill:{MUTED};text-anchor:middle">{esc(labels[i])}</text>')
    o.append('</svg>')
    return ''.join(o)


def series(seed, n, start, drift, noise, lo=None, hi=None, end=None):
    rnd = random.Random(seed)
    v = start; out = []
    for i in range(n):
        v += drift + rnd.uniform(-noise, noise)
        if lo is not None: v = max(lo, v)
        if hi is not None: v = min(hi, v)
        out.append(v)
    if end is not None:
        diff = end - out[-1]
        out = [x + diff * (i / (n - 1)) for i, x in enumerate(out)]
    return out

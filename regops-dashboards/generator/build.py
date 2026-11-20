import json, os, sys
import lib
from screens import SCREENS, BUILDERS

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
FONTS = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin=""><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;650;700&amp;display=swap">'
RESP = ('@media (max-width: 1100px){[data-span]{grid-column:span 6 !important}}'
        '@media (max-width: 720px){[data-span]{grid-column:1 / -1 !important}'
        'nav[aria-label="Dashboards"]{flex-direction:row !important;overflow-x:auto;border-right:0 !important;border-bottom:1px solid #E6EAF0;padding:10px !important}'
        'nav[aria-label="Dashboards"]>div{display:none !important}nav[aria-label="Dashboards"] a{flex:none}}')

heights = json.load(open(f'{HERE}/heights.json')) if os.path.exists(f'{HERE}/heights.json') else {}


def build_dc():
    lib.MODE['v'] = 'dc'
    os.makedirs(f'{ROOT}/canvas', exist_ok=True)
    boards, order = {}, []
    for i, (sid, f, lab, ic, title, *_r) in enumerate(SCREENS):
        h = heights.get(sid, 1400)
        body = BUILDERS[sid]()
        props = json.dumps({'$preview': {'width': 1440, 'height': h}})
        html = (f'<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>{lib.esc(title)} · RegOps</title>\n'
                f'<script src="./support.js"></script>\n</head>\n<body>\n<x-dc>\n<helmet>\n{FONTS}\n<style>\n'
                f'body{{margin:0;background:{lib.BG}}}\na{{color:{lib.NAVY2}}}a:hover{{color:{lib.NAVY}}}\n{RESP}\n</style>\n</helmet>\n'
                f'{body}\n</x-dc>\n<script type="text/x-dc" data-dc-script data-props=\'{props}\'>\n'
                'class Component extends DCLogic {\n  renderVals() { return {}; }\n}\n</script>\n</body>\n</html>\n')
        assert '{{' not in body
        open(f'{ROOT}/canvas/{f}.dc.html', 'w').write(html)
        col, row = i % 2, i // 2
        boards[f'{f}.dc.html'] = {'x': col * (1440 + 120), 'y': row * (max(heights.values() or [1400]) + 200), 'w': 1440, 'h': h,
                                  'title': f'{i+1:02d} · {title}', 'expand': 'fill', 'is_interactive': True}
        order.append(f'{f}.dc.html')
    idx = {'v': 3, 'createdOnFiles': {'v': 1, 'at': '2026-11-19T21:10:00Z'}, 'title': 'Regulatory Reporting Dashboards — Transaction Reporting',
           'launch': {'view': 'canvas'}, 'pages': [], 'boards': boards, 'order': order, 'designSystems': [],
           'notes': {'t1': {'x': 0, 'y': -300, 'text': 'Transaction reporting control tower · 10 screens', 'kind': 'title1', 'maxW': 3000}}}
    json.dump(idx, open(f'{ROOT}/canvas/canvas.json', 'w'), indent=1)


JS = r'''
(function(){
  const screens=[...document.querySelectorAll('.screen')];
  function show(){const id=(location.hash||'#overview').slice(1);let hit=false;
    screens.forEach(s=>{const on=s.id==='s-'+id;s.hidden=!on;if(on)hit=true});
    if(!hit){screens.forEach((s,i)=>s.hidden=i!==0)} window.scrollTo(0,0); applyRegime();}
  window.addEventListener('hashchange',show);
  // tooltips
  document.querySelectorAll('svg title').forEach(t=>t.remove());
  document.querySelectorAll('[data-tip][title]').forEach(e=>e.removeAttribute('title'));
  const tip=document.createElement('div');tip.className='tip';document.body.appendChild(tip);
  document.addEventListener('mousemove',e=>{const t=e.target.closest('[data-tip]');
    if(!t){tip.style.opacity=0;return}
    tip.textContent=t.getAttribute('data-tip');tip.style.opacity=1;
    const w=tip.offsetWidth;let x=e.clientX+14;if(x+w>innerWidth-8)x=e.clientX-w-14;
    tip.style.left=x+'px';tip.style.top=(e.clientY+16)+'px';
    document.querySelectorAll('.hl').forEach(n=>n.classList.remove('hl'));t.classList.add('hl');});
  // regime filter (shared across screens)
  let regime='';
  function applyRegime(){document.querySelectorAll('[data-regime]').forEach(el=>{
      const r=el.getAttribute('data-regime');if(!r)return;
      el.style.opacity=(regime&&r!==regime)?'0.18':'';el.style.transition='opacity .2s'});
    document.querySelectorAll('.regime-filter').forEach(s=>s.value=regime);}
  document.addEventListener('change',e=>{if(e.target.classList.contains('regime-filter')){regime=e.target.value;applyRegime()}});
  // exceptions saved views
  document.addEventListener('click',e=>{const b=e.target.closest('[data-view]');if(!b)return;
    const v=b.getAttribute('data-view');const list=b.parentElement;
    list.querySelectorAll('[data-view]').forEach(x=>{const on=x===b;x.setAttribute('aria-selected',on);
      x.style.background=on?'#0B2A5B':'#fff';x.style.color=on?'#fff':'#0F172A';x.style.borderColor=on?'#0B2A5B':'#E6EAF0';x.style.fontWeight=on?600:500;
      const c=x.querySelector('span');if(c)c.style.background=on?'rgba(255,255,255,0.18)':'#F1F5F9'});
    const tb=list.parentElement.querySelector('tbody');
    tb.querySelectorAll('tr').forEach(tr=>{tr.hidden=!(tr.dataset.tags||'').split(' ').includes(v)});});
  // sortable tables
  document.querySelectorAll('table.sortable th').forEach((th,i)=>{th.style.cursor='pointer';th.title='Sort';
    th.addEventListener('click',()=>{const tb=th.closest('table').tBodies[0];const rows=[...tb.rows];
      const dir=th.dataset.dir==='asc'?'desc':'asc';th.closest('tr').querySelectorAll('th').forEach(h=>{delete h.dataset.dir;h.textContent=h.textContent.replace(/ [↑↓]$/,'')});
      th.dataset.dir=dir;th.textContent+=dir==='asc'?' ↑':' ↓';
      const key=r=>{const t=r.cells[i].innerText.trim();const n=parseFloat(t.replace(/[,%a-z ]/gi,''));return isNaN(n)?t.toLowerCase():n};
      rows.sort((a,b)=>{const x=key(a),y=key(b);return (x>y?1:x<y?-1:0)*(dir==='asc'?1:-1)});rows.forEach(r=>tb.appendChild(r));});});
  // simulated T+1 countdown from 20:54 UTC to 23:59 UTC
  let secs=3*3600+5*60;setInterval(()=>{secs=Math.max(0,secs-1);const h=Math.floor(secs/3600),m=Math.floor(secs%3600/60),s=secs%60;
    document.querySelectorAll('.countdown').forEach(c=>c.textContent=`${h}h ${String(m).padStart(2,'0')}m ${String(s).padStart(2,'0')}s`)},1000);
  show();
})();
'''


def build_proto():
    lib.MODE['v'] = 'proto'
    parts = []
    for sid, *_ in SCREENS:
        parts.append(f'<div class="screen" id="s-{sid}" hidden>{BUILDERS[sid]()}</div>')
    css = (f'html,body{{margin:0;background:{lib.BG}}}body{{font-family:{lib.FONT}}}'
           f'.tip{{position:fixed;z-index:50;pointer-events:none;opacity:0;background:{lib.INK};color:#fff;font-size:12px;font-weight:500;padding:6px 9px;border-radius:7px;'
           f'box-shadow:0 6px 20px rgba(15,23,42,.18);transition:opacity .12s;white-space:nowrap;font-family:{lib.FONT}}}'
           f'[data-tip]{{transition:filter .12s}}path[data-tip].hl,rect[data-tip].hl,div[data-tip].hl{{filter:brightness(0.86)}}'
           f'circle[data-tip].hl{{fill:rgba(31,79,168,0.18)!important}}'
           f'a[data-nav]:not([aria-current]):hover{{background:{lib.NAVY_T}}}'
           f'tbody tr:hover td{{background:#F8FAFD}}a:focus-visible,button:focus-visible,select:focus-visible{{outline:2px solid {lib.NAVY2};outline-offset:2px}}'
           f'[hidden]{{display:none!important}}' + RESP)
    html = (f'<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            f'<title>RegOps · Transaction reporting dashboards</title>{FONTS}<style>{css}</style></head><body>'
            + ''.join(parts) + f'<script>{JS}</script></body></html>')
    os.makedirs(f'{ROOT}/prototype', exist_ok=True)
    open(f'{ROOT}/prototype/index.html', 'w').write(html)


if __name__ == '__main__':
    build_proto(); build_dc()
    print('ok')

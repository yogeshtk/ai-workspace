/*
 * diagram-view.js — interactive SVG canvas for a DiagramCore.Diagram (browser only).
 *
 *   const view = new DiagramView(containerEl, diagram, { editable: true, onSelect(sel) {} });
 *
 * Mouse: drag node = move · drag a node's blue port = connect (drop on empty canvas = new node)
 *        drag background = pan · wheel = zoom · double-click = edit label (empty canvas = new node)
 * Keys:  Delete = remove · Ctrl+Z / Ctrl+Shift+Z (Ctrl+Y) = undo / redo · arrows = nudge · Esc = deselect
 */
(function (root) {
  'use strict';
  const Core = root.DiagramCore;
  const NS = 'http://www.w3.org/2000/svg';
  const GRID = 10;
  const snap = (v) => Math.round(v / GRID) * GRID;

  class DiagramView {
    constructor(container, diagram, opts) {
      this.c = document.createElement('div'); // own positioned host, so the container keeps its layout
      this.c.className = 'dg-host';
      Object.assign(this.c.style, { position: 'absolute', inset: '0', overflow: 'hidden' });
      if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
      container.insertBefore(this.c, container.firstChild);
      this.d = diagram;
      this.opts = opts || {};
      this.editable = this.opts.editable !== false;
      this.selection = null;
      this.t = { x: 40, y: 40, k: 1 };
      this.mode = null;

      const svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('class', 'dg-canvas');
      svg.setAttribute('font-family', Core.FONT);
      svg.innerHTML =
        '<defs><pattern id="dg-grid" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="#CBD5E1"/></pattern></defs>' +
        '<g class="dg-vp"><rect x="-100000" y="-100000" width="200000" height="200000" fill="url(#dg-grid)" class="dg-gridbg"/><g class="dg-layer"></g><g class="dg-overlay"></g></g>';
      this.c.appendChild(svg);
      this.svg = svg;
      this.vp = svg.querySelector('.dg-vp');
      this.layer = svg.querySelector('.dg-layer');
      this.overlay = svg.querySelector('.dg-overlay');

      svg.addEventListener('pointerdown', (e) => this._down(e));
      window.addEventListener('pointermove', (e) => this._move(e));
      window.addEventListener('pointerup', (e) => this._up(e));
      svg.addEventListener('wheel', (e) => this._wheel(e), { passive: false });
      svg.addEventListener('dblclick', (e) => this._dbl(e));
      window.addEventListener('keydown', (e) => this._key(e));
      this._unsub = diagram.onChange(() => this.render());

      this.render();
      requestAnimationFrame(() => this.fit());
    }

    // ---------------------------------------------------------------- public
    setDiagram(diagram) {
      if (this._unsub) this._unsub();
      this.d = diagram;
      this._unsub = diagram.onChange(() => this.render());
      this.select(null);
      this.fit();
    }

    render() {
      const sel = this.selection;
      if (sel && !(sel.kind === 'node' ? this.d.getNode(sel.id) : this.d.getEdge(sel.id))) {
        this.selection = null;
        if (this.opts.onSelect) this.opts.onSelect(null);
      }
      this.layer.innerHTML = Core.renderContent(this.d.doc, { selected: this.selection, ports: this.editable, interactive: true });
    }

    select(sel) {
      const same = (a, b) => (!a && !b) || (a && b && a.kind === b.kind && a.id === b.id);
      if (same(sel, this.selection)) return;
      this.selection = sel;
      this.render();
      if (this.opts.onSelect) this.opts.onSelect(sel);
    }

    fit() {
      const b = this.d.bounds();
      const W = this.svg.clientWidth || 800, H = this.svg.clientHeight || 600;
      if (!b) { this.t = { x: 40, y: 40, k: 1 }; return this._apply(); }
      const k = Math.min((W - 80) / Math.max(b.w + 60, 1), (H - 80) / Math.max(b.h + 40, 1), 1.25);
      this.t = { k, x: (W - b.w * k) / 2 - b.minX * k, y: (H - b.h * k) / 2 - b.minY * k };
      this._apply();
    }

    zoom(factor, cx, cy) {
      const W = this.svg.clientWidth, H = this.svg.clientHeight;
      if (cx === undefined) { cx = W / 2; cy = H / 2; }
      const k = Math.min(4, Math.max(0.15, this.t.k * factor));
      const f = k / this.t.k;
      this.t = { k, x: cx - (cx - this.t.x) * f, y: cy - (cy - this.t.y) * f };
      this._apply();
    }

    /** Diagram coordinates of the visible centre (for placing new nodes). */
    viewCenter() {
      return this._toDiagram({ clientX: this.svg.getBoundingClientRect().left + this.svg.clientWidth / 2, clientY: this.svg.getBoundingClientRect().top + this.svg.clientHeight / 2 });
    }

    deleteSelection() {
      const s = this.selection;
      if (!s) return;
      if (s.kind === 'node') this.d.removeNode(s.id); else this.d.removeEdge(s.id);
    }

    // ---------------------------------------------------------------- internals
    _apply() { this.vp.setAttribute('transform', `translate(${this.t.x},${this.t.y}) scale(${this.t.k})`); }

    _toDiagram(e) {
      const r = this.svg.getBoundingClientRect();
      return { x: (e.clientX - r.left - this.t.x) / this.t.k, y: (e.clientY - r.top - this.t.y) / this.t.k };
    }

    _hit(e) {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (!el || !this.svg.contains(el)) return {};
      const port = el.closest('[data-port]');
      const item = el.closest('[data-kind]');
      return { port: port && port.getAttribute('data-port'), kind: item && item.getAttribute('data-kind'), id: item && item.getAttribute('data-id') };
    }

    _down(e) {
      if (e.button !== 0 && e.button !== 1) return;
      if (this._editor) this._editor.blur();
      const hit = this._hit(e);
      const p = this._toDiagram(e);
      if (e.button === 1 || !hit.kind) {
        if (e.button === 0) this.select(null);
        this.mode = { type: 'pan', sx: e.clientX, sy: e.clientY, tx: this.t.x, ty: this.t.y };
        this.svg.classList.add('dg-panning');
      } else if (hit.port && this.editable) {
        const n = this.d.getNode(hit.id);
        this.mode = { type: 'connect', from: hit.id, start: Core.anchor(n, hit.port) };
      } else {
        this.select({ kind: hit.kind, id: hit.id });
        if (hit.kind === 'node' && this.editable) {
          const n = this.d.getNode(hit.id);
          const moving = [n].concat(n.type === 'group' ? this.d.nodes.filter((m) => m.group === n.id) : []);
          this.mode = { type: 'drag', start: p, before: JSON.stringify(this.d.doc), items: moving.map((m) => ({ n: m, x: m.x, y: m.y })), moved: false };
        }
      }
      e.preventDefault();
    }

    _move(e) {
      const m = this.mode;
      if (!m) return;
      if (m.type === 'pan') {
        this.t.x = m.tx + (e.clientX - m.sx);
        this.t.y = m.ty + (e.clientY - m.sy);
        this._apply();
      } else if (m.type === 'drag') {
        const p = this._toDiagram(e);
        const dx = p.x - m.start.x, dy = p.y - m.start.y;
        if (!m.moved && Math.hypot(dx, dy) < 3) return;
        m.moved = true;
        const lead = m.items[0];
        const sx = snap(lead.x + dx) - lead.x, sy = snap(lead.y + dy) - lead.y;
        for (const it of m.items) { it.n.x = it.x + sx; it.n.y = it.y + sy; }
        this.d._fitGroups();
        this.render();
      } else if (m.type === 'connect') {
        const p = this._toDiagram(e);
        this.overlay.innerHTML = `<line x1="${m.start.x}" y1="${m.start.y}" x2="${p.x}" y2="${p.y}" stroke="#2563EB" stroke-width="2" stroke-dasharray="5 4"/><circle cx="${p.x}" cy="${p.y}" r="4" fill="#2563EB"/>`;
      }
    }

    _up(e) {
      const m = this.mode;
      this.mode = null;
      this.svg.classList.remove('dg-panning');
      if (!m) return;
      if (m.type === 'drag' && m.moved) this.d._commit(m.before);
      if (m.type === 'connect') {
        this.overlay.innerHTML = '';
        const hit = this._hit(e);
        try {
          if (hit.kind === 'node' && hit.id !== m.from) {
            const id = this.d.addEdge({ from: m.from, to: hit.id });
            this.select({ kind: 'edge', id });
          } else if (!hit.kind && this.svg.contains(e.target)) {
            const p = this._toDiagram(e);
            const src = this.d.getNode(m.from);
            const type = src && src.type !== 'group' && src.type !== 'terminator' ? src.type : 'process';
            const t = Core.NODE_TYPES[type];
            const id = this.d.transaction((d) => {
              const nid = d.addNode({ type, label: 'New step', x: snap(p.x - t.w / 2), y: snap(p.y - t.h / 2) });
              d.addEdge({ from: m.from, to: nid });
              return nid;
            });
            this.select({ kind: 'node', id });
            this.editLabel({ kind: 'node', id });
          }
        } catch (err) { this._error(err); }
      }
    }

    _wheel(e) {
      e.preventDefault();
      const r = this.svg.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) >= Math.abs(e.deltaX)) {
        this.zoom(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX - r.left, e.clientY - r.top);
      } else {
        this.t.x -= e.deltaX; this._apply();
      }
    }

    _dbl(e) {
      if (!this.editable) return;
      const hit = this._hit(e);
      if (hit.kind) return this.editLabel({ kind: hit.kind, id: hit.id }, e);
      const p = this._toDiagram(e);
      const t = Core.NODE_TYPES.process;
      const id = this.d.addNode({ type: 'process', label: '', x: snap(p.x - t.w / 2), y: snap(p.y - t.h / 2) });
      this.select({ kind: 'node', id });
      this.editLabel({ kind: 'node', id });
    }

    /** Inline label editor over a node or edge. */
    editLabel(sel, evt) {
      if (!this.editable || !sel) return;
      const item = sel.kind === 'node' ? this.d.getNode(sel.id) : this.d.getEdge(sel.id);
      if (!item) return;
      const ta = document.createElement('textarea');
      ta.className = 'dg-inline-editor';
      ta.value = item.label || '';
      const k = this.t.k;
      let left, top, width, height;
      if (sel.kind === 'node') {
        left = item.x * k + this.t.x; top = item.y * k + this.t.y; width = item.w * k; height = item.h * k;
      } else {
        const a = this.d.getNode(item.from), b = this.d.getNode(item.to);
        const mid = Core.edgeGeometry(item, a, b, this.d.meta.direction).mid;
        width = 140; height = 34;
        left = mid.x * k + this.t.x - width / 2; top = mid.y * k + this.t.y - height / 2;
      }
      Object.assign(ta.style, { left: left + 'px', top: top + 'px', width: Math.max(width, 80) + 'px', height: Math.max(height, 30) + 'px', fontSize: Math.max(11, 13 * k) + 'px' });
      this.c.appendChild(ta);
      this._editor = ta;
      ta.focus();
      ta.select();
      let done = false;
      const finish = (save) => {
        if (done) return;
        done = true;
        this._editor = null;
        const val = ta.value;
        ta.remove();
        if (save && val !== (item.label || '')) {
          try {
            if (sel.kind === 'node') this.d.updateNode(sel.id, { label: val });
            else this.d.updateEdge(sel.id, { label: val });
          } catch (err) { this._error(err); }
        }
      };
      ta.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Escape') finish(false);
        else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); finish(true); }
      });
      ta.addEventListener('blur', () => finish(true));
    }

    _key(e) {
      const tgt = e.target;
      if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.tagName === 'SELECT' || tgt.isContentEditable)) return;
      const mod = e.ctrlKey || e.metaKey;
      try {
        if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) this.d.redo(); else this.d.undo(); }
        else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); this.d.redo(); }
        else if (!this.editable) return;
        else if (e.key === 'Delete' || e.key === 'Backspace') { if (this.selection) { e.preventDefault(); this.deleteSelection(); } }
        else if (e.key === 'Escape') this.select(null);
        else if (e.key === 'Enter' || e.key === 'F2') { if (this.selection) { e.preventDefault(); this.editLabel(this.selection); } }
        else if (e.key.startsWith('Arrow') && this.selection && this.selection.kind === 'node') {
          e.preventDefault();
          const step = e.shiftKey ? GRID * 5 : GRID;
          const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
          this.d.moveNode(this.selection.id, { dx: d[0], dy: d[1] });
        }
      } catch (err) { this._error(err); }
    }

    _error(err) {
      if (this.opts.onError) this.opts.onError(err); else console.error(err);
    }
  }

  root.DiagramView = DiagramView;
})(typeof globalThis !== 'undefined' ? globalThis : this);

/*
 * diagram-core.js — JSON diagram model, edit operations, auto-layout and SVG/HTML rendering.
 *
 * No dependencies. Works in the browser (window.DiagramCore) and in Node (require('./diagram-core')).
 *
 * The diagram JSON is the single source of truth:
 *   { "version": 1, "meta": {...}, "nodes": [...], "edges": [...] }
 * Every change goes through the Diagram class (or its applyOps() batch API), so the browser editor,
 * the CLI and an AI assistant all edit diagrams the same way. See API.md for the full reference.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DiagramCore = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const VERSION = 1;
  const FONT = 'Inter, "Segoe UI", system-ui, -apple-system, Helvetica, Arial, sans-serif';
  const SIDES = ['top', 'right', 'bottom', 'left'];
  const DIRS = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0] };

  /** Node types: default size and colours. */
  const NODE_TYPES = {
    process:    { w: 140, h: 60,  fill: '#EEF2FF', stroke: '#4F46E5', desc: 'Rectangle: a step or action' },
    decision:   { w: 150, h: 90,  fill: '#FEF3C7', stroke: '#D97706', desc: 'Diamond: a yes/no or branching question' },
    terminator: { w: 140, h: 54,  fill: '#DCFCE7', stroke: '#16A34A', desc: 'Pill: start or end' },
    data:       { w: 150, h: 60,  fill: '#E0F2FE', stroke: '#0284C7', desc: 'Parallelogram: input/output' },
    document:   { w: 140, h: 70,  fill: '#F5F3FF', stroke: '#7C3AED', desc: 'Document with wavy bottom' },
    database:   { w: 110, h: 80,  fill: '#FCE7F3', stroke: '#DB2777', desc: 'Cylinder: database or storage' },
    circle:     { w: 72,  h: 72,  fill: '#F1F5F9', stroke: '#475569', desc: 'Circle/ellipse: event, connector, state' },
    note:       { w: 160, h: 80,  fill: '#FEF9C3', stroke: '#CA8A04', desc: 'Sticky note with folded corner' },
    text:       { w: 120, h: 30,  fill: 'none',    stroke: 'none',    desc: 'Free text, no border' },
    group:      { w: 320, h: 220, fill: '#F8FAFC', stroke: '#94A3B8', desc: 'Container; members set "group": "<groupId>" and it auto-fits around them' },
  };
  const TEXT_COLOR = '#1E293B';
  const EDGE_COLOR = '#475569';

  class DiagramError extends Error {
    constructor(msg) { super(msg); this.name = 'DiagramError'; }
  }

  // ---------------------------------------------------------------- helpers
  const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
  const num = (v) => (v === null || v === undefined || v === '' || !isFinite(Number(v)) ? undefined : Number(v));
  const r1 = (n) => Math.round(n * 10) / 10;
  const isPlaced = (n) => n.x !== undefined && n.y !== undefined;

  function slug(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);
  }
  /** Shallow merge where a null value deletes the key. */
  function merge(base, patch) {
    const out = Object.assign({}, base || {});
    for (const k of Object.keys(patch || {})) {
      if (patch[k] === null) delete out[k];
      else out[k] = patch[k];
    }
    return out;
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function normNode(raw) {
    if (!raw || typeof raw !== 'object') throw new DiagramError('A node must be an object');
    const type = raw.type || 'process';
    const t = NODE_TYPES[type];
    if (!t) throw new DiagramError(`Unknown node type "${type}". Use one of: ${Object.keys(NODE_TYPES).join(', ')}`);
    const n = { id: raw.id != null && raw.id !== '' ? String(raw.id) : undefined, type, label: raw.label == null ? '' : String(raw.label) };
    n.x = num(raw.x);
    n.y = num(raw.y);
    n.w = num(raw.w) ?? t.w;
    n.h = num(raw.h) ?? t.h;
    if (raw.group != null && raw.group !== '') n.group = String(raw.group);
    if (raw.style && typeof raw.style === 'object' && Object.keys(raw.style).length) n.style = clone(raw.style);
    if (raw.data !== undefined && raw.data !== null) n.data = clone(raw.data);
    return n;
  }

  function normEdge(raw) {
    if (!raw || typeof raw !== 'object') throw new DiagramError('An edge must be an object');
    if (raw.from == null || raw.to == null) throw new DiagramError('An edge needs "from" and "to" node ids');
    const e = { id: raw.id != null && raw.id !== '' ? String(raw.id) : undefined, from: String(raw.from), to: String(raw.to) };
    if (raw.label != null && raw.label !== '') e.label = String(raw.label);
    for (const k of ['fromSide', 'toSide']) {
      if (raw[k] && raw[k] !== 'auto') {
        if (!SIDES.includes(raw[k])) throw new DiagramError(`Edge ${k} must be one of: auto, ${SIDES.join(', ')}`);
        e[k] = raw[k];
      }
    }
    if (raw.style && typeof raw.style === 'object' && Object.keys(raw.style).length) e.style = clone(raw.style);
    if (raw.data !== undefined && raw.data !== null) e.data = clone(raw.data);
    return e;
  }

  function overlaps(a, b, pad) {
    return a.x < b.x + b.w + pad && a.x + a.w + pad > b.x && a.y < b.y + b.h + pad && a.y + a.h + pad > b.y;
  }

  function bounds(nodes) {
    const list = nodes.filter(isPlaced);
    if (!list.length) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of list) {
      minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + n.w); maxY = Math.max(maxY, n.y + n.h);
    }
    return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
  }

  /** Compact, diff-friendly JSON: one node / edge per line. */
  function stringify(doc) {
    const list = (arr) => (arr.length ? '[\n' + arr.map((x) => '    ' + JSON.stringify(x)).join(',\n') + '\n  ]' : '[]');
    return '{\n' +
      `  "version": ${doc.version},\n` +
      `  "meta": ${JSON.stringify(doc.meta)},\n` +
      `  "nodes": ${list(doc.nodes)},\n` +
      `  "edges": ${list(doc.edges)}\n` +
      '}\n';
  }

  /** Accepts a diagram object, JSON text, or an HTML page exported by this tool. */
  function parse(input) {
    if (input && typeof input === 'object') return input;
    const text = String(input || '').trim();
    if (text.startsWith('<')) {
      const m = text.match(/<script[^>]*id=["']diagram-data["'][^>]*>([\s\S]*?)<\/script>/i);
      if (!m) throw new DiagramError('No <script id="diagram-data"> block found in this HTML');
      return JSON.parse(m[1]);
    }
    try { return JSON.parse(text || '{}'); }
    catch (err) { throw new DiagramError('Invalid JSON: ' + err.message); }
  }

  // ---------------------------------------------------------------- Diagram
  class Diagram {
    constructor(doc) {
      this._listeners = new Set();
      this._undo = [];
      this._redo = [];
      this._depth = 0;
      this._unplaced = new Set();
      this._load(doc || {});
    }

    static fromJSON(input) { return new Diagram(input); }

    // ---- reading
    get meta() { return this.doc.meta; }
    get nodes() { return this.doc.nodes; }
    get edges() { return this.doc.edges; }
    getNode(id) { return this.doc.nodes.find((n) => n.id === String(id)) || null; }
    getEdge(id) { return this.doc.edges.find((e) => e.id === String(id)) || null; }
    /** Find nodes by predicate, or by {type, label, group} (label match is case-insensitive substring). */
    findNodes(q) {
      if (typeof q === 'function') return this.doc.nodes.filter(q);
      q = q || {};
      return this.doc.nodes.filter((n) =>
        (q.type == null || n.type === q.type) &&
        (q.group == null || n.group === q.group) &&
        (q.label == null || n.label.toLowerCase().includes(String(q.label).toLowerCase())));
    }
    /** Edges touching a node. dir: 'in' | 'out' | 'both' (default). */
    edgesOf(id, dir = 'both') {
      id = String(id);
      return this.doc.edges.filter((e) => (dir !== 'in' && e.from === id) || (dir !== 'out' && e.to === id));
    }
    bounds() { return bounds(this.doc.nodes); }
    toJSON() { return clone(this.doc); }
    toString() { return stringify(this.doc); }
    toSVG(opts) { return renderSVG(this.doc, opts); }
    toHTML(opts) { return renderHTML(this.doc, opts); }
    /** Human/AI-readable outline of the diagram. */
    summary() { return summary(this.doc); }

    validate() {
      const errors = [];
      const ids = new Set();
      for (const n of this.doc.nodes) {
        if (ids.has(n.id)) errors.push(`Duplicate node id "${n.id}"`);
        ids.add(n.id);
        if (n.group && !this.doc.nodes.some((g) => g.id === n.group && g.type === 'group')) errors.push(`Node "${n.id}" has group "${n.group}" which is not a group node`);
      }
      const eids = new Set();
      for (const e of this.doc.edges) {
        if (eids.has(e.id)) errors.push(`Duplicate edge id "${e.id}"`);
        eids.add(e.id);
        if (!ids.has(e.from)) errors.push(`Edge "${e.id}" starts at missing node "${e.from}"`);
        if (!ids.has(e.to)) errors.push(`Edge "${e.id}" ends at missing node "${e.to}"`);
      }
      return errors;
    }

    // ---- events / history
    onChange(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn); }
    _emit() { for (const fn of this._listeners) { try { fn(this); } catch (e) { console.error(e); } } }
    canUndo() { return this._undo.length > 0; }
    canRedo() { return this._redo.length > 0; }
    undo() {
      if (!this._undo.length) return false;
      this._redo.push(JSON.stringify(this.doc));
      this.doc = JSON.parse(this._undo.pop());
      this._emit();
      return true;
    }
    redo() {
      if (!this._redo.length) return false;
      this._undo.push(JSON.stringify(this.doc));
      this.doc = JSON.parse(this._redo.pop());
      this._emit();
      return true;
    }
    /** Run fn as one atomic, undoable change. Any error rolls the whole thing back. */
    transaction(fn) {
      const outer = this._depth === 0;
      const before = outer ? JSON.stringify(this.doc) : null;
      this._depth++;
      let result;
      try {
        result = fn(this);
        if (outer) { this._placePending(); this._fitGroups(); }
      } catch (err) {
        this._depth--;
        if (outer) { this.doc = JSON.parse(before); this._unplaced.clear(); }
        throw err;
      }
      this._depth--;
      if (outer) this._commit(before);
      return result;
    }
    /** Record a change made by mutating this.doc directly (used by the editor while dragging). */
    _commit(before) {
      this._fitGroups();
      if (JSON.stringify(this.doc) === before) return;
      this._undo.push(before);
      if (this._undo.length > 200) this._undo.shift();
      this._redo = [];
      this._emit();
    }

    // ---- whole-document
    load(input) { return this.transaction(() => this._load(input)); }
    clear() { return this.transaction(() => { this.doc.nodes = []; this.doc.edges = []; }); }
    setMeta(patch) { return this.transaction(() => { this.doc.meta = merge(this.doc.meta, patch); }); }

    _load(input) {
      const raw = parse(input);
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new DiagramError('A diagram must be a JSON object');
      this.doc = { version: VERSION, meta: Object.assign({ title: 'Untitled diagram', direction: 'TB' }, raw.meta || {}), nodes: [], edges: [] };
      this._unplaced = new Set();
      for (const n of raw.nodes || []) this._addNode(n);
      for (const e of raw.edges || []) this._addEdge(e);
      if (this._depth === 0) { this._placePending(); this._fitGroups(); }
    }

    // ---- nodes
    _uniqueId(base, taken) {
      base = base || 'n';
      if (!taken(base)) return base;
      let i = 2;
      while (taken(`${base}-${i}`)) i++;
      return `${base}-${i}`;
    }
    _addNode(raw) {
      const n = normNode(raw);
      if (n.id === undefined) n.id = this._uniqueId(slug(n.label) || n.type, (id) => !!this.getNode(id));
      else if (this.getNode(n.id)) throw new DiagramError(`Node id "${n.id}" already exists`);
      this.doc.nodes.push(n);
      if (!isPlaced(n)) this._unplaced.add(n.id);
      return n.id;
    }
    _requireNode(id) {
      const n = this.getNode(id);
      if (!n) throw new DiagramError(`No node with id "${id}". Existing ids: ${this.doc.nodes.map((x) => x.id).join(', ') || '(none)'}`);
      return n;
    }
    /** Add a node. Omit x/y to have it placed automatically. Returns the node id. */
    addNode(spec) { return this.transaction(() => this._addNode(spec || {})); }
    /** Patch a node: {label, type, x, y, w, h, group, style:{...}, data:{...}}. style/data are merged; null removes a key. */
    updateNode(id, patch) {
      return this.transaction(() => {
        const old = this._requireNode(id);
        patch = Object.assign({}, patch);
        if ('id' in patch && patch.id !== old.id) throw new DiagramError('Use renameNode to change a node id');
        const next = Object.assign({}, old, patch, { id: old.id });
        if ('style' in patch) next.style = patch.style === null ? undefined : merge(old.style, patch.style);
        if ('data' in patch) next.data = patch.data === null || typeof patch.data !== 'object' || Array.isArray(patch.data) ? patch.data : merge(old.data, patch.data);
        if ('group' in patch && (patch.group === null || patch.group === '')) delete next.group;
        if (patch.type && patch.type !== old.type && NODE_TYPES[patch.type] && NODE_TYPES[old.type]) {
          if (patch.w == null && old.w === NODE_TYPES[old.type].w) next.w = NODE_TYPES[patch.type].w;
          if (patch.h == null && old.h === NODE_TYPES[old.type].h) next.h = NODE_TYPES[patch.type].h;
        }
        const n = normNode(next);
        if (n.x === undefined) n.x = old.x;
        if (n.y === undefined) n.y = old.y;
        this.doc.nodes[this.doc.nodes.indexOf(old)] = n;
        return n.id;
      });
    }
    /** Move a node (a group moves its members too). Pass {dx, dy} as x for a relative move. */
    moveNode(id, x, y) {
      return this.transaction(() => {
        const n = this._requireNode(id);
        let dx, dy;
        if (x && typeof x === 'object') { dx = num(x.dx) || 0; dy = num(x.dy) || 0; }
        else { dx = (num(x) ?? n.x) - n.x; dy = (num(y) ?? n.y) - n.y; }
        n.x += dx; n.y += dy;
        if (n.type === 'group') for (const m of this.doc.nodes) if (m.group === n.id) { m.x += dx; m.y += dy; }
        return n.id;
      });
    }
    /** Remove a node and every edge connected to it. Members of a removed group are kept. */
    removeNode(id) {
      return this.transaction(() => {
        const n = this._requireNode(id);
        this.doc.nodes = this.doc.nodes.filter((x) => x !== n);
        this.doc.edges = this.doc.edges.filter((e) => e.from !== n.id && e.to !== n.id);
        for (const m of this.doc.nodes) if (m.group === n.id) delete m.group;
        return n.id;
      });
    }
    renameNode(id, newId) {
      return this.transaction(() => {
        const n = this._requireNode(id);
        newId = String(newId || '').trim();
        if (!newId) throw new DiagramError('New id must not be empty');
        if (newId === n.id) return n.id;
        if (this.getNode(newId)) throw new DiagramError(`Node id "${newId}" already exists`);
        for (const e of this.doc.edges) { if (e.from === n.id) e.from = newId; if (e.to === n.id) e.to = newId; }
        for (const m of this.doc.nodes) if (m.group === n.id) m.group = newId;
        n.id = newId;
        return newId;
      });
    }

    // ---- edges
    _addEdge(raw) {
      const e = normEdge(raw);
      this._requireNode(e.from);
      this._requireNode(e.to);
      if (e.id === undefined) {
        let i = this.doc.edges.length + 1;
        while (this.getEdge('e' + i)) i++;
        e.id = 'e' + i;
      } else if (this.getEdge(e.id)) throw new DiagramError(`Edge id "${e.id}" already exists`);
      this.doc.edges.push(e);
      return e.id;
    }
    _requireEdge(id) {
      const e = this.getEdge(id);
      if (!e) throw new DiagramError(`No edge with id "${id}"`);
      return e;
    }
    /** Add an edge {from, to, label, fromSide, toSide, style}. Returns the edge id. */
    addEdge(spec) { return this.transaction(() => this._addEdge(spec || {})); }
    /** Shorthand: connect('a', 'b', 'yes') or connect('a', 'b', {label, style}). */
    connect(from, to, opts) {
      const extra = typeof opts === 'string' ? { label: opts } : (opts || {});
      return this.addEdge(Object.assign({}, extra, { from, to }));
    }
    updateEdge(id, patch) {
      return this.transaction(() => {
        const old = this._requireEdge(id);
        patch = Object.assign({}, patch);
        const next = Object.assign({}, old, patch, { id: old.id });
        if ('style' in patch) next.style = patch.style === null ? undefined : merge(old.style, patch.style);
        if (patch.label === null || patch.label === '') delete next.label;
        const e = normEdge(next);
        this._requireNode(e.from);
        this._requireNode(e.to);
        this.doc.edges[this.doc.edges.indexOf(old)] = e;
        return e.id;
      });
    }
    /** removeEdge('e3') or removeEdge('fromId', 'toId') (removes all edges between them). */
    removeEdge(idOrFrom, to) {
      return this.transaction(() => {
        const before = this.doc.edges.length;
        if (to === undefined) this._requireEdge(idOrFrom);
        this.doc.edges = this.doc.edges.filter((e) =>
          to === undefined ? e.id !== String(idOrFrom) : !(e.from === String(idOrFrom) && e.to === String(to)));
        if (this.doc.edges.length === before) throw new DiagramError(`No edge from "${idOrFrom}" to "${to}"`);
        return before - this.doc.edges.length;
      });
    }
    /** Split the edge from→to with a new node; downstream nodes shift to make room. Returns the new node id. */
    insertBetween(from, to, nodeSpec) {
      return this.transaction(() => {
        const edge = this.doc.edges.find((e) => e.from === String(from) && e.to === String(to));
        if (!edge) throw new DiagramError(`No edge from "${from}" to "${to}" to insert into`);
        const a = this._requireNode(from);
        const spec = Object.assign({}, nodeSpec);
        const auto = num(spec.x) === undefined || num(spec.y) === undefined;
        const id = this._addNode(spec);
        const n = this.getNode(id);
        if (auto) {
          this._unplaced.delete(id);
          const horiz = this.doc.meta.direction === 'LR';
          const gap = 70;
          if (horiz) {
            n.x = a.x + a.w + gap; n.y = a.y + a.h / 2 - n.h / 2;
            for (const m of this.doc.nodes) if (m !== n && m.x >= n.x - 1 && m.type !== 'group') m.x += n.w + gap;
          } else {
            n.x = a.x + a.w / 2 - n.w / 2; n.y = a.y + a.h + gap;
            for (const m of this.doc.nodes) if (m !== n && m.y >= n.y - 1 && m.type !== 'group') m.y += n.h + gap;
          }
        }
        const at = this.doc.edges.indexOf(edge);
        this.doc.edges.splice(at, 1);
        const first = Object.assign({}, edge, { to: id });
        delete first.toSide;
        this._addEdge(first);
        this._addEdge({ from: id, to: edge.to, style: edge.style });
        // keep the two new edges where the original edge was in the list
        const added = this.doc.edges.splice(this.doc.edges.length - 2, 2);
        this.doc.edges.splice(at, 0, ...added);
        return id;
      });
    }

    // ---- layout
    /** Layered auto-layout. opts: {direction: 'TB'|'LR', rankGap, nodeGap}. */
    layout(opts) { return this.transaction(() => this._layout(opts || {})); }

    _layout(opts) {
      const dir = String(opts.direction || this.doc.meta.direction || 'TB').toUpperCase() === 'LR' ? 'LR' : 'TB';
      this.doc.meta.direction = dir;
      const horiz = dir === 'LR';
      const rankGap = num(opts.rankGap) ?? (horiz ? 90 : 70);
      const nodeGap = num(opts.nodeGap) ?? 50;
      const nodes = this.doc.nodes.filter((n) => n.type !== 'group');
      const N = nodes.length;
      if (!N) return;
      const idx = new Map(nodes.map((n, i) => [n.id, i]));
      const out = nodes.map(() => []);
      const hasIn = new Array(N).fill(false);
      for (const e of this.doc.edges) {
        const a = idx.get(e.from), b = idx.get(e.to);
        if (a == null || b == null || a === b) continue;
        out[a].push(b); hasIn[b] = true;
      }
      // Break cycles with a DFS (back edges are ignored for ranking).
      const state = new Array(N).fill(0);
      const dag = nodes.map(() => []);
      const visit = (u) => {
        state[u] = 1;
        for (const v of out[u]) {
          if (state[v] === 1) continue;
          dag[u].push(v);
          if (state[v] === 0) visit(v);
        }
        state[u] = 2;
      };
      for (let i = 0; i < N; i++) if (!hasIn[i] && !state[i]) visit(i);
      for (let i = 0; i < N; i++) if (!state[i]) visit(i);
      // Longest-path ranking.
      const indeg = new Array(N).fill(0);
      dag.forEach((vs) => vs.forEach((v) => indeg[v]++));
      const rank = new Array(N).fill(0);
      const queue = [];
      for (let i = 0; i < N; i++) if (!indeg[i]) queue.push(i);
      while (queue.length) {
        const u = queue.shift();
        for (const v of dag[u]) {
          rank[v] = Math.max(rank[v], rank[u] + 1);
          if (--indeg[v] === 0) queue.push(v);
        }
      }
      const preds = nodes.map(() => []);
      dag.forEach((vs, u) => vs.forEach((v) => preds[v].push(u)));
      const layers = [];
      for (let i = 0; i < N; i++) (layers[rank[i]] = layers[rank[i]] || []).push(i);
      for (let r = 0; r < layers.length; r++) layers[r] = layers[r] || [];
      // Reduce crossings: barycenter sweeps.
      const pos = new Array(N).fill(0);
      const setPos = () => layers.forEach((L) => L.forEach((v, i) => { pos[v] = i; }));
      setPos();
      const sweep = (r, nbrs) => {
        const L = layers[r];
        const key = new Map(L.map((v) => {
          const ns = nbrs[v];
          return [v, ns.length ? ns.reduce((s, u) => s + pos[u], 0) / ns.length : pos[v]];
        }));
        L.sort((a, b) => key.get(a) - key.get(b) || pos[a] - pos[b]);
        L.forEach((v, i) => { pos[v] = i; });
      };
      for (let it = 0; it < 4; it++) {
        for (let r = 1; r < layers.length; r++) sweep(r, preds);
        for (let r = layers.length - 2; r >= 0; r--) sweep(r, dag);
      }
      // Coordinates.
      const mainSize = (n) => (horiz ? n.w : n.h);
      const crossSize = (n) => (horiz ? n.h : n.w);
      let mainPos = 0;
      for (const L of layers) {
        const band = Math.max(...L.map((v) => mainSize(nodes[v])));
        const total = L.reduce((s, v) => s + crossSize(nodes[v]), 0) + nodeGap * (L.length - 1);
        let c = -total / 2;
        for (const v of L) {
          const n = nodes[v];
          const m = mainPos + (band - mainSize(n)) / 2;
          if (horiz) { n.x = m; n.y = c; } else { n.x = c; n.y = m; }
          c += crossSize(n) + nodeGap;
        }
        mainPos += band + rankGap;
      }
      const b = bounds(nodes);
      for (const n of nodes) {
        n.x = Math.round(n.x - b.minX + 40);
        n.y = Math.round(n.y - b.minY + 40);
        this._unplaced.delete(n.id);
      }
    }

    /** Give positions to nodes that were added without x/y. */
    _placePending() {
      if (!this._unplaced.size) return;
      const content = this.doc.nodes.filter((n) => n.type !== 'group');
      const unplacedContent = content.filter((n) => this._unplaced.has(n.id));
      if (content.length && unplacedContent.length === content.length) this._layout({});
      for (const id of [...this._unplaced]) {
        const n = this.getNode(id);
        this._unplaced.delete(id);
        if (!n || isPlaced(n)) continue;
        if (n.type === 'group' && this.doc.nodes.some((m) => m.group === n.id)) continue; // fitted later
        this._autoPlace(n);
      }
    }

    _autoPlace(n) {
      const horiz = this.doc.meta.direction === 'LR';
      const gap = horiz ? 90 : 70;
      const placed = this.doc.nodes.filter((m) => m !== n && isPlaced(m) && m.type !== 'group');
      if (!placed.length) { n.x = 40; n.y = 40; return; }
      let anchor = null, after = true;
      for (const e of this.doc.edges) {
        if (e.to === n.id) { const m = this.getNode(e.from); if (m && m !== n && isPlaced(m)) { anchor = m; break; } }
      }
      if (!anchor) {
        for (const e of this.doc.edges) {
          if (e.from === n.id) { const m = this.getNode(e.to); if (m && m !== n && isPlaced(m)) { anchor = m; after = false; break; } }
        }
      }
      if (anchor) {
        if (horiz) { n.x = after ? anchor.x + anchor.w + gap : anchor.x - n.w - gap; n.y = anchor.y + anchor.h / 2 - n.h / 2; }
        else { n.x = anchor.x + anchor.w / 2 - n.w / 2; n.y = after ? anchor.y + anchor.h + gap : anchor.y - n.h - gap; }
      } else {
        const b = bounds(placed);
        if (horiz) { n.x = b.minX; n.y = b.maxY + gap; } else { n.x = b.maxX + gap; n.y = b.minY; }
      }
      for (let guard = 0; guard < 60 && placed.some((m) => overlaps(n, m, 20)); guard++) {
        if (horiz) n.y += n.h + 40; else n.x += n.w + 40;
      }
      n.x = Math.round(n.x); n.y = Math.round(n.y);
    }

    /** Groups with members resize to wrap them. */
    _fitGroups() {
      for (const g of this.doc.nodes) {
        if (g.type !== 'group') continue;
        const members = this.doc.nodes.filter((m) => m.group === g.id && m.type !== 'group' && isPlaced(m));
        if (!members.length) continue;
        const b = bounds(members);
        g.x = b.minX - 24; g.y = b.minY - 40; g.w = b.w + 48; g.h = b.h + 64;
      }
    }

    // ---- batch operations (the main AI-facing API)
    /**
     * Apply a list of operations atomically (all succeed or nothing changes; one undo step).
     * Returns one result per op (the affected id). See OPS / API.md for the op list.
     */
    applyOps(ops) {
      if (typeof ops === 'string') ops = parse(ops);
      if (ops && !Array.isArray(ops)) ops = Array.isArray(ops.ops) ? ops.ops : [ops];
      return this.transaction(() => ops.map((op, i) => {
        try { return this._applyOp(op); }
        catch (err) { throw new DiagramError(`Op #${i + 1} (${op && op.op}): ${err.message}`); }
      }));
    }

    _applyOp(op) {
      if (!op || typeof op !== 'object') throw new DiagramError('Each op must be an object like {"op": "addNode", ...}');
      const { op: name } = op;
      const rest = Object.assign({}, op);
      delete rest.op;
      const patchOf = () => {
        if (op.set) return op.set;
        const p = Object.assign({}, rest);
        delete p.id;
        return p;
      };
      switch (name) {
        case 'addNode': return this._addNode(rest);
        case 'updateNode': return this.updateNode(op.id, patchOf());
        case 'moveNode': return op.dx !== undefined || op.dy !== undefined ? this.moveNode(op.id, { dx: op.dx, dy: op.dy }) : this.moveNode(op.id, op.x, op.y);
        case 'removeNode': return this.removeNode(op.id);
        case 'renameNode': return this.renameNode(op.id, op.newId);
        case 'addEdge': return this._addEdge(rest);
        case 'updateEdge': return this.updateEdge(op.id, patchOf());
        case 'removeEdge': return op.id !== undefined ? this.removeEdge(op.id) : this.removeEdge(op.from, op.to);
        case 'insertBetween': return this.insertBetween(op.from, op.to, op.node || {});
        case 'setMeta': return this.setMeta(patchOf());
        case 'layout': this._layout(rest); return 'layout';
        case 'clear': this.doc.nodes = []; this.doc.edges = []; return 'clear';
        default: throw new DiagramError(`Unknown op "${name}". Valid ops: ${OPS.map((o) => o.op).join(', ')}`);
      }
    }
  }

  /** Reference list of operations (used by the editor's help and the CLI). */
  const OPS = [
    { op: 'addNode', example: { op: 'addNode', id: 'check', type: 'decision', label: 'In stock?' }, note: 'x/y optional: omitted = auto-placed next to connected nodes' },
    { op: 'updateNode', example: { op: 'updateNode', id: 'check', set: { label: 'Item in stock?', style: { fill: '#FFE4E6' } } }, note: 'style/data merge; null removes a key' },
    { op: 'moveNode', example: { op: 'moveNode', id: 'check', x: 300, y: 200 }, note: 'or {dx, dy} for a relative move' },
    { op: 'removeNode', example: { op: 'removeNode', id: 'check' }, note: 'also removes its edges' },
    { op: 'renameNode', example: { op: 'renameNode', id: 'check', newId: 'stock-check' }, note: 'edges follow' },
    { op: 'addEdge', example: { op: 'addEdge', from: 'check', to: 'ship', label: 'yes' }, note: 'optional id, fromSide/toSide, style' },
    { op: 'updateEdge', example: { op: 'updateEdge', id: 'e3', set: { label: 'no', style: { dashed: true } } } },
    { op: 'removeEdge', example: { op: 'removeEdge', id: 'e3' }, note: 'or {from, to}' },
    { op: 'insertBetween', example: { op: 'insertBetween', from: 'pay', to: 'ship', node: { id: 'pack', label: 'Pack order' } }, note: 'splits an edge; downstream nodes shift' },
    { op: 'setMeta', example: { op: 'setMeta', set: { title: 'Order flow', direction: 'LR' } } },
    { op: 'layout', example: { op: 'layout', direction: 'TB' }, note: 'TB (top-bottom) or LR (left-right); re-positions everything' },
    { op: 'clear', example: { op: 'clear' }, note: 'removes all nodes and edges' },
  ];

  // ---------------------------------------------------------------- geometry
  function anchor(n, side) {
    const cx = n.x + n.w / 2, cy = n.y + n.h / 2;
    switch (side) {
      case 'top': return { x: cx, y: n.y };
      case 'bottom': return { x: cx, y: n.y + n.h };
      case 'left': return { x: n.x, y: cy };
      default: return { x: n.x + n.w, y: cy };
    }
  }

  function autoSides(a, b, dir) {
    const dx = (b.x + b.w / 2) - (a.x + a.w / 2);
    const dy = (b.y + b.h / 2) - (a.y + a.h / 2);
    const vGap = dy > 0 ? b.y - (a.y + a.h) : a.y - (b.y + b.h);
    const hGap = dx > 0 ? b.x - (a.x + a.w) : a.x - (b.x + b.w);
    if (vGap >= hGap) {
      if (dy > 0) return ['bottom', 'top'];
      if (dir === 'LR') return ['top', 'bottom'];
      return dx > 20 ? ['left', 'left'] : ['right', 'right']; // back edge loops round the source's outer side
    }
    if (dx > 0) return ['right', 'left'];
    if (dir !== 'LR') return ['left', 'right'];
    return dy > 20 ? ['top', 'top'] : ['bottom', 'bottom'];
  }

  function simplify(pts) {
    const out = [];
    for (const p of pts) {
      const last = out[out.length - 1];
      if (last && Math.abs(last.x - p.x) < 0.5 && Math.abs(last.y - p.y) < 0.5) continue;
      out.push(p);
    }
    for (let i = out.length - 2; i > 0; i--) {
      const a = out[i - 1], b = out[i], c = out[i + 1];
      if ((Math.abs(a.x - b.x) < 0.5 && Math.abs(b.x - c.x) < 0.5) || (Math.abs(a.y - b.y) < 0.5 && Math.abs(b.y - c.y) < 0.5)) out.splice(i, 1);
    }
    return out;
  }

  function orthogonal(p1, s1, p2, s2) {
    const G = 24;
    const d1 = DIRS[s1], d2 = DIRS[s2];
    const v1 = d1[0] === 0, v2 = d2[0] === 0;
    const q1 = { x: p1.x + d1[0] * G, y: p1.y + d1[1] * G };
    const q2 = { x: p2.x + d2[0] * G, y: p2.y + d2[1] * G };
    let pts;
    if (v1 && v2) {
      if (s1 === s2) {
        const y = s1 === 'bottom' ? Math.max(q1.y, q2.y) : Math.min(q1.y, q2.y);
        pts = [p1, { x: p1.x, y }, { x: p2.x, y }, p2];
      } else {
        const y = (p1.y + p2.y) / 2;
        pts = [p1, { x: p1.x, y }, { x: p2.x, y }, p2];
      }
    } else if (!v1 && !v2) {
      if (s1 === s2) {
        const x = s1 === 'right' ? Math.max(q1.x, q2.x) : Math.min(q1.x, q2.x);
        pts = [p1, { x, y: p1.y }, { x, y: p2.y }, p2];
      } else {
        const x = (p1.x + p2.x) / 2;
        pts = [p1, { x, y: p1.y }, { x, y: p2.y }, p2];
      }
    } else if (v1) {
      pts = [p1, { x: p1.x, y: p2.y }, p2];
    } else {
      pts = [p1, { x: p2.x, y: p1.y }, p2];
    }
    return simplify(pts);
  }

  function roundedPath(pts, radius) {
    const f = (p) => `${r1(p.x)},${r1(p.y)}`;
    let d = 'M' + f(pts[0]);
    for (let i = 1; i < pts.length - 1; i++) {
      const a = pts[i - 1], p = pts[i], b = pts[i + 1];
      const l1 = Math.hypot(p.x - a.x, p.y - a.y) || 1, l2 = Math.hypot(b.x - p.x, b.y - p.y) || 1;
      const rr = Math.min(radius, l1 / 2, l2 / 2);
      const s = { x: p.x + (a.x - p.x) / l1 * rr, y: p.y + (a.y - p.y) / l1 * rr };
      const t = { x: p.x + (b.x - p.x) / l2 * rr, y: p.y + (b.y - p.y) / l2 * rr };
      d += ` L${f(s)} Q${f(p)} ${f(t)}`;
    }
    return d + ' L' + f(pts[pts.length - 1]);
  }

  function polyMid(pts) {
    let total = 0;
    for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    let half = total / 2;
    for (let i = 1; i < pts.length; i++) {
      const L = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      if (half <= L) { const t = L ? half / L : 0; return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t }; }
      half -= L;
    }
    return pts[0];
  }

  /** Route an edge. Returns {d, start:{tip,from}, end:{tip,from}, mid}. */
  function edgeGeometry(e, a, b, dir) {
    if (a === b) {
      const R = a.x + a.w, cy = a.y + a.h / 2, cx = a.x + a.w / 2;
      const pts = [{ x: R, y: cy }, { x: R + 30, y: cy }, { x: R + 30, y: a.y - 24 }, { x: cx, y: a.y - 24 }, { x: cx, y: a.y }];
      return { d: roundedPath(pts, 8), start: { tip: pts[0], from: pts[1] }, end: { tip: pts[4], from: pts[3] }, mid: { x: R + 30, y: (cy + a.y - 24) / 2 } };
    }
    const auto = autoSides(a, b, dir);
    const s1 = e.fromSide || auto[0], s2 = e.toSide || auto[1];
    const p1 = anchor(a, s1), p2 = anchor(b, s2);
    const routing = (e.style && e.style.routing) || 'orthogonal';
    if (routing === 'curved') {
      const k = Math.max(40, Math.hypot(p2.x - p1.x, p2.y - p1.y) * 0.4);
      const c1 = { x: p1.x + DIRS[s1][0] * k, y: p1.y + DIRS[s1][1] * k };
      const c2 = { x: p2.x + DIRS[s2][0] * k, y: p2.y + DIRS[s2][1] * k };
      const mid = { x: 0.125 * p1.x + 0.375 * c1.x + 0.375 * c2.x + 0.125 * p2.x, y: 0.125 * p1.y + 0.375 * c1.y + 0.375 * c2.y + 0.125 * p2.y };
      return { d: `M${r1(p1.x)},${r1(p1.y)} C${r1(c1.x)},${r1(c1.y)} ${r1(c2.x)},${r1(c2.y)} ${r1(p2.x)},${r1(p2.y)}`, start: { tip: p1, from: c1 }, end: { tip: p2, from: c2 }, mid };
    }
    const pts = routing === 'straight' ? [p1, p2] : orthogonal(p1, s1, p2, s2);
    return { d: roundedPath(pts, 8), start: { tip: pts[0], from: pts[1] }, end: { tip: pts[pts.length - 1], from: pts[pts.length - 2] }, mid: polyMid(pts) };
  }

  function arrowHead(tip, from, size, color) {
    const dx = tip.x - from.x, dy = tip.y - from.y, L = Math.hypot(dx, dy) || 1;
    const ux = dx / L, uy = dy / L;
    const bx = tip.x - ux * size, by = tip.y - uy * size;
    const px = -uy * size * 0.5, py = ux * size * 0.5;
    return `<polygon points="${r1(tip.x)},${r1(tip.y)} ${r1(bx + px)},${r1(by + py)} ${r1(bx - px)},${r1(by - py)}" fill="${esc(color)}"/>`;
  }

  // ---------------------------------------------------------------- rendering
  function nodeStyle(n) {
    const t = NODE_TYPES[n.type] || NODE_TYPES.process;
    const s = n.style || {};
    return {
      fill: s.fill || t.fill,
      stroke: s.stroke || t.stroke,
      strokeWidth: num(s.strokeWidth) ?? (n.type === 'group' ? 1.5 : 2),
      dashed: s.dashed != null ? !!s.dashed : n.type === 'group',
      color: s.color || TEXT_COLOR,
      fontSize: num(s.fontSize) ?? 13,
      bold: s.bold != null ? !!s.bold : n.type === 'terminator',
      align: s.align || 'center',
    };
  }

  function wrap(text, maxW, fs) {
    const maxC = Math.max(4, Math.floor(maxW / (fs * 0.56)));
    const lines = [];
    for (const para of String(text).split('\n')) {
      let line = '';
      for (let word of para.split(/\s+/).filter(Boolean)) {
        while (word.length > maxC) {
          if (line) { lines.push(line); line = ''; }
          lines.push(word.slice(0, maxC)); word = word.slice(maxC);
        }
        if (!line) line = word;
        else if (line.length + 1 + word.length <= maxC) line += ' ' + word;
        else { lines.push(line); line = word; }
      }
      lines.push(line);
    }
    return lines;
  }

  function textBlock(lines, x, cy, st, anchorAttr) {
    const lh = st.fontSize * 1.3;
    const y0 = cy - ((lines.length - 1) * lh) / 2 + st.fontSize * 0.35;
    const spans = lines.map((l, i) => `<tspan x="${r1(x)}" y="${r1(y0 + i * lh)}">${esc(l)}</tspan>`).join('');
    return `<text text-anchor="${anchorAttr}" font-size="${st.fontSize}" fill="${esc(st.color)}"${st.bold ? ' font-weight="600"' : ''}>${spans}</text>`;
  }

  function shapeMarkup(n, st) {
    const { x, y, w, h } = n;
    const a = `fill="${esc(st.fill)}" stroke="${esc(st.stroke)}" stroke-width="${st.strokeWidth}"${st.dashed ? ' stroke-dasharray="6 4"' : ''}`;
    switch (n.type) {
      case 'terminator': return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r1(h / 2)}" ${a}/>`;
      case 'decision': return `<polygon points="${x + w / 2},${y} ${x + w},${y + h / 2} ${x + w / 2},${y + h} ${x},${y + h / 2}" ${a}/>`;
      case 'data': { const s = Math.min(18, w * 0.15); return `<polygon points="${x + s},${y} ${x + w},${y} ${x + w - s},${y + h} ${x},${y + h}" ${a}/>`; }
      case 'document': return `<path d="M${x},${y} H${x + w} V${y + h - 10} Q${x + w * 0.75},${y + h - 22} ${x + w / 2},${y + h - 10} T${x},${y + h - 10} Z" ${a}/>`;
      case 'database': {
        const ry = Math.min(12, h * 0.15), rx = w / 2;
        return `<path d="M${x},${y + ry} V${y + h - ry} A${rx},${ry} 0 0 0 ${x + w},${y + h - ry} V${y + ry} A${rx},${ry} 0 0 0 ${x},${y + ry} Z" ${a}/>` +
          `<ellipse cx="${x + rx}" cy="${y + ry}" rx="${rx}" ry="${ry}" ${a}/>`;
      }
      case 'circle': return `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}" ${a}/>`;
      case 'note': {
        const f = 14;
        return `<path d="M${x},${y} H${x + w - f} L${x + w},${y + f} V${y + h} H${x} Z" ${a}/>` +
          `<path d="M${x + w - f},${y} V${y + f} H${x + w}" fill="none" stroke="${esc(st.stroke)}" stroke-width="${st.strokeWidth}"/>`;
      }
      case 'text': return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="transparent" stroke="none"/>`;
      case 'group': return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" ${a}/>`;
      default: return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" ${a}/>`;
    }
  }

  function nodeMarkup(n, opts) {
    const st = nodeStyle(n);
    const selected = opts.selected && opts.selected.kind === 'node' && opts.selected.id === n.id;
    let s = `<g class="dg-node dg-type-${n.type}${selected ? ' dg-selected' : ''}" data-kind="node" data-id="${esc(n.id)}">`;
    s += shapeMarkup(n, st);
    if (n.type === 'group') {
      if (n.label) s += textBlock([n.label], n.x + 12, n.y + 18, Object.assign({}, st, { bold: true }), 'start');
    } else if (n.label) {
      const inner = n.type === 'decision' ? n.w * 0.62 : n.type === 'circle' ? n.w * 0.75 : n.w - 16;
      const cy = n.type === 'document' ? n.y + (n.h - 8) / 2 : n.type === 'database' ? n.y + n.h / 2 + 5 : n.y + n.h / 2;
      if (st.align === 'left') s += textBlock(wrap(n.label, inner, st.fontSize), n.x + 10, cy, st, 'start');
      else s += textBlock(wrap(n.label, inner, st.fontSize), n.x + n.w / 2, cy, st, 'middle');
    }
    if (selected) s += `<rect class="dg-sel" x="${n.x - 4}" y="${n.y - 4}" width="${n.w + 8}" height="${n.h + 8}" rx="6" fill="none" stroke="#2563EB" stroke-width="1.5" stroke-dasharray="4 3"/>`;
    if (opts.ports && n.type !== 'group') {
      for (const side of SIDES) {
        const p = anchor(n, side);
        s += `<circle class="dg-port" data-port="${side}" cx="${p.x}" cy="${p.y}" r="5"/>`;
      }
    }
    return s + '</g>';
  }

  function edgeMarkup(e, byId, dir, opts) {
    const a = byId.get(e.from), b = byId.get(e.to);
    if (!a || !b || !isPlaced(a) || !isPlaced(b)) return '';
    const st = e.style || {};
    const selected = opts.selected && opts.selected.kind === 'edge' && opts.selected.id === e.id;
    const color = selected ? '#2563EB' : (st.stroke || EDGE_COLOR);
    const width = num(st.strokeWidth) ?? 1.5;
    const arrow = st.arrow || 'end';
    const g = edgeGeometry(e, a, b, dir);
    const size = 8 + width * 1.5;
    let s = `<g class="dg-edge${selected ? ' dg-selected' : ''}" data-kind="edge" data-id="${esc(e.id)}">`;
    s += `<path d="${g.d}" fill="none" stroke="${esc(color)}" stroke-width="${selected ? width + 1 : width}" stroke-linejoin="round"${st.dashed ? ' stroke-dasharray="6 4"' : ''}/>`;
    if (arrow === 'end' || arrow === 'both') s += arrowHead(g.end.tip, g.end.from, size, color);
    if (arrow === 'start' || arrow === 'both') s += arrowHead(g.start.tip, g.start.from, size, color);
    if (opts.interactive) s += `<path class="dg-edge-hit" d="${g.d}" fill="none" stroke="transparent" stroke-width="14"/>`;
    if (e.label) {
      const fs = num(st.fontSize) ?? 12;
      const lines = String(e.label).split('\n');
      const tw = Math.max(...lines.map((l) => l.length)) * fs * 0.56 + 10;
      const th = lines.length * fs * 1.3 + 4;
      s += `<rect x="${r1(g.mid.x - tw / 2)}" y="${r1(g.mid.y - th / 2)}" width="${r1(tw)}" height="${r1(th)}" rx="4" fill="${esc(st.labelBackground || '#FFFFFF')}"/>`;
      s += textBlock(lines, g.mid.x, g.mid.y, { fontSize: fs, color: st.color || '#334155', bold: false }, 'middle');
    }
    return s + '</g>';
  }

  /** Inner SVG markup (no <svg> wrapper). opts: {selected:{kind,id}, ports:bool, interactive:bool} */
  function renderContent(doc, opts) {
    opts = opts || {};
    const byId = new Map(doc.nodes.map((n) => [n.id, n]));
    const dir = doc.meta && doc.meta.direction;
    const placed = doc.nodes.filter(isPlaced);
    let s = '';
    for (const n of placed) if (n.type === 'group') s += nodeMarkup(n, opts);
    for (const e of doc.edges) s += edgeMarkup(e, byId, dir, opts);
    for (const n of placed) if (n.type !== 'group') s += nodeMarkup(n, opts);
    return s;
  }

  /** Full standalone SVG document. opts: {padding, background} */
  function renderSVG(doc, opts) {
    opts = opts || {};
    doc = new Diagram(doc).doc;
    const pad = opts.padding ?? 40;
    const b = bounds(doc.nodes) || { minX: 0, minY: 0, w: 200, h: 100 };
    const x = b.minX - pad, y = b.minY - pad - 10, w = b.w + pad * 2 + 30, h = b.h + pad * 2 + 10;
    const bg = opts.background === undefined ? '#FFFFFF' : opts.background;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${r1(w)}" height="${r1(h)}" viewBox="${r1(x)} ${r1(y)} ${r1(w)} ${r1(h)}" font-family='${FONT}'>` +
      (bg ? `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" fill="${esc(bg)}"/>` : '') +
      renderContent(doc, {}) + '</svg>';
  }

  /** Static, self-contained HTML page with the diagram as inline SVG and the JSON embedded for round-tripping. */
  function renderHTML(doc) {
    doc = new Diagram(doc).doc;
    const title = (doc.meta && doc.meta.title) || 'Diagram';
    const desc = doc.meta && doc.meta.description;
    const json = stringify(doc).replace(/</g, '\\u003c');
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  body { margin: 0; background: #F8FAFC; color: #0F172A; font-family: ${FONT}; }
  header { padding: 20px 16px 4px; max-width: 1200px; margin: 0 auto; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  p { margin: 0; color: #475569; font-size: 14px; }
  main { padding: 16px; max-width: 1200px; margin: 0 auto; overflow-x: auto; }
  main svg { max-width: 100%; height: auto; border: 1px solid #E2E8F0; border-radius: 10px; background: #fff; }
</style>
</head>
<body>
<header><h1>${esc(title)}</h1>${desc ? `<p>${esc(desc)}</p>` : ''}</header>
<main>${renderSVG(doc)}</main>
<script type="application/json" id="diagram-data">
${json}</script>
</body>
</html>
`;
  }

  function summary(doc) {
    const lines = [`Diagram: ${doc.meta.title || ''} (direction ${doc.meta.direction || 'TB'}) — ${doc.nodes.length} nodes, ${doc.edges.length} edges`, 'Nodes:'];
    for (const n of doc.nodes) lines.push(`  ${n.id} [${n.type}] "${n.label.replace(/\n/g, ' / ')}" @${n.x},${n.y}${n.group ? ' group=' + n.group : ''}`);
    lines.push('Edges:');
    for (const e of doc.edges) lines.push(`  ${e.id}: ${e.from} -> ${e.to}${e.label ? ` "${e.label}"` : ''}`);
    return lines.join('\n');
  }

  /** Compact guide to paste into an AI chat together with the current JSON. */
  const AI_GUIDE = `You are editing a diagram stored as JSON:
{"version":1,"meta":{"title","description","direction":"TB"|"LR"},"nodes":[...],"edges":[...]}

Node: {"id","type","label","x","y","w","h","group?","style?","data?"}
  types: ${Object.keys(NODE_TYPES).map((t) => `${t} (${NODE_TYPES[t].desc})`).join('; ')}
  label: use \\n for line breaks. x/y are the top-left corner; omit x/y and the node is auto-placed.
  style: {fill, stroke, color (text), strokeWidth, dashed, fontSize, bold, align:"center"|"left"}
Edge: {"id","from","to","label?","fromSide?","toSide?","style?"}
  sides: top|right|bottom|left (omit for automatic). style: {stroke, strokeWidth, dashed, arrow:"end"|"start"|"both"|"none", routing:"orthogonal"|"straight"|"curved", color, fontSize}

Prefer answering with a JSON array of operations (applied atomically, in order):
${OPS.map((o) => '  ' + JSON.stringify(o.example) + (o.note ? '   // ' + o.note : '')).join('\n')}

Rules: keep existing ids stable; reference nodes by id; use short lowercase-hyphen ids;
end with {"op":"layout"} when you add several nodes or restructure the flow.
Alternatively return the complete updated diagram JSON.`;

  return {
    VERSION, FONT, NODE_TYPES, SIDES, OPS, AI_GUIDE,
    Diagram, DiagramError,
    create: (doc) => new Diagram(doc),
    parse, stringify, bounds, slug,
    renderContent, renderSVG, renderHTML, summary, edgeGeometry, anchor,
  };
});

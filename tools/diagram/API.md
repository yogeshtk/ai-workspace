# JSON Diagram Tool — API Reference

A small draw.io-style diagram tool where **the JSON file is the diagram**. You can edit a diagram three ways, and they all go through the same JavaScript API:

| Way | Who uses it | How |
|-----|-------------|-----|
| Visual editor | You | Open `tools/diagram/diagram.html` in a browser |
| CLI | Claude Code / scripts | `node tools/diagram/diagram-cli.js apply <file> <ops>` |
| JavaScript | Browser console, other pages, Node | `new DiagramCore.Diagram(json).applyOps([...])` |

There are no dependencies and no build step. It works offline from `file://`.

| File | Purpose |
|------|---------|
| `diagram-core.js` | Model, operations, auto-layout, SVG/HTML rendering (browser + Node) |
| `diagram-view.js` | Interactive SVG canvas (drag, connect, pan/zoom, inline edit) |
| `diagram.html` | The editor app |
| `diagram-cli.js` | Command-line editing and export |
| `SKILL.md` | The `diagramjs` Claude Code skill (uses the files above) |
| `install.sh` | Installs the skill for all projects: `bash tools/diagram/install.sh` |

---

## 1. The JSON format

```json
{
  "version": 1,
  "meta": {"title": "Order fulfilment", "description": "optional", "direction": "TB"},
  "nodes": [
    {"id": "start", "type": "terminator", "label": "Order received", "x": 145, "y": 40, "w": 140, "h": 54},
    {"id": "paid", "type": "decision", "label": "Payment OK?", "x": 140, "y": 294, "w": 150, "h": 90}
  ],
  "edges": [
    {"id": "e1", "from": "start", "to": "paid", "label": "next"}
  ]
}
```

The file is saved with one node or edge per line, so git diffs stay readable.

### meta

| Field | Meaning |
|-------|---------|
| `title` | Diagram title (used for export file names and the HTML page heading) |
| `description` | Optional subtitle |
| `direction` | `TB` (top → bottom) or `LR` (left → right). Used by auto-layout and auto-placement |

### Node

| Field | Required | Meaning |
|-------|----------|---------|
| `id` | no* | Unique id. Use short lowercase-hyphen ids (`take-payment`). *Auto-generated from the label if omitted |
| `type` | no | One of the types below. Default `process` |
| `label` | no | Text. Use `\n` for a line break; long text wraps automatically |
| `x`, `y` | no | Top-left corner. **Omit both and the node is auto-placed** next to whatever it connects to (or the whole diagram is laid out if no node has a position) |
| `w`, `h` | no | Size. Defaults per type |
| `group` | no | Id of a `group` node this node belongs to |
| `style` | no | See below |
| `data` | no | Any JSON you want to attach (owner, status, links…). Not rendered |

**Node types**

| Type | Shape | Typical use | Default size |
|------|-------|-------------|--------------|
| `process` | rectangle | a step / action | 140×60 |
| `decision` | diamond | yes/no, branching | 150×90 |
| `terminator` | pill | start / end | 140×54 |
| `data` | parallelogram | input / output | 150×60 |
| `document` | wavy-bottom page | report, file | 140×70 |
| `database` | cylinder | DB / storage | 110×80 |
| `circle` | ellipse | event, actor, state | 72×72 |
| `note` | folded sticky note | comment | 160×80 |
| `text` | none | free text, caption | 120×30 |
| `group` | dashed container | swimlane / boundary. **Auto-fits around its members** | 320×220 |

**Node style** (all optional): `fill`, `stroke` (border), `color` (text), `strokeWidth`, `dashed` (bool), `fontSize`, `bold` (bool), `align` (`center` | `left`).

### Edge

| Field | Required | Meaning |
|-------|----------|---------|
| `id` | no | Unique id. Auto `e1`, `e2`… |
| `from`, `to` | yes | Node ids |
| `label` | no | Text shown on the line |
| `fromSide`, `toSide` | no | `top` / `right` / `bottom` / `left`. Omit for automatic |
| `style` | no | See below |
| `data` | no | Any JSON |

**Edge style**: `stroke` (colour), `strokeWidth`, `dashed`, `arrow` (`end` default, `start`, `both`, `none`), `routing` (`orthogonal` default, `straight`, `curved`), `color` (label text), `fontSize`, `labelBackground`.

---

## 2. Operations (the AI-facing API)

An AI (or you) changes a diagram by sending a **JSON array of operations**. They run in order, **atomically**: if any op fails, nothing changes. Each op returns the id it affected.

```json
[
  {"op": "addNode", "id": "check", "type": "decision", "label": "In stock?"},
  {"op": "addEdge", "from": "pick", "to": "check"},
  {"op": "addEdge", "from": "check", "to": "ship", "label": "yes"},
  {"op": "layout"}
]
```

| Op | Fields | Notes |
|----|--------|-------|
| `addNode` | any node fields | `x`/`y` optional (auto-placed) |
| `updateNode` | `id`, `set: {...}` | `style` and `data` merge. A `null` value removes a key. Changing `type` resets a default size |
| `moveNode` | `id`, `x`, `y` — or `dx`, `dy` | Moving a group moves its members |
| `removeNode` | `id` | Also removes its edges. Group members are kept |
| `renameNode` | `id`, `newId` | Edges and group membership follow |
| `addEdge` | `from`, `to`, optional `id`, `label`, `fromSide`, `toSide`, `style` | |
| `updateEdge` | `id`, `set: {...}` | Can change `from`/`to` too |
| `removeEdge` | `id` — or `from`, `to` | `from`/`to` removes all edges between the two |
| `insertBetween` | `from`, `to`, `node: {...}` | Splits the edge from→to with a new node. Downstream nodes shift to make room |
| `setMeta` | `set: {...}` | e.g. title, description, direction |
| `layout` | optional `direction` (`TB`/`LR`), `rankGap`, `nodeGap` | Re-positions all nodes (layered layout) |
| `clear` | none | Removes all nodes and edges |

> `updateNode`, `updateEdge` and `setMeta` also accept the fields flat (`{"op":"updateNode","id":"a","label":"x"}`), but `set` is clearer.

**Guidance for AI edits**

- Keep existing ids stable. Refer to nodes by id (run `show` first to see them).
- For new nodes, leave out `x`/`y`. They are placed next to what they connect to.
- Add `{"op":"layout"}` at the end when you add many nodes or restructure the flow. Leave it out for small edits, so the user's manual arrangement is kept.
- Use `insertBetween` to add a step into an existing arrow.
- Use `decision` nodes for questions, and label their outgoing edges (`yes` / `no`).

The same guide in compact form (ready to paste into any chatbot) is printed by `node tools/diagram/diagram-cli.js guide`. The editor's **AI / Ops → Copy AI prompt** button copies it along with the current JSON.

---

## 3. JavaScript API

```js
// Node:     const { Diagram } = require('./tools/diagram/diagram-core.js');
// Browser:  <script src="diagram-core.js"></script>  →  window.DiagramCore.Diagram
const d = new Diagram(jsonObjectOrString);   // missing positions are auto-placed

d.addNode({ type: 'decision', label: 'Approved?' })      // → 'approved'
d.connect('approved', 'publish', 'yes')                  // → 'e7'
d.addEdge({ from, to, label, style })
d.updateNode('approved', { label: 'Approved by lead?', style: { fill: '#FFE4E6' } })
d.updateEdge('e7', { style: { dashed: true } })
d.moveNode('approved', 300, 200)    // or d.moveNode('approved', { dx: 20, dy: 0 })
d.insertBetween('draft', 'publish', { label: 'Review' })
d.removeNode('approved')   d.removeEdge('e7')   d.removeEdge('a', 'b')
d.renameNode('old-id', 'new-id')
d.setMeta({ title: 'Publishing flow', direction: 'LR' })
d.layout({ direction: 'LR' })
d.applyOps([...])                    // batch, atomic, one undo step
d.transaction(d => { ... })          // group several calls into one atomic, undoable change
d.load(json)   d.clear()
d.undo()   d.redo()   d.canUndo()
d.onChange(fn)                        // returns an unsubscribe function

d.getNode(id)  d.getEdge(id)  d.nodes  d.edges  d.meta
d.findNodes({ type: 'decision' })  d.findNodes({ label: 'pay' })  d.edgesOf(id, 'in'|'out'|'both')
d.validate()   // → array of problems ([] = ok)
d.summary()    // readable outline
d.toJSON()  d.toString()  d.toSVG()  d.toHTML()
```

Module-level helpers: `DiagramCore.renderSVG(json)`, `renderHTML(json)`, `parse(textOrHtml)`, `stringify(doc)`, `NODE_TYPES`, `OPS`, `AI_GUIDE`.

In the editor, the live objects are available in the browser console as `diagram` and `view`.

---

## 4. CLI

```bash
node tools/diagram/diagram-cli.js new diagrams/hiring-process.json --title "Hiring process" [--dir LR]
node tools/diagram/diagram-cli.js show diagrams/hiring-process.json
node tools/diagram/diagram-cli.js apply diagrams/hiring-process.json '[{"op":"addNode","label":"Phone screen"}]'
node tools/diagram/diagram-cli.js apply diagrams/hiring-process.json ops.json      # or "-" for stdin
node tools/diagram/diagram-cli.js layout diagrams/hiring-process.json --dir TB
node tools/diagram/diagram-cli.js validate diagrams/hiring-process.json
node tools/diagram/diagram-cli.js html diagrams/hiring-process.json   # → diagrams/hiring-process.html
node tools/diagram/diagram-cli.js svg diagrams/hiring-process.json    # → diagrams/hiring-process.svg
node tools/diagram/diagram-cli.js json diagrams/old-export.html       # recover JSON from an exported page
node tools/diagram/diagram-cli.js guide
```

`apply` writes nothing if an op fails or the result is invalid. `new` refuses to overwrite an existing file.

---

## 5. Visual editor

Open `tools/diagram/diagram.html`. The editor:

- **Adds shapes** from the left palette.
- **Connects** when you hover a shape and drag one of its blue ports onto another shape. Dropping on empty canvas creates a new connected shape.
- **Edits text** when you double-click a shape or arrow. Double-clicking empty canvas adds a new shape.
- **Moves** shapes by dragging (snaps to a 10px grid). Arrow keys nudge.
- **Pans and zooms**: drag empty space to pan, use the mouse wheel to zoom, and **Fit** recentres.
- **Supports undo/redo** with Ctrl+Z / Ctrl+Shift+Z. Del removes the selection.
- **Properties tab**: label, type, colours, size, group, data. With nothing selected it shows the diagram title and direction.
- **JSON tab**: the live JSON. Edit or paste it here and the canvas updates.
- **AI / Ops tab**: paste an operations array from an AI and apply it, or use **Copy AI prompt** to get the guide plus the current JSON, ready to paste into any AI chat.
- **Files**: Open/drag-drop a `.json` (or an `.html` exported by this tool), Save JSON, and export SVG, PNG or standalone HTML.
- **Autosave**: work is kept in the browser's local storage between visits.

Exported HTML pages embed the diagram JSON in `<script id="diagram-data">`, so they can be re-opened and edited.

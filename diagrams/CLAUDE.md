# Diagrams Folder — Instructions

This folder replaces draw.io / Google Drawings. Each diagram is a **JSON file**, and the JSON is the diagram. HTML/SVG files next to it are exports.

## Files

- `[name].json` — the diagram (source of truth). Lowercase-hyphenated names.
- `[name].html` — standalone page showing the diagram. Regenerate with `node tools/diagram/diagram-cli.js html diagrams/[name].json`.
- `archive/` — retired diagrams (never delete).

## How to change a diagram

- Use the `diagram` skill (`skills/skill-diagram.md`), or apply operations directly:
  `node tools/diagram/diagram-cli.js apply diagrams/[name].json '[{"op":"addNode","label":"New step"}]'`
- To see what's in a diagram: `node tools/diagram/diagram-cli.js show diagrams/[name].json`
- To edit visually: open `tools/diagram/diagram.html` in a browser, click **Open…** and pick the JSON.
- API reference: `tools/diagram/API.md`.

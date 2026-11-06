---
name: diagramjs
description: Create and edit flowcharts and diagrams (process flows, decision trees, architecture, pipelines, org/swimlane charts) stored as JSON, with an HTML/SVG export and a draw.io-style browser editor. Use when the user asks to make, draw, update or restructure a flowchart or diagram, says "run the diagramjs skill", or points at a diagram .json/.html made by this tool.
---

# Skill: diagramjs

**Trigger:** `run the diagramjs skill` (also: "make a flowchart / diagram of …", "change the … diagram")
**Output:** a diagram JSON file (the source of truth) plus a standalone HTML page next to it that shows it

Everything this skill needs is in its own folder, the **skill directory** (the folder containing this `SKILL.md`; the path is given when the skill loads):

| File | Use |
|------|-----|
| `diagram-cli.js` | CLI used in the steps below (Node 16+) |
| `diagram-core.js` | Engine: JSON model, operations, auto-layout, SVG/HTML rendering |
| `diagram.html` + `diagram-view.js` | Visual editor for the user (open in a browser) |
| `API.md` | Full reference: JSON schema, operations, JS API |

All edits go through the operations API, never through free-hand rewriting of coordinates.

CLI shorthand used below: `DG = node "<skill-dir>/diagram-cli.js"`

## Where diagrams live

- If the current project has a `diagrams/` folder, use it.
- Otherwise, use the path the user gives. If they give none, create `diagrams/` in the current working directory.
- File names: 2–5 words, lowercase-hyphenated, e.g. `diagrams/hiring-process.json`.

## Steps

1. Work out whether this is a **new** diagram or a **change** to an existing one. List the `*.json` files in the diagrams folder. If the user named a diagram that exists, it is a change. If it's ambiguous, ask: "New diagram, or update one of: [list]?" (wait for answer).
2. If the user hasn't said what the diagram should show, ask: "What should the diagram show? List the steps/components and how they connect — rough is fine." (wait for answer).
3. Run `DG guide` once in the session to load the JSON schema and the list of operations.
4. **New diagram:** run `DG new <dir>/[name].json --title "[Title]"`. Add `--dir LR` for pipelines, architectures or timelines that read left to right. Otherwise use the default top-to-bottom direction.
5. **Existing diagram:** run `DG show <dir>/[name].json` to see the current node ids, labels and edges. If the user only has an `.html` exported by this tool, it embeds the JSON: run `DG json <file>.html` to recover `<file>.json`, then continue with that.
6. Translate the request into a JSON **operations array**:
   - Use short lowercase-hyphen ids, and keep existing ids unchanged.
   - Use `terminator` for start and end, `process` for steps, `decision` for questions (label their outgoing edges `yes`/`no`), `data` for inputs/outputs, `database` for storage, `document` for reports, `note` for comments, and `group` for swimlanes or boundaries (members set `"group": "<group-id>"`).
   - Leave out `x`/`y` on new nodes so they are auto-placed.
   - To add a step into an existing arrow, use `insertBetween`.
   - End with `{"op":"layout"}` for a new diagram or a big restructure. For a small change to an existing diagram, don't run layout, so the user's manual arrangement is kept.
7. Apply it: `DG apply <dir>/[name].json '<ops array>'`. For long op lists, write them to a scratch file and pass the path. If it fails, the file is unchanged. Read the error, fix the ops and re-apply.
8. Run `DG html <dir>/[name].json` to refresh `<dir>/[name].html`.
9. Tell the user:
   - which files were created or updated
   - a short outline of what changed (from `DG show`)
   - that they can view the `.html` in a browser, or open the JSON in `<skill-dir>/diagram.html` (Open… button) to edit it visually.
10. If the user edited the diagram in the browser editor and saved a new JSON (it goes to their Downloads), offer to copy it back over the diagram's `.json` and re-export the HTML.

## Rules

- The `.json` file is the source of truth. The `.html` and `.svg` files are exports and can be regenerated at any time.
- Never delete a diagram. To retire one, move it to an `archive/` subfolder.
- Don't hand-edit `x`/`y` values unless the user asks for a specific placement. Use `moveNode` or `layout`.
- Follow the project's own conventions (CLAUDE.md) where they differ, e.g. about folders or file naming.

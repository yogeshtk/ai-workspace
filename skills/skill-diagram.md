# Skill: Diagram

**Trigger:** `run the diagram skill` (also: "make a flowchart / diagram of …", "change the … diagram")
**Output:** A diagram JSON file in `diagrams/` (the source of truth) plus a standalone HTML page `diagrams/[name].html` that shows it

The diagram tool lives in `tools/diagram/`. The full reference is `tools/diagram/API.md`. All edits go through the operations API, never through free-hand rewriting of coordinates.

CLI shorthand used below: `DG = node tools/diagram/diagram-cli.js`

## Steps

1. Work out whether this is a **new** diagram or a **change** to an existing one. List `diagrams/*.json`. If the user named a diagram that exists, it is a change. If it's ambiguous, ask: "New diagram, or update one of: [list]?" (wait for answer).
2. If the user hasn't said what the diagram should show, ask: "What should the diagram show? List the steps/components and how they connect — rough is fine." (wait for answer).
3. Run `DG guide` once in the session to load the JSON schema and the list of operations.
4. **New diagram:**
   - Pick a filename: 2–5 words, lowercase-hyphenated, e.g. `diagrams/hiring-process.json`.
   - Run `DG new diagrams/[name].json --title "[Title]"`. Add `--dir LR` for pipelines, architectures or timelines that read left to right. Otherwise use the default top-to-bottom direction.
5. **Existing diagram:** run `DG show diagrams/[name].json` to see the current node ids, labels and edges.
6. Translate the request into a JSON **operations array**:
   - Use short lowercase-hyphen ids, and keep existing ids unchanged.
   - Use `terminator` for start and end, `process` for steps, `decision` for questions (label their outgoing edges `yes`/`no`), `data` for inputs/outputs, `database` for storage, `document` for reports, `note` for comments, and `group` for swimlanes or boundaries (members set `"group": "<group-id>"`).
   - Leave out `x`/`y` on new nodes so they are auto-placed.
   - To add a step into an existing arrow, use `insertBetween`.
   - End with `{"op":"layout"}` for a new diagram or a big restructure. For a small change to an existing diagram, don't run layout, so the user's manual arrangement is kept.
7. Apply it: `DG apply diagrams/[name].json '<ops array>'`. For long op lists, write them to a scratch file and pass the path. If it fails, the file is unchanged. Read the error, fix the ops and re-apply.
8. Run `DG html diagrams/[name].json` to refresh `diagrams/[name].html`.
9. Tell the user:
   - which files were created or updated
   - a short outline of what changed (from `DG show`)
   - that they can view `diagrams/[name].html` in a browser, or open the JSON in `tools/diagram/diagram.html` (Open… button) to edit it visually.
10. If the user edited the diagram in the browser editor and saved a new JSON (it goes to their Downloads), offer to copy it back into `diagrams/[name].json` and re-export the HTML.

## Rules

- `diagrams/[name].json` is the source of truth. The `.html` and `.svg` files are exports and can be regenerated at any time.
- Never delete a diagram. To retire one, move it to `diagrams/archive/`.
- Don't hand-edit `x`/`y` values unless the user asks for a specific placement. Use `moveNode` or `layout`.

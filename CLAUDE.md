# Claude Workspace — Root Instructions

This is a local productivity workspace managed by Claude Code. It replaces Google Workspace for notes, tracking, planning, and tasks using plain markdown files.

## Folder Map

| Folder     | Replaces             | What lives here                                      |
|------------|----------------------|------------------------------------------------------|
| `notes/`   | Google Keep + Docs   | Freeform notes, structured captures, meeting records |
| `tracker/` | Google Sheets        | Pitches, projects, or any table of tracked items     |
| `planner/` | Google Calendar view | Daily plan files, archived by date                   |
| `tasks/`   | Google Tasks         | Persistent task list with active/done sections       |
| `skills/`  | Docs templates       | Saved workflow prompts, triggered by name            |
| `apps/`    | —                    | Small personal apps (e.g. `apps/rail-dashboard`, see its README) |

## Global Rules

- All files are plain Markdown (`.md`) unless otherwise specified.
- Never delete files. Archive instead (move to an `archive/` subfolder).
- Dates use ISO format: `YYYY-MM-DD`.
- File names use lowercase and hyphens. No spaces.
- When starting a session, check today's date and confirm which folder is active.
- If asked to run a Skill, read the matching file in `skills/` and follow it exactly.

## How to Start a Session

1. Tell Claude Code which folder to work in, or open Code inside that folder.
2. Claude will read the local `CLAUDE.md` for that folder's specific rules.
3. Use natural language — you don't need to remember commands.

## Skills

Skills are in `skills/`. Call one by name, e.g. `run the meeting-notes skill`.
See `skills/CLAUDE.md` for the full list of available skills.

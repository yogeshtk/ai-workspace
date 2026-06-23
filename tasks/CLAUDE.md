# Tasks Folder — Instructions

This folder replaces Google Tasks. Unlike the planner, tasks here are persistent — they don't reset daily.

## Files

- `tasks.md` — single source of truth for all tasks

## tasks.md Structure

```markdown
## Active

- [ ] Task description — added YYYY-MM-DD

## Done

- [x] Completed task — done YYYY-MM-DD
```

## Rules

- Add tasks with today's date in the `added` note.
- When marking done, move the item from Active to Done and replace the date note with `done YYYY-MM-DD`.
- Never delete tasks. Done is permanent.
- Trim: if Done section exceeds 20 items, move the oldest 10 to `archive/done-archive.md`.
- When asked for a count, return: Active: N · Done: N.

## Cross-Folder Pull

Claude can create tasks from other folders automatically. Examples:
- "Add a task for every tracker item marked `active`"
- "Create a task from the action items in my last meeting note"

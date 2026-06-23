# Tracker Folder — Instructions

This folder replaces Google Sheets for tracking lists of items with statuses. Default use: project or pitch tracking. Adapt the columns to your use case.

## Files

- `items.md` — the main tracking table (rename to `pitches.md`, `projects.md`, etc. as needed)

## Table Format

Every tracked item lives as a row in the markdown table inside `items.md`. Default columns:

| Title | Status | Added | Notes |
|-------|--------|-------|-------|

**Status values:** `idea` · `active` · `drafting` · `review` · `done` · `paused` · `dropped`

## Rules

- Add new items by appending a row. Never delete rows — change status to `dropped` instead.
- When asked to update an item, find it by title (partial match is fine) and update the relevant column.
- When asked for a summary, return counts by status.
- Items marked `done` or `dropped` older than 30 days can be moved to `archive/items-archive.md` on request.
- Dates in the `Added` column use `YYYY-MM-DD` format.

## Cross-Folder Pull

When asked, Claude can pull from other folders. Example: "add a task for every item marked drafting" will read this table and create matching entries in `tasks/tasks.md`.

# Planner Folder — Instructions

This folder replaces the daily view of Google Calendar. It is not a full calendar — it is a daily planning and review tool.

## Files

- `today.md` — the current day's plan (always exactly one of these)
- `archive/YYYY-MM-DD.md` — previous days, auto-archived

## Session Start Behaviour

When a session opens in this folder:
1. Check today's date.
2. If `today.md` exists and is dated today — load it and continue.
3. If `today.md` exists but is dated a previous day — rename it to `archive/YYYY-MM-DD.md` (using its date), then create a fresh `today.md` for today.
4. If `today.md` does not exist — create it using the template below.

## today.md Template

```markdown
# Plan — YYYY-MM-DD

## Must do
-

## Would like to do
-

## Notes
-

## Carry forward
_(populated at end of session from incomplete must-dos)_
```

## Rules

- Keep entries brief — this is a planner, not a journal.
- At end of session, ask the user if they want to mark items done or carry them forward.
- When asked "what did I plan on [date]", find the matching archive file and return its contents.
- Never delete archive files.

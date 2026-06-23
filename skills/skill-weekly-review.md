# Skill: Weekly Review

**Trigger:** `run the weekly-review skill`
**Output:** A summary printed in the chat (not saved as a file unless asked)

## Steps

1. Determine the current week's date range (Mon–Sun).
2. Read `planner/archive/` — collect all daily files from this week.
3. Read `tasks/tasks.md` — note tasks completed this week (done date in range) and tasks still active.
4. Read `tracker/items.md` — note any status changes or new items added this week.
5. Return a structured summary in this format:

```
## Weekly Review — [Mon date] to [Sun date]

### Planner (days reviewed: N)
- Completed: [list of notable must-dos marked done]
- Recurring carries: [anything carried forward 2+ days]

### Tasks
- Done this week: N
- Still active: N
- Overdue (added >7 days ago, still active): [list]

### Tracker
- New items: [list]
- Status changes: [list]
- Items stalled (no update >14 days, not done/dropped): [list]

### Notes created this week
- [list of files in notes/ created this week]

### Suggested next actions
- [1–3 short suggestions based on the above]
```

6. Ask: "Want me to save this as a note?"

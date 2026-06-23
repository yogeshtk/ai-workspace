# Skill: Triage

**Trigger:** `run the triage skill`
**Output:** A triage report printed in chat

## Steps

1. Read `tasks/tasks.md` — identify:
   - Tasks added more than 7 days ago still marked active
   - Total active count
2. Read `tracker/items.md` — identify:
   - Items with status `active` or `drafting` not updated in the last 14 days
   - Items with no notes
3. Read `planner/today.md` — note anything carried forward from previous days (check `## Carry forward` section)
4. Return a triage report:

```
## Triage — YYYY-MM-DD

### Tasks (Active: N)
🔴 Overdue (>7 days): [list]
🟡 Active and recent: [list]

### Tracker (Active/Drafting: N)
🔴 Stalled (>14 days, no update): [list]
🟡 In progress: [list]

### Planner carry-forwards
- [list from today.md carry forward section]

### Recommended focus today
1. [top priority]
2. [second priority]
3. [third priority]
```

5. Ask: "Want me to update any of these statuses or move anything to done?"

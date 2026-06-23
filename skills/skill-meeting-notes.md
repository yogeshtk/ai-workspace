# Skill: Meeting Notes

**Trigger:** `run the meeting-notes skill`
**Output:** A new `.md` file in `notes/` named `meeting-YYYY-MM-DD-[topic].md`

## Steps

1. Ask the user: "What's the meeting about and who's attending?" (one question, wait for answer)
2. Ask: "Any pre-meeting context or agenda items to include?" (wait for answer, "none" is fine)
3. Create a new file in `notes/` with this structure:

```markdown
---
created: YYYY-MM-DD
type: meeting
attendees: [list from user]
tags: [meeting]
---

# Meeting: [Topic] — YYYY-MM-DD

## Attendees
- [list]

## Agenda / Context
[from user input, or leave blank]

## Discussion

-

## Decisions

-

## Actions

| Action | Owner | Due |
|--------|-------|-----|
|        |       |     |

## Notes

-
```

4. Confirm the file name and location to the user.
5. Offer to add any action items from the meeting directly to `tasks/tasks.md`.

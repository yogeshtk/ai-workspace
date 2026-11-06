# Skills Folder — Instructions

Skills are saved workflows. Call one by name and Claude will execute it exactly as defined.

## How to Run a Skill

Say: `run the [skill-name] skill` — Claude will read the matching file and follow it.

## Available Skills

| Skill name        | File                        | What it does                                         |
|-------------------|-----------------------------|------------------------------------------------------|
| `meeting-notes`   | `skill-meeting-notes.md`    | Creates a structured meeting note file               |
| `weekly-review`   | `skill-weekly-review.md`    | Summarises the week across planner, tasks, tracker   |
| `note-from-paste` | `skill-note-from-paste.md`  | Organises pasted raw text into a structured note     |
| `triage`          | `skill-triage.md`           | Reviews tasks and tracker, flags overdue/stale items |
| `Diagram`         | `skill-diagram.md`          | Creates/edits a JSON-backed flowchart + HTML export  |

## Adding a New Skill

1. Create a new file: `skill-[name].md`
2. Add it to the table above.
3. Write the skill as a numbered list of instructions Claude should follow step by step.

## Skill File Format

```markdown
# Skill: [Name]

**Trigger:** `run the [name] skill`
**Output:** [what gets created or returned]

## Steps

1. ...
2. ...
```

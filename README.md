# Claude Workspace

A local folder setup that replaces Google Workspace using **Claude Code** and plain markdown files. No subscriptions, no cloud lock-in, no apps to open.

Inspired by [this XDA article](https://www.xda-developers.com/claude-code-and-local-folder-replaced-google-workspace/).

---

## What this replaces

| This folder | Replaces |
|-------------|----------|
| `notes/` | Google Keep + Google Docs |
| `tracker/` | Google Sheets (for lists/tables) |
| `planner/` | Google Calendar daily view |
| `tasks/` | Google Tasks |
| `skills/` | Google Docs templates + macros |
| `garmin/` | Manually building Garmin Connect workouts |

---

## How it works

Each folder has a `CLAUDE.md` file. When you open Claude Code inside a folder (or point it at the root), it reads those instructions automatically. You then talk to it naturally — no commands to memorise.

The root `CLAUDE.md` is the master brain. Folder-level `CLAUDE.md` files override it with specific rules for that folder.

---

## Setup

### 1. Clone or download this repo

```bash
git clone https://github.com/YOUR_USERNAME/claude-workspace.git ~/claude
```

Or just download the ZIP and put the folder wherever you like.

### 2. Open Claude Code

Point Claude Code at the root `claude/` folder, or at any subfolder to work in that context only.

In Claude Code desktop: **File → Open Folder** → select `claude/`

### 3. Customise

- Edit the root `CLAUDE.md` if you want to change global behaviour.
- Edit each folder's `CLAUDE.md` to change how that folder works.
- Rename `tracker/items.md` to something meaningful (e.g. `pitches.md`, `projects.md`).
- If you use Obsidian, set your vault path in `notes/CLAUDE.md`.

### 4. Start working

Just talk to Claude Code:

> "Create a note about my meeting with the infrastructure team."
> "Add a task: review the Q3 budget by Friday."
> "What did I plan to do last Tuesday?"
> "Run the triage skill."

---

## Folder Reference

### `notes/` — Capture & Documents

Your notes folder. Each note is its own `.md` file with frontmatter. Claude names files sensibly based on content.

**Example prompts:**
- `"Create a note: [paste your text here]"`
- `"Find what I wrote about the Pi-hole setup"`
- `"Organise this into a note"` _(then paste raw text)_
- `"Run the note-from-paste skill"`

---

### `tracker/` — Table Tracking

Tracks items in a markdown table. Default columns: Title, Status, Added, Notes. Rename and reshape to fit your use case — articles, projects, bugs, whatever.

**Status values:** `idea` · `active` · `drafting` · `review` · `done` · `paused` · `dropped`

**Example prompts:**
- `"Add a new item: [title], status: active"`
- `"Update [item name] status to review"`
- `"Show me everything marked drafting"`
- `"Give me a count by status"`
- `"Add a task for every item marked active"` _(cross-folder pull to tasks/)_

---

### `planner/` — Daily Planning

One file per day. Claude auto-archives yesterday and creates today when you start a new session. Think of it as a daily scratchpad, not a full calendar.

**Example prompts:**
- `"What's on my plan today?"`
- `"Add to must-do: respond to Shankar's email"`
- `"Mark 'review PR' as done"`
- `"What did I plan last Monday?"`
- `"Carry forward everything I didn't finish"`

---

### `tasks/` — Persistent Task List

Unlike the planner, tasks persist day-to-day. Active and done sections. Claude can pull from other folders to auto-populate.

**Example prompts:**
- `"Add a task: [description]"`
- `"Mark [task] as done"`
- `"How many active tasks do I have?"`
- `"Add tasks from all active tracker items"`
- `"What tasks are overdue?"` _(older than 7 days and still active)_

---

### `skills/` — Saved Workflows

Skills are reusable workflows defined as step-by-step instruction files. Call them by name.

| Skill | Trigger phrase | What it does |
|-------|---------------|--------------|
| Meeting Notes | `run the meeting-notes skill` | Creates a structured meeting file in notes/ |
| Weekly Review | `run the weekly-review skill` | Summarises the week across all folders |
| Note from Paste | `run the note-from-paste skill` | Structures raw pasted text into a note |
| Triage | `run the triage skill` | Flags overdue tasks and stalled tracker items |

**Adding your own skill:**
1. Create `skills/skill-[name].md`
2. Add it to the table in `skills/CLAUDE.md`
3. Write the steps as a numbered list
4. Call it with `run the [name] skill`

---

## Cross-Folder Operations

Claude Code can read across all folders in the same session. Useful examples:

- `"Add a task for every tracker item marked drafting"`
- `"Create a meeting note and add all actions to my task list"`
- `"Run a weekly review across planner, tasks, and tracker"`
- `"Find any note I wrote about [topic] and add a follow-up task"`

---

## Tips

**Start sessions at root level** for cross-folder work. Open a subfolder directly if you only need that context.

**CLAUDE.md is the key.** Everything Claude does in a folder is governed by its `CLAUDE.md`. Edit it to change behaviour — add rules, rename columns, adjust archiving thresholds.

**Skills > repeating yourself.** If you describe the same workflow more than twice, write a skill for it.

**It's not automatic.** Claude Code isn't watching folders in the background. But starting a session is fast, so in practice it's close enough.

**Obsidian users:** Set your vault path in `notes/CLAUDE.md` and Claude will drop notes directly into your vault with correct frontmatter.

---

## Repo Structure

```
claude/
├── CLAUDE.md                        ← root brain file
├── README.md                        ← this file
│
├── notes/
│   ├── CLAUDE.md                    ← notes rules
│   └── archive/                     ← auto-archived old notes
│
├── tracker/
│   ├── CLAUDE.md                    ← tracker rules
│   ├── items.md                     ← your tracking table
│   └── archive/
│
├── planner/
│   ├── CLAUDE.md                    ← planner rules
│   ├── today.md                     ← current day
│   └── archive/                     ← previous days (YYYY-MM-DD.md)
│
├── tasks/
│   ├── CLAUDE.md                    ← tasks rules
│   ├── tasks.md                     ← active + done list
│   └── archive/
│
└── skills/
    ├── CLAUDE.md                    ← skill index
    ├── skill-meeting-notes.md
    ├── skill-weekly-review.md
    ├── skill-note-from-paste.md
    └── skill-triage.md
```

---

## Contributing / Extending

This is a personal setup repo — fork it and make it yours. Good extension ideas:

- A `finances/` folder for budget tracking (replaces Google Sheets formulas with AI-assisted summaries)
- A `reading/` folder for book/article notes with a `skill-reading-summary.md`
- A `journal/` folder with its own daily file format
- Integration skills for Obsidian publish, NotebookLM source drops, or GitHub Issues

---

## Requirements

- [Claude Code](https://claude.ai/code) (desktop app or CLI)
- A Claude Pro or Max subscription (for Claude Code access)
- No other dependencies — everything is plain markdown

---

*Built from the XDA setup guide. No affiliation with Anthropic or XDA.*

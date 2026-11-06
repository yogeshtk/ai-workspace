# Skill: diagramjs

**Trigger:** `run the diagramjs skill` (also: "make a flowchart / diagram of …", "change the … diagram")
**Output:** A diagram JSON file in `diagrams/` (the source of truth) plus a standalone HTML page `diagrams/[name].html` that shows it

This skill is packaged as a standard Claude Code skill so it also works outside this workspace.

## Steps

1. Read `tools/diagram/SKILL.md` and follow its steps exactly. Here the skill directory is `tools/diagram/`, so `DG = node tools/diagram/diagram-cli.js`.
2. In this workspace, diagrams always live in `diagrams/`. Follow `diagrams/CLAUDE.md`.

## Making it available in every project

Run `bash tools/diagram/install.sh` once per machine. It copies the skill to `~/.claude/skills/diagramjs/`. Use `--link` instead to symlink it, so pulling this repo also updates the skill.

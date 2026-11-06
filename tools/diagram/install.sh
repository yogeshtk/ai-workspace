#!/usr/bin/env bash
# Install the diagramjs skill for Claude Code, for every project on this machine.
#
#   bash tools/diagram/install.sh          # copy into ~/.claude/skills/diagramjs (standalone)
#   bash tools/diagram/install.sh --link   # symlink instead, so `git pull` here updates the skill
#
# Re-running updates an existing install. Set CLAUDE_CONFIG_DIR to install somewhere other than ~/.claude.
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST_ROOT="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/skills"
DEST="$DEST_ROOT/diagramjs"
FILES=(SKILL.md API.md diagram-core.js diagram-view.js diagram-cli.js diagram.html)

for f in "${FILES[@]}"; do
  [[ -f "$SRC/$f" ]] || { echo "Missing $SRC/$f" >&2; exit 1; }
done
mkdir -p "$DEST_ROOT"

if [[ "${1:-}" == "--link" ]]; then
  if [[ -e "$DEST" && ! -L "$DEST" ]]; then
    backup="$DEST.backup-$(date +%Y%m%d%H%M%S)"
    mv "$DEST" "$backup"
    echo "Moved existing install to $backup"
  fi
  ln -sfn "$SRC" "$DEST"
  echo "Linked $DEST -> $SRC"
else
  [[ -L "$DEST" ]] && rm "$DEST"   # replace a previous --link install (removes the link only)
  mkdir -p "$DEST"
  for f in "${FILES[@]}"; do cp "$SRC/$f" "$DEST/$f"; done
  echo "Installed diagramjs skill to $DEST"
fi

echo "Restart Claude Code (or start a new session), then say: run the diagramjs skill"

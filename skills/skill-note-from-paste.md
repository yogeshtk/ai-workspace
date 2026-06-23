# Skill: Note from Paste

**Trigger:** `run the note-from-paste skill`
**Output:** A new structured `.md` file in `notes/`

## Steps

1. Ask the user to paste their raw text (wait for input).
2. Read the pasted content and determine:
   - Main topic (used for filename)
   - Natural sections or categories within the content
3. Reorganise into structured markdown:
   - Use `##` for main sections
   - Use `-` bullets for list items
   - Use `**bold**` for key terms or names
   - Preserve all original information — do not summarise or cut
4. Add frontmatter:
   ```
   ---
   created: YYYY-MM-DD
   source: paste
   tags: []
   ---
   ```
5. Suggest a filename (3–5 words, lowercase-hyphenated). Confirm with user before saving.
6. Save to `notes/[filename].md`.
7. Offer to add any action items to `tasks/tasks.md`.

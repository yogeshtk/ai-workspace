# Skill: AI Usage

**Trigger:** `run the ai-usage skill` (optionally with a period: today, 7d, 30d, 3 months, all, or a date range)
**Output:** a short summary in chat, plus an HTML dashboard at `tracker/ai-usage/ai-usage-YYYY-MM-DD.html`

All the work is done by `skills/scripts/ai-usage-report.py`. It has no dependencies and makes no AI calls, so the same logs always give the same numbers. Claude's only job is to run it and pass on the short summary. **Do not read the log files or the HTML yourself: that wastes tokens.**

## Steps

1. Work out the period from the request:
   - "today" → `--period today`
   - "this week" / "last 7 days" → `--period 7d`
   - "this month" / "last 30 days" → `--period 30d` (default)
   - "3 months" / "quarter" → `--period 90d`
   - "all time" → `--period all`
   - A date range → `--since YYYY-MM-DD --until YYYY-MM-DD`
2. Run this exact command from the workspace root (one call, nothing else):
   ```bash
   python3 skills/scripts/ai-usage-report.py --plain <period flags>
   ```
   - Add `--csv` only if the user asks for a spreadsheet or Excel.
   - If the user has a Devin export file, add `--devin-file <path>`.
3. Reply with the script's output as is: the cache hit ratio first, then cost, tokens, top tools and repos, and the insights. Then give the path to the HTML report. Keep the reply under 15 lines and don't add your own analysis unless asked.
4. If the script prints `note:` lines (for example, Devin isn't set up), pass them on in one line each.

## Running it yourself in a terminal

```bash
python3 skills/scripts/ai-usage-report.py                 # last 30 days, coloured, + HTML
python3 skills/scripts/ai-usage-report.py --period 7d
python3 skills/scripts/ai-usage-report.py --since 2026-10-01 --until 2026-10-31 --csv
python3 skills/scripts/ai-usage-report.py --json          # machine-readable
python3 skills/scripts/ai-usage-report.py --help
```

The HTML report has tabs for Today / 7 days / 30 days / 3 months / All time (plus Custom when you pass `--since`). Its sessions table can be sorted and filtered.

## Data sources

| Source      | Where it comes from                                                                                     |
|-------------|---------------------------------------------------------------------------------------------------------|
| Claude Code | `~/.claude/projects/**/*.jsonl` (also `$CLAUDE_CONFIG_DIR/projects`; add more with `--claude-dir`)       |
| Devin       | Devin API when `DEVIN_API_KEY` is set (endpoint: `DEVIN_API_URL`, default `https://api.devin.ai/v1/sessions`), or `--devin-file export.json/.csv` |

- Claude cost is the **API list-price equivalent**. On a Pro/Max plan, read it as the value you got, not what you were billed.
- Devin cost = ACUs × `--acu-price` (default $2.25, or set `DEVIN_ACU_PRICE`).
- Model prices are at the top of the script (`PRICING`). Override them with `--pricing prices.json`.
- Only sessions whose logs are on this machine are counted. Cloud and web sessions keep their logs in their own containers.

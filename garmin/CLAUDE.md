# Garmin Folder — Instructions

Turns training plans into **Garmin Connect workouts** that sync to the watch,
and optionally puts them on the Garmin calendar.

## Layout

| Path                     | What lives here                                        |
|--------------------------|--------------------------------------------------------|
| `plans/`                 | Your plan files (`YYYY-MM-DD-plan-name.yaml`)          |
| `plans/incoming/`        | Raw plans you drop in (PDF, text, screenshot, CSV)     |
| `plans/examples/`        | Reference plan showing every supported step/target     |
| `plans/archive/`         | Plans that are finished (never delete, move here)      |
| `garmin_plans.py`        | Converter + uploader (validate / preview / upload)     |
| `uploads.md`             | Log of every upload with Garmin workout IDs            |
| `.env`                   | Credentials — gitignored, never commit                 |

## Rules

- Always run `validate` and `preview` before `upload`, and show the preview.
- Workout names must be unique per plan; use the plan `prefix` to group them.
- Re-uploading a plan: use `--replace` so old copies are deleted, not duplicated.
- Never print, log or commit the password or token files.
- When a plan is finished, move its YAML to `plans/archive/`.

## Plan format (YAML)

```yaml
plan: Half Marathon Block
start_date: 2026-10-05   # needed only if workouts use week/day
sport: running           # default; override per workout
prefix: "HM"             # optional name prefix

workouts:
  - name: W1 Tempo
    week: 1              # or: date: 2026-10-07
    day: wed
    description: optional text shown on the watch
    steps:
      - warmup: 10min
      - run: 20min @ pace 4:50-5:00
      - repeat: 4
        steps:
          - run: 1km @ hr zone 4
          - recover: 2min
      - cooldown: lap
```

- **Step types:** `warmup`, `cooldown`, `run`/`ride`/`swim`/`interval`/`exercise`,
  `recover`, `rest`, `other`, `repeat` (with `steps:`). Add `note:` for a label.
- **Durations:** `90s`, `10min`, `1:30`, `1h`, `400m`, `5km`, `2mi`, `12 reps`, `lap`.
- **Targets (after `@`, or `target:`):** `pace 5:00-5:30` (per km, add `/mi`),
  `hr zone 2`, `hr 140-155`, `power zone 3`, `power 200-250`,
  `cadence 170-180`, `speed 25-30kph`.
- **Sports:** running, cycling, swimming, strength, cardio, hiit, yoga,
  pilates, mobility, other.

## Commands

```bash
pip install -r garmin/requirements.txt
python garmin/garmin_plans.py validate garmin/plans/<file>.yaml
python garmin/garmin_plans.py preview  garmin/plans/<file>.yaml
python garmin/garmin_plans.py login                     # once; asks for MFA if enabled
python garmin/garmin_plans.py upload   garmin/plans/<file>.yaml [--replace] [--no-schedule]
python garmin/garmin_plans.py list
python -m pytest garmin/tests -q
```

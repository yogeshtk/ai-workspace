# Skill: Garmin Plan

**Trigger:** `run the garmin-plan skill` (or "upload this plan to Garmin")
**Output:** A YAML plan in `garmin/plans/`, workouts in Garmin Connect, and rows in `garmin/uploads.md`

## Steps

1. Read `garmin/CLAUDE.md` for the plan format and rules.
2. Find the plan: a file the user attached or named, anything new in
   `garmin/plans/incoming/`, or text pasted into the chat.
3. Convert it to YAML at `garmin/plans/YYYY-MM-DD-<plan-name>.yaml`
   (date = the plan's start date). Map each session to a workout:
   - Pick the sport; set `start_date` and use `week`/`day`, or explicit `date`.
   - Turn each part of the session into steps; wrap repeated sets in `repeat`.
   - Use the most specific target the plan gives (pace, HR zone, power).
   - Rest days and vague sessions ("cross-train") are skipped — list them to the user.
   - Put strength exercise names in `note:` with `N reps` durations.
4. Run `python garmin/garmin_plans.py validate <file>`; fix any errors and re-run.
5. Run `preview` and show the user the result as a short summary per week.
6. Upload with `python garmin/garmin_plans.py upload <file>` (add `--replace` if the
   plan was uploaded before). If login fails because credentials are missing,
   tell the user to fill in `garmin/.env` (see `.env.example`) and stop.
   If Garmin asks for an MFA code, ask the user for it and re-run with `--mfa-code`.
7. Move the raw source file from `plans/incoming/` to `plans/archive/`.
8. Report: number of workouts created, the date range scheduled, and anything skipped.

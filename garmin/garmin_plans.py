#!/usr/bin/env python3
"""Turn plain-text training plans into Garmin Connect workouts.

Usage:
    python garmin/garmin_plans.py validate garmin/plans/my-plan.yaml
    python garmin/garmin_plans.py preview  garmin/plans/my-plan.yaml [--json]
    python garmin/garmin_plans.py login
    python garmin/garmin_plans.py upload   garmin/plans/my-plan.yaml [--no-schedule] [--replace]
    python garmin/garmin_plans.py list

Credentials come from GARMIN_EMAIL / GARMIN_PASSWORD (environment or garmin/.env).
Session tokens are cached in GARMINTOKENS (default ~/.garminconnect) so MFA is
only needed once.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sys
from pathlib import Path
from typing import Any

import yaml

HERE = Path(__file__).resolve().parent
UPLOAD_LOG = HERE / "uploads.md"

# --- Garmin Connect workout vocabulary --------------------------------------

SPORTS = {
    "running": (1, "running"),
    "cycling": (2, "cycling"),
    "other": (3, "other"),
    "swimming": (4, "swimming"),
    "strength": (5, "strength_training"),
    "strength_training": (5, "strength_training"),
    "cardio": (6, "cardio_training"),
    "cardio_training": (6, "cardio_training"),
    "yoga": (7, "yoga"),
    "pilates": (8, "pilates"),
    "hiit": (9, "hiit"),
    "mobility": (11, "mobility"),
}
SPORT_ALIASES = {"run": "running", "bike": "cycling", "ride": "cycling", "swim": "swimming",
                 "gym": "strength", "walk": "other", "walking": "other"}

STEP_TYPES = {
    "warmup": (1, "warmup"),
    "cooldown": (2, "cooldown"),
    "interval": (3, "interval"),
    "recovery": (4, "recovery"),
    "rest": (5, "rest"),
    "repeat": (6, "repeat"),
    "other": (7, "other"),
}
STEP_ALIASES = {
    "warm": "warmup", "warm-up": "warmup", "wu": "warmup",
    "cool": "cooldown", "cool-down": "cooldown", "cd": "cooldown",
    "run": "interval", "ride": "interval", "swim": "interval", "work": "interval",
    "effort": "interval", "exercise": "interval", "set": "interval",
    "recover": "recovery", "easy": "recovery", "jog": "recovery",
}

CONDITIONS = {
    "lap.button": (1, "lap.button"),
    "time": (2, "time"),
    "distance": (3, "distance"),
    "iterations": (7, "iterations"),
    "reps": (10, "reps"),
}

TARGETS = {
    "no.target": (1, "no.target"),
    "power.zone": (2, "power.zone"),
    "cadence": (3, "cadence"),
    "heart.rate.zone": (4, "heart.rate.zone"),
    "speed.zone": (5, "speed.zone"),
    "pace.zone": (6, "pace.zone"),
}

WEEKDAYS = {name: i for i, name in enumerate(
    ["mon", "tue", "wed", "thu", "fri", "sat", "sun"])}


class PlanError(ValueError):
    """Raised when a plan file cannot be understood."""


# --- Parsing helpers ---------------------------------------------------------

def parse_duration(text: str) -> tuple[str, float | None]:
    """Parse '10min', '90s', '1:30', '1h', '5km', '400m', '2mi', '12 reps', 'lap'.

    Returns (condition_key, value) where value is seconds, metres or a count.
    """
    t = str(text).strip().lower()
    if t in ("lap", "open", "lap button", "lap.button", "until lap"):
        return "lap.button", None

    m = re.fullmatch(r"(\d+):(\d{2})(?::(\d{2}))?", t)
    if m:
        a, b, c = m.groups()
        secs = int(a) * 3600 + int(b) * 60 + int(c) if c else int(a) * 60 + int(b)
        return "time", float(secs)

    m = re.fullmatch(r"(\d+(?:\.\d+)?)\s*([a-z]+)", t)
    if not m:
        raise PlanError(f"can't read duration {text!r} (try 10min, 90s, 5km, 400m, 12 reps, lap)")
    num, unit = float(m.group(1)), m.group(2)
    if unit in ("s", "sec", "secs", "second", "seconds"):
        return "time", num
    if unit in ("min", "mins", "minute", "minutes"):
        return "time", num * 60
    if unit in ("h", "hr", "hrs", "hour", "hours"):
        return "time", num * 3600
    if unit == "m":  # bare "m" means metres (use "min" for minutes)
        return "distance", num
    if unit in ("km", "k"):
        return "distance", num * 1000
    if unit in ("mi", "mile", "miles"):
        return "distance", num * 1609.344
    if unit in ("y", "yd", "yds", "yard", "yards"):
        return "distance", num * 0.9144
    if unit in ("rep", "reps", "x"):
        return "reps", num
    raise PlanError(f"unknown duration unit {unit!r} in {text!r}")


def _pace_to_mps(pace: str, per: str) -> float:
    m = re.fullmatch(r"(\d+):(\d{2})", pace.strip())
    if not m:
        raise PlanError(f"can't read pace {pace!r} (use m:ss)")
    secs = int(m.group(1)) * 60 + int(m.group(2))
    metres = 1609.344 if per.startswith("mi") else 1000.0
    return metres / secs


def _range(text: str) -> tuple[float, float]:
    m = re.fullmatch(r"(\d+(?:\.\d+)?)\s*(?:-|to)\s*(\d+(?:\.\d+)?)", text.strip())
    if not m:
        raise PlanError(f"expected a range like 140-155, got {text!r}")
    lo, hi = float(m.group(1)), float(m.group(2))
    return min(lo, hi), max(lo, hi)


def parse_target(text: str | None) -> dict[str, Any]:
    """Parse targets such as 'pace 5:00-5:30', 'pace 8:00-8:30/mi', 'hr zone 2',
    'hr 140-155', 'power 200-250', 'power zone 3', 'cadence 170-180',
    'speed 25-30kph'."""
    if not text:
        return {"targetType": _target("no.target")}
    t = str(text).strip().lower()

    m = re.fullmatch(r"(?:hr|heart ?rate)\s*(?:zone|z)\s*(\d)", t) or re.fullmatch(r"z(\d)", t)
    if m:
        return {"targetType": _target("heart.rate.zone"), "zoneNumber": int(m.group(1))}
    m = re.fullmatch(r"(?:hr|heart ?rate)\s+(.+?)\s*(?:bpm)?", t)
    if m:
        lo, hi = _range(m.group(1))
        return {"targetType": _target("heart.rate.zone"), "targetValueOne": lo, "targetValueTwo": hi}

    m = re.fullmatch(r"power\s*(?:zone|z)\s*(\d)", t)
    if m:
        return {"targetType": _target("power.zone"), "zoneNumber": int(m.group(1))}
    m = re.fullmatch(r"power\s+(.+?)\s*w?", t)
    if m:
        lo, hi = _range(m.group(1))
        return {"targetType": _target("power.zone"), "targetValueOne": lo, "targetValueTwo": hi}

    m = re.fullmatch(r"cadence\s+(.+?)\s*(?:rpm|spm)?", t)
    if m:
        lo, hi = _range(m.group(1))
        return {"targetType": _target("cadence"), "targetValueOne": lo, "targetValueTwo": hi}

    m = re.fullmatch(r"pace\s+(\d+:\d{2})\s*(?:-|to)\s*(\d+:\d{2})\s*(?:/\s*(km|mi))?", t)
    if m:
        per = m.group(3) or "km"
        a, b = _pace_to_mps(m.group(1), per), _pace_to_mps(m.group(2), per)
        # Garmin stores pace as speed (m/s); valueOne is the slower bound.
        return {"targetType": _target("pace.zone"),
                "targetValueOne": round(min(a, b), 4), "targetValueTwo": round(max(a, b), 4)}

    m = re.fullmatch(r"speed\s+(.+?)\s*(kph|km/h|mph)", t)
    if m:
        lo, hi = _range(m.group(1))
        factor = 1609.344 / 3600 if m.group(2) == "mph" else 1000 / 3600
        return {"targetType": _target("speed.zone"),
                "targetValueOne": round(lo * factor, 4), "targetValueTwo": round(hi * factor, 4)}

    raise PlanError(f"can't read target {text!r}")


def _sport(name: str) -> dict[str, Any]:
    key = SPORT_ALIASES.get(str(name).lower(), str(name).lower())
    if key not in SPORTS:
        raise PlanError(f"unknown sport {name!r}; use one of {sorted(set(SPORTS))}")
    sid, skey = SPORTS[key]
    return {"sportTypeId": sid, "sportTypeKey": skey}


def _step_type(name: str) -> dict[str, Any]:
    key = STEP_ALIASES.get(name.lower(), name.lower())
    if key not in STEP_TYPES:
        raise PlanError(f"unknown step type {name!r}; use warmup, run/interval, recover, rest, cooldown, repeat")
    sid, skey = STEP_TYPES[key]
    return {"stepTypeId": sid, "stepTypeKey": skey}


def _condition(key: str) -> dict[str, Any]:
    cid, ckey = CONDITIONS[key]
    return {"conditionTypeId": cid, "conditionTypeKey": ckey}


def _target(key: str) -> dict[str, Any]:
    tid, tkey = TARGETS[key]
    return {"workoutTargetTypeId": tid, "workoutTargetTypeKey": tkey}


# --- Plan -> Garmin JSON -----------------------------------------------------

class _Counter:
    def __init__(self) -> None:
        self.n = 0

    def next(self) -> int:
        self.n += 1
        return self.n


def build_step(raw: Any, order: _Counter, est: list[float]) -> dict[str, Any]:
    """Build a Garmin step from one YAML step.

    Accepted shapes:
        {warmup: 10min}
        {run: "5km @ pace 5:00-5:30"}
        {run: 400m, target: "hr zone 4", note: "strong"}
        {repeat: 6, steps: [...]}
    """
    if isinstance(raw, str):
        kind, _, rest = raw.partition(":")
        raw = {kind.strip(): rest.strip() or None}
    if not isinstance(raw, dict) or not raw:
        raise PlanError(f"step must be a mapping, got {raw!r}")

    raw = dict(raw)
    note = raw.pop("note", None) or raw.pop("description", None)
    explicit_target = raw.pop("target", None)
    steps = raw.pop("steps", None)
    if len(raw) != 1:
        raise PlanError(f"step needs exactly one type key (warmup/run/recover/...), got {list(raw)}")
    kind, value = next(iter(raw.items()))
    kind = str(kind)

    if kind.lower() == "repeat":
        if not steps:
            raise PlanError("repeat needs a 'steps' list")
        try:
            times = int(str(value).lower().rstrip("x"))
        except ValueError as e:
            raise PlanError(f"repeat count must be a number, got {value!r}") from e
        step_order = order.next()
        inner_est: list[float] = []
        children = [build_step(s, order, inner_est) for s in steps]
        est.append(sum(inner_est) * times)
        return {
            "type": "RepeatGroupDTO",
            "stepOrder": step_order,
            "stepType": _step_type("repeat"),
            "numberOfIterations": times,
            "smartRepeat": False,
            "endCondition": _condition("iterations"),
            "endConditionValue": float(times),
            "workoutSteps": children,
        }

    duration, _, target_text = str(value if value is not None else "lap").partition("@")
    cond, amount = parse_duration(duration)
    target = parse_target(explicit_target or target_text.strip() or None)
    step: dict[str, Any] = {
        "type": "ExecutableStepDTO",
        "stepOrder": order.next(),
        "stepType": _step_type(kind),
        "endCondition": _condition(cond),
        **target,
    }
    if amount is not None:
        step["endConditionValue"] = amount
    if note:
        step["description"] = str(note)
    if cond == "time":
        est.append(amount or 0)
    return step


def build_workout(w: dict[str, Any], default_sport: str = "running") -> dict[str, Any]:
    if "name" not in w:
        raise PlanError(f"workout is missing a name: {w!r}")
    if not w.get("steps"):
        raise PlanError(f"workout {w['name']!r} has no steps")
    sport = _sport(w.get("sport", default_sport))
    order, est = _Counter(), []
    steps = [build_step(s, order, est) for s in w["steps"]]
    workout: dict[str, Any] = {
        "workoutName": str(w["name"])[:80],
        "sportType": sport,
        "estimatedDurationInSecs": int(sum(est)),
        "workoutSegments": [{"segmentOrder": 1, "sportType": sport, "workoutSteps": steps}],
    }
    if w.get("description"):
        workout["description"] = str(w["description"])[:1024]
    if sport["sportTypeKey"] == "swimming":
        workout["poolLength"] = float(w.get("pool_length", 25))
        workout["poolLengthUnit"] = {"unitId": 1, "unitKey": "meter", "factor": 100.0}
    return workout


def workout_date(w: dict[str, Any], start: dt.date | None) -> dt.date | None:
    """Resolve 'date: 2026-10-05' or 'week: 2, day: thu' (relative to start_date)."""
    if w.get("date"):
        d = w["date"]
        return d if isinstance(d, dt.date) else dt.date.fromisoformat(str(d))
    if "week" in w or "day" in w:
        if start is None:
            raise PlanError(f"workout {w.get('name')!r} uses week/day but the plan has no start_date")
        week = int(w.get("week", 1))
        day = str(w.get("day", start.strftime("%a"))).lower()[:3]
        if day not in WEEKDAYS:
            raise PlanError(f"unknown day {w.get('day')!r} in {w.get('name')!r}")
        monday = start - dt.timedelta(days=start.weekday())
        return monday + dt.timedelta(weeks=week - 1, days=WEEKDAYS[day])
    return None


def load_plan(path: str | Path) -> dict[str, Any]:
    """Load a plan file and return {'name', 'workouts': [(date|None, garmin_json), ...]}."""
    data = yaml.safe_load(Path(path).read_text())
    if not isinstance(data, dict) or not isinstance(data.get("workouts"), list):
        raise PlanError("plan must be a mapping with a 'workouts' list")
    start = data.get("start_date")
    if start and not isinstance(start, dt.date):
        start = dt.date.fromisoformat(str(start))
    prefix = data.get("prefix", "")
    default_sport = data.get("sport", "running")
    out = []
    for w in data["workouts"]:
        w = dict(w)
        if prefix:
            w["name"] = f"{prefix} {w['name']}"
        out.append((workout_date(w, start), build_workout(w, default_sport)))
    return {"name": data.get("plan", Path(path).stem), "workouts": out}


# --- Pretty preview ----------------------------------------------------------

def _fmt_amount(step: dict[str, Any]) -> str:
    key = step["endCondition"]["conditionTypeKey"]
    v = step.get("endConditionValue")
    if key == "time":
        m, s = divmod(int(v), 60)
        return f"{m}:{s:02d}"
    if key == "distance":
        return f"{v / 1000:g} km" if v >= 1000 else f"{v:g} m"
    if key == "reps":
        return f"{int(v)} reps"
    return "until lap"


def _fmt_target(step: dict[str, Any]) -> str:
    key = step["targetType"]["workoutTargetTypeKey"]
    if key == "no.target":
        return ""
    if "zoneNumber" in step:
        label = "hr" if key == "heart.rate.zone" else key.split(".")[0]
        return f" @ {label} zone {step['zoneNumber']}"
    lo, hi = step.get("targetValueOne"), step.get("targetValueTwo")
    if key == "pace.zone":
        def pace(mps: float) -> str:
            m, s = divmod(round(1000 / mps), 60)
            return f"{m}:{s:02d}"
        return f" @ pace {pace(hi)}-{pace(lo)}/km"
    if key == "speed.zone":
        return f" @ {lo * 3.6:.1f}-{hi * 3.6:.1f} km/h"
    return f" @ {key.split('.')[0]} {lo:g}-{hi:g}"


def describe_steps(steps: list[dict[str, Any]], indent: str = "  ") -> list[str]:
    lines = []
    for s in steps:
        if s["type"] == "RepeatGroupDTO":
            lines.append(f"{indent}repeat x{s['numberOfIterations']}:")
            lines += describe_steps(s["workoutSteps"], indent + "  ")
        else:
            note = f"  ({s['description']})" if s.get("description") else ""
            lines.append(f"{indent}{s['stepType']['stepTypeKey']:<9} {_fmt_amount(s)}{_fmt_target(s)}{note}")
    return lines


def describe_plan(plan: dict[str, Any]) -> str:
    lines = [f"Plan: {plan['name']}  ({len(plan['workouts'])} workouts)"]
    for date, w in plan["workouts"]:
        mins = w["estimatedDurationInSecs"] // 60
        when = date.isoformat() if date else "unscheduled"
        lines.append(f"\n{when}  {w['workoutName']}  [{w['sportType']['sportTypeKey']}, ~{mins} min timed]")
        lines += describe_steps(w["workoutSegments"][0]["workoutSteps"])
    return "\n".join(lines)


# --- Garmin Connect ----------------------------------------------------------

def _load_dotenv() -> None:
    env = HERE / ".env"
    if not env.exists():
        return
    for line in env.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, _, v = line.partition("=")
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def connect(mfa_code: str | None = None):
    from garminconnect import Garmin

    _load_dotenv()
    tokenstore = os.getenv("GARMINTOKENS", "~/.garminconnect")

    def prompt_mfa() -> str:
        return mfa_code or os.getenv("GARMIN_MFA_CODE") or input("Garmin MFA code: ").strip()

    api = Garmin(os.getenv("GARMIN_EMAIL"), os.getenv("GARMIN_PASSWORD"), prompt_mfa=prompt_mfa)
    api.login(tokenstore)
    # Make sure tokens are persisted even on a fresh credential login.
    try:
        api.client.dump(str(Path(tokenstore).expanduser()))
    except Exception:
        pass
    return api


def _log_upload(plan_name: str, rows: list[tuple[str, str, Any, Any]]) -> None:
    new = not UPLOAD_LOG.exists()
    with UPLOAD_LOG.open("a") as f:
        if new:
            f.write("# Garmin Uploads\n\n| Uploaded | Plan | Workout | Workout ID | Scheduled |\n"
                    "|---|---|---|---|---|\n")
        today = dt.date.today().isoformat()
        for name, _, wid, when in rows:
            f.write(f"| {today} | {plan_name} | {name} | {wid} | {when or '-'} |\n")


def upload_plan(path: str, schedule: bool, replace: bool, mfa_code: str | None) -> int:
    plan = load_plan(path)
    api = connect(mfa_code)
    existing: dict[str, list[int]] = {}
    if replace:
        for w in api.get_workouts(0, 1000) or []:
            existing.setdefault(w.get("workoutName"), []).append(w.get("workoutId"))

    rows = []
    for date, workout in plan["workouts"]:
        name = workout["workoutName"]
        for old_id in existing.get(name, []):
            api.delete_workout(old_id)
            print(f"  removed old '{name}' ({old_id})")
        res = api.upload_workout(workout)
        wid = res.get("workoutId")
        when = None
        if schedule and date and wid:
            api.schedule_workout(wid, date.isoformat())
            when = date.isoformat()
        print(f"  uploaded '{name}' -> id {wid}" + (f", scheduled {when}" if when else ""))
        rows.append((name, workout["sportType"]["sportTypeKey"], wid, when))
    _log_upload(plan["name"], rows)
    print(f"Done: {len(rows)} workouts uploaded. Log: {UPLOAD_LOG.relative_to(HERE.parent)}")
    return 0


# --- CLI ---------------------------------------------------------------------

def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    for name in ("validate", "preview", "upload"):
        sp = sub.add_parser(name)
        sp.add_argument("plan")
        if name == "preview":
            sp.add_argument("--json", action="store_true", help="print the Garmin API payloads")
        if name == "upload":
            sp.add_argument("--no-schedule", action="store_true", help="add to library only, no calendar")
            sp.add_argument("--replace", action="store_true", help="delete same-named workouts first")
            sp.add_argument("--mfa-code")
    lg = sub.add_parser("login")
    lg.add_argument("--mfa-code")
    sub.add_parser("list")
    a = p.parse_args(argv)

    try:
        if a.cmd == "validate":
            plan = load_plan(a.plan)
            print(f"OK: {plan['name']} — {len(plan['workouts'])} workouts")
        elif a.cmd == "preview":
            plan = load_plan(a.plan)
            if a.json:
                print(json.dumps([{"date": d.isoformat() if d else None, "workout": w}
                                  for d, w in plan["workouts"]], indent=2))
            else:
                print(describe_plan(plan))
        elif a.cmd == "login":
            api = connect(a.mfa_code)
            print(f"Logged in as {api.full_name or api.display_name}. Tokens cached.")
        elif a.cmd == "list":
            for w in connect().get_workouts(0, 200) or []:
                print(f"{w.get('workoutId'):>12}  {w.get('sportType', {}).get('sportTypeKey', ''):<18} {w.get('workoutName')}")
        elif a.cmd == "upload":
            return upload_plan(a.plan, not a.no_schedule, a.replace, a.mfa_code)
    except PlanError as e:
        print(f"Plan error: {e}", file=sys.stderr)
        return 2
    except Exception as e:  # garminconnect auth / network errors
        if type(e).__module__.startswith("garminconnect"):
            hint = ""
            if not os.getenv("GARMIN_EMAIL"):
                hint = " — set GARMIN_EMAIL / GARMIN_PASSWORD in garmin/.env (see .env.example)"
            print(f"Garmin error: {e}{hint}", file=sys.stderr)
            return 1
        raise
    return 0


if __name__ == "__main__":
    sys.exit(main())

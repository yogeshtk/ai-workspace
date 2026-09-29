import datetime as dt
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import garmin_plans as gp  # noqa: E402

EXAMPLE = Path(__file__).resolve().parents[1] / "plans" / "examples" / "example-10k-plan.yaml"


@pytest.mark.parametrize("text,expected", [
    ("10min", ("time", 600)),
    ("90s", ("time", 90)),
    ("1:30", ("time", 90)),
    ("1:00:00", ("time", 3600)),
    ("1h", ("time", 3600)),
    ("400m", ("distance", 400)),
    ("5km", ("distance", 5000)),
    ("12 reps", ("reps", 12)),
    ("lap", ("lap.button", None)),
])
def test_parse_duration(text, expected):
    assert gp.parse_duration(text) == expected


def test_parse_duration_rejects_garbage():
    with pytest.raises(gp.PlanError):
        gp.parse_duration("forever")


def test_pace_target_is_speed_range():
    t = gp.parse_target("pace 5:00-5:30")
    assert t["targetType"]["workoutTargetTypeKey"] == "pace.zone"
    assert t["targetValueOne"] < t["targetValueTwo"]
    assert t["targetValueTwo"] == pytest.approx(1000 / 300, rel=1e-3)


@pytest.mark.parametrize("text,key", [
    ("hr zone 2", "heart.rate.zone"),
    ("hr 140-155", "heart.rate.zone"),
    ("power 200-250", "power.zone"),
    ("power zone 3", "power.zone"),
    ("cadence 170-180", "cadence"),
    ("speed 25-30kph", "speed.zone"),
    (None, "no.target"),
])
def test_targets(text, key):
    assert gp.parse_target(text)["targetType"]["workoutTargetTypeKey"] == key


def test_repeat_group_and_step_order():
    w = gp.build_workout({"name": "x", "steps": [
        {"warmup": "10min"},
        {"repeat": 3, "steps": [{"run": "400m"}, {"recover": "1min"}]},
        {"cooldown": "5min"},
    ]})
    steps = w["workoutSegments"][0]["workoutSteps"]
    assert [s["stepOrder"] for s in steps] == [1, 2, 5]
    assert steps[1]["type"] == "RepeatGroupDTO"
    assert steps[1]["numberOfIterations"] == 3
    assert [s["stepOrder"] for s in steps[1]["workoutSteps"]] == [3, 4]
    assert w["estimatedDurationInSecs"] == 600 + 3 * 60 + 300


def test_week_day_scheduling():
    start = dt.date(2026, 10, 7)  # a Wednesday
    assert gp.workout_date({"week": 1, "day": "mon"}, start) == dt.date(2026, 10, 5)
    assert gp.workout_date({"week": 2, "day": "sun"}, start) == dt.date(2026, 10, 18)


def test_example_plan_loads():
    plan = gp.load_plan(EXAMPLE)
    assert len(plan["workouts"]) == 5
    names = [w["workoutName"] for _, w in plan["workouts"]]
    assert all(n.startswith("10K ") for n in names)
    sports = {w["sportType"]["sportTypeKey"] for _, w in plan["workouts"]}
    assert sports == {"running", "strength_training", "cycling"}
    assert "repeat x6" in gp.describe_plan(plan)


def test_cli_validate(capsys):
    assert gp.main(["validate", str(EXAMPLE)]) == 0
    assert "5 workouts" in capsys.readouterr().out

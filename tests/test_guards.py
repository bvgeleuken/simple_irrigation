"""Tests for the generic guard system."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from custom_components.simple_irrigation.guards import (
    REASON_BLOCKED,
    REASON_INDETERMINATE,
    REASON_MISSING,
    REASON_NON_NUMERIC,
    REASON_PASS,
    REASON_UNAVAILABLE,
    effective_guards,
    evaluate_guard,
    guards_allow_run,
)
from custom_components.simple_irrigation.models import (
    Guard,
    Installation,
    ScheduleSlot,
    parse_guards,
)


def _hass(state: str | None) -> MagicMock:
    """hass whose single entity reports `state` (None = entity missing)."""
    hass = MagicMock()
    hass.states.get.return_value = None if state is None else MagicMock(state=state)
    return hass


def _slot(**kwargs) -> ScheduleSlot:
    base = {"slot_id": "s1", "weekdays": [0], "time_local": "06:00"}
    base.update(kwargs)
    return ScheduleSlot(**base)


def _inst(**kwargs) -> Installation:
    base = {"installation_id": "i1", "name": "Garden"}
    base.update(kwargs)
    return Installation(**base)


# --------------------------------------------------------------------------
# Model round-trip
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    "guard",
    [
        Guard("sensor.tank", "above", 20.0),
        Guard("sensor.moisture", "below", 40.0),
        Guard("sensor.x", "equals", 5.0),
        Guard("input_select.season", "state_is", "summer"),
        Guard("binary_sensor.rain", "is_true", None),
        Guard("binary_sensor.rain", "is_false", None),
    ],
)
def test_guard_round_trip(guard: Guard) -> None:
    assert Guard.from_dict(guard.to_dict()) == guard


def test_guard_from_dict_drops_unusable() -> None:
    assert Guard.from_dict({"entity_id": "sensor.a", "operator": "nope"}) is None
    assert Guard.from_dict({"entity_id": "nodot", "operator": "above", "value": 1}) is None
    assert Guard.from_dict({"entity_id": "sensor.a", "operator": "above"}) is None
    assert Guard.from_dict({"entity_id": "sensor.a", "operator": "state_is"}) is None
    assert Guard.from_dict("not-a-dict") is None


def test_parse_guards_skips_bad_entries() -> None:
    guards = parse_guards(
        [
            {"entity_id": "sensor.ok", "operator": "above", "value": 1},
            {"entity_id": "sensor.bad", "operator": "unknown"},
        ]
    )
    assert len(guards) == 1
    assert guards[0].entity_id == "sensor.ok"


def test_slot_defaults_need_no_store_migration() -> None:
    """A slot dict written before guards existed still loads."""
    slot = ScheduleSlot.from_dict(
        {"slot_id": "s1", "weekdays": [1], "time_local": "07:00"}
    )
    assert slot.guards == []
    assert slot.ignore_global_guards is False


def test_slot_ignores_legacy_humidity_keys() -> None:
    """Anyone running the PR branch keeps a loadable store."""
    slot = ScheduleSlot.from_dict(
        {
            "slot_id": "s1",
            "weekdays": [1],
            "time_local": "07:00",
            "humidity_sensor_entity_id": "sensor.soil",
            "humidity_threshold": 42.0,
        }
    )
    assert slot.guards == []
    assert not hasattr(slot, "humidity_threshold")


def test_installation_round_trip_carries_guards() -> None:
    inst = _inst(guards=[Guard("sensor.tank", "above", 20.0)])
    restored = Installation.from_dict(inst.to_dict())
    assert restored.guards == inst.guards


def test_split_produces_independent_guard_lists() -> None:
    """Copying a slot's guards must not alias the source list."""
    src = _slot(guards=[Guard("sensor.tank", "above", 20.0)])
    copy = _slot(slot_id="s2", guards=list(src.guards))
    assert copy.guards == src.guards
    assert copy.guards is not src.guards


# --------------------------------------------------------------------------
# effective_guards
# --------------------------------------------------------------------------


def test_effective_guards_is_additive() -> None:
    g_global = Guard("binary_sensor.rain", "is_false", None)
    g_slot = Guard("sensor.tank", "above", 20.0)
    inst = _inst(guards=[g_global])
    assert effective_guards(inst, _slot(guards=[g_slot])) == [g_global, g_slot]


def test_effective_guards_opt_out_drops_global() -> None:
    g_global = Guard("binary_sensor.rain", "is_false", None)
    g_slot = Guard("sensor.tank", "above", 20.0)
    inst = _inst(guards=[g_global])
    slot = _slot(guards=[g_slot], ignore_global_guards=True)
    assert effective_guards(inst, slot) == [g_slot]


def test_effective_guards_opt_out_with_no_own_guards_runs_always() -> None:
    inst = _inst(guards=[Guard("binary_sensor.rain", "is_false", None)])
    slot = _slot(ignore_global_guards=True)
    assert effective_guards(inst, slot) == []


def test_effective_guards_both_empty() -> None:
    assert effective_guards(_inst(), _slot()) == []


# --------------------------------------------------------------------------
# evaluate_guard — numeric
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("state", "passes"),
    [("50", True), ("30", False), ("40", False)],  # exact threshold blocks
)
def test_above_is_strict(state: str, passes: bool) -> None:
    ok, _ = evaluate_guard(_hass(state), Guard("sensor.a", "above", 40.0))
    assert ok is passes


@pytest.mark.parametrize(
    ("state", "passes"),
    [("30", True), ("50", False), ("40", False)],  # exact threshold blocks
)
def test_below_is_strict(state: str, passes: bool) -> None:
    ok, _ = evaluate_guard(_hass(state), Guard("sensor.a", "below", 40.0))
    assert ok is passes


def test_equals_uses_tolerance() -> None:
    guard = Guard("sensor.a", "equals", 40.0)
    assert evaluate_guard(_hass("40"), guard)[0] is True
    assert evaluate_guard(_hass("40.0000000001"), guard)[0] is True
    assert evaluate_guard(_hass("41"), guard)[0] is False


def test_negative_and_large_values_work() -> None:
    """No 0-100 clamp: litres and degrees below zero must compare."""
    assert evaluate_guard(_hass("250"), Guard("sensor.a", "above", 200.0))[0] is True
    assert evaluate_guard(_hass("-3"), Guard("sensor.a", "below", 0.0))[0] is True


# --------------------------------------------------------------------------
# evaluate_guard — text + boolean
# --------------------------------------------------------------------------


def test_state_is_ignores_case_and_padding() -> None:
    guard = Guard("input_select.season", "state_is", "Summer")
    assert evaluate_guard(_hass("summer"), guard)[0] is True
    assert evaluate_guard(_hass("  SUMMER "), guard)[0] is True
    assert evaluate_guard(_hass("winter"), guard)[0] is False


@pytest.mark.parametrize("state", ["on", "true", "yes", "open", "home", "1"])
def test_is_true_truthy_states(state: str) -> None:
    assert evaluate_guard(_hass(state), Guard("binary_sensor.a", "is_true"))[0] is True
    assert evaluate_guard(_hass(state), Guard("binary_sensor.a", "is_false"))[0] is False


@pytest.mark.parametrize("state", ["off", "false", "no", "closed", "not_home", "0"])
def test_is_false_falsy_states(state: str) -> None:
    assert evaluate_guard(_hass(state), Guard("binary_sensor.a", "is_false"))[0] is True
    assert evaluate_guard(_hass(state), Guard("binary_sensor.a", "is_true"))[0] is False


def test_boolean_numeric_fallback() -> None:
    """input_number helpers used as a flag still work."""
    assert evaluate_guard(_hass("2.5"), Guard("input_number.a", "is_true"))[0] is True
    assert evaluate_guard(_hass("0"), Guard("input_number.a", "is_true"))[0] is False


# --------------------------------------------------------------------------
# evaluate_guard — fail-open
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("state", "reason"),
    [
        (None, REASON_MISSING),
        ("unavailable", REASON_UNAVAILABLE),
        ("unknown", REASON_UNAVAILABLE),
        ("", REASON_UNAVAILABLE),
        ("abc", REASON_NON_NUMERIC),
        # PR #24 stripped "%" — dropped, so a unit in the state is unreadable
        # and must fail open rather than silently compare.
        ("45 %", REASON_NON_NUMERIC),
    ],
)
def test_numeric_guard_fails_open(state: str | None, reason: str) -> None:
    ok, got = evaluate_guard(_hass(state), Guard("sensor.a", "above", 40.0))
    assert ok is True
    assert got == reason


def test_boolean_guard_fails_open_on_indeterminate_state() -> None:
    ok, reason = evaluate_guard(_hass("heat"), Guard("climate.a", "is_true"))
    assert ok is True
    assert reason == REASON_INDETERMINATE


def test_passing_guard_reports_pass() -> None:
    ok, reason = evaluate_guard(_hass("50"), Guard("sensor.a", "above", 40.0))
    assert ok is True
    assert reason == REASON_PASS


def test_blocking_guard_reports_blocked() -> None:
    ok, reason = evaluate_guard(_hass("30"), Guard("sensor.a", "above", 40.0))
    assert ok is False
    assert reason == REASON_BLOCKED


# --------------------------------------------------------------------------
# guards_allow_run
# --------------------------------------------------------------------------


def test_no_guards_always_runs() -> None:
    assert guards_allow_run(_hass("0"), _inst(), _slot()) is True


def test_all_guards_pass() -> None:
    hass = _hass("50")
    slot = _slot(guards=[Guard("sensor.a", "above", 40.0), Guard("sensor.b", "below", 60.0)])
    assert guards_allow_run(hass, _inst(), slot) is True


@pytest.mark.parametrize("order", [0, 1])
def test_single_blocking_guard_stops_run(order: int) -> None:
    """AND is order independent."""
    passing = Guard("sensor.a", "above", 10.0)
    blocking = Guard("sensor.a", "above", 90.0)
    guards = [passing, blocking] if order == 0 else [blocking, passing]
    assert guards_allow_run(_hass("50"), _inst(), _slot(guards=guards)) is False


def test_global_guard_blocks_slot_without_own_guards() -> None:
    inst = _inst(guards=[Guard("sensor.a", "above", 90.0)])
    assert guards_allow_run(_hass("50"), inst, _slot()) is False


def test_slot_can_opt_out_of_blocking_global_guard() -> None:
    inst = _inst(guards=[Guard("sensor.a", "above", 90.0)])
    slot = _slot(ignore_global_guards=True)
    assert guards_allow_run(_hass("50"), inst, slot) is True


# --------------------------------------------------------------------------
# Manual runs must never be gated
# --------------------------------------------------------------------------


def test_manual_slot_run_is_not_guarded() -> None:
    """async_run_schedule_slot is the user pressing "run now" — always wins."""
    import inspect

    from custom_components.simple_irrigation import runtime

    src = inspect.getsource(runtime.IrrigationRuntime.async_run_schedule_slot)
    assert "guards_allow_run" not in src


def test_due_now_is_guarded() -> None:
    import inspect

    from custom_components.simple_irrigation import runtime

    src = inspect.getsource(runtime.IrrigationRuntime.async_run_due_now)
    assert "guards_allow_run" in src

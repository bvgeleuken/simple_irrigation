"""Guard evaluation: conditions that must hold for a scheduled run to start.

A guard is stated positively — ``sensor.tank above 20`` means "run only while the
tank holds more than 20". All effective guards are AND-combined.

Anything the integration cannot read (missing entity, ``unavailable``, a
non-numeric state for a numeric comparison) **fails open**: the run proceeds. A
broken sensor must never silently stop irrigation for a whole season.
"""

from __future__ import annotations

import logging
import math

from homeassistant.core import HomeAssistant

from .const import (
    GUARD_BOOLEAN_OPERATORS,
    GUARD_NUMERIC_OPERATORS,
    GUARD_OP_ABOVE,
    GUARD_OP_BELOW,
    GUARD_OP_EQUALS,
    GUARD_OP_IS_FALSE,
    GUARD_OP_IS_TRUE,
    GUARD_OP_STATE_IS,
)
from .models import Guard, Installation, ScheduleSlot

_LOGGER = logging.getLogger(__name__)

# States that carry no usable reading.
_EMPTY_STATES = frozenset({"unavailable", "unknown", "none", ""})

_TRUE_STATES = frozenset({"on", "true", "yes", "open", "opening", "home", "1"})
_FALSE_STATES = frozenset({"off", "false", "no", "closed", "closing", "not_home", "0"})

# Reasons returned by evaluate_guard(); everything but "blocked" fails open.
REASON_PASS = "pass"
REASON_BLOCKED = "blocked"
REASON_MISSING = "missing"
REASON_UNAVAILABLE = "unavailable"
REASON_NON_NUMERIC = "non_numeric"
REASON_INDETERMINATE = "indeterminate"
REASON_NO_VALUE = "no_value"


def effective_guards(inst: Installation, slot: ScheduleSlot) -> list[Guard]:
    """Global guards (unless the slot opts out) followed by the slot's own."""
    inherited: list[Guard] = [] if slot.ignore_global_guards else list(inst.guards)
    return inherited + list(slot.guards)


def _as_bool(raw: str) -> bool | None:
    """Interpret a state as a boolean, falling back to "non-zero number"."""
    if raw in _TRUE_STATES:
        return True
    if raw in _FALSE_STATES:
        return False
    try:
        return float(raw) != 0
    except (TypeError, ValueError):
        return None


def evaluate_guard(hass: HomeAssistant, guard: Guard) -> tuple[bool, str]:
    """Return (passes, reason) for one guard. Unreadable input passes."""
    state = hass.states.get(guard.entity_id)
    if state is None:
        return True, REASON_MISSING

    raw = str(state.state).strip()
    if raw.casefold() in _EMPTY_STATES:
        return True, REASON_UNAVAILABLE

    op = guard.operator

    if op in GUARD_BOOLEAN_OPERATORS:
        truth = _as_bool(raw.casefold())
        if truth is None:
            return True, REASON_INDETERMINATE
        want = op == GUARD_OP_IS_TRUE
        return (truth is want), REASON_PASS if truth is want else REASON_BLOCKED

    if op == GUARD_OP_STATE_IS:
        if guard.value is None:
            return True, REASON_NO_VALUE
        passes = raw.casefold() == str(guard.value).strip().casefold()
        return passes, REASON_PASS if passes else REASON_BLOCKED

    if op in GUARD_NUMERIC_OPERATORS:
        if guard.value is None:
            return True, REASON_NO_VALUE
        try:
            current = float(raw)
            threshold = float(guard.value)
        except (TypeError, ValueError):
            return True, REASON_NON_NUMERIC
        if op == GUARD_OP_ABOVE:
            passes = current > threshold
        elif op == GUARD_OP_BELOW:
            passes = current < threshold
        else:  # GUARD_OP_EQUALS
            passes = math.isclose(current, threshold, rel_tol=1e-9, abs_tol=1e-6)
        return passes, REASON_PASS if passes else REASON_BLOCKED

    # Unknown operator — models.Guard.from_dict should have dropped it already.
    return True, REASON_INDETERMINATE


def guards_allow_run(
    hass: HomeAssistant, inst: Installation, slot: ScheduleSlot
) -> bool:
    """AND-combine the slot's effective guards. Logs the first blocking one."""
    for guard in effective_guards(inst, slot):
        passes, reason = evaluate_guard(hass, guard)
        if passes:
            continue
        if reason == REASON_BLOCKED:
            state = hass.states.get(guard.entity_id)
            _LOGGER.info(
                "Skipping slot %s: guard %s %s %s not met (currently %s)",
                slot.slot_id,
                guard.entity_id,
                guard.operator,
                guard.value if guard.value is not None else "",
                state.state if state else "unknown",
            )
        return False
    return True

"""Tests for the optional pre-start script.

The script runs to completion *before* the pre-start outputs, so it can wait
for the world to be ready (mower docking). It fails open: a script that errors
or overruns its timeout must never cost an irrigation run.
"""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock

import pytest

from custom_components.simple_irrigation.models import Installation, RunState
from custom_components.simple_irrigation.runtime import IrrigationRuntime
from custom_components.simple_irrigation.scripts import ScriptCall
from custom_components.simple_irrigation.validation import (
    validate_script_entity,
    validate_script_timeout,
)


def _hass(calls: list[tuple[str, str, dict]]) -> MagicMock:
    """hass recording every service call, in order."""
    hass = MagicMock()

    async def _call(domain, service, data=None, **kwargs):
        calls.append((domain, service, dict(data or {})))

    hass.services.async_call = AsyncMock(side_effect=_call)
    hass.async_create_task = lambda coro, name=None: asyncio.ensure_future(coro)
    return hass


def _runtime(hass: MagicMock, inst: Installation) -> IrrigationRuntime:
    coordinator = MagicMock()
    coordinator.installation = inst
    coordinator.run_state = RunState()
    coordinator.async_update_run_state = AsyncMock()
    return IrrigationRuntime(hass, coordinator)


def _installation(**kwargs) -> Installation:
    base = {"installation_id": "i1", "name": "Garden"}
    base.update(kwargs)
    return Installation(**base)


# --- validation --------------------------------------------------------------


def test_empty_script_is_valid() -> None:
    """No script configured is the normal case, not an error."""
    assert validate_script_entity(MagicMock(), "") is None
    assert validate_script_entity(MagicMock(), None) is None


def test_script_must_be_a_script_entity() -> None:
    hass = MagicMock()
    hass.states.get.return_value = MagicMock(state="off")
    assert validate_script_entity(hass, "switch.pump") == "invalid_script"
    assert validate_script_entity(hass, "mower_go_home") == "invalid_script"
    assert validate_script_entity(hass, "script.mower_go_home") is None


def test_unknown_script_entity_rejected() -> None:
    hass = MagicMock()
    hass.states.get.return_value = None
    assert validate_script_entity(hass, "script.nope") == "unknown_entity"


@pytest.mark.parametrize("value", [0, -1, 3601, "abc", None])
def test_invalid_timeouts(value) -> None:
    assert validate_script_timeout(value) == "invalid_script_timeout"


@pytest.mark.parametrize("value", [1, 300, 3600, "120"])
def test_valid_timeouts(value) -> None:
    assert validate_script_timeout(value) is None


# --- runtime -----------------------------------------------------------------


@pytest.mark.asyncio
async def test_script_runs_before_pre_start_outputs() -> None:
    """Ordering is the whole point: script first, pump second."""
    calls: list[tuple[str, str, dict]] = []
    inst = _installation(
        pre_start_switches=["switch.pump"],
        pre_start_delay_sec=0,
        pre_start_script="script.mower_go_home",
    )
    runtime = _runtime(_hass(calls), inst)

    await runtime._async_pre_start(0)

    assert calls == [
        ("script", "mower_go_home", {}),
        ("switch", "turn_on", {"entity_id": "switch.pump"}),
    ]


@pytest.mark.asyncio
async def test_script_is_called_blocking_by_object_id() -> None:
    """script.<object_id> waits for the script; script.turn_on would not."""
    calls: list[tuple[str, str, dict]] = []
    hass = _hass(calls)
    runtime = _runtime(hass, _installation())

    await runtime._async_run_script(
        ScriptCall("script.mower_go_home", 60), "Pre-start", abort_on_stop=True
    )

    assert calls == [("script", "mower_go_home", {})]
    assert hass.services.async_call.await_args.kwargs["blocking"] is True


@pytest.mark.asyncio
async def test_no_script_configured_is_a_no_op() -> None:
    calls: list[tuple[str, str, dict]] = []
    runtime = _runtime(_hass(calls), _installation())

    await runtime._async_run_script(ScriptCall("", 60), "Pre-start", abort_on_stop=True)

    assert calls == []


@pytest.mark.asyncio
async def test_non_script_entity_is_skipped() -> None:
    """Stale config must not turn a pump on through the script path."""
    calls: list[tuple[str, str, dict]] = []
    runtime = _runtime(_hass(calls), _installation())

    await runtime._async_run_script(
        ScriptCall("switch.pump", 60), "Pre-start", abort_on_stop=True
    )

    assert calls == []


@pytest.mark.asyncio
async def test_failing_script_fails_open() -> None:
    """A raising script logs and waters anyway."""
    calls: list[tuple[str, str, dict]] = []
    inst = _installation(
        pre_start_switches=["switch.pump"],
        pre_start_script="script.boom",
    )
    hass = _hass(calls)

    async def _call(domain, service, data=None, **kwargs):
        if service == "boom":
            raise RuntimeError("script blew up")
        calls.append((domain, service, dict(data or {})))

    hass.services.async_call = AsyncMock(side_effect=_call)
    runtime = _runtime(hass, inst)

    await runtime._async_pre_start(0)

    assert calls == [("switch", "turn_on", {"entity_id": "switch.pump"})]


@pytest.mark.asyncio
async def test_timeout_stops_the_script_and_waters_anyway() -> None:
    """A mower that never docks must not block the season."""
    calls: list[tuple[str, str, dict]] = []
    inst = _installation(
        pre_start_switches=["switch.pump"],
        pre_start_script="script.hangs",
        pre_start_script_timeout_sec=1,
    )
    hass = _hass(calls)

    async def _call(domain, service, data=None, **kwargs):
        calls.append((domain, service, dict(data or {})))
        if service == "hangs":
            await asyncio.sleep(30)

    hass.services.async_call = AsyncMock(side_effect=_call)
    runtime = _runtime(hass, inst)

    await runtime._async_pre_start(0)

    assert calls == [
        ("script", "hangs", {}),
        ("script", "turn_off", {"entity_id": "script.hangs"}),
        ("switch", "turn_on", {"entity_id": "switch.pump"}),
    ]


@pytest.mark.asyncio
async def test_stop_during_script_skips_the_pre_start_outputs() -> None:
    """Stop All while the script waits: nothing is switched on afterwards."""
    calls: list[tuple[str, str, dict]] = []
    inst = _installation(
        pre_start_switches=["switch.pump"],
        pre_start_script="script.slow",
        pre_start_script_timeout_sec=3600,
    )
    hass = _hass(calls)

    async def _call(domain, service, data=None, **kwargs):
        calls.append((domain, service, dict(data or {})))
        if service == "slow":
            await asyncio.sleep(30)

    hass.services.async_call = AsyncMock(side_effect=_call)
    runtime = _runtime(hass, inst)

    task = asyncio.ensure_future(runtime._async_pre_start(0))
    await asyncio.sleep(0)
    runtime._stop_event.set()
    await task

    assert calls == [
        ("script", "slow", {}),
        ("script", "turn_off", {"entity_id": "script.slow"}),
    ]


# --- persistence -------------------------------------------------------------


def test_round_trips_through_the_store() -> None:
    inst = _installation(
        pre_start_script="script.mower_go_home",
        pre_start_script_timeout_sec=600,
    )
    restored = Installation.from_dict(inst.to_dict())
    assert restored.pre_start_script == "script.mower_go_home"
    assert restored.pre_start_script_timeout_sec == 600


def test_installations_stored_before_this_feature_load_with_defaults() -> None:
    """v1.1.0 stores have no script keys; STORE_VERSION stays 1."""
    old = {"installation_id": "i1", "name": "Garden"}
    restored = Installation.from_dict(old)
    assert restored.pre_start_script == ""
    assert restored.pre_start_script_timeout_sec == 300

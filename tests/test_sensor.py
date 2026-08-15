"""Tests for Simple Irrigation sensors."""

from datetime import datetime, timezone
from types import SimpleNamespace

from custom_components.simple_irrigation.const import (
    RUN_STATE_IDLE,
    RUN_STATE_RUNNING,
    RUN_STATE_STOPPING,
)
from custom_components.simple_irrigation.models import Zone
from custom_components.simple_irrigation.sensor import (
    ActiveZonesSensor,
    CurrentRunEndsAtSensor,
    ZoneEndsAtSensor,
)


def _active_zones_value(active_ids: list[str], zones: dict[str, Zone]) -> str | None:
    """Read the value without initializing a Home Assistant entity."""
    sensor = object.__new__(ActiveZonesSensor)
    sensor.coordinator = SimpleNamespace(
        run_state=SimpleNamespace(active_zone_ids=active_ids),
        installation=SimpleNamespace(zones=zones),
    )
    return sensor.native_value


def test_active_zones_uses_zone_names() -> None:
    """Present internal zone UUIDs as human-readable names."""
    zones = {
        "zone-1": Zone(zone_id="zone-1", name="Voortuin"),
        "zone-2": Zone(zone_id="zone-2", name="Achtertuin"),
    }

    assert _active_zones_value(["zone-1", "zone-2"], zones) == "Voortuin, Achtertuin"


def test_active_zones_keeps_unknown_id_as_fallback() -> None:
    """Keep a stale run-state ID visible without breaking the sensor."""
    assert _active_zones_value(["unknown-zone"], {}) == "unknown-zone"


def test_active_zones_is_none_when_idle() -> None:
    """Return no value when no zones are active."""
    assert _active_zones_value([], {}) is None


EARLY = datetime(2026, 8, 15, 10, 5, tzinfo=timezone.utc)
LATE = datetime(2026, 8, 15, 10, 20, tzinfo=timezone.utc)


def _ends_at_value(
    run_state: str,
    active_ids: list[str],
    zone_ends_at: dict[str, datetime],
    zone_id: str | None = None,
) -> datetime | None:
    """Read the value without initializing a Home Assistant entity."""
    sensor = object.__new__(ZoneEndsAtSensor if zone_id else CurrentRunEndsAtSensor)
    if zone_id:
        sensor._zone_id = zone_id
    sensor.coordinator = SimpleNamespace(
        run_state=SimpleNamespace(
            run_state=run_state,
            active_zone_ids=active_ids,
            zone_ends_at=zone_ends_at,
        )
    )
    return sensor.native_value


def test_current_run_ends_at_reports_last_zone_to_finish() -> None:
    """Parallel zones end at different times; the run ends with the last one."""
    value = _ends_at_value(
        RUN_STATE_RUNNING,
        ["zone-1", "zone-2"],
        {"zone-1": EARLY, "zone-2": LATE},
    )

    assert value == LATE


def test_current_run_ends_at_ignores_zones_that_are_not_active() -> None:
    """Only zones watering right now contribute to the end of the current run."""
    value = _ends_at_value(RUN_STATE_RUNNING, ["zone-1"], {"zone-1": EARLY, "zone-2": LATE})

    assert value == EARLY


def test_current_run_ends_at_is_none_when_not_running() -> None:
    """A leftover end time must never render a countdown against a finished run."""
    for state in (RUN_STATE_IDLE, RUN_STATE_STOPPING):
        assert _ends_at_value(state, ["zone-1"], {"zone-1": LATE}) is None


def test_current_run_ends_at_is_none_without_deadline() -> None:
    """A zone driven by an external controller may have no known deadline."""
    assert _ends_at_value(RUN_STATE_RUNNING, ["zone-1"], {}) is None


def test_zone_ends_at_reports_own_deadline() -> None:
    """Each zone reports its own end, not the end of the phase."""
    value = _ends_at_value(
        RUN_STATE_RUNNING,
        ["zone-1", "zone-2"],
        {"zone-1": EARLY, "zone-2": LATE},
        zone_id="zone-1",
    )

    assert value == EARLY


def test_zone_ends_at_is_none_when_not_running() -> None:
    """Same guard as the global sensor."""
    value = _ends_at_value(RUN_STATE_IDLE, ["zone-1"], {"zone-1": EARLY}, zone_id="zone-1")

    assert value is None

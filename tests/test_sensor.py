"""Tests for Simple Irrigation sensors."""

from types import SimpleNamespace

from custom_components.simple_irrigation.models import Zone
from custom_components.simple_irrigation.sensor import ActiveZonesSensor


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

from __future__ import annotations

from unittest.mock import MagicMock

from custom_components.simple_irrigation.models import ScheduleSlot
from custom_components.simple_irrigation.scheduler import slot_allows_humidity_run


def test_schedule_slot_humidity_round_trip() -> None:
    slot = ScheduleSlot(
        slot_id="slot-1",
        weekdays=[0, 2],
        time_local="06:30",
        zone_ids_ordered=["zone-1"],
        humidity_sensor_entity_id="sensor.soil_moisture",
        humidity_threshold=42.5,
    )

    restored = ScheduleSlot.from_dict(slot.to_dict())

    assert restored.humidity_sensor_entity_id == "sensor.soil_moisture"
    assert restored.humidity_threshold == 42.5
    assert restored.weekdays == [0, 2]


def test_slot_allows_humidity_run_only_below_threshold() -> None:
    hass = MagicMock()
    hass.states.get.return_value = MagicMock(state="35.2")
    slot = ScheduleSlot(
        slot_id="slot-2",
        weekdays=[0],
        time_local="07:00",
        humidity_sensor_entity_id="sensor.soil_moisture",
        humidity_threshold=40.0,
    )

    assert slot_allows_humidity_run(hass, slot) is True

    hass.states.get.return_value = MagicMock(state="45")
    assert slot_allows_humidity_run(hass, slot) is False


def test_slot_allows_humidity_run_when_sensor_missing() -> None:
    hass = MagicMock()
    hass.states.get.return_value = None
    slot = ScheduleSlot(
        slot_id="slot-3",
        weekdays=[0],
        time_local="07:00",
        humidity_sensor_entity_id="sensor.soil_moisture",
        humidity_threshold=40.0,
    )

    assert slot_allows_humidity_run(hass, slot) is True

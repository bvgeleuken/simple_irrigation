"""Sensor platform."""

from __future__ import annotations

from homeassistant.components.sensor import SensorDeviceClass, SensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity import EntityCategory
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from .const import DOMAIN, RUN_STATE_RUNNING
from .coordinator import SimpleIrrigationCoordinator
from .entity import SimpleIrrigationEntity


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up sensors."""
    coordinator: SimpleIrrigationCoordinator = hass.data[DOMAIN][entry.entry_id]["coordinator"]
    entities: list[SensorEntity] = [
        ActiveZonesSensor(coordinator),
        NextRunSensor(coordinator),
        PauseUntilSensor(coordinator),
        CurrentRunEndsAtSensor(coordinator),
    ]
    for zid, zone in coordinator.installation.zones.items():
        entities.append(ZoneNextRunSensor(coordinator, zid, zone.name))
        entities.append(ZoneLastRunSensor(coordinator, zid, zone.name))
        entities.append(ZoneEndsAtSensor(coordinator, zid, zone.name))
    async_add_entities(entities)


class ActiveZonesSensor(SimpleIrrigationEntity, SensorEntity):
    """Comma-separated active zone names."""

    _attr_translation_key = "active_zones"
    _attr_icon = "mdi:sprinkler-variant"
    _attr_entity_category = EntityCategory.DIAGNOSTIC

    def __init__(self, coordinator: SimpleIrrigationCoordinator) -> None:
        """Initialize."""
        super().__init__(coordinator, "sensor_active_zones")

    @property
    def native_value(self) -> str | None:
        """Active zones."""
        ids = self.coordinator.run_state.active_zone_ids
        if not ids:
            return None
        zones = self.coordinator.installation.zones
        return ", ".join(zones[zid].name if zid in zones else zid for zid in ids)


class NextRunSensor(SimpleIrrigationEntity, SensorEntity):
    """Next scheduled run (global)."""

    _attr_translation_key = "next_run"
    _attr_device_class = SensorDeviceClass.TIMESTAMP
    _attr_entity_category = EntityCategory.DIAGNOSTIC

    def __init__(self, coordinator: SimpleIrrigationCoordinator) -> None:
        """Initialize."""
        super().__init__(coordinator, "sensor_next_run")

    @property
    def native_value(self):
        """Next run."""
        return self.coordinator.run_state.next_run_global


class PauseUntilSensor(SimpleIrrigationEntity, SensorEntity):
    """Pause until timestamp."""

    _attr_translation_key = "pause_until"
    _attr_device_class = SensorDeviceClass.TIMESTAMP
    _attr_entity_category = EntityCategory.DIAGNOSTIC

    def __init__(self, coordinator: SimpleIrrigationCoordinator) -> None:
        """Initialize."""
        super().__init__(coordinator, "sensor_pause_until")

    @property
    def native_value(self):
        """Pause until."""
        return self.coordinator.installation.pause_until


class CurrentRunEndsAtSensor(SimpleIrrigationEntity, SensorEntity):
    """When the zones watering right now are planned to finish.

    A timestamp rather than a remaining-minutes value on purpose: the state then
    changes twice per zone run instead of continuously, which keeps the recorder
    quiet, and a dashboard can still render a live countdown from it
    (`format: relative` on an entities row).
    """

    _attr_translation_key = "current_run_ends_at"
    _attr_icon = "mdi:timer-sand"
    _attr_device_class = SensorDeviceClass.TIMESTAMP

    def __init__(self, coordinator: SimpleIrrigationCoordinator) -> None:
        """Initialize."""
        super().__init__(coordinator, "sensor_current_run_ends_at")

    @property
    def native_value(self):
        """Latest planned end among the zones running right now."""
        rs = self.coordinator.run_state
        # Guarded by run_state, so a stale entry can never produce a phantom
        # countdown — whatever left it behind.
        if rs.run_state != RUN_STATE_RUNNING:
            return None
        ends = [rs.zone_ends_at[zid] for zid in rs.active_zone_ids if zid in rs.zone_ends_at]
        return max(ends) if ends else None


class ZoneNextRunSensor(SimpleIrrigationEntity, SensorEntity):
    """Per-zone next run."""

    _attr_device_class = SensorDeviceClass.TIMESTAMP
    _attr_entity_category = EntityCategory.DIAGNOSTIC

    def __init__(
        self,
        coordinator: SimpleIrrigationCoordinator,
        zone_id: str,
        zone_name: str,
    ) -> None:
        """Initialize."""
        super().__init__(coordinator, f"zone_{zone_id}_next_run")
        self._zone_id = zone_id
        self._attr_translation_key = "zone_next_run"
        self._attr_translation_placeholders = {"zone_name": zone_name}

    @property
    def native_value(self):
        """Next run for zone."""
        return self.coordinator.run_state.next_run_per_zone.get(self._zone_id)


class ZoneLastRunSensor(SimpleIrrigationEntity, SensorEntity):
    """Per-zone last run."""

    _attr_device_class = SensorDeviceClass.TIMESTAMP
    _attr_entity_category = EntityCategory.DIAGNOSTIC

    def __init__(
        self,
        coordinator: SimpleIrrigationCoordinator,
        zone_id: str,
        zone_name: str,
    ) -> None:
        """Initialize."""
        super().__init__(coordinator, f"zone_{zone_id}_last_run")
        self._zone_id = zone_id
        self._attr_translation_key = "zone_last_run"
        self._attr_translation_placeholders = {"zone_name": zone_name}

    @property
    def native_value(self):
        """Last run for zone."""
        return self.coordinator.run_state.last_run_per_zone.get(self._zone_id)


class ZoneEndsAtSensor(SimpleIrrigationEntity, SensorEntity):
    """Per-zone planned end of the current run.

    Useful with parallel zones, where each zone can have its own duration and the
    global sensor only reports the last one to finish.
    """

    _attr_icon = "mdi:timer-sand"
    _attr_device_class = SensorDeviceClass.TIMESTAMP

    def __init__(
        self,
        coordinator: SimpleIrrigationCoordinator,
        zone_id: str,
        zone_name: str,
    ) -> None:
        """Initialize."""
        super().__init__(coordinator, f"zone_{zone_id}_ends_at")
        self._zone_id = zone_id
        self._attr_translation_key = "zone_ends_at"
        self._attr_translation_placeholders = {"zone_name": zone_name}

    @property
    def native_value(self):
        """Planned end for this zone while it is watering."""
        rs = self.coordinator.run_state
        if rs.run_state != RUN_STATE_RUNNING:
            return None
        return rs.zone_ends_at.get(self._zone_id)

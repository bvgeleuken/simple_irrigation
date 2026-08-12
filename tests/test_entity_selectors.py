"""Regression tests for native Home Assistant entity selectors."""

from pathlib import Path

from custom_components.simple_irrigation.config_flow import _output_entity_selector


ROOT = Path(__file__).parents[1]
CONFIG_FLOW = ROOT / "custom_components/simple_irrigation/config_flow.py"
FRONTEND = ROOT / "custom_components/simple_irrigation/frontend/src"


def _frontend_source() -> str:
    return "\n".join(path.read_text() for path in FRONTEND.rglob("*.ts"))


def test_config_flow_uses_modern_multiple_entity_selector() -> None:
    """The setup form uses an entity selector with its original domain filter."""
    source = CONFIG_FLOW.read_text()

    assert "EntitySelectorConfig(" in source
    assert 'filter={"domain": ["switch", "input_boolean", "group", "valve"]}' in source
    assert "multiple=multiple" in source
    assert '_output_entity_selector(\n                    multiple=True' in source


def test_entity_selector_validates_single_and_multiple_entity_ids() -> None:
    """Native selectors retain scalar/list values and their frontend filter."""
    single = _output_entity_selector(multiple=False)
    multiple = _output_entity_selector(multiple=True)

    assert single("switch.front_lawn") == "switch.front_lawn"
    assert multiple(["switch.front_lawn", "valve.back_lawn"]) == [
        "switch.front_lawn",
        "valve.back_lawn",
    ]
    assert single.config["filter"] == [
        {"domain": ["switch", "input_boolean", "group", "valve"]}
    ]
    assert multiple.config["multiple"] is True


def test_panel_uses_native_entity_picker_with_string_values() -> None:
    """Panel fields use HA's picker and consume its entity_id string value."""
    entity_input = (FRONTEND / "entity-input.ts").read_text()

    assert "<ha-entity-picker" in entity_input
    assert ".includeDomains=${domains}" in entity_input
    assert '@value-changed=${(e: CustomEvent<{ value?: string }>)' in entity_input
    assert 'onValue(e.detail.value ?? "")' in entity_input


def test_panel_does_not_construct_entity_option_lists() -> None:
    """No form enumerates hass.states or constructs an entity datalist."""
    source = _frontend_source()

    assert "Object.keys(hass.states)" not in source
    assert "renderEntityDatalist" not in source
    assert "<datalist" not in source
    assert 'list=${' not in source


def test_panel_preserves_entity_domain_filters() -> None:
    """Output, guard, script, and start-target restrictions remain explicit."""
    source = _frontend_source()

    assert '["switch", "input_boolean", "group", "valve"]' in source
    assert 'export const SCRIPT_ENTITY_DOMAINS = ["script"]' in source
    assert '"sensor",\n  "binary_sensor",\n  "input_boolean"' in source
    assert (
        '["switch", "valve", "binary_sensor", "input_boolean", "number"]'
        in source
    )


def test_existing_single_and_multiple_values_remain_entity_ids() -> None:
    """Existing scalar and repeated fields still load entity IDs unchanged."""
    zones = (FRONTEND / "views/view-zones.ts").read_text()
    scripts = (FRONTEND / "script-override.ts").read_text()

    assert "switch_entity_ids: ids" in zones
    assert 'start_entity_id: String(o.start_entity_id ?? "")' in zones
    assert 'entity_id: String(o[`${phase}_script`] ?? "").trim()' in scripts


def test_state_is_uses_entity_aware_native_state_picker() -> None:
    """The text-state guard obtains valid states from its selected entity."""
    guards = (FRONTEND / "guard-list-editor.ts").read_text()

    assert "<ha-selector" in guards
    assert '.selector=${{ state: { entity_id: guard.entity_id } }}' in guards
    assert "@value-changed=" in guards
    assert "v === g.entity_id ? g.value" in guards

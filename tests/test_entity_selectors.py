"""Regression tests for the native Home Assistant entity selectors.

The panel is TypeScript, so some checks below read the frontend source. They are
deliberately limited to the things a Python test can state better than a linter:
that the domain lists the panel offers never contradict the rules
``validation.py`` actually enforces, and that the two fields the backend leaves
domain-agnostic stay open to any entity. Everything is matched against
whitespace-collapsed source so reformatting the panel cannot break these tests.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from custom_components.simple_irrigation.config_flow import _output_entity_selector
from custom_components.simple_irrigation.const import OUTPUT_ENTITY_DOMAINS, SCRIPT_DOMAIN

ROOT = Path(__file__).parents[1]
FRONTEND = ROOT / "custom_components/simple_irrigation/frontend/src"


def _squeeze(text: str) -> str:
    """Collapse whitespace so indentation and line breaks stop mattering."""
    return re.sub(r"\s+", " ", text)


def _source(relative: str) -> str:
    return _squeeze((FRONTEND / relative).read_text(encoding="utf-8"))


def _frontend_source() -> str:
    return _squeeze("\n".join(p.read_text(encoding="utf-8") for p in sorted(FRONTEND.rglob("*.ts"))))


def _ts_domain_list(relative: str, name: str) -> set[str]:
    """The string literals of a `const <name> = [...]` array in the panel source."""
    match = re.search(rf"\b{name}\s*=\s*\[(.*?)\]", _source(relative))
    assert match, f"{name} not found in {relative}"
    return set(re.findall(r'"([^"]+)"', match.group(1)))


def test_output_selector_keeps_scalar_and_list_values() -> None:
    """The setup form still stores plain entity IDs, single or repeated."""
    single = _output_entity_selector(multiple=False)
    multiple = _output_entity_selector(multiple=True)

    assert single("switch.front_lawn") == "switch.front_lawn"
    assert multiple(["switch.front_lawn", "valve.back_lawn"]) == [
        "switch.front_lawn",
        "valve.back_lawn",
    ]
    assert multiple.config["multiple"] is True
    assert single.config.get("multiple", False) is False


def test_output_selector_filters_on_the_domains_the_backend_enforces() -> None:
    """`is_allowed_output_domain` rejects anything else, so the picker may filter."""
    selector = _output_entity_selector(multiple=False)

    assert len(selector.config["filter"]) == 1
    assert set(selector.config["filter"][0]["domain"]) == set(OUTPUT_ENTITY_DOMAINS)


def test_panel_output_domains_match_the_backend_rule() -> None:
    """The panel's fallback list drifting from the backend hides valid entities."""
    assert _ts_domain_list("views/view-zones.ts", "defaultDomains") == set(OUTPUT_ENTITY_DOMAINS)


def test_panel_script_fields_use_the_script_domain() -> None:
    """`validate_script_entity` accepts nothing but `script.*`."""
    assert _ts_domain_list("script-override.ts", "SCRIPT_ENTITY_DOMAINS") == {SCRIPT_DOMAIN}


@pytest.mark.parametrize(
    ("relative", "field"),
    [
        ("guard-list-editor.ts", "guard entity"),
        ("views/view-zones.ts", "zone start target"),
    ],
)
def test_domain_agnostic_fields_stay_open_to_any_entity(relative: str, field: str) -> None:
    """`parse_guard_list` and `start_entity_id` put no domain rule on the value.

    Their domain lists rank the suggestions; turning one into a picker filter
    would lock out working setups (a guard on `weather.home`, a start target on
    `button.start`), so those pickers must run with `allowCustom`.
    """
    assert "allowCustom: true" in _source(relative), (
        f"the {field} picker must allow entities outside its suggested domains"
    )


@pytest.mark.parametrize("relative", ["views/view-settings.ts", "script-override.ts"])
def test_backend_enforced_fields_keep_their_filter(relative: str) -> None:
    """Outputs and scripts are validated server-side — do not weaken those pickers."""
    assert "allowCustom" not in _source(relative)


def test_panel_hands_back_the_entity_id_the_picker_selected() -> None:
    """The stored value stays an entity_id, so no config migration is needed."""
    entity_input = _source("entity-input.ts")

    assert "<ha-entity-picker" in entity_input
    assert "onValue(e.detail.value ?? \"\")" in entity_input


def test_panel_no_longer_builds_its_own_entity_lists() -> None:
    """The whole point of the native picker: no hand-rolled option list is left."""
    source = _frontend_source()

    assert "Object.keys(hass.states)" not in source
    assert "renderEntityDatalist" not in source
    assert "<datalist" not in source


def test_panel_startup_cannot_block_on_a_missing_element() -> None:
    """`whenDefined` never rejects; without a timeout a lazy tag blanks the panel."""
    assert "Promise.race" in _source("load-ha-elements.ts")

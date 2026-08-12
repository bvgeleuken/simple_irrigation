import { html, type TemplateResult } from "lit";
import { t } from "./i18n";
import type { HomeAssistant } from "./types";

/**
 * Render Home Assistant's standard searchable entity picker.
 *
 * Entity names, icons, supporting information, and search are deliberately left
 * to the Home Assistant frontend. The value emitted by the picker is always the
 * selected entity_id.
 */
export function renderNativeEntityField(
  hass: HomeAssistant,
  domains: string[],
  label: string,
  value: string,
  onValue: (v: string) => void,
  /** Override when the default output example (valves, switches) would mislead. */
  placeholderKey = "config_panel.entity_placeholder_example"
): TemplateResult {
  return html`
    <ha-entity-picker
      .hass=${hass}
      .label=${label}
      .value=${value || undefined}
      .includeDomains=${domains}
      .placeholder=${t(hass, placeholderKey)}
      .required=${false}
      @value-changed=${(e: CustomEvent<{ value?: string }>) => onValue(e.detail.value ?? "")}
    ></ha-entity-picker>
  `;
}

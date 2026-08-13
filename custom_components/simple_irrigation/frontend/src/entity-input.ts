import { html, type TemplateResult } from "lit";
import { t } from "./i18n";
import type { HomeAssistant } from "./types";

export interface EntityFieldOptions {
  /** Override when the default output example (valves, switches) would mislead. */
  placeholderKey?: string;
  /**
   * Keep the field open to entities outside `domains`.
   *
   * Only outputs and scripts are domain-restricted on the backend
   * (`is_allowed_output_domain`, `validate_script_entity`) — there the picker may
   * filter. Guards and the zone start target are deliberately domain-agnostic in
   * `validation.py`, so for those the domain list only ranks the suggestions and
   * must never become a filter: a guard on `weather.home` or a start target on
   * `button.start` has to stay selectable.
   */
  allowCustom?: boolean;
}

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
  {
    placeholderKey = "config_panel.entity_placeholder_example",
    allowCustom = false,
  }: EntityFieldOptions = {}
): TemplateResult {
  return html`
    <ha-entity-picker
      .hass=${hass}
      .label=${label}
      .value=${value || undefined}
      .includeDomains=${domains}
      .placeholder=${t(hass, placeholderKey)}
      .allowCustomEntity=${allowCustom}
      .required=${false}
      @value-changed=${(e: CustomEvent<{ value?: string }>) => onValue(e.detail.value ?? "")}
    ></ha-entity-picker>
  `;
}

import { html, nothing, type TemplateResult } from "lit";
import { renderNativeEntityField } from "./entity-input";
import { t } from "./i18n";
import type { HomeAssistant } from "./types";

/**
 * A schedule slot's override for one of the installation's pipeline scripts.
 *
 * The switch is what makes "no script at all for this slot" expressible: with
 * `override` on and an empty entity_id nothing runs, instead of falling back to
 * the installation's script. That is the drip-irrigation case — leave the mower
 * out while the lawn slot sends it home.
 *
 * Shared render functions keep the native Home Assistant entity picker
 * consistent between the schedule editor and cycle wizard.
 */

export type ScriptPhase = "pre_start" | "post_run";

export interface ScriptOverride {
  override: boolean;
  entity_id: string;
  /** null = use the installation's timeout. */
  timeout_sec: number | null;
}

export const SCRIPT_ENTITY_DOMAINS = ["script"];
export const MAX_SCRIPT_TIMEOUT_SEC = 3600;

/** Nothing overridden — the installation's script applies. Copy before editing. */
export const EMPTY_SCRIPT_OVERRIDE: ScriptOverride = {
  override: false,
  entity_id: "",
  timeout_sec: null,
};

/** Read one phase's override off a raw slot object from the API. */
export function normalizeScriptOverride(
  raw: Record<string, unknown> | undefined,
  phase: ScriptPhase
): ScriptOverride {
  const o = raw ?? {};
  const timeout = Number(o[`${phase}_script_timeout_sec`]);
  return {
    override: Boolean(o[`override_${phase}_script`] ?? false),
    entity_id: String(o[`${phase}_script`] ?? "").trim(),
    timeout_sec: Number.isFinite(timeout) && timeout > 0 ? Math.round(timeout) : null,
  };
}

/** The three keys the slot API expects for one phase. */
export function scriptOverrideForSave(
  value: ScriptOverride,
  phase: ScriptPhase
): Record<string, unknown> {
  return {
    [`override_${phase}_script`]: value.override,
    [`${phase}_script`]: value.override ? value.entity_id.trim() : "",
    [`${phase}_script_timeout_sec`]: value.override ? value.timeout_sec : null,
  };
}

/** True when either phase replaces the installation's script. */
export function hasScriptOverride(pre: ScriptOverride, post: ScriptOverride): boolean {
  return pre.override || post.override;
}

export function renderScriptOverride(
  hass: HomeAssistant,
  domains: string[],
  phase: ScriptPhase,
  value: ScriptOverride,
  /** The installation's script and timeout, shown while not overriding. */
  globalScript: string,
  globalTimeoutSec: number,
  busy: boolean,
  onChange: (next: ScriptOverride) => void
): TemplateResult {
  const patch = (p: Partial<ScriptOverride>): void => onChange({ ...value, ...p });

  return html`
    <div class="field-block">
      <span class="field-title">${t(hass, `config_panel.schedule_${phase}_script_title`)}</span>
      <div class="switch-row">
        <ha-switch
          .disabled=${busy}
          .checked=${value.override}
          @change=${(e: Event) =>
            patch({
              override: Boolean((e.target as HTMLInputElement & { checked: boolean }).checked),
            })}
        ></ha-switch>
        <span class="switch-row-label"
          >${t(hass, `config_panel.schedule_override_${phase}_script`)}</span
        >
      </div>
      ${value.override
        ? html`
            <div class="field-row">
              ${renderNativeEntityField(
                hass,
                domains,
                t(hass, "config_panel.schedule_script_field"),
                value.entity_id,
                (v) => patch({ entity_id: v }),
                "config_panel.entity_placeholder_script"
              )}
            </div>
            <p class="hint">${t(hass, "config_panel.schedule_script_override_hint")}</p>
            ${value.entity_id.trim()
              ? html`
                  <div class="field-row">
                    <ha-input
                      type="number"
                      .label=${t(hass, "config_panel.schedule_script_timeout_field")}
                      .value=${value.timeout_sec === null ? "" : String(value.timeout_sec)}
                      min="1"
                      max=${MAX_SCRIPT_TIMEOUT_SEC}
                      @input=${(e: Event) => {
                        const raw = (e.target as HTMLInputElement).value.trim();
                        if (raw === "") {
                          patch({ timeout_sec: null });
                          return;
                        }
                        const n = parseInt(raw, 10);
                        patch({
                          timeout_sec: Number.isFinite(n)
                            ? Math.max(1, Math.min(MAX_SCRIPT_TIMEOUT_SEC, n))
                            : null,
                        });
                      }}
                    ></ha-input>
                  </div>
                  <p class="hint">
                    ${t(hass, "config_panel.schedule_script_timeout_hint", {
                      n: String(globalTimeoutSec),
                    })}
                  </p>
                `
              : nothing}
          `
        : html`<p class="hint">
            ${globalScript
              ? t(hass, "config_panel.schedule_script_inherited", { script: globalScript })
              : t(hass, "config_panel.schedule_script_inherited_none")}
          </p>`}
    </div>
  `;
}

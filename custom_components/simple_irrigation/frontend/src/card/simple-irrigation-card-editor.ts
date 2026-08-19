import { css, html, LitElement, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";

import {
  ACTION_TYPES,
  PANEL_PAGES,
  type ActionConfig,
  type ActionTarget,
  type ActionType,
  type PanelPage,
} from "./actions";
import { listEntries, subscribeSnapshot } from "./api";
import { fireEvent } from "./fire-event";
import { localize } from "./i18n";
import {
  ACTION_KEYS,
  CARD_ACTIONS,
  DEFAULT_CONFIG,
  type CardAction,
  type CardView,
  type EntryRow,
  type HomeAssistant,
  type ManualStart,
  type SimpleIrrigationCardConfig,
  type Snapshot,
} from "./types";

/** Views the editor offers as chips; `run` is reached via the picker toggle. */
const EDITOR_VIEWS: CardView[] = ["status", "zones", "schedule", "week"];

const MANUAL_MODES: ManualStart[] = ["zones", "slot", "both"];

@customElement("simple-irrigation-card-editor")
export class SimpleIrrigationCardEditor extends LitElement {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: SimpleIrrigationCardConfig;

  @state() private _entries: EntryRow[] = [];

  /** Only needed for the explicit zone picker. */
  @state() private _snapshot?: Snapshot;

  private _unsubscribe?: Promise<() => Promise<void>>;

  public setConfig(config: SimpleIrrigationCardConfig): void {
    this._config = { ...DEFAULT_CONFIG, ...config };
  }

  public connectedCallback(): void {
    super.connectedCallback();
    void this._loadEntries();
    this._resubscribe();
  }

  public disconnectedCallback(): void {
    super.disconnectedCallback();
    this._unsubscribe?.then((unsub) => unsub()).catch(() => undefined);
    this._unsubscribe = undefined;
  }

  protected updated(): void {
    if (this.hass && !this._entries.length) void this._loadEntries();
    this._resubscribe();
  }

  private async _loadEntries(): Promise<void> {
    if (!this.hass || this._entries.length) return;
    try {
      this._entries = await listEntries(this.hass);
    } catch {
      this._entries = [];
    }
  }

  private _resubscribe(): void {
    if (!this.hass || this._unsubscribe || !this.isConnected) return;
    this._unsubscribe = subscribeSnapshot(
      this.hass,
      (snapshot) => {
        this._snapshot = snapshot;
      },
      this._config?.entry_id
    );
    this._unsubscribe.catch(() => {
      this._unsubscribe = undefined;
    });
  }

  private _emit(patch: Partial<SimpleIrrigationCardConfig>): void {
    if (!this._config) return;
    const next = { ...this._config, ...patch } as Record<string, unknown>;
    // Keep the YAML honest: options at their default add noise, and an option
    // that does not apply to the chosen view is worse than noise.
    for (const [key, value] of Object.entries(DEFAULT_CONFIG)) {
      if (JSON.stringify(next[key]) === JSON.stringify(value)) {
        delete next[key];
      }
    }
    if (next.view !== "schedule") delete next.next_runs;
    if (!next.entry_id) delete next.entry_id;
    const config = next as unknown as SimpleIrrigationCardConfig;
    this._config = { ...DEFAULT_CONFIG, ...config };
    fireEvent(this, "config-changed", { config });
  }

  protected render(): TemplateResult | typeof nothing {
    if (!this.hass || !this._config) return nothing;
    const cfg = { ...DEFAULT_CONFIG, ...this._config };
    const view = cfg.view;

    return html`
      <div class="wrap">
        <div class="etitle">${localize(this.hass, "editor_title")}</div>

        ${this._entries.length > 1
          ? html`
              <div class="flabel">
                ${localize(this.hass, "editor_installation")}
              </div>
              <select
                class="select"
                .value=${this._config.entry_id ?? ""}
                @change=${(ev: Event) =>
                  this._emit({
                    entry_id:
                      (ev.target as HTMLSelectElement).value || undefined,
                  })}
              >
                <option value="">
                  ${localize(this.hass, "editor_installation_auto")}
                </option>
                ${this._entries.map(
                  (entry) => html`<option value=${entry.entry_id}>
                    ${entry.name}
                  </option>`
                )}
              </select>
            `
          : nothing}

        <div class="flabel">${localize(this.hass, "editor_view")}</div>
        <div class="seg">
          ${EDITOR_VIEWS.map(
            (option) => html`<button
              class=${classMap({ on: view === option })}
              @click=${() => this._emit({ view: option })}
            >
              ${localize(this.hass, `editor_view_${option}`)}
            </button>`
          )}
        </div>

        ${this._toggleRow(
          "editor_compact",
          cfg.compact,
          (on) => this._emit({ compact: on }),
          "editor_compact_help"
        )}
        ${view === "status" || view === "run"
          ? this._toggleRow("editor_show_mode", cfg.show_mode, (on) =>
              this._emit({ show_mode: on })
            )
          : nothing}
        ${this._toggleRow(
          "editor_manual_start",
          cfg.manual_start !== "off",
          (on) => this._emit({ manual_start: on ? "zones" : "off" }),
          "editor_manual_start_help"
        )}
        ${cfg.manual_start !== "off"
          ? html`
              <div class="flabel">
                ${localize(this.hass, "editor_manual_start_mode")}
              </div>
              <div class="seg">
                ${MANUAL_MODES.map(
                  (mode) => html`<button
                    class=${classMap({ on: cfg.manual_start === mode })}
                    @click=${() => this._emit({ manual_start: mode })}
                  >
                    ${localize(
                      this.hass,
                      mode === "zones"
                        ? "editor_manual_zones"
                        : mode === "slot"
                          ? "editor_manual_slot"
                          : "editor_manual_both"
                    )}
                  </button>`
                )}
              </div>
              ${this._toggleRow(
                "editor_manual_duration",
                cfg.manual_duration,
                (on) => this._emit({ manual_duration: on })
              )}
            `
          : nothing}

        ${view === "status"
          ? html`
              <div class="flabel top">
                ${localize(this.hass, "editor_actions")}
              </div>
              <div class="chips">
                ${CARD_ACTIONS.map((action) => {
                  const on = cfg.actions.includes(action);
                  return html`<button
                    class=${classMap({ chip: true, on })}
                    @click=${() => this._toggleAction(action)}
                  >
                    ${localize(this.hass, `action_${action}`)}
                  </button>`;
                })}
              </div>
            `
          : nothing}

        ${view === "schedule"
          ? html`
              <div class="flabel top">
                ${localize(this.hass, "editor_next_runs")}
              </div>
              <input
                class="select"
                type="number"
                min="1"
                max="12"
                .value=${String(cfg.next_runs)}
                @change=${(ev: Event) => {
                  const value = Number.parseInt(
                    (ev.target as HTMLInputElement).value,
                    10
                  );
                  if (Number.isFinite(value)) {
                    this._emit({ next_runs: Math.min(12, Math.max(1, value)) });
                  }
                }}
              />
              <div class="fhelp">
                ${localize(this.hass, "editor_next_runs_help")}
              </div>
            `
          : nothing}

        ${view === "zones"
          ? html`
              <div class="flabel top">${localize(this.hass, "editor_zones")}</div>
              <div class="seg">
                ${(["all", "active", "custom"] as const).map(
                  (option) => html`<button
                    class=${classMap({ on: this._zoneMode() === option })}
                    @click=${() => this._setZoneMode(option)}
                  >
                    ${localize(this.hass, `editor_zones_${option}`)}
                  </button>`
                )}
              </div>
              ${this._zoneMode() === "custom" && this._snapshot
                ? html`<div class="chips">
                    ${this._snapshot.zones.map((zone) => {
                      const picked = Array.isArray(cfg.zones)
                        ? cfg.zones.includes(zone.zone_id)
                        : false;
                      return html`<button
                        class=${classMap({ chip: true, on: picked })}
                        @click=${() => this._toggleZone(zone.zone_id)}
                      >
                        ${zone.name}
                      </button>`;
                    })}
                  </div>`
                : nothing}
            `
          : nothing}

        <div class="flabel top strong">
          ${localize(this.hass, "editor_interactions")}
        </div>
        <div class="fhelp bottom">
          ${localize(this.hass, "editor_interactions_help")}
        </div>
        ${this._actionTarget("card", "editor_actions_card")}
        ${view === "zones"
          ? this._actionTarget("zone", "editor_actions_zone")
          : nothing}
        ${view === "schedule" || view === "week"
          ? this._actionTarget("run", "editor_actions_run")
          : nothing}
      </div>
    `;
  }

  // ---- tap / hold ---------------------------------------------------------

  private _action(target: ActionTarget, kind: "tap" | "hold"): ActionConfig {
    const key = ACTION_KEYS[target][kind];
    const value = (this._config?.[key] ?? DEFAULT_CONFIG[key]) as ActionConfig;
    return value;
  }

  private _setAction(
    target: ActionTarget,
    kind: "tap" | "hold",
    action: ActionConfig
  ): void {
    const key = ACTION_KEYS[target][kind];
    this._emit({ [key]: action } as Partial<SimpleIrrigationCardConfig>);
  }

  /** Patch one field, dropping it again when the input is cleared. */
  private _patchAction(
    target: ActionTarget,
    kind: "tap" | "hold",
    patch: Partial<ActionConfig>
  ): void {
    const next = { ...this._action(target, kind), ...patch } as Record<
      string,
      unknown
    >;
    for (const [field, value] of Object.entries(patch)) {
      if (value === undefined || value === "") delete next[field];
    }
    this._setAction(target, kind, next as unknown as ActionConfig);
  }

  private _actionTarget(
    target: ActionTarget,
    labelKey: string
  ): TemplateResult {
    return html`
      <div class="flabel top">${localize(this.hass, labelKey)}</div>
      ${this._actionEditor(target, "tap")}
      ${this._actionEditor(target, "hold")}
    `;
  }

  private _actionEditor(
    target: ActionTarget,
    kind: "tap" | "hold"
  ): TemplateResult {
    const action = this._action(target, kind);
    return html`
      <div class="arow">
        <span class="aname">
          ${localize(
            this.hass,
            kind === "tap" ? "editor_tap_action" : "editor_hold_action"
          )}
        </span>
        <select
          class="select inline"
          @change=${(ev: Event) =>
            this._setAction(target, kind, {
              action: (ev.target as HTMLSelectElement).value as ActionType,
            })}
        >
          ${ACTION_TYPES.map(
            (type) => html`<option
              value=${type}
              ?selected=${type === action.action}
            >
              ${localize(this.hass, `editor_action_${type.replace("-", "_")}`)}
            </option>`
          )}
        </select>
      </div>
      ${this._actionFields(target, kind, action)}
    `;
  }

  private _actionFields(
    target: ActionTarget,
    kind: "tap" | "hold",
    action: ActionConfig
  ): TemplateResult | typeof nothing {
    switch (action.action) {
      case "more-info":
        return html`<input
          class="select sub"
          type="text"
          .value=${action.entity ?? ""}
          placeholder=${localize(this.hass, "editor_action_entity")}
          @change=${(ev: Event) =>
            this._patchAction(target, kind, {
              entity: (ev.target as HTMLInputElement).value.trim(),
            })}
        />`;
      case "panel":
        return html`
          <select
            class="select sub"
            @change=${(ev: Event) => {
              const value = (ev.target as HTMLSelectElement).value;
              this._patchAction(target, kind, {
                panel_page: (value || undefined) as PanelPage | undefined,
              });
            }}
          >
            <option value="" ?selected=${!action.panel_page}>
              ${localize(this.hass, "editor_panel_page_auto")}
            </option>
            ${PANEL_PAGES.map(
              (page) => html`<option
                value=${page}
                ?selected=${page === action.panel_page}
              >
                ${localize(this.hass, `editor_page_${page}`)}
              </option>`
            )}
          </select>
          <div class="fhelp bottom">
            ${localize(this.hass, "editor_panel_admin_help")}
          </div>
        `;
      case "navigate":
        return html`<input
          class="select sub"
          type="text"
          .value=${action.navigation_path ?? ""}
          placeholder="/lovelace/garden"
          @change=${(ev: Event) =>
            this._patchAction(target, kind, {
              navigation_path: (ev.target as HTMLInputElement).value.trim(),
            })}
        />`;
      case "url":
        return html`<input
          class="select sub"
          type="text"
          .value=${action.url_path ?? ""}
          placeholder="https://…"
          @change=${(ev: Event) =>
            this._patchAction(target, kind, {
              url_path: (ev.target as HTMLInputElement).value.trim(),
            })}
        />`;
      case "perform-action":
        return html`
          <input
            class="select sub"
            type="text"
            .value=${action.perform_action ?? action.service ?? ""}
            placeholder="simple_irrigation.run_zone"
            @change=${(ev: Event) =>
              this._patchAction(target, kind, {
                perform_action: (ev.target as HTMLInputElement).value.trim(),
                service: undefined,
              })}
          />
          <input
            class="select sub"
            type="text"
            .value=${action.data ? JSON.stringify(action.data) : ""}
            placeholder=${localize(this.hass, "editor_action_data")}
            @change=${(ev: Event) => this._onActionData(target, kind, ev)}
          />
          <div class="fhelp bottom">
            ${localize(this.hass, "editor_action_data_help")}
          </div>
        `;
      default:
        return nothing;
    }
  }

  private _onActionData(
    target: ActionTarget,
    kind: "tap" | "hold",
    ev: Event
  ): void {
    const input = ev.target as HTMLInputElement;
    const raw = input.value.trim();
    if (!raw) {
      this._patchAction(target, kind, { data: undefined });
      input.setCustomValidity("");
      return;
    }
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error("not an object");
      }
      input.setCustomValidity("");
      this._patchAction(target, kind, { data: parsed });
    } catch {
      // Keep what they typed and say so, rather than silently dropping it.
      input.setCustomValidity(localize(this.hass, "editor_action_data_invalid"));
      input.reportValidity();
    }
  }

  private _toggleRow(
    labelKey: string,
    value: boolean,
    onChange: (on: boolean) => void,
    helpKey?: string
  ): TemplateResult {
    return html`<div class="row">
      <div class="rowmain">
        <span>${localize(this.hass, labelKey)}</span>
        ${helpKey
          ? html`<div class="fhelp">${localize(this.hass, helpKey)}</div>`
          : nothing}
      </div>
      <button
        class=${classMap({ toggle: true, on: value })}
        role="switch"
        aria-checked=${value}
        aria-label=${localize(this.hass, labelKey)}
        @click=${() => onChange(!value)}
      >
        <span class="knob"></span>
      </button>
    </div>`;
  }

  private _toggleAction(action: CardAction): void {
    const current = { ...DEFAULT_CONFIG, ...this._config }.actions;
    const next = current.includes(action)
      ? current.filter((a) => a !== action)
      : // Keep the canonical order so the primary action stays predictable.
        CARD_ACTIONS.filter((a) => current.includes(a) || a === action);
    this._emit({ actions: next });
  }

  private _zoneMode(): "all" | "active" | "custom" {
    const zones = { ...DEFAULT_CONFIG, ...this._config }.zones;
    if (zones === "active") return "active";
    if (Array.isArray(zones)) return "custom";
    return "all";
  }

  private _setZoneMode(mode: "all" | "active" | "custom"): void {
    if (mode === "custom") {
      const current = this._config?.zones;
      this._emit({ zones: Array.isArray(current) ? current : [] });
      return;
    }
    this._emit({ zones: mode });
  }

  private _toggleZone(zoneId: string): void {
    const current = this._config?.zones;
    const list = Array.isArray(current) ? current : [];
    this._emit({
      zones: list.includes(zoneId)
        ? list.filter((id) => id !== zoneId)
        : [...list, zoneId],
    });
  }

  public static styles = css`
    :host {
      --e-fg: var(--primary-text-color);
      --e-fg2: var(--secondary-text-color);
      --e-div: var(--divider-color);
      --e-pri: var(--primary-color);
      --e-prifg: var(--text-primary-color, #fff);
      display: block;
    }
    .wrap {
      padding: 4px 0 8px;
      color: var(--e-fg);
    }
    button {
      font: inherit;
      cursor: pointer;
      color: inherit;
    }
    button:focus-visible {
      outline: 2px solid var(--e-pri);
      outline-offset: 2px;
    }
    .etitle {
      font-size: 15px;
      font-weight: 500;
      margin-bottom: 14px;
    }
    .flabel {
      font-size: 12px;
      color: var(--e-fg2);
      margin-bottom: 6px;
    }
    .flabel.top {
      margin-top: 14px;
    }
    .flabel.strong {
      font-size: 13.5px;
      font-weight: 500;
      color: var(--e-fg);
    }
    .fhelp.bottom {
      margin-bottom: 10px;
    }
    .arow {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 8px;
    }
    .aname {
      font-size: 13px;
      flex: none;
      min-width: 92px;
    }
    .select.inline {
      margin-bottom: 0;
      flex: 1 1 auto;
      min-width: 0;
    }
    .select.sub {
      margin-bottom: 8px;
    }
    .fhelp {
      font-size: 12px;
      color: var(--e-fg2);
      margin-top: 4px;
      line-height: 1.4;
    }
    .select {
      display: block;
      width: 100%;
      box-sizing: border-box;
      border: 1px solid var(--e-div);
      border-radius: 8px;
      padding: 9px 12px;
      font: inherit;
      font-size: 13.5px;
      margin-bottom: 14px;
      background: var(--ha-card-background, var(--card-background-color));
      color: var(--e-fg);
    }
    .seg {
      display: inline-flex;
      border: 1px solid var(--e-div);
      border-radius: 9px;
      overflow: hidden;
      margin-bottom: 14px;
      max-width: 100%;
      flex-wrap: wrap;
    }
    .seg button {
      font-size: 12.5px;
      padding: 7px 13px;
      border: 0;
      background: transparent;
      color: var(--e-fg2);
      white-space: nowrap;
    }
    .seg button + button {
      border-left: 1px solid var(--e-div);
    }
    .seg button.on {
      background: var(--e-pri);
      color: var(--e-prifg);
    }
    .row {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 9px 0;
      border-top: 1px solid var(--e-div);
      font-size: 13.5px;
    }
    .rowmain {
      min-width: 0;
    }
    .toggle {
      margin-left: auto;
      flex: none;
      width: 34px;
      height: 20px;
      border-radius: 999px;
      background: var(--e-div);
      position: relative;
      border: 0;
      padding: 0;
    }
    .toggle .knob {
      position: absolute;
      left: 2px;
      top: 2px;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: var(--ha-card-background, var(--card-background-color));
      border: 1px solid var(--e-div);
      box-sizing: border-box;
      transition: left 0.15s ease;
    }
    .toggle.on {
      background: var(--e-pri);
    }
    .toggle.on .knob {
      left: 16px;
      background: #fff;
      border-color: transparent;
    }
    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .chip {
      font-size: 12px;
      padding: 5px 11px;
      border-radius: 14px;
      border: 1px solid var(--e-div);
      background: transparent;
      color: var(--e-fg2);
    }
    .chip.on {
      background: var(--e-pri);
      color: var(--e-prifg);
      border-color: transparent;
    }
    @media (prefers-reduced-motion: reduce) {
      .toggle .knob {
        transition: none;
      }
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "simple-irrigation-card-editor": SimpleIrrigationCardEditor;
  }
}

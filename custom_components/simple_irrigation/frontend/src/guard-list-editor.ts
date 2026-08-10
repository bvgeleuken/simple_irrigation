import { html, nothing, type TemplateResult } from "lit";
import { renderNativeEntityField } from "./entity-input";
import { t } from "./i18n";
import type { HomeAssistant } from "./types";

/**
 * A guard states a condition that must HOLD for a scheduled run to start.
 * Guards are AND-combined; the backend fails open on anything it cannot read.
 *
 * These are shared render functions rather than a custom element on purpose:
 * `<input list=…>` only resolves its `<datalist>` inside the same tree scope, so
 * a separate shadow root would silently break entity autocomplete — the same
 * reason `entity-input.ts` exists.
 */

export type GuardOperator = "above" | "below" | "equals" | "state_is" | "is_true" | "is_false";

export interface Guard {
  entity_id: string;
  operator: GuardOperator;
  value: number | string | null;
}

export const GUARD_OPERATORS: GuardOperator[] = [
  "above",
  "below",
  "equals",
  "state_is",
  "is_true",
  "is_false",
];

/** Operators comparing the state as a number. */
export const GUARD_NUMERIC_OPERATORS: GuardOperator[] = ["above", "below", "equals"];
/** Operators comparing the state as text. */
export const GUARD_TEXT_OPERATORS: GuardOperator[] = ["state_is"];

/** Datalist suggestions only — the backend accepts any domain. */
export const GUARD_ENTITY_DOMAINS = [
  "sensor",
  "binary_sensor",
  "input_boolean",
  "input_number",
  "input_select",
  "number",
  "switch",
];

const isNumericOp = (op: GuardOperator): boolean => GUARD_NUMERIC_OPERATORS.includes(op);
const isTextOp = (op: GuardOperator): boolean => GUARD_TEXT_OPERATORS.includes(op);
/** Boolean operators need no value at all. */
const needsValue = (op: GuardOperator): boolean => isNumericOp(op) || isTextOp(op);

function asOperator(raw: unknown): GuardOperator {
  const s = String(raw ?? "");
  return (GUARD_OPERATORS as string[]).includes(s) ? (s as GuardOperator) : "above";
}

/** Build a clean Guard[] from whatever the API delivered. */
export function normalizeGuards(raw: unknown): Guard[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry) => {
    const o = (entry ?? {}) as Record<string, unknown>;
    const operator = asOperator(o.operator);
    let value: number | string | null = null;
    if (isNumericOp(operator)) {
      value = o.value === null || o.value === undefined || o.value === "" ? null : Number(o.value);
    } else if (isTextOp(operator)) {
      value = o.value === null || o.value === undefined ? "" : String(o.value);
    }
    return { entity_id: String(o.entity_id ?? "").trim(), operator, value };
  });
}

/** Drop blank rows and null out values the operator does not use. */
export function guardsForSave(guards: Guard[]): Guard[] {
  return guards
    .filter((g) => g.entity_id.trim() !== "")
    .map((g) => ({
      entity_id: g.entity_id.trim(),
      operator: g.operator,
      value: needsValue(g.operator) ? g.value : null,
    }));
}

/** True when a row has an entity but is missing the value its operator needs. */
export function guardsIncomplete(guards: Guard[]): boolean {
  return guards.some((g) => {
    const hasEntity = g.entity_id.trim() !== "";
    if (!hasEntity) return false;
    if (!needsValue(g.operator)) return false;
    if (isNumericOp(g.operator)) return g.value === null || Number.isNaN(Number(g.value));
    return String(g.value ?? "").trim() === "";
  });
}

function entityName(hass: HomeAssistant, entityId: string): string {
  const st = hass.states[entityId];
  return st ? String(st.attributes?.friendly_name ?? entityId) : entityId;
}

/** Current reading of the guarded entity, or "" when unknown. */
function currentState(hass: HomeAssistant, entityId: string): string {
  const st = hass.states[entityId];
  return st ? String(st.state) : "";
}

/** Human-readable single guard, e.g. "Tank level is above 20". */
export function guardLabel(hass: HomeAssistant, g: Guard): string {
  const op = t(hass, `config_panel.guard_op_${g.operator}`);
  const entity = entityName(hass, g.entity_id);
  if (!needsValue(g.operator)) {
    return t(hass, "config_panel.guard_label_boolean", { entity, op });
  }
  return t(hass, "config_panel.guard_label_numeric", {
    entity,
    op,
    value: String(g.value ?? ""),
  });
}

/** One guard spelled out; several collapsed to a count. */
export function guardsSummary(hass: HomeAssistant, guards: Guard[]): string {
  if (guards.length === 0) return t(hass, "config_panel.guards_none");
  if (guards.length === 1) return guardLabel(hass, guards[0]);
  return t(hass, "config_panel.guards_count", { n: String(guards.length) });
}

function renderValueField(
  hass: HomeAssistant,
  guard: Guard,
  onValue: (v: number | string | null) => void
): TemplateResult | typeof nothing {
  if (!needsValue(guard.operator)) return nothing;

  if (isTextOp(guard.operator)) {
    return html`<ha-input
      class="guard-value"
      type="text"
      .label=${t(hass, "config_panel.guards_value_label")}
      .value=${String(guard.value ?? "")}
      @input=${(e: Event) => onValue((e.target as HTMLInputElement).value)}
    ></ha-input>`;
  }

  return html`<ha-input
    class="guard-value"
    type="number"
    step="any"
    .label=${t(hass, "config_panel.guards_value_label")}
    .value=${guard.value === null || guard.value === undefined ? "" : String(guard.value)}
    @input=${(e: Event) => {
      const raw = (e.target as HTMLInputElement).value;
      onValue(raw === "" ? null : Number(raw));
    }}
  ></ha-input>`;
}

/**
 * Repeatable guard editor. Mirrors the pre-start entity list pattern.
 * `onChange` always receives a fresh array so callers can mark dirty uniformly.
 */
export function renderGuardList(
  hass: HomeAssistant,
  listId: string,
  guards: Guard[],
  onChange: (next: Guard[]) => void
): TemplateResult {
  const replaceAt = (i: number, patch: Partial<Guard>): void => {
    const next = guards.map((g, idx) => (idx === i ? { ...g, ...patch } : g));
    onChange(next);
  };

  return html`
    <div class="guard-rows">
      ${guards.map((g, i) => {
        const reading = currentState(hass, g.entity_id);
        return html`
          <div class="guard-row">
            ${renderNativeEntityField(
              hass,
              listId,
              t(hass, "config_panel.guards_entity_label"),
              g.entity_id,
              (v) => replaceAt(i, { entity_id: v }),
              "config_panel.guards_entity_placeholder"
            )}
            <div class="native-entity-field guard-operator">
              <label class="native-entity-label"
                >${t(hass, "config_panel.guards_operator_label")}</label
              >
              <select
                class="field-select"
                .value=${g.operator}
                @change=${(e: Event) => {
                  const op = asOperator((e.target as HTMLSelectElement).value);
                  // Reset the value when switching between value kinds.
                  const value = isNumericOp(op) ? null : isTextOp(op) ? "" : null;
                  replaceAt(i, { operator: op, value });
                }}
              >
                ${GUARD_OPERATORS.map(
                  (op) => html`<option value=${op} ?selected=${op === g.operator}>
                    ${t(hass, `config_panel.guard_op_${op}`)}
                  </option>`
                )}
              </select>
            </div>
            ${renderValueField(hass, g, (v) => replaceAt(i, { value: v }))}
            <button
              type="button"
              class="row-remove"
              @click=${() => onChange(guards.filter((_, idx) => idx !== i))}
            >
              ${t(hass, "config_panel.guards_remove")}
            </button>
            ${reading !== ""
              ? html`<p class="hint guard-reading">
                  ${t(hass, "config_panel.guards_current_value", { v: reading })}
                </p>`
              : nothing}
            ${g.operator === "equals"
              ? html`<p class="hint guard-reading">
                  ${t(hass, "config_panel.guards_equals_hint")}
                </p>`
              : nothing}
          </div>
        `;
      })}
      <button
        type="button"
        class="btn-outline"
        @click=${() => onChange([...guards, { entity_id: "", operator: "above", value: null }])}
      >
        ${t(hass, "config_panel.guards_add")}
      </button>
    </div>
  `;
}

import { fireEvent } from "./fire-event";
import { t } from "./i18n";
import type { HomeAssistant } from "./types";

/** Backend error codes are snake_case identifiers, never prose. */
const ERROR_CODE_RE = /^[a-z][a-z0-9_]*$/;

/**
 * Turn a backend error code into a translated sentence.
 * Falls back to the raw code when no translation exists, so new codes degrade
 * to the previous behaviour instead of showing an empty message.
 */
function translateErrorCode(value: string, hass?: HomeAssistant): string {
  if (hass?.localize == null || !ERROR_CODE_RE.test(value)) {
    return value;
  }
  const path = `config_panel.errors_${value}`;
  const translated = t(hass, path);
  return translated === path ? value : translated;
}

/** Home Assistant callApi may put a string or structured object in `error`. */
export function formatApiError(value: unknown, hass?: HomeAssistant): string {
  const fallback =
    hass?.localize != null
      ? t(hass, "config_panel.errors_request_failed")
      : "Request failed";
  if (value == null || value === "") {
    return fallback;
  }
  if (typeof value === "string") {
    return translateErrorCode(value, hass);
  }
  if (value instanceof Error) {
    return value.message;
  }
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    if (typeof o.message === "string") {
      return o.message;
    }
    if (typeof o.error === "string") {
      return translateErrorCode(o.error, hass);
    }
    try {
      return JSON.stringify(value);
    } catch {
      return fallback;
    }
  }
  return String(value);
}

/** Safe when the panel bundle runs twice (navigation, scoped custom element registry). */
export function defineCustomElementOnce(
  name: string,
  constructor: CustomElementConstructor,
  options?: ElementDefinitionOptions
): void {
  if (customElements.get(name) !== undefined) {
    return;
  }
  customElements.define(name, constructor, options);
}

export const navigate = (_node: unknown, path: string, replace = false): void => {
  if (replace) {
    history.replaceState(null, "", path);
  } else {
    history.pushState(null, "", path);
  }
  fireEvent(window, "location-changed", { replace });
};

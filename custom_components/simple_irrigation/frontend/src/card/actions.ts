import { nothing } from "lit";
import { AsyncDirective, directive } from "lit/async-directive.js";
import { PartType, type ElementPart, type PartInfo } from "lit/directive.js";

import { fireEvent } from "./fire-event";
import type { HomeAssistant } from "./types";

/**
 * Tap and hold behaviour for the card's rows, modelled on Home Assistant's own
 * `tap_action` / `hold_action` but with one extra action type: `panel` opens
 * the Simple Irrigation panel on the page the tapped thing belongs to, which is
 * the answer to "what else could a zone row possibly do?".
 */

export type ActionType =
  | "none"
  | "more-info"
  | "panel"
  | "navigate"
  | "url"
  | "perform-action";

export type PanelPage =
  | "overview"
  | "zones"
  | "schedule"
  | "timetable"
  | "settings";

export const ACTION_TYPES: ActionType[] = [
  "none",
  "more-info",
  "panel",
  "navigate",
  "url",
  "perform-action",
];

export const PANEL_PAGES: PanelPage[] = [
  "overview",
  "zones",
  "schedule",
  "timetable",
  "settings",
];

export interface ActionConfig {
  action: ActionType;
  /** `more-info`: overrides the entity the tapped row stands for. */
  entity?: string;
  /** `panel`: which page; omitted means "the one this row belongs to". */
  panel_page?: PanelPage;
  /** `navigate` */
  navigation_path?: string;
  /** `url` */
  url_path?: string;
  /** `perform-action`; `service` is accepted as the pre-2024.8 spelling. */
  perform_action?: string;
  service?: string;
  data?: Record<string, unknown>;
  target?: Record<string, unknown>;
}

/** What the tapped row stands for — supplies the action's missing halves. */
export interface ActionContext {
  /** More-info target: the zone's entity, or the installation's. */
  entityId?: string;
  entryId?: string;
  /** Deep-links the schedule page to one slot. */
  slotId?: string;
  /** Panel page when the action does not name one. */
  page?: PanelPage;
}

/** The rows that carry their own pair of actions. */
export type ActionTarget = "card" | "zone" | "run";

const PANEL_BASE = "/simple-irrigation";

export const isActionable = (action: ActionConfig | undefined): boolean =>
  Boolean(action) && action!.action !== "none";

const navigate = (path: string): void => {
  history.pushState(null, "", path);
  fireEvent(window, "location-changed", { replace: false });
};

const openMoreInfo = (node: HTMLElement, entityId?: string): void => {
  if (!entityId) return;
  fireEvent(node, "hass-more-info", { entityId });
};

const openPanel = (
  node: HTMLElement,
  hass: HomeAssistant | undefined,
  action: ActionConfig,
  context: ActionContext
): void => {
  // The panel is registered with `require_admin`, the card is not: sending a
  // non-admin there lands on a blank "not found" page, so fall back to the
  // thing they *can* open.
  if (hass?.user?.is_admin === false) {
    openMoreInfo(node, action.entity ?? context.entityId);
    return;
  }
  const entryId = context.entryId;
  if (!entryId) return;
  const page = action.panel_page ?? context.page ?? "overview";
  const query =
    page === "schedule" && context.slotId
      ? `?editSlot=${encodeURIComponent(context.slotId)}`
      : "";
  navigate(`${PANEL_BASE}/${entryId}/${page}${query}`);
};

export function handleAction(
  node: HTMLElement,
  hass: HomeAssistant | undefined,
  action: ActionConfig | undefined,
  context: ActionContext
): void {
  if (!isActionable(action)) return;
  const config = action!;
  switch (config.action) {
    case "more-info":
      openMoreInfo(node, config.entity ?? context.entityId);
      return;
    case "panel":
      openPanel(node, hass, config, context);
      return;
    case "navigate":
      if (config.navigation_path) navigate(config.navigation_path);
      return;
    case "url":
      if (config.url_path) {
        window.open(
          config.url_path,
          config.url_path.startsWith("/") ? "_self" : "_blank"
        );
      }
      return;
    case "perform-action": {
      const service = config.perform_action ?? config.service;
      const separator = service?.indexOf(".") ?? -1;
      if (!service || separator < 1 || !hass) return;
      const domain = service.slice(0, separator);
      const name = service.slice(separator + 1);
      void hass.callService(
        domain,
        name,
        config.data ?? {},
        config.target
      );
      return;
    }
    default:
  }
}

/**
 * Throw on a config a user could not otherwise debug — Lovelace shows the
 * message on the card itself.
 */
export function validateAction(key: string, value: unknown): void {
  if (value === undefined) return;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${key} must be an action object`);
  }
  const action = value as ActionConfig;
  if (!ACTION_TYPES.includes(action.action)) {
    throw new Error(
      `${key}.action must be one of ${ACTION_TYPES.join(", ")}`
    );
  }
  if (
    action.panel_page !== undefined &&
    !PANEL_PAGES.includes(action.panel_page)
  ) {
    throw new Error(`${key}.panel_page must be one of ${PANEL_PAGES.join(", ")}`);
  }
  if (action.data !== undefined && typeof action.data !== "object") {
    throw new Error(`${key}.data must be a mapping`);
  }
  // A missing path or service is not a config error: the visual editor writes
  // the action type first and the field a keystroke later, and a card that
  // throws in between is worse than one that does nothing until it is filled in.
}

// ---- tap / hold handling ---------------------------------------------------

/** Long enough not to fire on a slow tap, short enough to feel deliberate. */
const HOLD_MS = 500;

export interface ActionHandlerOptions {
  hasHold: boolean;
  /** No action configured at all: the row stays a plain, inert row. */
  disabled?: boolean;
  handler: (kind: "tap" | "hold") => void;
}

/**
 * `actionHandler` as an element directive, rather than Home Assistant's own —
 * a custom card cannot import from the frontend bundle.
 */
class ActionHandlerDirective extends AsyncDirective {
  private _element?: HTMLElement;

  private _options: ActionHandlerOptions = {
    hasHold: false,
    disabled: true,
    handler: () => undefined,
  };

  private _timer?: number;

  private _held = false;

  constructor(partInfo: PartInfo) {
    super(partInfo);
    if (partInfo.type !== PartType.ELEMENT) {
      throw new Error("actionHandler must be used on an element");
    }
  }

  public render(_options: ActionHandlerOptions): typeof nothing {
    return nothing;
  }

  public override update(
    part: ElementPart,
    [options]: [ActionHandlerOptions]
  ): typeof nothing {
    this._options = options;
    const element = part.element as HTMLElement;
    if (this._element !== element) {
      this._detach();
      this._element = element;
      this._attach();
    }
    return nothing;
  }

  protected override disconnected(): void {
    this._detach();
  }

  protected override reconnected(): void {
    this._attach();
  }

  private _attach(): void {
    const element = this._element;
    if (!element) return;
    element.addEventListener("pointerdown", this._onDown);
    element.addEventListener("pointerup", this._onCancel);
    element.addEventListener("pointercancel", this._onCancel);
    element.addEventListener("pointerleave", this._onCancel);
    element.addEventListener("click", this._onClick);
    element.addEventListener("keydown", this._onKeyDown);
    element.addEventListener("contextmenu", this._onContextMenu);
  }

  private _detach(): void {
    const element = this._element;
    this._clearTimer();
    if (!element) return;
    element.removeEventListener("pointerdown", this._onDown);
    element.removeEventListener("pointerup", this._onCancel);
    element.removeEventListener("pointercancel", this._onCancel);
    element.removeEventListener("pointerleave", this._onCancel);
    element.removeEventListener("click", this._onClick);
    element.removeEventListener("keydown", this._onKeyDown);
    element.removeEventListener("contextmenu", this._onContextMenu);
  }

  private _clearTimer(): void {
    if (this._timer !== undefined) {
      clearTimeout(this._timer);
      this._timer = undefined;
    }
  }

  private _onDown = (): void => {
    this._held = false;
    this._clearTimer();
    if (this._options.disabled || !this._options.hasHold) return;
    this._timer = window.setTimeout(() => {
      this._timer = undefined;
      this._held = true;
      // Same confirmation HA gives a long press elsewhere; silently ignored
      // where the browser has no vibration motor.
      navigator.vibrate?.(20);
      this._options.handler("hold");
    }, HOLD_MS);
  };

  private _onCancel = (): void => {
    this._clearTimer();
  };

  private _onClick = (ev: Event): void => {
    this._clearTimer();
    if (this._options.disabled) return;
    // Nested targets: a week bar sits inside its own tappable day column.
    ev.stopPropagation();
    if (this._held) {
      // The hold already ran; the click that follows it is not a second tap.
      this._held = false;
      ev.preventDefault();
      return;
    }
    this._options.handler("tap");
  };

  private _onKeyDown = (ev: KeyboardEvent): void => {
    // A real <button> turns Enter/Space into a click by itself; only the
    // role="button" rows need this.
    if (this._element?.tagName === "BUTTON") return;
    if (this._options.disabled) return;
    if (ev.key !== "Enter" && ev.key !== " ") return;
    ev.preventDefault();
    ev.stopPropagation();
    this._options.handler("tap");
  };

  private _onContextMenu = (ev: Event): void => {
    // Long press on touch would otherwise open the browser's own menu.
    if (this._options.disabled || !this._options.hasHold) return;
    ev.preventDefault();
  };
}

export const actionHandler = directive(ActionHandlerDirective);

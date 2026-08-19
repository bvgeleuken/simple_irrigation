import { css, html, LitElement, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";

import {
  actionHandler,
  handleAction,
  isActionable,
  validateAction,
  type ActionConfig,
} from "./actions";
import { subscribeSnapshot } from "./api";
import { clock, countdown, dayTime, secondsUntil } from "./format";
import { localize, localizeCount } from "./i18n";
import {
  BADGE_KINDS,
  type BadgeConfig,
  type BadgeKind,
  type HomeAssistant,
  type Snapshot,
} from "./types";

declare global {
  interface Window {
    customBadges?: unknown[];
  }
}

interface Pill {
  icon: string;
  text: string;
  tone: "" | "warn" | "err";
  drip?: boolean;
}

/**
 * The same facts as the status card, without a card slot — for the badge row of
 * a sections dashboard. Each configured kind renders as its own pill; kinds
 * that have nothing to say (no pause, no issues) stay silent rather than
 * showing an empty state.
 */
@customElement("simple-irrigation-badge")
export class SimpleIrrigationBadge extends LitElement {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: BadgeConfig;

  @state() private _snapshot?: Snapshot;

  private _unsubscribe?: Promise<() => Promise<void>>;

  private _ticker?: number;

  public static getStubConfig(): Partial<BadgeConfig> {
    return { badges: ["state", "next"] };
  }

  public setConfig(config: BadgeConfig): void {
    if (!config || typeof config !== "object") {
      throw new Error("Invalid configuration");
    }
    if (config.badges) {
      if (!Array.isArray(config.badges)) {
        throw new Error("badges must be a list");
      }
      for (const kind of config.badges) {
        if (!BADGE_KINDS.includes(kind)) {
          throw new Error(`unknown badge "${kind}"`);
        }
      }
    }
    validateAction("tap_action", config.tap_action);
    validateAction("hold_action", config.hold_action);
    this._config = { badges: ["state", "next"], ...config };
    this._resubscribe();
  }

  public connectedCallback(): void {
    super.connectedCallback();
    this._resubscribe();
  }

  public disconnectedCallback(): void {
    super.disconnectedCallback();
    this._unsubscribe?.then((unsub) => unsub()).catch(() => undefined);
    this._unsubscribe = undefined;
    this._stopTicker();
  }

  protected updated(): void {
    this.toggleAttribute("data-dark", Boolean(this.hass?.themes?.darkMode));
    const running = this._snapshot?.state === "running";
    if (running && this._ticker === undefined) {
      this._ticker = window.setInterval(() => this.requestUpdate(), 1000);
    } else if (!running) {
      this._stopTicker();
    }
  }

  private _stopTicker(): void {
    if (this._ticker !== undefined) {
      window.clearInterval(this._ticker);
      this._ticker = undefined;
    }
  }

  private _resubscribe(): void {
    if (!this.hass || !this._config || this._unsubscribe || !this.isConnected) {
      return;
    }
    this._unsubscribe = subscribeSnapshot(
      this.hass,
      (snapshot) => {
        this._snapshot = snapshot;
      },
      this._config.entry_id
    );
    this._unsubscribe.catch(() => {
      this._unsubscribe = undefined;
    });
  }

  private _pill(kind: BadgeKind, snap: Snapshot): Pill | undefined {
    switch (kind) {
      case "state": {
        const running = snap.state === "running" || snap.state === "stopping";
        const lead = snap.zones
          .filter((z) => z.active)
          .sort((a, b) => secondsUntil(b.ends_at) - secondsUntil(a.ends_at))[0];
        const label = localize(this.hass, `state_${snap.state}`);
        return {
          icon: running ? "mdi:sprinkler-variant" : "mdi:sprinkler-variant",
          text:
            running && lead
              ? `${label} · ${countdown(secondsUntil(lead.ends_at))}`
              : label,
          tone: snap.state === "error" ? "err" : "",
          drip: running,
        };
      }
      case "next": {
        const next = snap.next_runs.find((run) => !run.skipped_by_pause);
        if (!next?.fire_at) return undefined;
        return {
          icon: "mdi:clock-outline",
          text: localize(this.hass, "badge_next", {
            time: clock(this.hass, next.fire_at),
          }),
          tone: "",
        };
      }
      case "mode":
        return {
          icon: "mdi:water-percent",
          text: localize(this.hass, `mode_${snap.mode}`),
          tone: "",
        };
      case "pause": {
        if (!snap.paused_until) return undefined;
        return {
          icon: "mdi:pause-circle-outline",
          text: localize(this.hass, "badge_paused", {
            time: dayTime(this.hass, snap.paused_until),
          }),
          tone: "warn",
        };
      }
      case "issues": {
        if (!snap.issue_count) return undefined;
        return {
          icon: "mdi:alert-circle-outline",
          text: localizeCount(this.hass, "badge_issues", snap.issue_count),
          tone: "err",
        };
      }
    }
  }

  protected render(): TemplateResult | typeof nothing {
    const snap = this._snapshot;
    if (!this.hass || !this._config || !snap) return nothing;
    const kinds = this._config.badges ?? ["state", "next"];
    const pills = kinds
      .map((kind) => this._pill(kind, snap))
      .filter((pill): pill is Pill => Boolean(pill));
    if (!pills.length) return nothing;

    const tap: ActionConfig = this._config.tap_action ?? {
      action: "more-info",
    };
    const hold: ActionConfig = this._config.hold_action ?? { action: "panel" };
    const on = isActionable(tap) || isActionable(hold);
    const options = {
      hasHold: isActionable(hold),
      disabled: !on,
      handler: (kind: "tap" | "hold") =>
        handleAction(this, this.hass, kind === "tap" ? tap : hold, {
          entityId: snap.entity_id,
          entryId: snap.entry_id,
          page: "overview" as const,
        }),
    };

    return html`<div
      class=${classMap({ row: true, tappable: on })}
      role=${on ? "button" : nothing}
      tabindex=${on ? "0" : nothing}
      ${actionHandler(options)}
    >
      ${pills.map(
        (pill) => html`<span class="badge ${pill.tone}">
          <ha-icon
            class=${classMap({ drip: Boolean(pill.drip) })}
            .icon=${pill.icon}
          ></ha-icon>
          <span class="txt">${pill.text}</span>
        </span>`
      )}
    </div>`;
  }

  public static styles = css`
    :host {
      --b-fg: var(--primary-text-color);
      --b-fg2: var(--secondary-text-color);
      --b-div: var(--divider-color);
      --b-pri: var(--primary-color);
      --b-err: var(--error-color, #db4437);
      --b-warn: var(--warning-color, #e07c00);
      --b-warnB: color-mix(in srgb, var(--b-warn) 45%, transparent);
      --b-errB: color-mix(in srgb, var(--b-err) 45%, transparent);
      display: block;
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .row.tappable {
      cursor: pointer;
      -webkit-user-select: none;
      user-select: none;
      -webkit-tap-highlight-color: transparent;
      touch-action: manipulation;
    }
    .row.tappable:focus-visible {
      outline: 2px solid var(--b-pri);
      outline-offset: 2px;
      border-radius: 999px;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: var(--ha-card-background, var(--card-background-color));
      border: 1px solid var(--b-div);
      border-radius: 999px;
      padding: 7px 14px 7px 11px;
      font-size: 13px;
      color: var(--b-fg);
      max-width: 100%;
    }
    .badge ha-icon {
      --mdc-icon-size: 18px;
      color: var(--b-fg2);
      flex: none;
    }
    .badge:first-child ha-icon {
      color: var(--b-pri);
    }
    .badge.warn {
      border-color: var(--b-warnB);
      color: var(--b-warn);
    }
    .badge.err {
      border-color: var(--b-errB);
      color: var(--b-err);
    }
    .badge.warn ha-icon,
    .badge.err ha-icon {
      color: currentColor;
    }
    .txt {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
    }
    .drip {
      animation: drip 1.8s ease-in-out infinite;
    }
    @keyframes drip {
      0%,
      100% {
        opacity: 1;
      }
      50% {
        opacity: 0.35;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .drip {
        animation: none;
      }
    }
  `;
}

window.customBadges = window.customBadges ?? [];
window.customBadges.push({
  type: "simple-irrigation-badge",
  name: "Simple Irrigation Badge",
  description: "Irrigation state, next run, mode and warnings as badge pills.",
  preview: true,
  documentationURL: "https://github.com/florianbaethge/simple_irrigation",
});

declare global {
  interface HTMLElementTagNameMap {
    "simple-irrigation-badge": SimpleIrrigationBadge;
  }
}

/** How long to wait for a core element before rendering anyway. */
const ELEMENT_TIMEOUT_MS = 2000;

/**
 * Wait until core HA custom elements used by the panel are defined.
 *
 * `customElements.whenDefined()` never rejects — it simply stays pending when an
 * element is not registered, and a `.catch()` would not help. The panel blocks
 * its first render on this, so an unresolved tag would leave a blank panel
 * rather than one unstyled field. `ha-entity-picker` and `ha-selector` are the
 * risky ones: they come from lazily loaded frontend chunks, so cap the wait and
 * render regardless once it elapses.
 */
export async function loadHaPanelElements(): Promise<void> {
  const tags = [
    "ha-menu-button",
    "ha-tab-group",
    "ha-tab-group-tab",
    "ha-card",
    "ha-dialog",
    "ha-input",
    "ha-entity-picker",
    "ha-selector",
    "ha-icon",
    "ha-switch",
  ];
  const ready = (tag: string): Promise<unknown> =>
    Promise.race([
      customElements.whenDefined(tag),
      new Promise((resolve) => setTimeout(resolve, ELEMENT_TIMEOUT_MS)),
    ]).catch(() => undefined);
  await Promise.all(tags.map(ready));
}

export function fireEvent(
  node: HTMLElement | Window,
  type: string,
  detail?: Record<string, unknown>
): void {
  node.dispatchEvent(
    new CustomEvent(type, {
      bubbles: true,
      composed: true,
      detail: detail ?? {},
    })
  );
}

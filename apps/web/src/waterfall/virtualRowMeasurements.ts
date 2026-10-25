export type VirtualRowResizer = (index: number, size: number) => void;
export type VirtualRowAnchor = { index: number; offsetTop: number };
export const MIN_STABLE_VIRTUAL_ROW_WIDTH = 240;

export function measureVirtualRowHeight(element: Element): number {
  if ("offsetHeight" in element && typeof element.offsetHeight === "number") {
    return element.offsetHeight;
  }
  return Math.round(element.getBoundingClientRect().height);
}

/**
 * A pane width change reflows text without remounting virtual rows. Force a
 * layout read for the small mounted window so stale full-width heights cannot
 * position later absolute rows on top of newly wrapped content.
 */
export function remeasureMountedVirtualRows(container: ParentNode, resizeItem: VirtualRowResizer): number {
  const elements = container.querySelectorAll<HTMLElement>("[data-chat-virtual-row='true'][data-index]");
  let measured = 0;
  elements.forEach((element) => {
    const index = Number(element.dataset.index);
    if (!Number.isInteger(index) || index < 0 || !element.isConnected) {
      return;
    }
    const width = typeof element.offsetWidth === "number" && element.offsetWidth > 0
      ? element.offsetWidth
      : typeof element.getBoundingClientRect === "function"
        ? element.getBoundingClientRect().width
        : Number.NaN;
    if (Number.isFinite(width) && width < MIN_STABLE_VIRTUAL_ROW_WIDTH) {
      return;
    }
    const height = measureVirtualRowHeight(element);
    if (height <= 0) {
      return;
    }
    resizeItem(index, height);
    measured += 1;
  });
  return measured;
}

export function captureVisibleVirtualRowAnchor(container: HTMLElement): VirtualRowAnchor | null {
  const containerRect = container.getBoundingClientRect();
  const elements = container.querySelectorAll<HTMLElement>("[data-chat-virtual-row='true'][data-index]");
  let anchor: VirtualRowAnchor | null = null;
  let anchorTop = Number.POSITIVE_INFINITY;
  elements.forEach((element) => {
    const index = Number(element.dataset.index);
    if (!Number.isInteger(index) || index < 0 || !element.isConnected) return;
    const rowRect = element.getBoundingClientRect();
    if (rowRect.bottom <= containerRect.top || rowRect.top >= containerRect.bottom || rowRect.top >= anchorTop) return;
    anchor = { index, offsetTop: rowRect.top - containerRect.top };
    anchorTop = rowRect.top;
  });
  return anchor;
}

export function restoreVirtualRowAnchor(container: HTMLElement, anchor: VirtualRowAnchor | null): boolean {
  if (!anchor) return false;
  const element = container.querySelector<HTMLElement>(`[data-chat-virtual-row='true'][data-index='${anchor.index}']`);
  if (!element?.isConnected) return false;
  const offsetTop = element.getBoundingClientRect().top - container.getBoundingClientRect().top;
  container.scrollTop += offsetTop - anchor.offsetTop;
  return true;
}

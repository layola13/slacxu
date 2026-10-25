import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { UI_STORAGE_KEYS } from "./appConstants";
import { readStoredBoolean } from "./preferenceUtils";

export function useImmersiveComposer() {
  const [immersiveView, setImmersiveView] = useState(() => readStoredBoolean(UI_STORAGE_KEYS.immersiveView, false));
  const [immersiveTaskTabsOpen, setImmersiveTaskTabsOpen] = useState(false);
  const [immersiveComposerCompact, setImmersiveComposerCompact] = useState(() => readStoredBoolean(UI_STORAGE_KEYS.immersiveView, false));
  const [immersiveHintSequence, setImmersiveHintSequence] = useState(0);
  const [immersiveExitHintOpen, setImmersiveExitHintOpen] = useState(false);
  const [immersiveComposerHintOpen, setImmersiveComposerHintOpen] = useState(false);
  const immersiveComposerOffsetRef = useRef({ x: 0, y: 0 });
  const immersiveComposerDockRef = useRef<HTMLDivElement | null>(null);
  const immersiveComposerDragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    baseX: number;
    baseY: number;
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    latestX: number;
    latestY: number;
  } | null>(null);
  const applyImmersiveComposerOffset = useCallback((x: number, y: number) => {
    const dock = immersiveComposerDockRef.current;
    if (!dock) return;
    dock.style.setProperty("--immersive-composer-offset-x", `${x}px`);
    dock.style.setProperty("--immersive-composer-offset-y", `${y}px`);
  }, []);
  const resetImmersiveComposerOffset = useCallback(() => {
    const drag = immersiveComposerDragRef.current;
    const dock = immersiveComposerDockRef.current;
    immersiveComposerDragRef.current = null;
    immersiveComposerOffsetRef.current = { x: 0, y: 0 };
    if (dock) {
      dock.dataset.dragging = "false";
      if (drag && dock.hasPointerCapture(drag.pointerId)) {
        dock.releasePointerCapture(drag.pointerId);
      }
    }
    applyImmersiveComposerOffset(0, 0);
  }, [applyImmersiveComposerOffset]);
  const beginImmersiveComposerDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!immersiveView || !immersiveComposerCompact || event.button !== 0 || !event.isPrimary) return;
    const target = event.target as HTMLElement;
    if (target.closest("input, textarea, button, a, [role='button'], [role='combobox'], [role='menuitem']")) return;

    const dock = event.currentTarget;
    const dockRect = dock.getBoundingClientRect();
    const boundsRect = dock.parentElement?.getBoundingClientRect() ?? {
      left: 0,
      top: 0,
      right: window.innerWidth,
      bottom: window.innerHeight
    };
    const margin = 8;
    const base = immersiveComposerOffsetRef.current;
    immersiveComposerDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      baseX: base.x,
      baseY: base.y,
      minX: base.x + boundsRect.left + margin - dockRect.left,
      maxX: base.x + boundsRect.right - margin - dockRect.right,
      minY: base.y + boundsRect.top + margin - dockRect.top,
      maxY: base.y + boundsRect.bottom - margin - dockRect.bottom,
      latestX: base.x,
      latestY: base.y
    };
    dock.dataset.dragging = "true";
    dock.setPointerCapture(event.pointerId);
    event.preventDefault();
  }, [immersiveComposerCompact, immersiveView]);
  const moveImmersiveComposer = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = immersiveComposerDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const nextX = Math.min(drag.maxX, Math.max(drag.minX, drag.baseX + event.clientX - drag.startX));
    const nextY = Math.min(drag.maxY, Math.max(drag.minY, drag.baseY + event.clientY - drag.startY));
    drag.latestX = Math.round(nextX);
    drag.latestY = Math.round(nextY);
    applyImmersiveComposerOffset(drag.latestX, drag.latestY);
    event.preventDefault();
  }, [applyImmersiveComposerOffset]);
  const endImmersiveComposerDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = immersiveComposerDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    immersiveComposerDragRef.current = null;
    const next = { x: drag.latestX, y: drag.latestY };
    immersiveComposerOffsetRef.current = next;
    event.currentTarget.dataset.dragging = "false";
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const enterImmersiveView = useCallback(() => {
    resetImmersiveComposerOffset();
    setImmersiveComposerCompact(true);
    setImmersiveView(true);
    setImmersiveHintSequence((current: number) => current + 1);
    setImmersiveExitHintOpen(true);
    setImmersiveComposerHintOpen(true);
  }, [resetImmersiveComposerOffset]);

  const exitImmersiveView = useCallback(() => {
    setImmersiveView(false);
    setImmersiveComposerCompact(false);
    setImmersiveExitHintOpen(false);
    setImmersiveComposerHintOpen(false);
  }, []);
  return {
    immersiveView,
    setImmersiveView,
    immersiveTaskTabsOpen,
    setImmersiveTaskTabsOpen,
    immersiveComposerCompact,
    setImmersiveComposerCompact,
    immersiveHintSequence,
    setImmersiveHintSequence,
    immersiveExitHintOpen,
    setImmersiveExitHintOpen,
    immersiveComposerHintOpen,
    setImmersiveComposerHintOpen,
    immersiveComposerOffsetRef,
    immersiveComposerDockRef,
    immersiveComposerDragRef,
    applyImmersiveComposerOffset,
    resetImmersiveComposerOffset,
    beginImmersiveComposerDrag,
    moveImmersiveComposer,
    endImmersiveComposerDrag,
    enterImmersiveView,
    exitImmersiveView,
  };
}

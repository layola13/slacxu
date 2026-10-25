import { useEffect, useRef, useState } from "react";
import { UI_STORAGE_KEYS } from "./appConstants";
import { readPanelLayout } from "./preferenceUtils";
import {
  createWorkspaceLayout,
  readSplitViewState,
  readWorkspaceLayoutState,
  type SplitDirection,
  type SplitViewState,
  type WorkspaceLayoutState,
} from "../../taskTabs";
import type { DetachedTaskSnapshot } from "./appConstants";

export function useTaskTabsState(input: { detachedThreadId: string | null }) {
  const { detachedThreadId } = input;
  const [closedTaskTabIds, setClosedTaskTabIds] = useState<string[]>([]);
  const [taskTabOrder, setTaskTabOrder] = useState<string[]>(() => detachedThreadId ? [detachedThreadId] : []);
  const [draggedTaskTabId, setDraggedTaskTabId] = useState<string | null>(null);
  const splitDropHandledRef = useRef(false);
  const [taskTabContextMenu, setTaskTabContextMenu] = useState<{ threadId: string; mouseX: number; mouseY: number } | null>(null);
  const [paneContextMenu, setPaneContextMenu] = useState<{ paneId: string; threadId: string; mouseX: number; mouseY: number } | null>(null);
  const [pendingPaneSplit, setPendingPaneSplit] = useState<{ paneId: string; direction: SplitDirection } | null>(null);
  const [splitViewMenuAnchor, setSplitViewMenuAnchor] = useState<HTMLElement | null>(null);
  const [splitViewMenuPosition, setSplitViewMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const [splitViewSearch, setSplitViewSearch] = useState("");
  const [splitViewBaseThreadId, setSplitViewBaseThreadId] = useState<string | null>(null);
  const [splitView, setSplitView] = useState<SplitViewState | null>(() =>
    readSplitViewState(window.localStorage, UI_STORAGE_KEYS.splitView)
  );
  const [workspaceLayout, setWorkspaceLayout] = useState<WorkspaceLayoutState | null>(() => {
    const saved = readWorkspaceLayoutState(window.localStorage, UI_STORAGE_KEYS.workspaceLayout);
    if (saved) return saved;
    const legacy = readSplitViewState(window.localStorage, UI_STORAGE_KEYS.splitView);
    return legacy ? createWorkspaceLayout([legacy.leftThreadId, legacy.rightThreadId], "columns") : null;
  });
  useEffect(() => {
    if (!taskTabContextMenu && !paneContextMenu) return;
    const closeContextMenusOutside = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('[role="menu"]')) return;
      setTaskTabContextMenu(null);
      setPaneContextMenu(null);
    };
    document.addEventListener("pointerdown", closeContextMenusOutside, true);
    return () => document.removeEventListener("pointerdown", closeContextMenusOutside, true);
  }, [paneContextMenu, taskTabContextMenu]);
  const [splitViewLayout, setSplitViewLayout] = useState<Record<string, number> | undefined>(() =>
    readPanelLayout(UI_STORAGE_KEYS.splitViewLayout)
  );
  const [detachedTaskIds, setDetachedTaskIds] = useState<Set<string>>(() => new Set());
  const [detachedTaskSnapshot, setDetachedTaskSnapshot] = useState<DetachedTaskSnapshot | null>(null);
  const [detachedSnapshotReady, setDetachedSnapshotReady] = useState(() => !detachedThreadId || !window.codexUltraDesktop);
  const detachedSnapshotReadyPromiseRef = useRef<Promise<void> | null>(null);
  const resolveDetachedSnapshotReadyRef = useRef<(() => void) | null>(null);
  if (!detachedSnapshotReadyPromiseRef.current) {
    detachedSnapshotReadyPromiseRef.current = detachedThreadId && window.codexUltraDesktop
      ? new Promise<void>((resolve: (value: void | PromiseLike<void>) => void) => { resolveDetachedSnapshotReadyRef.current = resolve; })
      : Promise.resolve();
  }
  const workspaceLayoutRef = useRef(workspaceLayout);
  const splitViewRef = useRef(splitView);
  const splitMutationEpochRef = useRef(0);
  const detachedSnapshotHydratedRef = useRef(false);
  return {
    closedTaskTabIds,
    setClosedTaskTabIds,
    taskTabOrder,
    setTaskTabOrder,
    draggedTaskTabId,
    setDraggedTaskTabId,
    splitDropHandledRef,
    taskTabContextMenu,
    setTaskTabContextMenu,
    paneContextMenu,
    setPaneContextMenu,
    pendingPaneSplit,
    setPendingPaneSplit,
    splitViewMenuAnchor,
    setSplitViewMenuAnchor,
    splitViewMenuPosition,
    setSplitViewMenuPosition,
    splitViewSearch,
    setSplitViewSearch,
    splitViewBaseThreadId,
    setSplitViewBaseThreadId,
    splitView,
    setSplitView,
    workspaceLayout,
    setWorkspaceLayout,
    splitViewLayout,
    setSplitViewLayout,
    detachedTaskIds,
    setDetachedTaskIds,
    detachedTaskSnapshot,
    setDetachedTaskSnapshot,
    detachedSnapshotReady,
    setDetachedSnapshotReady,
    detachedSnapshotReadyPromiseRef,
    resolveDetachedSnapshotReadyRef,
    workspaceLayoutRef,
    splitViewRef,
    splitMutationEpochRef,
    detachedSnapshotHydratedRef,
  };
}

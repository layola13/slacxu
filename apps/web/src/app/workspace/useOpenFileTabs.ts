import { useCallback, useMemo, useState } from "react";
import type { OpenWorkspaceFile } from "../../components/WorkspaceFilesSettingsPanel";

export const OPEN_FILE_TABS_LIMIT = 10;

function blankTab(path: string): OpenWorkspaceFile {
  return { path, content: "", savedContent: "", loading: true, saving: false };
}

function loadedTab(path: string, content: string): OpenWorkspaceFile {
  return { path, content, savedContent: content, loading: false, saving: false };
}

/**
 * VSCode-style editor tab strip.
 * `openFile` stays the single active tab so every existing consumer
 * (Explorer editor pane, Settings files panel) keeps working unchanged.
 */
export function useOpenFileTabs() {
  const [tabs, setTabs] = useState<OpenWorkspaceFile[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);

  const openFile = useMemo<OpenWorkspaceFile | null>(
    () => tabs.find((tab) => tab.path === activePath) ?? tabs[0] ?? null,
    [tabs, activePath]
  );

  const openTab = useCallback((path: string) => {
    setTabs((current) => {
      if (current.some((tab) => tab.path === path)) return current;
      const next = [...current, blankTab(path)];
      return next.length > OPEN_FILE_TABS_LIMIT ? next.slice(next.length - OPEN_FILE_TABS_LIMIT) : next;
    });
    setActivePath(path);
  }, []);

  const activateTab = useCallback((path: string) => {
    setActivePath(path);
  }, []);

  const applyTabContent = useCallback((path: string, content: string) => {
    setTabs((current) => current.map((tab) => (tab.path === path ? loadedTab(path, content) : tab)));
  }, []);

  const markTabLoading = useCallback((path: string) => {
    setTabs((current) => current.map((tab) => (tab.path === path ? { ...tab, loading: true } : tab)));
  }, []);

  const markTabLoadFailed = useCallback((path: string) => {
    setTabs((current) => current.map((tab) => (tab.path === path ? { ...tab, loading: false } : tab)));
  }, []);

  const changeTabContent = useCallback((content: string) => {
    setTabs((current) => current.map((tab) =>
      activePath !== null && tab.path === activePath ? { ...tab, content } : tab
    ));
  }, [activePath]);

  const markTabSaving = useCallback((path: string, saving: boolean) => {
    setTabs((current) => current.map((tab) => (tab.path === path ? { ...tab, saving } : tab)));
  }, []);

  const markTabSaved = useCallback((path: string) => {
    setTabs((current) => current.map((tab) =>
      tab.path === path ? { ...tab, savedContent: tab.content, saving: false } : tab
    ));
  }, []);

  const renameTab = useCallback((source: string, destination: string) => {
    setTabs((current) => current.map((tab) => (tab.path === source ? { ...tab, path: destination } : tab)));
    setActivePath((current) => (current === source ? destination : current));
  }, []);

  const closeTab = useCallback((path: string): void => {
    // Dirty guard lives at the call site (tab strip / context menu) so the
    // hook stays headless and unit-testable without window.confirm.
    setTabs((current) => current.filter((tab) => tab.path !== path));
    setActivePath((current) => (current === path ? null : current));
  }, []);

  const closeOtherTabs = useCallback((keepPath: string) => {
    setTabs((current) => current.filter((tab) => tab.path === keepPath || tab.content !== tab.savedContent));
    setActivePath(keepPath);
  }, []);

  const closeAllTabs = useCallback(() => {
    setTabs((current) => current.filter((tab) => tab.content !== tab.savedContent));
    setActivePath(null);
  }, []);

  const resetTabs = useCallback(() => {
    setTabs([]);
    setActivePath(null);
  }, []);

  const dirtyPaths = useMemo(
    () => new Set(tabs.filter((tab) => !tab.loading && tab.content !== tab.savedContent).map((tab) => tab.path)),
    [tabs]
  );

  return {
    tabs,
    activePath,
    openFile,
    dirtyPaths,
    openTab,
    activateTab,
    applyTabContent,
    markTabLoading,
    markTabLoadFailed,
    changeTabContent,
    markTabSaving,
    markTabSaved,
    renameTab,
    closeTab,
    closeOtherTabs,
    closeAllTabs,
    resetTabs,
    setTabs
  };
}

export type OpenFileTabs = ReturnType<typeof useOpenFileTabs>;

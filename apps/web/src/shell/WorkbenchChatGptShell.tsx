import type { ReactNode } from "react";
import { ChatGptDesktopShell } from "../components/chatgpt-shell/ChatGptDesktopShell";
import { ThemeQuickSwitcher } from "../components/ThemeQuickSwitcher";

export function WorkbenchChatGptShell({ wb }: { wb: any }) {
  const {
    activeProviderLabel, allThemePlugins, cwd, cwdForThread, effectiveSelectedModel,
    immersiveView, installedThemePluginIds, mainThreads, onThemeModeChange, openSettings,
    permission, renderCenterPanel, renderRightWorkspacePanel, requestNewSession, runningThreadIds,
    selectHistoryThread, selectedModel, setRightWorkspaceTab, setRightWorkspaceVisible, state,
    t, themeMode, threadRuntimeSelections,
  } = wb;
  return (
    <>
      {themeMode === "chatgpt" && !immersiveView && (
        <ChatGptDesktopShell
          threads={mainThreads}
          activeThreadId={state.activeThreadId}
          providerLabel={activeProviderLabel}
          modelLabel={effectiveSelectedModel || selectedModel}
          cwd={state.activeThreadId ? cwdForThread(state.activeThreadId) ?? undefined : cwd || undefined}
          permission={permission}
          runtimeSelections={threadRuntimeSelections}
          runningThreadIds={runningThreadIds}
          workspace={renderRightWorkspacePanel()}
          themeSwitcher={<ThemeQuickSwitcher themeMode={themeMode} themes={allThemePlugins} installedThemePluginIds={installedThemePluginIds} t={t} onThemeChange={onThemeModeChange} onOpenAppearance={() => openSettings("appearance")} />}
          onSelectThread={selectHistoryThread}
          onNewChat={() => requestNewSession(permission)}
          onOpenSettings={() => openSettings("appearance")}
          onOpenWorkspace={() => {
            setRightWorkspaceTab("sidechat");
            setRightWorkspaceVisible(true);
          }}
        >
          {renderCenterPanel()}
        </ChatGptDesktopShell>
      )}
    </>
  );
}

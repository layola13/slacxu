import type { ReactNode } from "react";
import { type HistoryBackendFilter, HistorySidebar } from "../history/HistorySidebar";
import { type PluginEntry, type PluginMarketplace, type SkillEntry } from "../state/codexClient";
import { type CodexConfigFieldKey } from "../state/codexConfigSettings";
import { type JsonValue } from "@codex-ui/shared";
import { Box, Drawer } from "@mui/material";


export function WorkbenchDrawers({ wb }: { wb: any }) {
  const {
    activeProviderLabel, appInstalled, archiveHistoryThread, deleteHistoryThread, desktopLayout,
    exportHistoryThread, handleInstallApp, historyBackendFilter, historyBackendFilterUserTouchedRef, historyBackgroundImage,
    historyDateRange, historyLoadProgress, historyLoading, historySearchTerm, historyUsageByThread,
    historyViewMode, immersiveView, installPromptEvent, leftPanelVisible, loadHistory,
    mainThreads, openSettings, renameHistoryThread, runningThreadIds, selectHistoryThread,
    setHistoryBackendFilter, setHistoryDateRange, setHistorySearchTerm, setHistoryViewMode, setLeftPanelVisible,
    state, t, themeMode, unfilteredMainThreads,
    mobileHistoryOpen, setMobileHistoryOpen,
  } = wb;
  return (
    <>
      {themeMode !== "chatgpt" && <Drawer
        anchor="left"
        open={desktopLayout && leftPanelVisible}
        onClose={() => setLeftPanelVisible(false)}
        ModalProps={{ keepMounted: true }}
        PaperProps={{ sx: { width: "min(380px, 88vw)", top: immersiveView ? 0 : { xs: 58, sm: 70 }, height: immersiveView ? "100dvh" : { xs: "calc(100dvh - 66px)", sm: "calc(100dvh - 82px)" }, ml: { xs: 0, sm: 1.5 }, borderRadius: { xs: 0, sm: 2 }, overflow: "hidden", boxShadow: 12 } }}
      >
        <HistorySidebar
          threads={mainThreads} activeThreadId={state.activeThreadId} runningThreadIds={runningThreadIds} providerLabel={activeProviderLabel}
          threadUsage={historyUsageByThread} searchTerm={historySearchTerm} loading={historyLoading} loadProgress={historyLoadProgress}
          dateRange={historyDateRange} viewMode={historyViewMode} totalThreadCount={unfilteredMainThreads.length}
          backendFilter={historyBackendFilter}
          installAvailable={Boolean(installPromptEvent) && !appInstalled} backgroundImage={historyBackgroundImage} t={t}
          onSearchChange={setHistorySearchTerm} onDateRangeChange={setHistoryDateRange} onViewModeChange={setHistoryViewMode}
          onBackendFilterChange={(value: HistoryBackendFilter) => { historyBackendFilterUserTouchedRef.current = true; setHistoryBackendFilter(value); }}
          onRefresh={() => void loadHistory(historySearchTerm)} onSelect={(threadId: string) => { setLeftPanelVisible(false); selectHistoryThread(threadId); }}
          onRename={(threadId: string, name: string) => renameHistoryThread(threadId, name)} onArchive={(threadId: string) => archiveHistoryThread(threadId)}
          onDelete={(threadId: string) => deleteHistoryThread(threadId)} onExport={(threadId: string) => exportHistoryThread(threadId)} onInstallApp={() => void handleInstallApp()}
          onOpenSettings={() => { setLeftPanelVisible(false); openSettings("codex"); }}
        />
      </Drawer>}
      {themeMode !== "chatgpt" && <Drawer
        anchor="left"
        open={!desktopLayout && mobileHistoryOpen}
        onClose={() => setMobileHistoryOpen(false)}
        PaperProps={{ sx: { width: "min(88vw, 360px)", overflow: "hidden" } }}
      >
        <Box sx={{ height: "100dvh", minHeight: 0 }}>
          <HistorySidebar
            threads={mainThreads}
            activeThreadId={state.activeThreadId}
            runningThreadIds={runningThreadIds}
            providerLabel={activeProviderLabel}
            threadUsage={historyUsageByThread}
            searchTerm={historySearchTerm}
            loading={historyLoading}
            loadProgress={historyLoadProgress}
            dateRange={historyDateRange}
            viewMode={historyViewMode}
            backendFilter={historyBackendFilter}
            totalThreadCount={unfilteredMainThreads.length}

            installAvailable={Boolean(installPromptEvent) && !appInstalled}
            backgroundImage={historyBackgroundImage}
            t={t}
            onSearchChange={setHistorySearchTerm}
            onDateRangeChange={setHistoryDateRange}
            onViewModeChange={setHistoryViewMode}
            onBackendFilterChange={(value: HistoryBackendFilter) => { historyBackendFilterUserTouchedRef.current = true; setHistoryBackendFilter(value); }}
            onRefresh={() => void loadHistory(historySearchTerm)}
            onSelect={(threadId: string) => { setMobileHistoryOpen(false); selectHistoryThread(threadId); }}
            onRename={(threadId: string, name: string) => renameHistoryThread(threadId, name)}
            onArchive={(threadId: string) => archiveHistoryThread(threadId)}
            onDelete={(threadId: string) => deleteHistoryThread(threadId)}
            onExport={(threadId: string) => exportHistoryThread(threadId)}
            onInstallApp={() => void handleInstallApp()}
            onOpenSettings={() => { setMobileHistoryOpen(false); openSettings("codex"); }}
          />
        </Box>
      </Drawer>}
    </>
  );
}

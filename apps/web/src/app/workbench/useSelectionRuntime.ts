import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { type HistoryBackendFilter } from "../../history/HistorySidebar";
import { useI18n } from "../../i18n";
import { useIsMobile } from "../../mobile/useIsMobile";
import { type CliInstallationKind, type CodexCliUpdateStatus, fetchCodexCliUpdateStatus } from "../../state/codexClient";
import { isAgyCliBackend, isClaudeCliBackend, isCodexCliBackend, isGrokCliBackend, isMiniCliBackend, isMuseCliBackend, isOpencodeCliBackend, isOpencodeV2CliBackend, isPiCliBackend } from "../cli/cliBackendKind";
import { DEFAULT_CLI_BACKEND } from "../cli/cliPlugins";
import { resolveCliBackendSelection } from "../cli/resolveCliBackendSelection";
import { useCliInstallations } from "../cli/useCliInstallations";
import { useThreadRuntimeSelections } from "../runtime/useThreadRuntimeSelections";
import { useFreeCompactionSelection } from "../../free/useFreeCompactionSelection";
import { useFreebuffSession } from "./useFreebuffSession";
import { useSessionRecovery } from "./useSessionRecovery";
import { type CliBackend, type PermissionPresetId, permissionPresets } from "@codex-ui/shared";
import { useMediaQuery } from "@mui/material";

import type { AppProps } from "./appConstants";
import type { appReducer } from "../../app/appReducer";
import type { ClientState, CodexSocketClient } from "../../state/codexClient";
import type { useAccessRuntime } from "./useAccessRuntime";
import type { useTaskTabsRuntime } from "./useTaskTabsRuntime";
import type { useThreadWorkspaceRuntime } from "./useThreadWorkspaceRuntime";

export function useSelectionRuntime(input: {
  state: ClientState;
  dispatch: Dispatch<Parameters<typeof appReducer>[1]>;
  themeMode: AppProps["themeMode"];
  customThemePlugins: AppProps["customThemePlugins"];
  onThemeModeChange: AppProps["onThemeModeChange"];
  onCustomThemePluginsChange: AppProps["onCustomThemePluginsChange"];
  detachedThreadId: string | null;
  access: ReturnType<typeof useAccessRuntime>;
  taskTabs: ReturnType<typeof useTaskTabsRuntime>;
  threadWorkspace: ReturnType<typeof useThreadWorkspaceRuntime>;
}) {
  const { state, dispatch, themeMode, customThemePlugins, onThemeModeChange, onCustomThemePluginsChange, detachedThreadId } = input;
  const {
    authStatus,
    setAuthStatus,
    authSession,
    setAuthSession,
    dangerBypassConfirmed,
    setDangerBypassConfirmed,
    workspaceMode,
    cwd,
    setCwd,
    setWorkspacePickerPath,
    workspaceSelectionPending,
    setWorkspaceSelectionPending,
    setSlashNotice,
    setCodexCliUpdateStatus,
    modelCapacityRetryRef,
    setHistoryBackendFilter,
    historyBackendFilterUserTouchedRef,
  } = input.access;
  const {
    setFreeModelAccessOpen,
    freeAutoCompactBusyRef,
    codexCliEnabled,
    claudeCliEnabled,
    agyCliEnabled,
    auggieCliEnabled,
    clineCliEnabled,
    commandCodeCliEnabled,
    grokCliEnabled,
    museCliEnabled,
    piCliEnabled,
    opencodeCliEnabled,
    opencodeV2CliEnabled,
    handleCliBackendToggle,
  } = input.taskTabs;
  const {
    activeThreadIdRef,
    clientRef,
    imageJobsRef,
  } = input.threadWorkspace;
  const {
    threadRuntimeSelections,
    imageRuntimeSelections,
    runtimeSelectionKey,
    runtimeSelection,
    imageRuntimeSelection,
    selectedModelRef,
    selectionForThread,
    historySelectionForThread,
    hydratePreferences: hydrateRuntimePreferences,
    updateRuntimeSelection,
    updateRuntimeSelectionAndPersist,
    updateRuntimeSelectionForKey,
    updateNewConversationRuntimeSelection,
    patchThreadRuntimeSelection,
    seedThreadRuntimeSelection,
    setSelectedModel,
    setReasoningEffort,
    setActiveProviderId,
    setActiveGroupId,
    setRuntimePermission,
    updateImageRuntimeSelection,
    loadPersistedThreadRuntimeSelection,
    persistThreadRuntimeSelection,
    awaitThreadRuntimePersistence,
    setThreadRuntimePersistencePaused,
    applyDefaultNewChatSelection
  } = useThreadRuntimeSelections({ token: state.token, activeThreadId: state.activeThreadId });
  // L0能力门禁联动：jev策略要求增强工具开关已开，否则只提示不执行（MVP3 barrier 同理降级为提醒）。
  const compactTools = runtimeSelection.vmPolicy?.tools;
  const vmEnabled = runtimeSelection.vmEnabled;
  const selectedModel = runtimeSelection.model;
  const { freeAutoCompactEnabled, freeAutoCompactThreshold, freeAutoCompactModel, freeAutoCompactProviderId, freeAutoCompactGroupId, compactMode, jevCompressThreshold, setFreeAutoCompactEnabled, setCompactMode, setJevCompressThreshold, setFreeAutoCompactThreshold, freeCompactionChannelOptions, selectedFreeCompactionChannel, freeCompactionProviderOptions, freeCompactionGroupOptions, freeCompactionModels, freeCompactionReadiness, setFreeAutoCompactProvider, setFreeAutoCompactGroup, setFreeAutoCompactModel, checkFreeModelsBeforeToggle, compactCapabilityWarning } = useFreeCompactionSelection({ state, dispatch, runtimeSelection, selectedModel, setSlashNotice, freeAutoCompactBusyRef, workspaceMode, setFreeModelAccessOpen, selectionForThread, updateRuntimeSelectionForKey });
  const isClaudeBackend = isClaudeCliBackend(runtimeSelection.cliBackend) && claudeCliEnabled;
  const isAgyBackend = isAgyCliBackend(runtimeSelection.cliBackend) && agyCliEnabled;
  const isGrokBackend = isGrokCliBackend(runtimeSelection.cliBackend) && grokCliEnabled;
  const isMuseBackend = isMuseCliBackend(runtimeSelection.cliBackend) && museCliEnabled;
  const isPiBackend = isPiCliBackend(runtimeSelection.cliBackend) && piCliEnabled;
  const isOpencodeBackend = isOpencodeCliBackend(runtimeSelection.cliBackend) && opencodeCliEnabled;
  const isOpencodeV2Backend = isOpencodeV2CliBackend(runtimeSelection.cliBackend) && opencodeV2CliEnabled;
  const isCodexBackend = isCodexCliBackend(runtimeSelection.cliBackend) && codexCliEnabled;
  const isMiniBackend = isMiniCliBackend(runtimeSelection.cliBackend) || (!isCodexBackend && !isClaudeBackend && !isAgyBackend && !isGrokBackend && !isMuseBackend && !isPiBackend && !isOpencodeBackend && !isOpencodeV2Backend);
  const handleNewConversationCliBackend = useCallback((value: CliBackend) => {
    updateRuntimeSelection(resolveCliBackendSelection({
      value,
      currentProviderId: runtimeSelection.providerId,
      currentGroupId: runtimeSelection.groupId,
      currentModel: runtimeSelection.model,
      providers: state.providers,
    }));
  }, [runtimeSelection.groupId, runtimeSelection.model, runtimeSelection.providerId, state.providers, updateRuntimeSelection]);
  useEffect(() => {
    if (!codexCliEnabled && runtimeSelection.cliBackend === "codex") {
      updateRuntimeSelection({ cliBackend: "mini" });
    }
  }, [codexCliEnabled, runtimeSelection.cliBackend, updateRuntimeSelection]);
  useEffect(() => {
    if (historyBackendFilterUserTouchedRef.current) return;
    const next = isClaudeBackend ? "claude" : isAgyBackend ? "agy" : isGrokBackend ? "grok" : isMuseBackend ? "muse" : isPiBackend ? "pi" : isOpencodeBackend ? "opencode" : isOpencodeV2Backend ? "opencode-v2" : isCodexBackend ? "codex" : "mini";
    setHistoryBackendFilter((current: HistoryBackendFilter) => (current === next ? current : next));
  }, [isClaudeBackend, isAgyBackend, isGrokBackend, isMuseBackend, isPiBackend, isOpencodeBackend, isOpencodeV2Backend, isCodexBackend, isMiniBackend]);

  const reasoningEffort = runtimeSelection.reasoningEffort;
  const fastModeEnabled = runtimeSelection.fastModeEnabled;
  const planModeEnabled = runtimeSelection.planModeEnabled;
  const planModeEnabledRef = useRef(planModeEnabled);
  planModeEnabledRef.current = planModeEnabled;
  const permission = runtimeSelection.permission;
  const dangerBypassPermissionConfirmed = permission === "dangerBypass" && (runtimeSelection.dangerBypassConfirmed || dangerBypassConfirmed);
  const activeProviderId = runtimeSelection.providerId;
  const activeGroupId = runtimeSelection.groupId;

  const { freebuffSession, setFreebuffSession, freebuffSwitchDialogOpen, setFreebuffSwitchDialogOpen, freebuffSwitchTargetModel, setFreebuffSwitchTargetModel, freebuffSwitchBusy, setFreebuffSwitchBusy, clineBalance, setClineBalance, freebuffAutoFailover, setFreebuffAutoFailover, freebuffFallbackSuggestion, setFreebuffFallbackSuggestion, refreshFreebuffSession, refreshClineBalance, handleReleaseFreebuffSlotFromChip, handleConfirmFreebuffSwitch, handleKeepCurrentFreebuffModel } = useFreebuffSession({ state, dispatch, activeThreadIdRef, setSlashNotice, updateNewConversationRuntimeSelection, setSelectedModel });



  useEffect(() => {
    if ((activeGroupId === "cline-free" || (activeGroupId && activeGroupId.includes("cline"))) && state.token) {
      void refreshClineBalance();
    }
  }, [activeGroupId, state.token, refreshClineBalance]);




  useEffect(() => () => {
    for (const controller of imageJobsRef.current.values()) controller.abort();
    imageJobsRef.current.clear();
    for (const entry of modelCapacityRetryRef.current.values()) {
      if (entry.timer !== null) window.clearTimeout(entry.timer);
    }
    modelCapacityRetryRef.current.clear();
  }, []);
  const newChatDefaultsAppliedRef = useRef(false);

  useEffect(() => {
    if (state.activeThreadId || !workspaceSelectionPending || newChatDefaultsAppliedRef.current) {
      return;
    }
    if (applyDefaultNewChatSelection(state.providers)) {
      newChatDefaultsAppliedRef.current = true;
    }
  }, [applyDefaultNewChatSelection, state.activeThreadId, state.providers, workspaceSelectionPending]);
  const desktopLayout = useMediaQuery("(min-width:900px)");
  const isMobile = useIsMobile();
  const { locale, setLocale, t } = useI18n();
  const translateRef = useRef(t);
  translateRef.current = t;



  const checkCodexCliUpdate = useCallback((token: string) => {
    void fetchCodexCliUpdateStatus(token)
      .then((status: CodexCliUpdateStatus) => setCodexCliUpdateStatus(status))
      .catch(() => {
        /* non-critical: ignore update check failures */
      });
  }, []);

  const {
    cliInstallations,
    miniVersion,
    cliSwitcherAnchor,
    setCliSwitcherAnchor,
    cliSwitchConfirmTarget,
    setCliSwitchConfirmTarget,
    cliSwitchBusy,
    cliSwitchError,
    setCliSwitchError,
    cliSwitchNotice,
    setCliSwitchNotice,
    refreshCliInstallations,
    ensureCliBackendLoaded,
    handleCliSwitchConfirm,
    cliBackendVersionLabel,
  } = useCliInstallations({
    token: state.token,
    cliBackend: runtimeSelection.cliBackend ?? DEFAULT_CLI_BACKEND,
    codexVersion: state.engine.codexVersion,
    t,
  });

  const handleCliPluginToggleFromList = useCallback((backend: CliInstallationKind, next: boolean, effect: "immediate" | "restart") => {
    void handleCliBackendToggle(backend, next).then(() => {
      if (!next && runtimeSelection.cliBackend === backend) updateRuntimeSelection({ cliBackend: "mini" });
      if (next && state.token) refreshCliInstallations(state.token, [backend]);
      setCliSwitchNotice((t(effect === "restart" ? "app.cliSwitcherToggleRestart" : "app.cliSwitcherToggleImmediate") as string) || null);
    });
  }, [handleCliBackendToggle, refreshCliInstallations, runtimeSelection.cliBackend, setCliSwitchNotice, state.token, t, updateRuntimeSelection]);


  /**
   * A single 401 is not proof that the member has to sign in again: a desktop
   * build re-issues a local session, `/api/session` hands back a rotated token
   * before the old one expires, and a proxy hop can answer for another
   * instance. The login screen is only shown once the session endpoint agrees.
   * Returns whether the workbench may keep running.
   */

  // Keepalive: the server rotates a session past half its lifetime, so an app
  // that stays open for days never reaches a hard expiry and never has to ask
  // for the password again.

  const { handleSessionExpired, recoverOrExpireSession } = useSessionRecovery({ state, dispatch, t, authStatus, setAuthStatus, setAuthSession, clientRef });







  const allowedPermissions = useMemo((): PermissionPresetId[] => {
    const user = authSession?.user;
    if (!user || user.role === "admin") {
      return permissionPresets.map((preset: typeof permissionPresets[number]) => preset.id);
    }
    const rank: Record<PermissionPresetId, number> = {
      readonlyAsk: 0,
      workspaceAsk: 1,
      fullAsk: 2,
      dangerBypass: 3
    };
    return permissionPresets
      .map((preset: typeof permissionPresets[number]) => preset.id)
      .filter((id: PermissionPresetId) => {
        if (!user.allowDangerBypass && id === "dangerBypass") return false;
        if (!user.allowWrite && id !== "readonlyAsk") return false;
        return rank[id] <= rank[user.maxPermission];
      });
  }, [authSession?.user]);

  useEffect(() => {
    if (!allowedPermissions.includes(permission)) {
      setRuntimePermission(allowedPermissions[0] ?? "readonlyAsk");
      setDangerBypassConfirmed(false);
    }
  }, [allowedPermissions, permission, setRuntimePermission]);

  useEffect(() => {
    if (permission !== "dangerBypass" && dangerBypassConfirmed) {
      setDangerBypassConfirmed(false);
    }
  }, [dangerBypassConfirmed, permission]);

  useEffect(() => {
    const root = authSession?.user?.workspaceRoot;
    if (root && authSession?.user?.role !== "admin") {
      setCwd(root);
      setWorkspacePickerPath(root);
      setWorkspaceSelectionPending(false);
    }
  }, [authSession?.user?.role, authSession?.user?.workspaceRoot]);

  // Members may only use paths under their workspace root.
  useEffect(() => {
    const user = authSession?.user;
    if (!user || user.role === "admin" || !user.workspaceRoot) {
      return;
    }
    const root = user.workspaceRoot.replace(/\/+$/, "");
    const normalized = cwd.replace(/\/+$/, "") || root;
    if (normalized !== root && !normalized.startsWith(`${root}/`)) {
      setCwd(root);
    }
  }, [authSession?.user, cwd]);







  return {
    threadRuntimeSelections,
    imageRuntimeSelections,
    runtimeSelectionKey,
    runtimeSelection,
    imageRuntimeSelection,
    selectedModelRef,
    selectionForThread,
    historySelectionForThread,
    hydrateRuntimePreferences,
    updateRuntimeSelection,
    updateRuntimeSelectionAndPersist,
    updateRuntimeSelectionForKey,
    updateNewConversationRuntimeSelection,
    patchThreadRuntimeSelection,
    seedThreadRuntimeSelection,
    setSelectedModel,
    setReasoningEffort,
    setActiveProviderId,
    setActiveGroupId,
    setRuntimePermission,
    updateImageRuntimeSelection,
    loadPersistedThreadRuntimeSelection,
    persistThreadRuntimeSelection,
    awaitThreadRuntimePersistence,
    setThreadRuntimePersistencePaused,
    applyDefaultNewChatSelection,
    compactTools,
    vmEnabled,
    selectedModel,
    freeAutoCompactEnabled,
    freeAutoCompactThreshold,
    freeAutoCompactModel,
    freeAutoCompactProviderId,
    freeAutoCompactGroupId,
    compactMode,
    jevCompressThreshold,
    setFreeAutoCompactEnabled,
    setCompactMode,
    setJevCompressThreshold,
    setFreeAutoCompactThreshold,
    freeCompactionChannelOptions,
    selectedFreeCompactionChannel,
    freeCompactionProviderOptions,
    freeCompactionGroupOptions,
    freeCompactionModels,
    freeCompactionReadiness,
    setFreeAutoCompactProvider,
    setFreeAutoCompactGroup,
    setFreeAutoCompactModel,
    checkFreeModelsBeforeToggle,
    compactCapabilityWarning,
    isClaudeBackend,
    isAgyBackend,
    isGrokBackend,
    isMuseBackend,
    isPiBackend,
    isOpencodeBackend,
    isOpencodeV2Backend,
    isCodexBackend,
    isMiniBackend,
    handleNewConversationCliBackend,
    reasoningEffort,
    fastModeEnabled,
    planModeEnabled,
    planModeEnabledRef,
    permission,
    dangerBypassPermissionConfirmed,
    activeProviderId,
    activeGroupId,
    freebuffSession,
    setFreebuffSession,
    freebuffSwitchDialogOpen,
    setFreebuffSwitchDialogOpen,
    freebuffSwitchTargetModel,
    setFreebuffSwitchTargetModel,
    freebuffSwitchBusy,
    setFreebuffSwitchBusy,
    clineBalance,
    setClineBalance,
    freebuffAutoFailover,
    setFreebuffAutoFailover,
    freebuffFallbackSuggestion,
    setFreebuffFallbackSuggestion,
    refreshFreebuffSession,
    refreshClineBalance,
    handleReleaseFreebuffSlotFromChip,
    handleConfirmFreebuffSwitch,
    handleKeepCurrentFreebuffModel,
    newChatDefaultsAppliedRef,
    desktopLayout,
    isMobile,
    locale,
    setLocale,
    t,
    translateRef,
    checkCodexCliUpdate,
    cliInstallations,
    miniVersion,
    cliSwitcherAnchor,
    setCliSwitcherAnchor,
    cliSwitchConfirmTarget,
    setCliSwitchConfirmTarget,
    cliSwitchBusy,
    cliSwitchError,
    setCliSwitchError,
    cliSwitchNotice,
    setCliSwitchNotice,
    refreshCliInstallations,
    ensureCliBackendLoaded,
    handleCliSwitchConfirm,
    cliBackendVersionLabel,
    handleCliPluginToggleFromList,
    handleSessionExpired,
    recoverOrExpireSession,
    allowedPermissions,
  };
}

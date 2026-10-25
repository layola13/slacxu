import { useCallback, type Dispatch, type MouseEvent as ReactMouseEvent, type MutableRefObject, type SetStateAction } from "react";
import type { AgentRosterRole, JsonValue } from "@codex-ui/shared";
import {
  createWorkspaceDirectory,
  fetchAgentReadiness,
  startRemoteBackgroundThread,
  type AgentReadinessResult,
  type LocalWorkspaceInfo,
  type TerminalSession,
  type ThreadEntry,
} from "../../state/codexClient";
import { asRecord, errorMessage, formatErrorText, normalizeGitPath, stringValue, waterfallFileChangePaths } from "./appUtils";
import { addWorkspaceRpcMetadata, createSshWorkspaceDirectory, normalizeSshWorkspaceCwd } from "./sshUtils";
import { displayThreadTitle } from "../threads/threadCatalog";
import { normalizeWorkspaceCwd, parentWorkspacePath, resolveTildeWorkspacePath, resolveWorkspaceNewFolderPath } from "../../workspacePaths";
import { resolveThreadWorkspace } from "../threads/editConversation";
import { DEFAULT_CLI_BACKEND } from "../cli/cliPlugins";
import { DEFAULT_SSH_WORKSPACE_CWD, type WorkspaceMode } from "./appConstants";
import { useWorkspaceFileMutations } from "../workspace/useWorkspaceFileMutations";
import type { ChatWaterfallRow } from "../../waterfall/types";
import type { TaskNotificationEvent, TaskNotificationPreferences } from "../../taskNotifications";
import type { ReasoningOption } from "../../settings/SettingsDrawer";
import type { ThreadTokenUsageState } from "../../components/ChatPanel";
import type { TopicUsageStore } from "../usage/topicUsageStore";
import type { useOpenFileTabs } from "../workspace/useOpenFileTabs";
import type { ThreadRuntimeSelection } from "../runtime/useThreadRuntimeSelections";
import type { appReducer } from "../../app/appReducer";
import type { ClientState, CodexSocketClient } from "../../state/codexClient";
import type { TranslateFn } from "../../i18n";

export type WorkbenchOpsInput = {
  state: ClientState;
  dispatch: Dispatch<Parameters<typeof appReducer>[1]>;
  client: CodexSocketClient;
  t: TranslateFn;
  activeWorkspaceCwd: string;
  activeWorkspaceMode: WorkspaceMode;
  activeWorkspaceSshCommand: string;
  activeProviderId: string | null;
  activeGroupId: string | null;
  activeThreadIdRef: MutableRefObject<string | null>;
  allHistoryThreadsRef: MutableRefObject<ClientState["threads"]>;
  composerModels: import("../../state/codexClient").ModelEntry[];
  cwd: string;
  sshCommand: string;
  sshCwd: string;
  workspaceMode: WorkspaceMode;
  workspacePickerPath: string;
  workspaceNewFolderName: string;
  setWorkspaceNewFolderName: Dispatch<SetStateAction<string>>;
  workspaceHostPlatform: string | undefined;
  localWorkspaceInfo: LocalWorkspaceInfo | null;
  localWorkspaceDefaultPath: string;
  runtimeSelection: ThreadRuntimeSelection;
  selectedModel: string;
  reasoningEffort: string;
  resolveComposerReasoningOptions: (model: string) => ReasoningOption[];
  terminalSessions: TerminalSession[];
  setTerminalSessions: Dispatch<SetStateAction<TerminalSession[]>>;
  fileTabs: ReturnType<typeof useOpenFileTabs>;
  readDirectory: (path: string) => Promise<void>;
  readActiveWorkspaceDirectory: (path: string) => Promise<void>;
  setFileDirectories: Dispatch<SetStateAction<Record<string, import("../../state/codexClient").FsDirectoryEntry[]>>>;
  rightWorkspaceRequestEpochRef: MutableRefObject<number>;
  usageStore: TopicUsageStore;
  threadUsagePublishTimerRef: MutableRefObject<number | null>;
  threadUsagePublishBusyRef: MutableRefObject<boolean>;
  threadUsagePublishPendingRef: MutableRefObject<Record<string, ThreadTokenUsageState> | null>;
  flushThreadTokenUsage: () => void;
  taskNotificationPreferences: TaskNotificationPreferences;
  setRemoteBackgroundStarting: Dispatch<SetStateAction<boolean>>;
  remoteBackgroundStarting: boolean;
  agentReadiness: AgentReadinessResult | null;
  setAgentReadiness: Dispatch<SetStateAction<AgentReadinessResult | null>>;
  setAgentReadinessLoading: Dispatch<SetStateAction<boolean>>;
  updateAgentRuntime: (patch: Partial<ThreadRuntimeSelection["agents"]>) => void;
  openExistingThread: (threadId: string) => Promise<void>;
  openFile: ReturnType<typeof useOpenFileTabs>["openFile"];
  runningThreadIds: ReadonlySet<string>;
  workspaceGitRpc: (method: string, params: Record<string, unknown>) => Promise<JsonValue>;
  setOpenWithApps: Dispatch<SetStateAction<Array<{ id: string; label: string }>>>;
  setOpenWithAppsLoading: Dispatch<SetStateAction<boolean>>;
  setOpenWithMenuPosition: Dispatch<SetStateAction<{ top: number; left: number } | null>>;
  setRightWorkspaceVisible: Dispatch<SetStateAction<boolean>>;
  setWorkspaceCreateBusy: Dispatch<SetStateAction<boolean>>;
  setOpenWithTarget: Dispatch<SetStateAction<{ cwd: string; workspaceMode: WorkspaceMode; sshCommand: string; sshCwd: string } | null>>;
  setWorkspacePickerPath: Dispatch<SetStateAction<string>>;
};

export function useWorkbenchOpsEarly(input: Pick<WorkbenchOpsInput, "state" | "dispatch" | "client" | "t" | "cwd" | "workspaceMode" | "sshCommand" | "sshCwd" |
  "workspacePickerPath" | "workspaceNewFolderName" | "setWorkspaceNewFolderName" | "workspaceHostPlatform" |
  "localWorkspaceDefaultPath" | "localWorkspaceInfo" | "setWorkspacePickerPath" | "setWorkspaceCreateBusy" |
  "usageStore" | "threadUsagePublishTimerRef" | "threadUsagePublishBusyRef" | "threadUsagePublishPendingRef" |
  "flushThreadTokenUsage" | "taskNotificationPreferences" | "fileTabs" | "rightWorkspaceRequestEpochRef" |
  "setRightWorkspaceVisible" | "setOpenWithApps" | "setOpenWithAppsLoading" | "setOpenWithMenuPosition" |
  "activeThreadIdRef" | "allHistoryThreadsRef" | "runtimeSelection" | "activeProviderId" | "activeGroupId" | "setOpenWithTarget">) {
  const {
    state, dispatch, client, t, cwd, workspaceMode, sshCommand, sshCwd, workspacePickerPath, workspaceNewFolderName, setWorkspaceNewFolderName, workspaceHostPlatform, localWorkspaceDefaultPath, localWorkspaceInfo, setWorkspacePickerPath, setWorkspaceCreateBusy, usageStore, threadUsagePublishTimerRef, threadUsagePublishBusyRef, threadUsagePublishPendingRef, flushThreadTokenUsage, taskNotificationPreferences, fileTabs, rightWorkspaceRequestEpochRef, setRightWorkspaceVisible, setOpenWithApps, setOpenWithAppsLoading, setOpenWithMenuPosition, activeThreadIdRef, allHistoryThreadsRef, runtimeSelection, activeProviderId, activeGroupId, setOpenWithTarget,
  } = input;
  const cwdForThread = useCallback(
    (threadId?: string | null) => {
      // Linux/macOS hosts reject "~" in thread/start cwd (AbsolutePathBuf),
      // so local paths are resolved against the server-reported home before
      // they are sent. Windows keeps the tilde form (server expands it).
      const resolveLocal = (value: string) => resolveTildeWorkspacePath(value, localWorkspaceInfo?.home, workspaceHostPlatform);
      if (threadId) {
        const thread = state.threads.find((entry: ClientState["threads"][number]) => entry.id === threadId)
          ?? allHistoryThreadsRef.current.find((entry: ClientState["threads"][number]) => entry.id === threadId);
        const resolved = resolveThreadWorkspace(thread, {
          workspaceMode,
          sshCommand,
          localCwd: localWorkspaceDefaultPath,
          sshCwd: normalizeSshWorkspaceCwd(sshCwd) || DEFAULT_SSH_WORKSPACE_CWD
        });
        return resolved.workspaceMode === "ssh" ? resolved.cwd : resolveLocal(resolved.cwd);
      }
      return workspaceMode === "ssh" ? normalizeSshWorkspaceCwd(sshCwd) || normalizeSshWorkspaceCwd(cwd) : resolveLocal(normalizeWorkspaceCwd(cwd));
    },
    [cwd, localWorkspaceDefaultPath, localWorkspaceInfo?.home, sshCommand, sshCwd, state.threads, workspaceMode, workspaceHostPlatform]
  );

  const publishThreadTokenUsage = useCallback((immediate: boolean = false) => {
    threadUsagePublishPendingRef.current = usageStore.allThreadUsage();
    if (immediate) {
      if (threadUsagePublishTimerRef.current !== null) {
        window.clearTimeout(threadUsagePublishTimerRef.current);
        threadUsagePublishTimerRef.current = null;
      }
      if (threadUsagePublishBusyRef.current) return;
      flushThreadTokenUsage();
      return;
    }
    if (threadUsagePublishBusyRef.current || threadUsagePublishTimerRef.current !== null) return;
    threadUsagePublishTimerRef.current = window.setTimeout(() => {
      threadUsagePublishTimerRef.current = null;
      flushThreadTokenUsage();
    }, 160);
  }, [flushThreadTokenUsage, usageStore]);

  const sendWindowsTaskNotification = useCallback((event: TaskNotificationEvent) => {
    const desktop = window.codexUltraDesktop;
    if (!desktop) return;
    if (event.type === "turnCompleted" && !taskNotificationPreferences.turnCompleted) return;
    if (event.type === "planStepsCompleted" && !taskNotificationPreferences.planStepsCompleted) return;
    if (event.type === "remoteError" && !taskNotificationPreferences.remoteErrors) return;

    const threadId = event.threadId ?? activeThreadIdRef.current;
    const thread = threadId ? state.threads.find((entry: ThreadEntry) => entry.id === threadId) : undefined;
    const threadLabel = thread ? displayThreadTitle(thread) : t("notifications.unknownConversation");
    let body: string;
    if (event.type === "turnCompleted") {
      body = t("notifications.turnCompleted");
    } else if (event.type === "planStepsCompleted") {
      body = event.steps.length === 1
        ? t("notifications.planStepCompleted", { step: event.steps[0] ?? "" })
        : t("notifications.planStepsCompleted", { count: event.steps.length, step: event.steps[0] ?? "" });
    } else {
      const status = event.status && !new RegExp(`\\b${event.status}\\b`).test(event.message) ? `${event.status} ` : "";
      const retry = event.willRetry ? ` ${t("notifications.retrying")}` : "";
      body = `${status}${event.message}${retry}`.trim();
    }
    void desktop.notify({
      title: `Codex Ultra · ${threadLabel}`,
      body,
      tag: event.key
    }).catch((error: unknown) => console.warn("[desktop-notification] unable to show task notification", error));
  }, [state.threads, t, taskNotificationPreferences]);

  const selectOpenWithTarget = useCallback((threadId: string) => {
    const thread = state.threads.find((entry) => entry.id === threadId);
    const isSsh = thread?.workspaceMode === "ssh" || Boolean(thread?.sshCommand?.trim());
    setOpenWithTarget({
      cwd: isSsh ? (thread?.sshCwd?.trim() || thread?.cwd?.trim() || "~") : cwdForThread(threadId),
      workspaceMode: isSsh ? "ssh" : "local",
      sshCommand: isSsh ? (thread?.sshCommand?.trim() || "") : "",
      sshCwd: isSsh ? (thread?.sshCwd?.trim() || thread?.cwd?.trim() || "~") : ""
    });
  }, [cwdForThread, state.threads]);
  const showOpenWithMenu = useCallback((event: ReactMouseEvent<HTMLElement>, threadId: string) => {
    selectOpenWithTarget(threadId);
    const rect = event.currentTarget.getBoundingClientRect();
    setOpenWithMenuPosition({ top: Math.max(8, rect.top), left: Math.min(window.innerWidth - 8, rect.right + 4) });
    const desktop = window.codexUltraDesktop;
    if (!desktop?.listOpenWithApps) {
      setOpenWithApps([]);
      setOpenWithAppsLoading(false);
      return;
    }
    setOpenWithAppsLoading(true);
    void desktop.listOpenWithApps()
      .then(setOpenWithApps)
      .catch(() => setOpenWithApps([]))
      .finally(() => setOpenWithAppsLoading(false));
  }, [selectOpenWithTarget]);

  return {
    cwdForThread,
    publishThreadTokenUsage,
    sendWindowsTaskNotification,
    showOpenWithMenu,
    selectOpenWithTarget,
  };
}

export function useWorkbenchOps(input: Pick<WorkbenchOpsInput, "state" | "dispatch" | "client" | "t" | "activeWorkspaceCwd" | "activeWorkspaceMode" |
  "activeWorkspaceSshCommand" | "activeProviderId" | "activeGroupId" | "activeThreadIdRef" |
  "allHistoryThreadsRef" | "composerModels" | "cwd" | "sshCommand" | "sshCwd" | "workspaceMode" |
  "workspacePickerPath" | "workspaceNewFolderName" | "setWorkspaceNewFolderName" | "workspaceHostPlatform" |
  "localWorkspaceInfo" | "localWorkspaceDefaultPath" | "runtimeSelection" | "selectedModel" |
  "reasoningEffort" | "terminalSessions" | "setTerminalSessions" | "fileTabs" | "readDirectory" |
  "readActiveWorkspaceDirectory" | "setFileDirectories" | "rightWorkspaceRequestEpochRef" |
  "setRemoteBackgroundStarting" | "remoteBackgroundStarting" | "setWorkspaceCreateBusy" | "setWorkspacePickerPath" | "setOpenWithTarget" |
  "openExistingThread" | "openFile" | "workspaceGitRpc" | "setRightWorkspaceVisible">) {
  const {
    state, dispatch, client, t, activeWorkspaceCwd, activeWorkspaceMode, activeWorkspaceSshCommand, activeProviderId, activeGroupId, activeThreadIdRef, allHistoryThreadsRef, composerModels, cwd, sshCommand, sshCwd, workspaceMode, workspacePickerPath, workspaceNewFolderName, setWorkspaceNewFolderName, workspaceHostPlatform, localWorkspaceInfo, localWorkspaceDefaultPath, runtimeSelection, selectedModel, reasoningEffort, terminalSessions, setTerminalSessions, fileTabs, readDirectory, readActiveWorkspaceDirectory, setFileDirectories, rightWorkspaceRequestEpochRef, setRemoteBackgroundStarting, remoteBackgroundStarting, openExistingThread, openFile, workspaceGitRpc, setRightWorkspaceVisible, setWorkspaceCreateBusy, setWorkspacePickerPath, setOpenWithTarget,
  } = input;
  const createWorkspaceFolder = useCallback(async () => {
    const targetPath = resolveWorkspaceNewFolderPath(workspacePickerPath, workspaceNewFolderName);
    if (!targetPath) {
      dispatch({ type: "error", message: t("workspace.createNameRequired") });
      return;
    }
    setWorkspaceCreateBusy(true);
    try {
      if (!state.token) {
        throw new Error("Missing session token");
      }
      if (workspaceMode === "ssh") {
        await createSshWorkspaceDirectory(state.token, sshCommand, targetPath);
      } else {
        await createWorkspaceDirectory(state.token, { path: targetPath, recursive: true, threadId: state.activeThreadId ?? undefined, cwd });
      }
      const parent = parentWorkspacePath(targetPath) ?? workspacePickerPath;
      setWorkspacePickerPath(targetPath);
      setWorkspaceNewFolderName("");
      await readDirectory(parent);
      await readDirectory(targetPath);
    } catch (error) {
      dispatch({ type: "error", message: errorMessage(t("workspace.createFolder"), error) });
    } finally {
      setWorkspaceCreateBusy(false);
    }
  }, [readDirectory, sshCommand, state.token, t, workspaceMode, workspaceNewFolderName, workspacePickerPath]);

  const undoWaterfallFileChanges = useCallback(async (rows: ChatWaterfallRow[]) => {
    const requestedPaths = waterfallFileChangePaths(rows);
    if (requestedPaths.length === 0 || !window.confirm(`Undo changes in ${requestedPaths.length} ${requestedPaths.length === 1 ? "file" : "files"}? This cannot be undone.`)) {
      return;
    }
    try {
      const status = asRecord(await workspaceGitRpc("ui/git/status", { cwd: activeWorkspaceCwd }));
      const statusEntries = Array.isArray(status.entries) ? status.entries.map(asRecord) : [];
      const resolved = requestedPaths.map((path: string) => {
        const normalizedPath = normalizeGitPath(path);
        const entry = statusEntries.find((candidate: Record<string, unknown>) => {
          const normalizedCandidate = normalizeGitPath(stringValue(candidate.path));
          return Boolean(normalizedCandidate)
            && (normalizedCandidate === normalizedPath || normalizedPath.endsWith(`/${normalizedCandidate}`));
        });
        return { path: stringValue(entry?.path) || path, untracked: entry?.untracked === true };
      });
      const tracked = resolved.filter((entry: { path: string; untracked: boolean }) => !entry.untracked).map((entry: { path: string; untracked: boolean }) => entry.path);
      const untracked = resolved.filter((entry: { path: string; untracked: boolean }) => entry.untracked).map((entry: { path: string; untracked: boolean }) => entry.path);
      if (tracked.length > 0) await workspaceGitRpc("ui/git/discard", { cwd: activeWorkspaceCwd, paths: tracked, untracked: false });
      if (untracked.length > 0) await workspaceGitRpc("ui/git/discard", { cwd: activeWorkspaceCwd, paths: untracked, untracked: true });
    } catch (error) {
      dispatch({ type: "error", message: errorMessage("Undo file changes", error) });
    }
  }, [activeWorkspaceCwd, workspaceGitRpc]);

  const workspaceFileMutations = useWorkspaceFileMutations({
    token: state.token,
    threadId: state.activeThreadId,
    mode: activeWorkspaceMode,
    sshCommand: activeWorkspaceSshCommand,
    cwd: activeWorkspaceCwd,
    onError: (message: string) => dispatch({ type: "error", message }),
    onMutated: async (parentPaths: string[]) => {
      for (const parentPath of parentPaths) {
        await readActiveWorkspaceDirectory(parentPath);
      }
    },
    openFilePath: openFile?.path ?? null,
    onOpenFileRemoved: (path: string) => {
      fileTabs.closeTab(path);
    },
    onOpenFileRenamed: (source: string, destination: string) => {
      fileTabs.renameTab(source, destination);
    }
  });

  const closeRightWorkspace = useCallback(() => {
    rightWorkspaceRequestEpochRef.current += 1;
    setRightWorkspaceVisible(false);
    fileTabs.resetTabs();
    setFileDirectories({});
    const runningProcessIds = terminalSessions
      .filter((session: TerminalSession) => session.status === "running")
      .map((session: TerminalSession) => session.processId);
    setTerminalSessions([]);
    for (const processId of runningProcessIds) {
      const session = terminalSessions.find((entry: TerminalSession) => entry.processId === processId);
      const params: Record<string, JsonValue> = { processId };
      if (session?.threadId) params.threadId = session.threadId;
      addWorkspaceRpcMetadata(params, session?.workspaceMode ?? "local", session?.sshCommand ?? "", session?.cwd ?? "", session?.providerId, session?.groupId);
      void client.rpc("command/exec/terminate", params).catch(() => undefined);
    }
  }, [client, terminalSessions]);

  const startRemoteBackgroundConversation = async () => {
    if (!state.token || remoteBackgroundStarting) return;
    setRemoteBackgroundStarting(true);
    try {
      const started = await startRemoteBackgroundThread(state.token, {
        command: sshCommand.trim(),
        cwd: normalizeSshWorkspaceCwd(sshCwd) || DEFAULT_SSH_WORKSPACE_CWD,
        ...(selectedModel ? { model: selectedModel } : {}),
        ...(activeProviderId ? { providerId: activeProviderId } : {}),
        ...(activeGroupId ? { groupId: activeGroupId } : {}),
        cliBackend: runtimeSelection.cliBackend ?? DEFAULT_CLI_BACKEND
      });
      await openExistingThread(started.threadId);
    } catch (error) {
      dispatch({ type: "error", message: formatErrorText(error) });
    } finally {
      setRemoteBackgroundStarting(false);
    }
  };
  return {
    createWorkspaceFolder,
    undoWaterfallFileChanges,
    workspaceFileMutations,
    closeRightWorkspace,
    startRemoteBackgroundConversation,
  };
}

export function useAgentReadinessOps(input: Pick<WorkbenchOpsInput, "state" | "dispatch" | "client" | "t" | "runtimeSelection" | "selectedModel" |
  "resolveComposerReasoningOptions" | "agentReadiness" | "setAgentReadiness" | "setAgentReadinessLoading" |
  "updateAgentRuntime" | "composerModels" | "runningThreadIds" | "activeThreadIdRef" | "activeProviderId" | "activeGroupId" | "reasoningEffort">) {
  const {
    state, dispatch, client, t, runtimeSelection, selectedModel, resolveComposerReasoningOptions, agentReadiness, setAgentReadiness, setAgentReadinessLoading, updateAgentRuntime, composerModels, runningThreadIds, activeThreadIdRef, activeProviderId, activeGroupId, reasoningEffort,
  } = input;
  const checkAgentReadiness = async (agents: ThreadRuntimeSelection["agents"] = runtimeSelection.agents) => {
    if (!state.token) return;
    setAgentReadinessLoading(true);
    try {
      const result = await fetchAgentReadiness(state.token, {
        agentMode: agents.mode,
        providerId: activeProviderId,
        groupId: activeGroupId,
        model: agents.model || selectedModel,
        reasoningEffort: agents.reasoningEffort || reasoningEffort,
        childCount: agents.childCount,
        roles: agents.roles,
        threadRunning: Boolean(state.activeThreadId && runningThreadIds.has(state.activeThreadId))
      });
      setAgentReadiness(result);
    } catch (error) {
      setAgentReadiness({ ready: false, code: "AGENTS_APP_SERVER_UNAVAILABLE", issues: [{ code: "AGENTS_APP_SERVER_UNAVAILABLE", message: error instanceof Error ? error.message : String(error) }], warnings: [], checks: {}, config: {}, catalog: {} });
    } finally {
      setAgentReadinessLoading(false);
    }
  };

  const applyRecommendedAgentRoster = () => {
    const definitions = [
      { id: "research", name: t("app.agentsPresetResearch"), responsibility: t("app.agentsPresetResearchDuty"), preferredEffort: "high" },
      { id: "implement", name: t("app.agentsPresetImplement"), responsibility: t("app.agentsPresetImplementDuty"), preferredEffort: "medium" },
      { id: "test", name: t("app.agentsPresetTest"), responsibility: t("app.agentsPresetTestDuty"), preferredEffort: "low" },
      { id: "review", name: t("app.agentsPresetReview"), responsibility: t("app.agentsPresetReviewDuty"), preferredEffort: "xhigh" }
    ];
    const roles = definitions.map((definition, index): AgentRosterRole => {
      const modelEntry = composerModels[index % Math.max(1, composerModels.length)];
      const model = modelEntry?.model ?? modelEntry?.id ?? selectedModel;
      const options = resolveComposerReasoningOptions(model);
      const effort = options.find((option) => option.value === definition.preferredEffort)?.value
        ?? options[Math.min(index, Math.max(0, options.length - 1))]?.value
        ?? "";
      return { ...definition, model, reasoningEffort: effort, enabled: true };
    });
    updateAgentRuntime({ roles, childCount: Math.max(runtimeSelection.agents.childCount ?? 0, roles.length) });
  };
  return {
    checkAgentReadiness,
    applyRecommendedAgentRoster,
  };
}

import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { threadReadToTurns, type ThreadEntry, type WorkbenchTurn } from "../../state/codexClient";
import { errorMessage } from "./appUtils";
import { isRunningTurnStatus } from "../transcripts/topicRuntimeIndex";
import { loadWorkspaceVmPolicy } from "../../utils/recentWorkspaces";
import { openTaskTab, type SplitViewState, type WorkspaceLayoutState } from "../../taskTabs";
import { orderWorkbenchTurns } from "../../state/workbenchTimeline";
import { resolveThreadWorkspace, validateSameThreadRollback } from "../threads/editConversation";
import type { TopicTranscriptStore } from "../transcripts/topicTranscriptStore";
import type { useTopicTranscriptRuntime } from "../transcripts/useTopicTranscriptRuntime";
import type { ThreadLoadProgress } from "../../components/ChatPanel";
import type { WorkspaceMode } from "./appConstants";
import type { ThreadRuntimeSelectionsDomain } from "../runtime/useThreadRuntimeSelections";
import type { ComposerCoreInput } from "./composerCoreContext";
import type { appReducer } from "../../app/appReducer";
import type { ClientState, CodexSocketClient } from "../../state/codexClient";
import type { TranslateFn } from "../../i18n";

type StartCodexTurnFn = (text: string, images: import("../../state/codexClient").ComposerImageAttachment[], mentions: import("../../state/codexClient").ComposerMention[], options?: import("./appConstants").StartCodexTurnOptions) => Promise<string | null>;

export function useTurnOps(input: {
  state: ClientState;
  dispatch: Dispatch<Parameters<typeof appReducer>[1]>;
  client: CodexSocketClient;
  t: TranslateFn;
  activeRunningTurn: WorkbenchTurn | null;
  activeThreadIdRef: MutableRefObject<string | null>;
  allHistoryThreadsRef: MutableRefObject<ClientState["threads"]>;
  cwdForThread: (threadId: string | null) => string;
  interruptTurn: (threadId: string, turnId: string) => Promise<void>;
  loadThreadIntoCache: (threadId: string, options?: { silent?: boolean }) => Promise<void>;
  localWorkspaceDefaultPath: string;
  modelCapacityRetryRef: MutableRefObject<Map<string, { attempt: number; max: number; timer: number | null; failedTurnId?: string; retryTurnId?: string; prompt?: string; exhausted: boolean; lastFailureTurnId?: string; lastError?: string; details?: string; errorTurnIds: Set<string> }>>;
  openExistingThread: (threadId: string) => Promise<void>;
  setClosedTaskTabIds: Dispatch<SetStateAction<string[]>>;
  setTaskTabOrder: Dispatch<SetStateAction<string[]>>;
  setSplitView: Dispatch<SetStateAction<SplitViewState | null>>;
  setWorkspaceLayout: Dispatch<SetStateAction<WorkspaceLayoutState | null>>;
  setCwd: Dispatch<SetStateAction<string>>;
  setWorkspaceMode: Dispatch<SetStateAction<WorkspaceMode>>;
  setWorkspaceFilePath: Dispatch<SetStateAction<string | null>>;
  setWorkspacePickerPath: Dispatch<SetStateAction<string>>;
  setWorkspaceSelectionPending: Dispatch<SetStateAction<boolean>>;
  setNewChatSetupOpen: Dispatch<SetStateAction<boolean>>;
  setNewChatBudgetLimit: Dispatch<SetStateAction<string>>;
  setThreadLoadProgress: Dispatch<SetStateAction<ThreadLoadProgress | null>>;
  setWelcomeDismissed: Dispatch<SetStateAction<boolean>>;
  splitMutationEpochRef: MutableRefObject<number>;
  sshCommand: string;
  workspaceMode: WorkspaceMode;
  startCodexTurn: StartCodexTurnFn;
  suppressThreadAutoNudge: (threadId: string | null | undefined) => void;
  threadSelectionEpochRef: MutableRefObject<number>;
  topicTranscriptStore: TopicTranscriptStore;
  transcriptRuntime: ReturnType<typeof useTopicTranscriptRuntime>;
  turnsByThreadIdRef: MutableRefObject<Map<string, WorkbenchTurn[]>>;
} & Pick<ThreadRuntimeSelectionsDomain, "historySelectionForThread" | "loadPersistedThreadRuntimeSelection" | "updateNewConversationRuntimeSelection">) {
  const {
    state, dispatch, client, t, activeRunningTurn, activeThreadIdRef, allHistoryThreadsRef,
    cwdForThread, interruptTurn, loadThreadIntoCache, localWorkspaceDefaultPath, modelCapacityRetryRef,
    openExistingThread, setClosedTaskTabIds, setTaskTabOrder, setSplitView, setWorkspaceLayout,
    setCwd, setWorkspaceMode, setWorkspaceFilePath, setWorkspacePickerPath, setWorkspaceSelectionPending,
    setNewChatSetupOpen, setNewChatBudgetLimit, setThreadLoadProgress, setWelcomeDismissed,
    splitMutationEpochRef, sshCommand, workspaceMode, startCodexTurn, suppressThreadAutoNudge,
    threadSelectionEpochRef, topicTranscriptStore, transcriptRuntime, turnsByThreadIdRef,
    historySelectionForThread, loadPersistedThreadRuntimeSelection, updateNewConversationRuntimeSelection,
  } = input;
  const stopActiveTurn = useCallback(async () => {
    if (!activeRunningTurn) {
      return;
    }
    // 显式停止即用户意图：抑制该线程后续 JEV 自动督促并清连败，
    // 在途旧 verdict 到达时不得复活本对话，更不得串到别的对话。
    suppressThreadAutoNudge(activeRunningTurn.threadId);
    try {
      const retryEntry = modelCapacityRetryRef.current.get(activeRunningTurn.threadId);
      if (retryEntry) {
        if (retryEntry.timer !== null) {
          window.clearTimeout(retryEntry.timer);
          retryEntry.timer = null;
        }
        retryEntry.exhausted = true;
      }
      await interruptTurn(activeRunningTurn.threadId, activeRunningTurn.id);
      const interruptedTurn = {
        ...activeRunningTurn,
        status: "interrupted",
        completedAt: Math.floor(Date.now() / 1000)
      };
      // Merge rather than replace. `replaceTurn`/`threadTurnReplaced` strip the
      // existing turn and re-add `activeRunningTurn`'s snapshot, whose `items`
      // are whatever the last render saw. Message deltas that stream in between
      // the click and the server's turn/interrupted confirmation are not in that
      // snapshot, so a replace silently drops them from the waterfall. Merging
      // keeps the live items and only patches the turn's status/completedAt.
      transcriptRuntime.mergeTurn(interruptedTurn);
      dispatch({ type: "threadTurnMerged", turn: interruptedTurn });
      void loadThreadIntoCache(activeRunningTurn.threadId, { silent: true });
    } catch (error) {
      dispatch({ type: "error", message: errorMessage("Stop turn", error) });
    }
  }, [activeRunningTurn, dispatch, interruptTurn, loadThreadIntoCache, transcriptRuntime]);

  const editLastUserMessage = useCallback(async (threadId: string, turnId: string, text: string) => {
    const normalizedText = text.trim();
    if (!normalizedText) throw new Error("Message cannot be empty");
    if (activeThreadIdRef.current !== threadId) throw new Error("Select this conversation before editing its last message");

    const threadTurns = (turnsByThreadIdRef.current.get(threadId) ?? topicTranscriptStore.getThreadTurns(threadId))
      .filter((turn: WorkbenchTurn) => turn.threadId === threadId);
    const orderedTurns = orderWorkbenchTurns(threadTurns);
    const turnIndex = orderedTurns.findIndex((turn: WorkbenchTurn) => turn.id === turnId);
    const targetTurn = turnIndex >= 0 ? orderedTurns[turnIndex] : undefined;
    if (!targetTurn) throw new Error("The message is no longer available");
    if (turnIndex !== orderedTurns.length - 1) throw new Error("Only the last message can be edited");
    if (isRunningTurnStatus(targetTurn.status)) throw new Error("Stop the active turn before editing a message");
    const userMessages = targetTurn.items.filter((item: import("../../state/codexClient").WorkbenchItem) => item.type === "userMessage");
    if (userMessages.length !== 1) throw new Error("A turn with multiple user messages cannot be edited safely");

    const sourceThread = allHistoryThreadsRef.current.find((thread: ThreadEntry) => thread.id === threadId)
      ?? state.threads.find((thread: ThreadEntry) => thread.id === threadId);
    if (sourceThread?.historyMode === "paginated") {
      throw new Error("This older conversation uses paginated history and cannot be edited in place by Codex 0.146.0. The original conversation was left unchanged.");
    }
    await loadPersistedThreadRuntimeSelection(threadId, historySelectionForThread(threadId));
    const rollbackResult = await client.rpc("thread/rollback", { threadId, numTurns: 1 });
    const rolledBack = threadReadToTurns(rollbackResult);
    validateSameThreadRollback(threadId, rolledBack.thread?.id);
    if (!rolledBack.thread) throw new Error("Codex did not return the rolled-back conversation");
    transcriptRuntime.replaceSnapshot(rolledBack.thread, rolledBack.turns);
    dispatch({ type: "threadSnapshotReplaced", thread: rolledBack.thread, turns: rolledBack.turns });
    const sourceWorkspace = resolveThreadWorkspace(sourceThread, {
      workspaceMode,
      sshCommand,
      localCwd: localWorkspaceDefaultPath,
      sshCwd: cwdForThread(threadId)
    });
    const sent = await startCodexTurn(normalizedText, [], [], {
      threadIdOverride: threadId,
      forceNewTurn: true,
      workspaceModeOverride: sourceWorkspace.workspaceMode,
      sshCommandOverride: sourceWorkspace.sshCommand
    });
    if (!sent) throw new Error("The edited message could not be sent");
  }, [client, cwdForThread, historySelectionForThread, loadPersistedThreadRuntimeSelection, localWorkspaceDefaultPath, sshCommand, startCodexTurn, state.threads, topicTranscriptStore, transcriptRuntime, workspaceMode]);
  return { stopActiveTurn, editLastUserMessage };
}

export function useSelectTaskTab(input: Omit<Parameters<typeof useTurnOps>[0], "activeRunningTurn" | "interruptTurn" | "startCodexTurn">) {
  const {
    state, dispatch, client, t, activeThreadIdRef, allHistoryThreadsRef, cwdForThread,
    loadThreadIntoCache, localWorkspaceDefaultPath, modelCapacityRetryRef, openExistingThread,
    setClosedTaskTabIds, setTaskTabOrder, setSplitView, setWorkspaceLayout, setCwd, setWorkspaceMode,
    setWorkspaceFilePath, setWorkspacePickerPath, setWorkspaceSelectionPending, setNewChatSetupOpen,
    setNewChatBudgetLimit, setThreadLoadProgress, setWelcomeDismissed, splitMutationEpochRef,
    sshCommand, workspaceMode, suppressThreadAutoNudge, threadSelectionEpochRef, topicTranscriptStore,
    transcriptRuntime, turnsByThreadIdRef, historySelectionForThread, loadPersistedThreadRuntimeSelection,
    updateNewConversationRuntimeSelection,
  } = input;
  const selectTaskTab = useCallback(
    (threadId: string | null) => {
      if (!threadId) {
        threadSelectionEpochRef.current += 1;
        splitMutationEpochRef.current += 1;
        setWorkspaceLayout(null);
        setSplitView(null);
        setThreadLoadProgress(null);
        activeThreadIdRef.current = null;
        setWorkspaceMode("local");
        setWorkspaceFilePath(null);
        setWorkspacePickerPath(localWorkspaceDefaultPath);
        setCwd(localWorkspaceDefaultPath);
        setWorkspaceSelectionPending(false);
        setNewChatSetupOpen(false);
        setNewChatBudgetLimit("");
        const savedVm = localWorkspaceDefaultPath ? loadWorkspaceVmPolicy(localWorkspaceDefaultPath) : null;
        updateNewConversationRuntimeSelection({
          vmEnabled: savedVm ? savedVm.vmEnabled : false,
          vmPolicy: savedVm ? savedVm.vmPolicy : undefined
        });
        setWelcomeDismissed(false);
        dispatch({ type: "newConversation" });
        return;
      }
      setWorkspaceSelectionPending(false);
      setClosedTaskTabIds((current: string[]) => current.filter((id: string) => id !== threadId));
      setTaskTabOrder((current: string[]) => openTaskTab(current, threadId));
      void openExistingThread(threadId);
    },
    [localWorkspaceDefaultPath, openExistingThread, updateNewConversationRuntimeSelection]
  );
  return { selectTaskTab };
}

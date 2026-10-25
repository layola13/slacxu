import { startTransition, useCallback, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { JsonValue } from "@codex-ui/shared";
import { threadReadToTurns, threadTurnsPageToTurns } from "../../state/codexClient";
import { asRecord, numberValue, syncWorkspaceFromThread } from "./appUtils";
import { filterHistoryThreads } from "../../historySearch";
import { loadAllThreads, mergeSuccessfulThreadList } from "../threads/threadCatalog";
import { SAFE_LEGACY_FULL_HISTORY_BYTES, SAFE_LEGACY_HISTORY_TAIL_BYTES, type ThreadHistoryPageState } from "../threads/threadHistoryService";
import type { HistoryLoadProgress } from "../../history/HistorySidebar";
import type { useTopicTranscriptRuntime } from "../transcripts/useTopicTranscriptRuntime";
import type { WorkspaceMode } from "./appConstants";
import type { appReducer } from "../../app/appReducer";
import type { ClientState, CodexSocketClient } from "../../state/codexClient";
import type { TranslateFn } from "../../i18n";

export function useLoadBasics(input: {
  state: ClientState;
  dispatch: Dispatch<Parameters<typeof appReducer>[1]>;
  client: CodexSocketClient;
  t: TranslateFn;
  detachedThreadId: string | null;
  detachedSnapshotHydratedRef: MutableRefObject<boolean>;
  detachedSnapshotReadyPromiseRef: MutableRefObject<Promise<void> | null>;
  codexCliEnabled: boolean;
  translateRef: MutableRefObject<TranslateFn>;
  activeThreadIdRef: MutableRefObject<string | null>;
  allHistoryThreadsRef: MutableRefObject<ClientState["threads"]>;
  historySearchTermRef: MutableRefObject<string>;
  historyFullyLoadedRef: MutableRefObject<boolean>;
  includeAutomationHistoryRef: MutableRefObject<boolean>;
  initialHistoryListStartedRef: MutableRefObject<boolean>;
  optimisticThreadIdsRef: MutableRefObject<Set<string>>;
  threadHistoryPagesRef: MutableRefObject<Record<string, ThreadHistoryPageState>>;
  transcriptRuntime: ReturnType<typeof useTopicTranscriptRuntime>;
  setHistoryLoading: Dispatch<SetStateAction<boolean>>;
  setHistoryLoadProgress: Dispatch<SetStateAction<HistoryLoadProgress | null>>;
  setThreadHistoryPages: Dispatch<SetStateAction<Record<string, ThreadHistoryPageState>>>;
  setAdditionalRoots: Dispatch<SetStateAction<string[]>>;
  setCwd: Dispatch<SetStateAction<string>>;
  setSshCommand: Dispatch<SetStateAction<string>>;
  setSshCwd: Dispatch<SetStateAction<string>>;
  setWorkspaceFilePath: Dispatch<SetStateAction<string | null>>;
  setWorkspaceMode: Dispatch<SetStateAction<WorkspaceMode>>;
  setWorkspaceSelectionPending: Dispatch<SetStateAction<boolean>>;
  setWelcomeDismissed: Dispatch<SetStateAction<boolean>>;
}) {
  const {
    state, dispatch, client, t, detachedThreadId, detachedSnapshotHydratedRef,
    detachedSnapshotReadyPromiseRef, codexCliEnabled, translateRef, activeThreadIdRef,
    allHistoryThreadsRef, historySearchTermRef, historyFullyLoadedRef, includeAutomationHistoryRef,
    initialHistoryListStartedRef, optimisticThreadIdsRef, threadHistoryPagesRef, transcriptRuntime,
    setHistoryLoading, setHistoryLoadProgress, setThreadHistoryPages, setAdditionalRoots, setCwd,
    setSshCommand, setSshCwd, setWorkspaceFilePath, setWorkspaceMode, setWorkspaceSelectionPending,
    setWelcomeDismissed,
  } = input;
  const loadBasicsInFlightRef = useRef<Promise<void> | null>(null);
  const loadBasics = useCallback((options: { forceHistoryRefresh?: boolean; preserveHistory?: boolean } = {}): Promise<void> => {
    const inFlight = loadBasicsInFlightRef.current;
    if (inFlight && options.preserveHistory) {
      // Provider/model changes only need runtime metadata. Never make a settings
      // action wait behind a potentially huge history refresh.
      // Mini is the default agent: skip Codex-only account/read when Codex CLI
      // is disabled (server also returns null as a backstop).
      const skipAccountRead = !codexCliEnabled;
      return Promise.all([
        skipAccountRead ? Promise.resolve(null) : client.rpc("account/read", { refreshToken: false }),
        client.rpc("model/list", {})
      ]).then(([account, modelResult]: [JsonValue, JsonValue]) => {
        if (account) dispatch({ type: "account", account });
        const models = asRecord(modelResult).data ?? asRecord(modelResult).models;
        dispatch({ type: "models", models: Array.isArray(models) ? models as ClientState["models"] : [] });
      });
    }
    if (inFlight) return inFlight;

    let shouldLoadDetachedThread = false;
    let shouldLoadHistory = false;
    const task = (async () => {
      await detachedSnapshotReadyPromiseRef.current;
      shouldLoadDetachedThread = Boolean(detachedThreadId) && (
        !detachedSnapshotHydratedRef.current ||
        options.forceHistoryRefresh ||
        !allHistoryThreadsRef.current.some((thread: ClientState["threads"][number]) => thread.id === detachedThreadId)
      );
      shouldLoadHistory = !options.preserveHistory && !detachedThreadId && (
        options.forceHistoryRefresh || !initialHistoryListStartedRef.current
      );
      if (shouldLoadHistory) initialHistoryListStartedRef.current = true;
      let listedPages = 0;
      if (shouldLoadHistory) {
        setHistoryLoading(true);
        setHistoryLoadProgress({ value: 6, label: translateRef.current("history.progressStarting") });
      }
      const [accountResult, modelListResult, historyResult] = await Promise.allSettled([
        (detachedThreadId || !codexCliEnabled) ? Promise.resolve(null) : client.rpc("account/read", { refreshToken: false }),
        detachedThreadId ? Promise.resolve(null) : client.rpc("model/list", {}),
        shouldLoadDetachedThread
          ? client.rpc("thread/read", { threadId: detachedThreadId!, includeTurns: false }).then(async (metadata: JsonValue) => {
              const parsed = threadReadToTurns(metadata);
              if (parsed.thread?.historyMode !== "paginated") {
                const needsLocalCodexHistoryFile = parsed.thread?.cliBackend !== "claude"
                  && parsed.thread?.cliBackend !== "pi"
                  && parsed.thread?.workspaceMode !== "ssh"
                  && parsed.thread?.remoteExecutionMode !== "autonomous";
                if (needsLocalCodexHistoryFile && parsed.thread?.path) {
                  const info = asRecord(await client.rpc("thread/history/fileInfo", { threadId: detachedThreadId! }));
                  const sizeBytes = numberValue(info.sizeBytes) ?? 0;
                  if (sizeBytes > SAFE_LEGACY_FULL_HISTORY_BYTES) {
                    return client.rpc("thread/history/tail", { threadId: detachedThreadId!, maxBytes: SAFE_LEGACY_HISTORY_TAIL_BYTES });
                  }
                }
                return client.rpc("thread/read", { threadId: detachedThreadId!, includeTurns: true });
              }
              const page = await client.rpc("thread/turns/list", { threadId: detachedThreadId!, cursor: null, limit: 32, sortDirection: "desc", itemsView: "full" });
              return { metadata, page };
            })
          : shouldLoadHistory
          ? loadAllThreads(client, {
              includeAutomationHistory: includeAutomationHistoryRef.current,
              firstPageOnly: true,  // Initial load: only first page for fast startup
              cliBackend: codexCliEnabled ? "codex" : "mini",  // Non-default backend history stays lazy until its tab opens
              onProgress: () => {
                listedPages += 1;
                setHistoryLoadProgress({ value: Math.min(72, 18 + listedPages * 6), label: translateRef.current("history.progressListing") });
              }
            })
          : Promise.resolve(null)
      ]);
      const failures: unknown[] = [];
      if (accountResult.status === "fulfilled") {
        if (accountResult.value) dispatch({ type: "account", account: accountResult.value });
      } else {
        failures.push(accountResult.reason);
      }
      if (modelListResult.status === "fulfilled") {
        if (modelListResult.value) {
          const models = asRecord(modelListResult.value).data ?? asRecord(modelListResult.value).models;
          dispatch({ type: "models", models: Array.isArray(models) ? (models as ClientState["models"]) : [] });
        }
      } else {
        failures.push(modelListResult.reason);
      }
      const threadResult = historyResult.status === "fulfilled" ? historyResult.value : null;
      if (historyResult.status === "rejected") {
        if (shouldLoadHistory) initialHistoryListStartedRef.current = false;
        failures.push(historyResult.reason);
      }
      if (detachedThreadId) {
        if (threadResult && !Array.isArray(threadResult)) {
          const detachedResult = threadResult as unknown as { metadata?: JsonValue; page?: JsonValue };
          const metadata = threadReadToTurns(detachedResult.metadata ?? threadResult as JsonValue);
          const page = detachedResult.page ? threadTurnsPageToTurns(detachedThreadId, detachedResult.page, "desc") : { turns: metadata.turns, nextCursor: null };
          const loaded = { thread: metadata.thread, turns: page.turns };
          const pageState = { nextCursor: page.nextCursor, loading: false, paginated: Boolean(detachedResult.page) };
          threadHistoryPagesRef.current = { ...threadHistoryPagesRef.current, [detachedThreadId]: pageState };
          setThreadHistoryPages((current: Record<string, ThreadHistoryPageState>) => ({ ...current, [detachedThreadId]: pageState }));
          if (loaded.thread) {
            transcriptRuntime.mergeSnapshot(loaded.thread, loaded.turns);
            activeThreadIdRef.current = detachedThreadId;
            allHistoryThreadsRef.current = [loaded.thread];
        syncWorkspaceFromThread(loaded.thread, setCwd, setWorkspaceSelectionPending, setWorkspaceMode, setSshCommand, setSshCwd, setAdditionalRoots, setWorkspaceFilePath);
            setWelcomeDismissed(false);
            startTransition(() => {
              dispatch({ type: "threadLoaded", thread: loaded.thread, turns: loaded.turns });
            });
            void client.rpc("model/list", {}).then((result: JsonValue) => {
              const models = asRecord(result).data ?? asRecord(result).models;
              if (Array.isArray(models)) {
                dispatch({ type: "models", models: models as ClientState["models"] });
              }
            }).catch(() => undefined);
          }
        }
      } else if (shouldLoadHistory) {
        const reconciledThreads = mergeSuccessfulThreadList(threadResult, allHistoryThreadsRef.current, optimisticThreadIdsRef.current);
        if (!reconciledThreads) {
          if (failures.length > 0) throw failures[0];
          return;
        }
        setHistoryLoadProgress({ value: 84, label: translateRef.current("history.progressMerging") });
        allHistoryThreadsRef.current = reconciledThreads;
        // Initial load only loads first page, not fully loaded
        historyFullyLoadedRef.current = false;
        const searchTerm = historySearchTermRef.current;
        dispatch({ type: "threads", threads: searchTerm.trim() ? filterHistoryThreads(reconciledThreads, searchTerm) : reconciledThreads });
        setHistoryLoadProgress({ value: 100, label: translateRef.current("history.progressDone") });
        setHistoryLoading(false);
        window.setTimeout(() => {
          setHistoryLoadProgress(null);
        }, 320);
      }
      if (failures.length > 0) throw failures[0];
    })();
    const tracked = task.finally(() => {
      if (loadBasicsInFlightRef.current === tracked) {
        loadBasicsInFlightRef.current = null;
        if (shouldLoadHistory) {
          setHistoryLoading(false);
          window.setTimeout(() => setHistoryLoadProgress(null), 320);
        }
      }
    });
    loadBasicsInFlightRef.current = tracked;
    return tracked;
  }, [client, codexCliEnabled, detachedThreadId, transcriptRuntime.mergeSnapshot]);
  return { loadBasics };
}

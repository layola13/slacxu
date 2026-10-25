import { useCallback, useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { SplitViewState, WorkspaceLayoutState } from "../../taskTabs";
import { useLazyCliBackendHistory } from "../cli/useLazyCliBackendHistory";
import type { HistoryBackendFilter } from "../../history/HistorySidebar";
import type { CliBackend } from "@codex-ui/shared";
import { loadAllThreads, loadHistoryThreadById, mergeListedThreadsWithOptimistic, mergeThreadLists, renameThreadAcrossCatalogs } from "../threads/threadCatalog";
import { extractThreadIdSearch, filterHistoryThreads } from "../../historySearch";
import { errorMessage } from "./appUtils";
import type { ThreadEntry } from "../../state/codexClient";
import type { appReducer } from "../../app/appReducer";
import type { ClientState, CodexSocketClient } from "../../state/codexClient";
import type { TranslateFn } from "../../i18n";

export function useThreadsHistory(input: {
  state: ClientState;
  dispatch: Dispatch<Parameters<typeof appReducer>[1]>;
  client: CodexSocketClient;
  t: TranslateFn;
  historySearchTermRef: MutableRefObject<string>;
  historyLoadRequestRef: MutableRefObject<number>;
  historyFullyLoadedRef: MutableRefObject<boolean>;
  allHistoryThreadsRef: MutableRefObject<ClientState["threads"]>;
  includeAutomationHistoryRef: MutableRefObject<boolean>;
  historyLoading: boolean;
  historyBackendFilter: HistoryBackendFilter;
  setHistoryLoading: Dispatch<SetStateAction<boolean>>;
  setHistoryLoadProgress: Dispatch<SetStateAction<{ value: number; label: string } | null>>;
  setSplitView: Dispatch<SetStateAction<SplitViewState | null>>;
  setWorkspaceLayout: Dispatch<SetStateAction<WorkspaceLayoutState | null>>;
  setWelcomeDismissed: Dispatch<SetStateAction<boolean>>;
  discardThreadGoal: (threadId: string) => void;
  optimisticThreadIdsRef: MutableRefObject<Set<string>>;
  splitMutationEpochRef: MutableRefObject<number>;
}) {
  const {
    state,
    dispatch,
    client,
    t,
    historySearchTermRef,
    historyLoadRequestRef,
    historyFullyLoadedRef,
    allHistoryThreadsRef,
    includeAutomationHistoryRef,
    historyLoading,
    historyBackendFilter,
    setHistoryLoading,
    setHistoryLoadProgress,
    setSplitView,
    setWorkspaceLayout,
    setWelcomeDismissed,
    discardThreadGoal,
    optimisticThreadIdsRef,
    splitMutationEpochRef,
  } = input;
  const {
    claudeHistoryLoadedRef,
    agyHistoryLoadedRef,
    grokHistoryLoadedRef,
    museHistoryLoadedRef,
    piHistoryLoadedRef,
    opencodeHistoryLoadedRef,
    opencodeV2HistoryLoadedRef,
    miniHistoryLoadedRef,
    markHistoryBackendLoaded,
  } = useLazyCliBackendHistory();
  const loadHistory = useCallback(
    async (searchTerm: string = historySearchTermRef.current, options: { cliBackend?: HistoryBackendFilter } = {}) => {
      const requestId = ++historyLoadRequestRef.current;
      let listedPages = 0;
      const setProgress = (value: number, label: string) => {
        if (requestId === historyLoadRequestRef.current) {
          setHistoryLoadProgress({ value, label });
        }
      };
      setHistoryLoading(true);
      setProgress(6, t("history.progressStarting"));
      try {
        const trimmedSearch = searchTerm.trim();
        const cachedThreads = allHistoryThreadsRef.current;
        const incAuto = includeAutomationHistoryRef.current;
        const directThreadId = extractThreadIdSearch(trimmedSearch);
        const onListPage = () => {
          listedPages += 1;
          setProgress(Math.min(72, 18 + listedPages * 6), t("history.progressListing"));
        };
        // This callback is wired only to explicit refresh controls. One manual
        // action owns one complete paginated listing operation.
        // When searching, load all pages to ensure search results are complete.
        // When no search term, load only first page for faster initial load.
        // A lazy backend scope loads just that backend; its results merge into
        // whatever other backends already have instead of replacing them.
        const [loadedThreads, directThread] = await Promise.all([
          loadAllThreads(client, {
            includeAutomationHistory: incAuto,
            onProgress: onListPage,
            firstPageOnly: !trimmedSearch,
            searchTerm: trimmedSearch,
            ...(options.cliBackend ? { cliBackend: options.cliBackend } : {})
          }),
          directThreadId ? loadHistoryThreadById(client, directThreadId) : Promise.resolve<ClientState["threads"][number] | null>(null)
        ]);
        if (requestId !== historyLoadRequestRef.current) return;
        const allThreads = options.cliBackend ? mergeThreadLists(cachedThreads, loadedThreads) : loadedThreads;
        setProgress(84, t("history.progressMerging"));
        // Mark as fully loaded if we loaded with search term (all pages).
        // A backend-scoped load only covers one tab, never the whole history.
        if (trimmedSearch && !options.cliBackend) {
          historyFullyLoadedRef.current = true;
        }
        if (options.cliBackend) {
          markHistoryBackendLoaded(options.cliBackend);
        }
        if (!trimmedSearch) {
          const reconciledThreads = mergeListedThreadsWithOptimistic(allThreads, allHistoryThreadsRef.current, optimisticThreadIdsRef.current);
          allHistoryThreadsRef.current = reconciledThreads;
          dispatch({ type: "threads", threads: reconciledThreads });
          return;
        }
        const directThreads = directThread ? [directThread] : [];
        allHistoryThreadsRef.current = mergeListedThreadsWithOptimistic(
          mergeThreadLists(allThreads, directThreads),
          allHistoryThreadsRef.current,
          optimisticThreadIdsRef.current
        );
        dispatch({
          type: "threads",
          threads: mergeThreadLists(
            directThreads,
            filterHistoryThreads(allHistoryThreadsRef.current, trimmedSearch),
            allHistoryThreadsRef.current.filter((thread: ClientState["threads"][number]) => optimisticThreadIdsRef.current.has(thread.id))
          )
        });
      } finally {
        if (requestId === historyLoadRequestRef.current) {
          setHistoryLoadProgress({ value: 100, label: t("history.progressDone") });
          setHistoryLoading(false);
          window.setTimeout(() => {
            if (requestId === historyLoadRequestRef.current) {
              setHistoryLoadProgress(null);
            }
          }, 320);
        }
      }
    },
    [client, t]
  );

  // Lazy Claude history: the first time the sidebar's Claude tab becomes
  // active — by user toggle or because the active thread is a Claude thread —
  // fetch the Claude-only listing once and merge it into the catalog. Startup
  // never pays for it. The request must wait for an open socket and a settled
  // history load: firing earlier makes client.rpc reject with "WebSocket is
  // not connected" (the persisted runtime selection can restore the Claude
  // backend before the first connect) and races the initial listing's
  // progress bookkeeping. The loaded flag is set by loadHistory only on
  // success, so a failed attempt retries here instead of leaving the Claude
  // tab permanently empty.
  const claudeHistoryInFlightRef = useRef(false);
  const claudeHistoryLastAttemptAtRef = useRef(0);
  useEffect(() => {
    if (historyBackendFilter !== "claude" || claudeHistoryLoadedRef.current) return;
    if (!state.connected || historyLoading || claudeHistoryInFlightRef.current) return;
    const attempt = () => {
      if (claudeHistoryLoadedRef.current || claudeHistoryInFlightRef.current) return;
      claudeHistoryLastAttemptAtRef.current = Date.now();
      claudeHistoryInFlightRef.current = true;
      void loadHistory(historySearchTermRef.current, { cliBackend: "claude" })
        .catch((error: unknown) => console.warn("[history] Claude listing failed", error))
        .finally(() => {
          claudeHistoryInFlightRef.current = false;
        });
    };
    const sinceLastAttempt = Date.now() - claudeHistoryLastAttemptAtRef.current;
    if (sinceLastAttempt < 5000) {
      const timer = window.setTimeout(attempt, 5000 - sinceLastAttempt);
      return () => window.clearTimeout(timer);
    }
    attempt();
    return undefined;
  }, [historyBackendFilter, historyLoading, state.connected, loadHistory]);

  const agyHistoryInFlightRef = useRef(false);
  const agyHistoryLastAttemptAtRef = useRef(0);
  useEffect(() => {
    if (historyBackendFilter !== "agy" || agyHistoryLoadedRef.current) return;
    if (!state.connected || historyLoading || agyHistoryInFlightRef.current) return;
    const attempt = () => {
      if (agyHistoryLoadedRef.current || agyHistoryInFlightRef.current) return;
      agyHistoryLastAttemptAtRef.current = Date.now();
      agyHistoryInFlightRef.current = true;
      void loadHistory(historySearchTermRef.current, { cliBackend: "agy" })
        .catch((error: unknown) => console.warn("[history] AGY listing failed", error))
        .finally(() => {
          agyHistoryInFlightRef.current = false;
        });
    };
    const sinceLastAttempt = Date.now() - agyHistoryLastAttemptAtRef.current;
    if (sinceLastAttempt < 5000) {
      const timer = window.setTimeout(attempt, 5000 - sinceLastAttempt);
      return () => window.clearTimeout(timer);
    }
    attempt();
    return undefined;
  }, [historyBackendFilter, historyLoading, state.connected, loadHistory]);

  const grokHistoryInFlightRef = useRef(false);
  const grokHistoryLastAttemptAtRef = useRef(0);
  useEffect(() => {
    if (historyBackendFilter !== "grok" || grokHistoryLoadedRef.current) return;
    if (!state.connected || historyLoading || grokHistoryInFlightRef.current) return;
    const attempt = () => {
      if (grokHistoryLoadedRef.current || grokHistoryInFlightRef.current) return;
      grokHistoryLastAttemptAtRef.current = Date.now();
      grokHistoryInFlightRef.current = true;
      void loadHistory(historySearchTermRef.current, { cliBackend: "grok" })
        .catch((error: unknown) => console.warn("[history] Grok listing failed", error))
        .finally(() => {
          grokHistoryInFlightRef.current = false;
        });
    };
    const sinceLastAttempt = Date.now() - grokHistoryLastAttemptAtRef.current;
    if (sinceLastAttempt < 5000) {
      const timer = window.setTimeout(attempt, 5000 - sinceLastAttempt);
      return () => window.clearTimeout(timer);
    }
    attempt();
    return undefined;
  }, [historyBackendFilter, historyLoading, state.connected, loadHistory]);

  const museHistoryInFlightRef = useRef(false);
  const museHistoryLastAttemptAtRef = useRef(0);
  useEffect(() => {
    if (historyBackendFilter !== "muse" || museHistoryLoadedRef.current) return;
    if (!state.connected || historyLoading || museHistoryInFlightRef.current) return;
    const attempt = () => {
      if (museHistoryLoadedRef.current || museHistoryInFlightRef.current) return;
      museHistoryLastAttemptAtRef.current = Date.now();
      museHistoryInFlightRef.current = true;
      void loadHistory(historySearchTermRef.current, { cliBackend: "muse" })
        .catch((error: unknown) => console.warn("[history] Muse listing failed", error))
        .finally(() => {
          museHistoryInFlightRef.current = false;
        });
    };
    const sinceLastAttempt = Date.now() - museHistoryLastAttemptAtRef.current;
    if (sinceLastAttempt < 5000) {
      const timer = window.setTimeout(attempt, 5000 - sinceLastAttempt);
      return () => window.clearTimeout(timer);
    }
    attempt();
    return undefined;
  }, [historyBackendFilter, historyLoading, state.connected, loadHistory]);

  const piHistoryInFlightRef = useRef(false);
  const piHistoryLastAttemptAtRef = useRef(0);
  useEffect(() => {
    if (historyBackendFilter !== "pi" || piHistoryLoadedRef.current) return;
    if (!state.connected || historyLoading || piHistoryInFlightRef.current) return;
    const attempt = () => {
      if (piHistoryLoadedRef.current || piHistoryInFlightRef.current) return;
      piHistoryLastAttemptAtRef.current = Date.now();
      piHistoryInFlightRef.current = true;
      void loadHistory(historySearchTermRef.current, { cliBackend: "pi" })
        .catch((error: unknown) => console.warn("[history] Pi listing failed", error))
        .finally(() => {
          piHistoryInFlightRef.current = false;
        });
    };
    const sinceLastAttempt = Date.now() - piHistoryLastAttemptAtRef.current;
    if (sinceLastAttempt < 5000) {
      const timer = window.setTimeout(attempt, 5000 - sinceLastAttempt);
      return () => window.clearTimeout(timer);
    }
    attempt();
    return undefined;
  }, [historyBackendFilter, historyLoading, state.connected, loadHistory]);

  const opencodeHistoryInFlightRef = useRef(false);
  const opencodeHistoryLastAttemptAtRef = useRef(0);
  useEffect(() => {
    if (historyBackendFilter !== "opencode" || opencodeHistoryLoadedRef.current) return;
    if (!state.connected || historyLoading || opencodeHistoryInFlightRef.current) return;
    const attempt = () => {
      if (opencodeHistoryLoadedRef.current || opencodeHistoryInFlightRef.current) return;
      opencodeHistoryLastAttemptAtRef.current = Date.now();
      opencodeHistoryInFlightRef.current = true;
      void loadHistory(historySearchTermRef.current, { cliBackend: "opencode" })
        .catch((error: unknown) => console.warn("[history] OpenCode listing failed", error))
        .finally(() => {
          opencodeHistoryInFlightRef.current = false;
        });
    };
    const sinceLastAttempt = Date.now() - opencodeHistoryLastAttemptAtRef.current;
    if (sinceLastAttempt < 5000) {
      const timer = window.setTimeout(attempt, 5000 - sinceLastAttempt);
      return () => window.clearTimeout(timer);
    }
    attempt();
    return undefined;
  }, [historyBackendFilter, historyLoading, state.connected, loadHistory]);

  const opencodeV2HistoryInFlightRef = useRef(false);
  const opencodeV2HistoryLastAttemptAtRef = useRef(0);
  useEffect(() => {
    if (historyBackendFilter !== "opencode-v2" || opencodeV2HistoryLoadedRef.current) return;
    if (!state.connected || historyLoading || opencodeV2HistoryInFlightRef.current) return;
    const attempt = () => {
      if (opencodeV2HistoryLoadedRef.current || opencodeV2HistoryInFlightRef.current) return;
      opencodeV2HistoryLastAttemptAtRef.current = Date.now();
      opencodeV2HistoryInFlightRef.current = true;
      void loadHistory(historySearchTermRef.current, { cliBackend: "opencode-v2" })
        .catch((error: unknown) => console.warn("[history] OpenCode v2 listing failed", error))
        .finally(() => {
          opencodeV2HistoryInFlightRef.current = false;
        });
    };
    const sinceLastAttempt = Date.now() - opencodeV2HistoryLastAttemptAtRef.current;
    if (sinceLastAttempt < 5000) {
      const timer = window.setTimeout(attempt, 5000 - sinceLastAttempt);
      return () => window.clearTimeout(timer);
    }
    attempt();
    return undefined;
  }, [historyBackendFilter, historyLoading, state.connected, loadHistory]);

  const miniHistoryInFlightRef = useRef(false);
  const miniHistoryLastAttemptAtRef = useRef(0);
  useEffect(() => {
    if (historyBackendFilter !== "mini" || miniHistoryLoadedRef.current) return;
    if (!state.connected || historyLoading || miniHistoryInFlightRef.current) return;
    const attempt = () => {
      if (miniHistoryLoadedRef.current || miniHistoryInFlightRef.current) return;
      miniHistoryLastAttemptAtRef.current = Date.now();
      miniHistoryInFlightRef.current = true;
      void loadHistory(historySearchTermRef.current, { cliBackend: "mini" })
        .catch((error: unknown) => console.warn("[history] Mini listing failed", error))
        .finally(() => {
          miniHistoryInFlightRef.current = false;
        });
    };
    const sinceLastAttempt = Date.now() - miniHistoryLastAttemptAtRef.current;
    if (sinceLastAttempt < 5000) {
      const timer = window.setTimeout(attempt, 5000 - sinceLastAttempt);
      return () => window.clearTimeout(timer);
    }
    attempt();
    return undefined;
  }, [historyBackendFilter, historyLoading, state.connected, loadHistory]);

  const applyHistoryThreads = useCallback((threads: ClientState["threads"]) => {
    allHistoryThreadsRef.current = threads;
    const searchTerm = historySearchTermRef.current;
    dispatch({ type: "threads", threads: searchTerm.trim() ? filterHistoryThreads(threads, searchTerm) : threads });
  }, []);

  const renameCliBackendFor = useCallback(
    (threadId: string): CliBackend | undefined => {
      const existing = [...allHistoryThreadsRef.current, ...state.threads].find((thread: ClientState["threads"][number]) => thread.id === threadId);
      return existing?.cliBackend;
    },
    [state.threads]
  );

  const renameHistoryThread = useCallback(
    async (threadId: string, name: string) => {
      const normalized = name.trim();
      if (!normalized) {
        return;
      }
      try {
        await client.rpc("thread/name/set", { threadId, name: normalized });
        applyHistoryThreads(renameThreadAcrossCatalogs(allHistoryThreadsRef.current, state.threads, threadId, normalized, renameCliBackendFor(threadId)));
      } catch (error) {
        dispatch({ type: "error", message: errorMessage("Rename history thread", error) });
        throw error;
      }
    },
    [applyHistoryThreads, client, renameCliBackendFor, state.threads]
  );

  const archiveHistoryThread = useCallback(
    async (threadId: string) => {
      try {
        await client.rpc("thread/archive", { threadId });
        applyHistoryThreads(allHistoryThreadsRef.current.filter((thread: ThreadEntry) => thread.id !== threadId));
        if (state.activeThreadId === threadId) {
          splitMutationEpochRef.current += 1;
          setWorkspaceLayout(null);
          setSplitView(null);
          setWelcomeDismissed(false);
          dispatch({ type: "newConversation" });
        }
      } catch (error) {
        dispatch({ type: "error", message: errorMessage("Archive history thread", error) });
        throw error;
      }
    },
    [applyHistoryThreads, client, state.activeThreadId]
  );

  const deleteHistoryThread = useCallback(
    async (threadId: string) => {
      try {
        await client.rpc("thread/delete", { threadId });
        applyHistoryThreads(allHistoryThreadsRef.current.filter((thread: ThreadEntry) => thread.id !== threadId));
        discardThreadGoal(threadId);
        if (state.activeThreadId === threadId) {
          splitMutationEpochRef.current += 1;
          setWorkspaceLayout(null);
          setSplitView(null);
          setWelcomeDismissed(false);
          dispatch({ type: "newConversation" });
        }
      } catch (error) {
        dispatch({ type: "error", message: errorMessage("Delete history thread", error) });
        throw error;
      }
    },
    [applyHistoryThreads, client, discardThreadGoal, state.activeThreadId]
  );

  return {
    renameCliBackendFor,
    loadHistory,
    applyHistoryThreads,
    renameHistoryThread,
    archiveHistoryThread,
    deleteHistoryThread,
    markHistoryBackendLoaded,
    claudeHistoryLoadedRef,
    agyHistoryLoadedRef,
    grokHistoryLoadedRef,
    museHistoryLoadedRef,
    piHistoryLoadedRef,
    opencodeHistoryLoadedRef,
    opencodeV2HistoryLoadedRef,
    miniHistoryLoadedRef,
  };
}

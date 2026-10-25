import { useRef, useState } from "react";
import type { ClientState } from "../../state/codexClient";
import type { ThreadHistoryPageState } from "../../app/threads/threadHistoryService";
import type { HistoryBackendFilter, HistoryDateRangeFilter, HistoryLoadProgress, HistoryViewMode } from "../../history/HistorySidebar";
import { readHistoryDateRange, readLegacyHistoryViewMode } from "./preferenceUtils";
import type { ThreadLoadProgress } from "../../components/ChatPanel";

export function useHistoryState() {
  const [historySearchTerm, setHistorySearchTerm] = useState("");
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyLoadProgress, setHistoryLoadProgress] = useState<HistoryLoadProgress | null>(null);
  const [historyDateRange, setHistoryDateRange] = useState<HistoryDateRangeFilter>(() => readHistoryDateRange());
  const [historyViewMode, setHistoryViewMode] = useState<HistoryViewMode>(() => readLegacyHistoryViewMode());
  const [historyBackendFilter, setHistoryBackendFilter] = useState<HistoryBackendFilter>("mini");
  const historyBackendFilterUserTouchedRef = useRef(false);
  const [threadHistoryPages, setThreadHistoryPages] = useState<Record<string, ThreadHistoryPageState>>({});
  const allHistoryThreadsRef = useRef<ClientState["threads"]>([]);
  const historySearchTermRef = useRef(historySearchTerm);
  const historyLoadRequestRef = useRef(0);
  const historyFullyLoadedRef = useRef(false);  // Track if we've loaded all history pages
  const initialHistoryListStartedRef = useRef(false);
  const threadHistoryPagesRef = useRef<Record<string, ThreadHistoryPageState>>({});
  const [threadLoadProgress, setThreadLoadProgress] = useState<ThreadLoadProgress | null>(null);
  return {
    threadLoadProgress,
    setThreadLoadProgress,
    historySearchTerm,
    setHistorySearchTerm,
    historyLoading,
    setHistoryLoading,
    historyLoadProgress,
    setHistoryLoadProgress,
    historyDateRange,
    setHistoryDateRange,
    historyViewMode,
    setHistoryViewMode,
    historyBackendFilter,
    setHistoryBackendFilter,
    historyBackendFilterUserTouchedRef,
    threadHistoryPages,
    setThreadHistoryPages,
    allHistoryThreadsRef,
    historySearchTermRef,
    historyLoadRequestRef,
    historyFullyLoadedRef,
    initialHistoryListStartedRef,
    threadHistoryPagesRef,
  };
}

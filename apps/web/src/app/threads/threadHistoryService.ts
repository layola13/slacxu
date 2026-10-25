import type { JsonValue } from "@codex-ui/shared";
import { threadReadToTurns, threadTurnsPageToTurns } from "../../state/codexClient";

export const SAFE_LEGACY_FULL_HISTORY_BYTES = 4 * 1024 ** 2;
export const SAFE_LEGACY_HISTORY_TAIL_BYTES = 10 * 1024 ** 2;
export const FAST_INITIAL_TAIL_BYTES = 4 * 1024 ** 2;
export const FAST_INITIAL_TURN_LIMIT = 20;
export const LARGE_HISTORY_REFUSE_FULL_READ_BYTES = 1024 ** 3;

export interface ThreadHistoryPageState {
  nextCursor: string | null;
  loading: boolean;
  paginated: boolean;
}

export interface ThreadHistoryLoadOptions {
  preserveRunningTurnIds?: ReadonlySet<string>;
  /** 真实阶段回调 (替代定时器假进度): 只在真实步骤完成时推进, 保证进度条正确。 */
  onStage?: (pct: number, label: string) => void;
}

export interface ThreadHistoryRpc {
  rpc(method: string, params?: Record<string, JsonValue>): Promise<JsonValue>;
}

export type LoadedThreadHistory = ReturnType<typeof threadReadToTurns>;

// History opens previously awaited RPCs with no timeout: when the backend
// SQLite projection stalls (WAL lock / giant part payload blocking the Bun
// event loop) the UI stuck forever at 52% "Loading transcript". Reads below
// are bounded so a stall fails fast with a retryable error and the progress
// placeholder can never hang. The initial metadata read keeps a bounded
// timeout (fast restore must stay interactive even on giant histories;
// use explicit "load full history" for the complete transcript).
export const THREAD_HISTORY_RPC_TIMEOUT_MS = {
  metadata: 8_000,
  fileInfo: 10_000,
  tail: 20_000,
  fullRead: 30_000,
  page: 20_000,
} as const;

function rpcWithTimeout(
  client: ThreadHistoryRpc,
  method: string,
  params: Record<string, JsonValue>,
  timeoutMs: number,
): Promise<JsonValue> {
  let timer: ReturnType<typeof globalThis.setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = globalThis.setTimeout(() => {
      reject(new Error(`${method} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  return Promise.race([client.rpc(method, params), timeout]).finally(() => {
    if (timer !== undefined) globalThis.clearTimeout(timer);
  });
}

export interface InitialThreadHistoryResult {
  loaded: LoadedThreadHistory;
  pageState: ThreadHistoryPageState;
  /** True when only metadata (or an empty tail) could be shown. Must NOT be cached as a complete transcript. */
  incomplete?: boolean;
  notice?: string;
}

export async function loadInitialThreadHistory(
  client: ThreadHistoryRpc,
  threadId: string,
  options: ThreadHistoryLoadOptions = {},
): Promise<InitialThreadHistoryResult> {
  const stage = options.onStage;
  const metadataResult = await readThreadMetadataWhenReady(client, threadId);
  stage?.(35, "Reading stored transcript");
  const metadata = threadReadToTurns(metadataResult);
  if (metadata.thread?.historyMode !== "paginated") {
    // Claude and SSH-backed threads do not own a local Codex rollout file. Their
    // history must stay on the selected runtime bridge instead of probing a
    // Codex session path that may not exist on either machine.
    const needsLocalCodexHistoryFile = metadata.thread?.cliBackend !== "claude"
      && metadata.thread?.cliBackend !== "agy"
      && metadata.thread?.workspaceMode !== "ssh"
      && metadata.thread?.remoteExecutionMode !== "autonomous";
    if (needsLocalCodexHistoryFile && metadata.thread?.path) {
      let knownSizeBytes: number | undefined;
      try {
        const fileInfo = record(await rpcWithTimeout(client, "thread/history/fileInfo", { threadId }, THREAD_HISTORY_RPC_TIMEOUT_MS.fileInfo));
        stage?.(45, "Reading stored transcript");
        const sizeBytes = finiteNumber(fileInfo.sizeBytes) ?? 0;
        knownSizeBytes = sizeBytes;
        if (sizeBytes > SAFE_LEGACY_FULL_HISTORY_BYTES) {
          try {
            const tailResult = await rpcWithTimeout(client, "thread/history/tail", { threadId, maxBytes: FAST_INITIAL_TAIL_BYTES }, THREAD_HISTORY_RPC_TIMEOUT_MS.tail);
            stage?.(70, "Decoding history");
            const tailed = normalizeHistoricalRunningTurns(threadReadToTurns(tailResult), options);
            stage?.(85, "Decoding history");
            if (tailed.turns.length > 0) {
              return { loaded: tailed, pageState: nonPaginatedPageState() };
            }
            // A bounded tail can parse successfully yet contain zero turns
            // (e.g. the window lands inside a giant single-line tool output).
            // Never cache that as a complete empty conversation. A bounded full
            // read is only safe below the refuse gate: at 1GB+ the full read
            // itself is the hazard the gate exists for, so skip straight to
            // the explicit incomplete result and let the next open retry.
            if (sizeBytes < LARGE_HISTORY_REFUSE_FULL_READ_BYTES) {
              console.warn("[thread history] tail parsed zero turns; trying bounded full read");
              try {
                const fullResult = await rpcWithTimeout(client, "thread/read", { threadId, includeTurns: true }, THREAD_HISTORY_RPC_TIMEOUT_MS.fullRead);
                stage?.(70, "Decoding history");
                const fullLoaded = normalizeHistoricalRunningTurns(threadReadToTurns(fullResult), options);
                stage?.(85, "Decoding history");
                if (fullLoaded.turns.length > 0) {
                  return { loaded: fullLoaded, pageState: nonPaginatedPageState() };
                }
              } catch (fullError) {
                if (/timed out after/i.test(errorText(fullError))) throw fullError;
                console.warn("[thread history] bounded full read after empty tail failed", errorText(fullError));
              }
            } else {
              console.warn("[thread history] tail parsed zero turns on a 1GB+ history; skipping full read");
            }
            return {
              loaded: { thread: metadata.thread, turns: [] },
              pageState: nonPaginatedPageState(),
              incomplete: true,
              notice: "历史只恢复了基本信息（最近片段无有效消息），可重试或使用“加载完整历史”。",
            };
          } catch (tailError) {
            // Tail windows cut mid-line on giant single-line tool outputs, or the
            // 1GB+ file cannot produce a complete record: never fall through to a
            // full 3G thread/read. Show metadata-only so the composer unlocks,
            // but mark it incomplete so the empty result is never cached.
            if (/timed out after/i.test(errorText(tailError))) throw tailError;
            console.warn("[thread history] tail unavailable; showing metadata only", errorText(tailError));
            stage?.(85, "Decoding history");
            return {
              loaded: { thread: metadata.thread, turns: [] },
              pageState: nonPaginatedPageState(),
              incomplete: true,
              notice: "历史片段读取失败，仅显示基本信息，可重试恢复完整对话。",
            };
          }
        }
      } catch (error) {
        if (/timed out after/i.test(errorText(error))) throw error;
        // fileInfo unavailable/ENOENT: the size is unknown and a full legacy read
        // could be a multi-GB rollout. Fail open with metadata-only instead of
        // hanging the server event loop and the 35s UI failsafe — but mark it
        // incomplete so a repeat open retries instead of hitting the cache.
        console.warn("[thread history] file size check unavailable; showing metadata only", errorText(error));
        stage?.(85, "Decoding history");
        return {
          loaded: { thread: metadata.thread, turns: [] },
          pageState: nonPaginatedPageState(),
          incomplete: true,
          notice: "无法确认历史文件大小，仅显示基本信息，可重试恢复完整对话。",
        };
      }
      if ((knownSizeBytes ?? 0) >= LARGE_HISTORY_REFUSE_FULL_READ_BYTES) {
        stage?.(85, "Decoding history");
        return {
          loaded: { thread: metadata.thread, turns: [] },
          pageState: nonPaginatedPageState(),
          incomplete: true,
          notice: "历史过大已跳过完整读取，可重试或分段加载。",
        };
      }
    }
    const legacyResult = await rpcWithTimeout(client, "thread/read", { threadId, includeTurns: true }, THREAD_HISTORY_RPC_TIMEOUT_MS.fullRead);
    stage?.(70, "Decoding history");
    const legacyLoaded = normalizeHistoricalRunningTurns(threadReadToTurns(legacyResult), options);
    stage?.(85, "Decoding history");
    return { loaded: legacyLoaded, pageState: nonPaginatedPageState() };
  }

  const pageResult = await rpcWithTimeout(client, "thread/turns/list", {
    threadId, cursor: null, limit: FAST_INITIAL_TURN_LIMIT, sortDirection: "desc", itemsView: "full"
  }, THREAD_HISTORY_RPC_TIMEOUT_MS.page);
  stage?.(70, "Decoding history");
  const page = threadTurnsPageToTurns(threadId, pageResult, "desc");
  stage?.(85, "Decoding history");
  return {
    loaded: normalizeHistoricalRunningTurns({ thread: metadata.thread, turns: page.turns }, options),
    pageState: { nextCursor: page.nextCursor, loading: false, paginated: true }
  };
}

export function normalizeHistoricalRunningTurns(
  history: LoadedThreadHistory,
  options: { preserveRunningTurnIds?: ReadonlySet<string> } = {},
): LoadedThreadHistory {
  const preserve = options.preserveRunningTurnIds;
  const preserveLiveThreadTurns = isPersistedRunningStatus(history.thread?.status);
  const latestRunningTurnId = preserveLiveThreadTurns
    ? history.turns.filter((turn) => isPersistedRunningStatus(turn.status)).reduce<string | null>((latest, turn) => {
      if (!latest) return turn.id;
      const current = history.turns.find((entry) => entry.id === latest);
      return (turn.startedAt ?? 0) >= (current?.startedAt ?? 0) ? turn.id : latest;
    }, null)
    : null;
  return {
    ...history,
    turns: history.turns.map((turn) => isPersistedRunningStatus(turn.status) && !(preserveLiveThreadTurns ? turn.id === latestRunningTurnId : false) && !preserve?.has(turn.id)
      ? { ...turn, status: "interrupted" }
      : turn)
  };
}

function isPersistedRunningStatus(status?: string): boolean {
  return ["inprogress", "pending", "pendinginit", "started", "running", "active"].includes(
    (status ?? "").replace(/[_-]+/g, "").toLowerCase()
  );
}

async function readThreadMetadataWhenReady(client: ThreadHistoryRpc, threadId: string): Promise<JsonValue> {
  // Bounded metadata read: fast restore must fail fast instead of hanging
  // forever at "Preparing conversation" on server builds.
  const delaysMs = [50, 100, 200];
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await rpcWithTimeout(client, "thread/read", { threadId, includeTurns: false }, THREAD_HISTORY_RPC_TIMEOUT_MS.metadata);
    } catch (error) {
      if (attempt >= delaysMs.length || !isPendingRolloutMetadata(error)) throw error;
      await new Promise((resolve) => globalThis.setTimeout(resolve, delaysMs[attempt]));
    }
  }
}

function isPendingRolloutMetadata(error: unknown): boolean {
  return /failed to read session metadata|rollout .* is empty/i.test(errorText(error));
}

export async function loadOlderThreadHistoryPage(
  client: ThreadHistoryRpc,
  threadId: string,
  cursor: string,
): Promise<{ turns: LoadedThreadHistory["turns"]; pageState: ThreadHistoryPageState }> {
  const result = await rpcWithTimeout(client, "thread/turns/list", {
    threadId, cursor, limit: 32, sortDirection: "desc", itemsView: "full"
  }, THREAD_HISTORY_RPC_TIMEOUT_MS.page);
  const page = threadTurnsPageToTurns(threadId, result, "desc");
  return {
    turns: page.turns,
    pageState: { nextCursor: page.nextCursor, loading: false, paginated: true }
  };
}

function nonPaginatedPageState(): ThreadHistoryPageState {
  return { nextCursor: null, loading: false, paginated: false };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

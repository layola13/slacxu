import type { JsonValue, ProviderConfig, ServerToClientMessage } from "@codex-ui/shared";
import {
  applyNotificationPreservingActiveThread,
  applyNotificationsPreservingActiveThread,
  type ClientState
} from "../state/codexClient";
import { mergeWorkbenchTurns } from "../state/workbenchTimeline";
import {
  projectRuntimeNotification,
  projectRuntimeNotifications,
  projectRuntimeTurn,
  projectRuntimeTurns
} from "./transcripts/runtimeTurnProjection";

export type AppAction =
  | { type: "connected"; connected: boolean }
  | { type: "token"; token: string | null }
  | { type: "engine"; status: ClientState["engine"] }
  | { type: "account"; account: JsonValue }
  | { type: "models"; models: ClientState["models"] }
  | { type: "threads"; threads: ClientState["threads"] }
  | { type: "threadSynced"; thread: ClientState["threads"][number] | null }
  | { type: "providers"; providers: ProviderConfig[] }
  | { type: "activeThread"; threadId: string | null }
  | { type: "newConversation" }
  | { type: "threadLoaded"; thread: ClientState["threads"][number] | null; turns: ClientState["turns"] }
  | { type: "threadMerged"; thread: ClientState["threads"][number] | null; turns: ClientState["turns"] }
  | { type: "threadSnapshotReplaced"; thread: ClientState["threads"][number]; turns: ClientState["turns"] }
  | { type: "threadTurnReplaced"; turn: ClientState["turns"][number] }
  | { type: "threadTurnMerged"; turn: ClientState["turns"][number] }
  | { type: "threadTranscriptsEvicted"; threadIds: string[] }
  | { type: "toolingLoading"; loading: boolean }
  | { type: "tooling"; tooling: ClientState["tooling"] }
  | { type: "notification"; message: CodexNotification }
  | { type: "notifications"; messages: CodexNotification[] }
  | { type: "serverRequest"; message: Extract<ServerToClientMessage, { type: "codex.serverRequest" }>["message"] }
  | { type: "serverRequestResolved"; id: string | number }
  | { type: "error"; message: string }
  | { type: "clearError" };

export type CodexNotification = Extract<ServerToClientMessage, { type: "codex.notification" }>["message"];

export function appReducer(state: ClientState, action: AppAction): ClientState {
  switch (action.type) {
    case "connected": return { ...state, connected: action.connected };
    case "token": return { ...state, token: action.token };
    case "engine": return { ...state, engine: action.status };
    case "account": return { ...state, account: action.account };
    case "models": return { ...state, models: action.models };
    case "threads": return { ...state, threads: action.threads };
    case "threadSynced": return { ...state, threads: action.thread ? upsertThread(state.threads, action.thread) : state.threads };
    case "providers": return { ...state, providers: action.providers };
    case "activeThread": return action.threadId === state.activeThreadId
      ? state
      : {
        ...state,
        activeThreadId: action.threadId
      };
    case "newConversation": return { ...state, activeThreadId: null };
    case "threadLoaded": return {
      ...state,
      activeThreadId: action.thread?.id ?? state.activeThreadId,
      threads: action.thread ? upsertThread(state.threads, action.thread) : state.threads,
      turns: mergeWorkbenchTurns(state.turns, projectRuntimeTurns(action.turns))
    };
    case "threadMerged": return {
      ...state,
      threads: action.thread ? upsertThread(state.threads, action.thread) : state.threads,
      turns: mergeWorkbenchTurns(state.turns, projectRuntimeTurns(action.turns))
    };
    case "threadSnapshotReplaced": return {
      ...state,
      threads: upsertThread(state.threads, action.thread),
      turns: mergeWorkbenchTurns(
        state.turns.filter((turn) => turn.threadId !== action.thread.id),
        projectRuntimeTurns(action.turns)
      )
    };
    case "threadTurnReplaced": return {
      ...state,
      turns: mergeWorkbenchTurns(state.turns.filter((turn) => turn.id !== action.turn.id), [projectRuntimeTurn(action.turn)])
    };
    // Inline review uses merge semantics so a late review/start RPC response can
    // add its synthetic user item and running status without erasing an
    // enteredReviewMode marker that already arrived via item notifications.
    case "threadTurnMerged": return {
      ...state,
      turns: mergeWorkbenchTurns(state.turns, [projectRuntimeTurn(action.turn)])
    };
    case "threadTranscriptsEvicted": {
      const evicted = new Set(action.threadIds);
      return { ...state, turns: state.turns.filter((turn) => !evicted.has(turn.threadId)) };
    }
    case "toolingLoading": return { ...state, toolingLoading: action.loading };
    case "tooling": return { ...state, tooling: action.tooling, toolingLoading: false };
    case "notification": {
      const message = projectRuntimeNotification(action.message);
      return message ? applyNotificationPreservingActiveThread(state, message) : state;
    }
    case "notifications": {
      const messages = projectRuntimeNotifications(action.messages);
      return messages.length > 0 ? applyNotificationsPreservingActiveThread(state, messages) : state;
    }
    case "serverRequest": {
      const params = action.message.params;
      const record = params && typeof params === "object" && !Array.isArray(params)
        ? params as Record<string, JsonValue>
        : undefined;
      const threadId = typeof record?.threadId === "string"
        ? record.threadId
        : typeof record?.thread_id === "string"
          ? record.thread_id
          : undefined;
      const request = {
        id: action.message.id,
        method: action.message.method,
        params,
        threadId: threadId ?? state.activeThreadId ?? undefined
      };
      return { ...state, pendingRequests: [request, ...state.pendingRequests.filter((existing) => existing.id !== request.id)] };
    }
    case "serverRequestResolved": return {
      ...state,
      pendingRequests: state.pendingRequests.filter((request) => request.id !== action.id)
    };
    case "error": return { ...state, errors: [action.message, ...state.errors].slice(0, 8) };
    case "clearError": return { ...state, errors: state.errors.slice(1) };
  }
}

function upsertThread(threads: ClientState["threads"], thread: ClientState["threads"][number]): ClientState["threads"] {
  const found = threads.some((entry) => entry.id === thread.id);
  return found
    ? threads.map((entry) => entry.id === thread.id
      ? { ...entry, ...thread, cliBackend: thread.cliBackend ?? entry.cliBackend }
      : entry)
    : [thread, ...threads];
}

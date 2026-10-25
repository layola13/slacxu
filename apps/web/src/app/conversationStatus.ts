import type { WorkbenchTurn } from "../state/codexClient";

export type ConversationStatus = "connecting" | "working" | "idle" | "disconnect" | "retrying" | "engine-error";

export function hasConversationWork(
  activeThreadId: string | null | undefined,
  activeRunningTurn: WorkbenchTurn | null | undefined,
  pendingAcceptedThreads: ReadonlySet<string>,
  creatingNewConversation = false,
): boolean {
  return creatingNewConversation
    || Boolean(activeRunningTurn)
    || Boolean(activeThreadId && pendingAcceptedThreads.has(activeThreadId));
}

export function getConversationStatus(
  connected: boolean,
  enginePhase: string,
  hasConversationWork: boolean,
  turnRetrying = false,
  conversationStarting = false,
): ConversationStatus {
  if (!connected) return "disconnect";
  if (enginePhase === "starting" || enginePhase === "idle") return "retrying";
  if (enginePhase !== "ready") return enginePhase === "error" ? "engine-error" : "retrying";
  if (turnRetrying) return "retrying";
  if (conversationStarting) return "connecting";
  return hasConversationWork ? "working" : "idle";
}

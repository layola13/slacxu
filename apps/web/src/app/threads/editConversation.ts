import type { ThreadEntry } from "../../state/codexClient";

export function validateSameThreadRollback(expectedThreadId: string, actualThreadId: string | null | undefined): void {
  if (!actualThreadId) throw new Error("Codex did not return the rolled-back conversation id");
  if (actualThreadId !== expectedThreadId) throw new Error("Codex returned a different conversation while editing; the replacement was stopped");
}

export function resolveThreadWorkspace(
  thread: Pick<ThreadEntry, "workspaceMode" | "sshCommand" | "sshCwd" | "cwd" | "additionalRoots"> | undefined,
  fallback: { workspaceMode: "local" | "ssh"; sshCommand: string; localCwd: string; sshCwd: string }
): { workspaceMode: "local" | "ssh"; sshCommand: string; cwd: string; additionalRoots: string[] } {
  if (!thread) {
    return fallback.workspaceMode === "ssh"
      ? { workspaceMode: "ssh", sshCommand: fallback.sshCommand.trim(), cwd: fallback.sshCwd, additionalRoots: [] }
      : { workspaceMode: "local", sshCommand: "", cwd: fallback.localCwd, additionalRoots: [] };
  }
  const ssh = thread.workspaceMode === "ssh" || Boolean(thread.sshCommand?.trim());
  return ssh
    ? {
        workspaceMode: "ssh",
        sshCommand: thread.sshCommand?.trim() || fallback.sshCommand.trim(),
        cwd: thread.sshCwd?.trim() || thread.cwd?.trim() || fallback.sshCwd,
        additionalRoots: thread.additionalRoots ?? []
      }
    : { workspaceMode: "local", sshCommand: "", cwd: thread.cwd?.trim() || fallback.localCwd, additionalRoots: thread.additionalRoots ?? [] };
}

/**
 * A turn/start response is the commit point for an edit. Any error after that
 * point belongs to reconciliation and must not make the editor report a send
 * failure.
 */
export function committedTurnResult(threadId: string | null, turnStarted: boolean): string | null {
  return turnStarted && threadId ? threadId : null;
}

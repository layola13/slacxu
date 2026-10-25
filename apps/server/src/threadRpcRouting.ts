export type ThreadRpcBridgeKind = "local" | "direct-ssh" | "autonomous" | "codecli" | "codecli-ssh";

export function selectThreadRpcBridgeKind(input: {
  hasAutonomousRoute: boolean;
  hasRequestedSshWorkspace: boolean;
  hasStoredSshWorkspace: boolean;
  isClaudeBackend?: boolean;
}): ThreadRpcBridgeKind {
  if (input.hasAutonomousRoute) return "autonomous";
  if (input.hasRequestedSshWorkspace || input.hasStoredSshWorkspace) {
    // A Claude thread owns a Claude CLI on the SSH host. Routing it through the
    // Codex app-server bridge would start the wrong remote runtime and report
    // `thread not found` for every follow-up RPC.
    return input.isClaudeBackend ? "codecli-ssh" : "direct-ssh";
  }
  return input.isClaudeBackend ? "codecli" : "local";
}

export function isRemoteThreadHistoryMethod(method: string): boolean {
  return method === "thread/history/fileInfo" || method === "thread/history/tail";
}

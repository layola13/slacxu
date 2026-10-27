import { describe, expect, test } from "bun:test";
import { isRemoteThreadHistoryMethod, selectThreadRpcBridgeKind } from "../../apps/server/src/threadRpcRouting";

describe("thread RPC bridge routing", () => {
  test("persisted autonomous routes override stale SSH workspace metadata", () => {
    expect(selectThreadRpcBridgeKind({
      hasAutonomousRoute: true,
      hasRequestedSshWorkspace: true,
      hasStoredSshWorkspace: true
    })).toBe("autonomous");
  });

  test("keeps direct SSH and local threads isolated", () => {
    expect(selectThreadRpcBridgeKind({
      hasAutonomousRoute: false,
      hasRequestedSshWorkspace: true,
      hasStoredSshWorkspace: false
    })).toBe("direct-ssh");
    expect(selectThreadRpcBridgeKind({
      hasAutonomousRoute: false,
      hasRequestedSshWorkspace: false,
      hasStoredSshWorkspace: false
    })).toBe("local");
  });

  test("recognizes both remote history RPC methods", () => {
    expect(isRemoteThreadHistoryMethod("thread/history/fileInfo")).toBe(true);
    expect(isRemoteThreadHistoryMethod("thread/history/tail")).toBe(true);
    expect(isRemoteThreadHistoryMethod("thread/read")).toBe(false);
  });

  test("routes Claude SSH threads to the Claude CLI bridge instead of the Codex one", () => {
    expect(selectThreadRpcBridgeKind({
      hasAutonomousRoute: false,
      hasRequestedSshWorkspace: true,
      hasStoredSshWorkspace: false,
      isClaudeBackend: true
    })).toBe("codecli-ssh");
    expect(selectThreadRpcBridgeKind({
      hasAutonomousRoute: false,
      hasRequestedSshWorkspace: false,
      hasStoredSshWorkspace: true,
      isClaudeBackend: true
    })).toBe("codecli-ssh");
  });

  test("keeps local Claude threads and Codex SSH threads on their own bridges", () => {
    expect(selectThreadRpcBridgeKind({
      hasAutonomousRoute: false,
      hasRequestedSshWorkspace: false,
      hasStoredSshWorkspace: false,
      isClaudeBackend: true
    })).toBe("codecli");
    expect(selectThreadRpcBridgeKind({
      hasAutonomousRoute: false,
      hasRequestedSshWorkspace: true,
      hasStoredSshWorkspace: false,
      isClaudeBackend: false
    })).toBe("direct-ssh");
  });

  test("an autonomous remote-node route still wins over a Claude backend flag", () => {
    expect(selectThreadRpcBridgeKind({
      hasAutonomousRoute: true,
      hasRequestedSshWorkspace: true,
      hasStoredSshWorkspace: true,
      isClaudeBackend: true
    })).toBe("autonomous");
  });
});

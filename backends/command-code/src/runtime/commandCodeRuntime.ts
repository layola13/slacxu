import { join } from "node:path";
import { CommandCodeAgentBridge } from "./commandCodeAgentBridge.js";

/**
 * Process-wide registry for the shared Command Code bridge.
 *
 * One bridge per server process; per-turn CLI processes are spawned by
 * the bridge itself. All CLI state lives under the isolated home
 * (HOME override at spawn), never the user's real `~/.commandcode`.
 */
let sharedBridge: CommandCodeAgentBridge | null = null;
const boundThreads = new Set<string>();

export function defaultCommandCodeHomeDir(dataDir: string): string {
  return join(dataDir, "command-code");
}

export function ensureCommandCodeBridge(dataDir: string, onCreate?: (bridge: CommandCodeAgentBridge) => void): CommandCodeAgentBridge {
  if (!sharedBridge) {
    sharedBridge = new CommandCodeAgentBridge(defaultCommandCodeHomeDir(dataDir));
    onCreate?.(sharedBridge);
  }
  return sharedBridge;
}

export function ensureCommandCodeBridgeForThread(
  threadId: string | null,
  dataDir: string,
  onCreate?: (bridge: CommandCodeAgentBridge) => void,
): CommandCodeAgentBridge {
  const bridge = ensureCommandCodeBridge(dataDir, onCreate);
  if (threadId) boundThreads.add(threadId);
  return bridge;
}

export function existingCommandCodeBridgeForThread(threadId: string): CommandCodeAgentBridge | null {
  if (!sharedBridge) return null;
  return boundThreads.has(threadId) || sharedBridge.hasSession(threadId) ? sharedBridge : null;
}

export function bindCommandCodeThreadBridge(threadId: string, bridge: CommandCodeAgentBridge): void {
  sharedBridge = bridge;
  boundThreads.add(threadId);
}

export function releaseCommandCodeThreadBridge(threadId: string): void {
  boundThreads.delete(threadId);
}

export function stopCommandCodeRuntime(): void {
  sharedBridge?.stop();
  sharedBridge = null;
  boundThreads.clear();
}

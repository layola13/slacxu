import { join } from "node:path";
import { ClineAgentBridge } from "./clineAgentBridge.js";

/**
 * Process-wide registry for the shared cline bridge.
 *
 * One bridge per server process: it owns a single WebSocket to the cline
 * hub daemon, and hub sessions are the per-thread state. The hub daemon
 * itself is detached and shared — stopping the bridge only disconnects.
 */
let sharedBridge: ClineAgentBridge | null = null;
const boundThreads = new Set<string>();

export function defaultClineDataDir(dataDir: string): string {
  return join(dataDir, "cline");
}

export function ensureClineBridge(dataDir: string, onCreate?: (bridge: ClineAgentBridge) => void): ClineAgentBridge {
  if (!sharedBridge) {
    sharedBridge = new ClineAgentBridge(defaultClineDataDir(dataDir));
    onCreate?.(sharedBridge);
  }
  return sharedBridge;
}

export function ensureClineBridgeForThread(
  threadId: string | null,
  dataDir: string,
  onCreate?: (bridge: ClineAgentBridge) => void,
): ClineAgentBridge {
  const bridge = ensureClineBridge(dataDir, onCreate);
  if (threadId) boundThreads.add(threadId);
  return bridge;
}

export function existingClineBridgeForThread(threadId: string): ClineAgentBridge | null {
  if (!sharedBridge) return null;
  return boundThreads.has(threadId) || sharedBridge.hasSession(threadId) ? sharedBridge : null;
}

export function bindClineThreadBridge(threadId: string, bridge: ClineAgentBridge): void {
  sharedBridge = bridge;
  boundThreads.add(threadId);
}

export function releaseClineThreadBridge(threadId: string): void {
  boundThreads.delete(threadId);
}

export function stopClineRuntime(): void {
  sharedBridge?.stop();
  sharedBridge = null;
  boundThreads.clear();
}

// Auggie backend — routing-layer runtime shared by apps/server/src/index.ts.
//
// Auggie is an EXTERNAL CLI backend like the others (user rule 2026-10-24:
// only Mini Agent is embedded): the bridge spawns the user's own `auggie`
// binary (see auggieCommand.ts for discovery). This module owns the pieces
// of the lifecycle the HTTP/WS routing layer needs:
//   - the indexing mode constant advertised through the redirector,
//   - the session/cache directory rooted at the server data dir,
//   - the per-thread bridge registry that guarantees auggie's single-process
//     exclusivity rule (auggie has no cross-process lock; two processes
//     resuming the same session overwrite each other's history files).
import { join } from "node:path";
import { AuggieAgentBridge } from "./auggieAgentBridge.js";

/**
 * Indexing mode advertised to auggie. "complete" is the redirector's
 * deny-indexing answer: /find-missing reports nothing missing and
 * max_upload_size_bytes is 0, so repository content is never uploaded.
 * Indexing stays disabled by default (user requirement 2026-10-24).
 */
export const AUGGIE_INDEXING_MODE = "complete" as const;

/**
 * Session/cache directory for spawned auggie processes, rooted at the server
 * data dir so sessions never land in the user's `~/.augment`.
 */
export function defaultAuggieCacheDir(dataDir: string): string {
  return join(dataDir, "auggie");
}

const threadBridges = new Map<string, AuggieAgentBridge>();
let sharedBridge: AuggieAgentBridge | undefined;

export interface EnsureAuggieBridgeOptions {
  /** Runtime env snapshot provider; defaults to process.env at creation time. */
  runtimeEnv?: () => NodeJS.ProcessEnv;
  /** Invoked once when the underlying bridge process object is constructed. */
  onCreate?: (bridge: AuggieAgentBridge) => void;
}

/**
 * Return the bridge bound to `threadId`, or the shared auggie process when
 * unbound. A single long-lived child process serves every auggie session, so
 * two turns on the same thread can never spawn competing CLI processes.
 */
export function existingAuggieBridgeForThread(threadId?: string | null): AuggieAgentBridge | null {
  if (!threadId) return null;
  return threadBridges.get(threadId) ?? null;
}

export function ensureAuggieBridgeForThread(
  threadId: string | null,
  options: EnsureAuggieBridgeOptions = {}
): AuggieAgentBridge {
  const existing = existingAuggieBridgeForThread(threadId);
  if (existing) return existing;
  if (!sharedBridge) {
    sharedBridge = new AuggieAgentBridge(() => ({
      ...(options.runtimeEnv?.() ?? process.env),
      // The redirector is the only outbound path; keep the CLI from probing npm.
      AUGMENT_DISABLE_AUTO_UPDATE: "1"
    }));
    options.onCreate?.(sharedBridge);
  }
  if (threadId) threadBridges.set(threadId, sharedBridge);
  return sharedBridge;
}

/** Drop a thread's binding once its route is gone (archive/delete/close). */
export function releaseAuggieThreadBridge(threadId: string): void {
  threadBridges.delete(threadId);
}

/**
 * Bind a thread id (including one the bridge itself minted during
 * `thread/start`) to the shared auggie process.
 */
export function bindAuggieThreadBridge(threadId: string, bridge: AuggieAgentBridge): void {
  threadBridges.set(threadId, bridge);
}

/** Tear the shared bridge down so the next use spawns a fresh CLI child. */
export function resetAuggieRuntime(): void {
  const bridge = sharedBridge;
  sharedBridge = undefined;
  threadBridges.clear();
  if (bridge) bridge.stop();
}

/** Stop all auggie bridges on process exit. */
export function stopAuggieRuntime(): void {
  if (sharedBridge) sharedBridge.stop();
}

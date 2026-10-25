/**
 * The runtime-client contract every backend engine implements.
 *
 * Historically defined in the host's daemonCodexBridge.ts (hence the
 * name) and implemented by ALL bridges — daemon Codex, the compatible
 * CLI runtimes, SSH/remote variants, Mini and OpencodeBridge alike.
 * It is a shared contract, so it lives in the SDK: plugins implement
 * it, the host consumes engines through it, and no plugin ever imports
 * another plugin (or a host file) just for this type.
 */
import type { EventEmitter } from "node:events";
import type { EngineStatus, JsonRpcFailure, JsonRpcId, JsonValue } from "@codex-ui/shared";

export interface CodexRuntimeClient extends EventEmitter {
  getStatus(): EngineStatus;
  start(): Promise<EngineStatus>;
  stop(): void;
  restart(): Promise<EngineStatus>;
  request(method: string, params?: JsonValue, timeoutMs?: number): Promise<JsonValue>;
  notify(method: string, params?: JsonValue): Promise<void>;
  respond(id: JsonRpcId, result?: JsonValue, error?: JsonRpcFailure["error"]): void;
}

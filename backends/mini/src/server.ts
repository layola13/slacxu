/**
 * Mini Agent — server side. Mini is the built-in agent runtime: it has no
 * external CLI binary, which is why it is the one plugin installed by
 * default. Phase 1 declares the SDK contract; the host still serves mini
 * through its existing runtime path until the Phase 2 extraction moves
 * the runtime behind `createEngine`.
 */
import type {
  EngineHandle,
  EngineStatus,
  PluginInstallation,
  ServerHost,
  ServerPlugin,
} from "@cxu/sdk-backend/server";

import { MINI_MANIFEST } from "./manifest.js";

export { MINI_MANIFEST };

class MiniEngine implements EngineHandle {
  readonly pluginId = "mini";
  #status: EngineStatus = { phase: "stopped", transport: "builtin" };

  async start(): Promise<EngineStatus> {
    this.#status = { phase: "ready", transport: "builtin" };
    return this.#status;
  }

  async stop(): Promise<void> {
    this.#status = { phase: "stopped", transport: "builtin" };
  }

  status(): EngineStatus {
    return this.#status;
  }

  async handleRpc(): Promise<unknown> {
    throw new Error("mini plugin engine is not wired to the host yet (phase 1 declaration)");
  }
}

export const miniServerPlugin: ServerPlugin = {
  manifest: MINI_MANIFEST,
  discovery: {
    binaryNames: [],
    envBinVars: [],
    matchesKind: () => false,
  },
  createEngine(_host: ServerHost): EngineHandle {
    return new MiniEngine();
  },
  async findInstallations(): Promise<PluginInstallation[]> {
    // Built-in runtime: there is no CLI binary to discover.
    return [];
  },
  skillRoots(): string[] {
    return [".codex/skills"];
  },
};

export default miniServerPlugin;

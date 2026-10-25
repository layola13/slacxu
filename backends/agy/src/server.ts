/**
 * Antigravity — server side (kind "backend"). Independent plugin.
 * Phase 1: declaration level — the runtime/bridge and installation
 * discovery move here from the host in Phase 2.
 */
import type {
  EngineHandle,
  EngineStatus,
  PluginInstallation,
  ServerHost,
  ServerPlugin,
} from "@cxu/sdk-backend/server";

import { AGY_MANIFEST } from "./manifest.js";
import { AGY_OFFICIAL_PROVIDER_ID } from "./runtime/agyBridge.js";

export { AGY_MANIFEST };

class AgyEngine implements EngineHandle {
  readonly pluginId = "agy";
  #status: EngineStatus = { phase: "stopped", transport: "stdio" };
  async start(): Promise<EngineStatus> {
    this.#status = { phase: "ready", transport: "stdio" };
    return this.#status;
  }
  async stop(): Promise<void> {
    this.#status = { phase: "stopped", transport: "stdio" };
  }
  status(): EngineStatus {
    return this.#status;
  }
  async handleRpc(): Promise<unknown> {
    throw new Error("agy plugin engine is not wired to the host yet (phase 1 declaration)");
  }
}

export const agyServerPlugin: ServerPlugin = {
  manifest: AGY_MANIFEST,
  officialProviderId: AGY_OFFICIAL_PROVIDER_ID,
  cliSettings: { slug: "agy-cli", enabledEnvVar: "CODEX_UI_AGY_COMPATIBLE_CLI_ENABLED", linkKey: "agyCompatibleCliSettings" },
  discovery: {
    preferredPathPrefKey: "cliPreferredAgyPath",
    binaryNames: ["agy"],
    envBinVars: ["AGY_BIN", "CODEX_UI_AGY_BIN"],
    matchesKind: () => true,
  },
  createEngine(_host: ServerHost): EngineHandle {
    return new AgyEngine();
  },
  async findInstallations(): Promise<PluginInstallation[]> {
    return [];
  },
  skillRoots(): string[] {
    return [];
  },
};

export default agyServerPlugin;

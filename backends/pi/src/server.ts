/**
 * Pi — server side (kind "backend"). Independent plugin.
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

import { PI_MANIFEST } from "./manifest.js";
import { PI_OFFICIAL_PROVIDER_ID } from "./runtime/piBridge.js";

export { PI_MANIFEST };

class PiEngine implements EngineHandle {
  readonly pluginId = "pi";
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
    throw new Error("pi plugin engine is not wired to the host yet (phase 1 declaration)");
  }
}

export const piServerPlugin: ServerPlugin = {
  manifest: PI_MANIFEST,
  officialProviderId: PI_OFFICIAL_PROVIDER_ID,
  cliSettings: { slug: "pi-cli", enabledEnvVar: "CODEX_UI_PI_COMPATIBLE_CLI_ENABLED", linkKey: "piCompatibleCliSettings" },
  discovery: {
    preferredPathPrefKey: "cliPreferredPiPath",
    binaryNames: ["pi"],
    envBinVars: ["PI_BIN", "CODEX_UI_PI_BIN"],
    matchesKind: () => true,
  },
  createEngine(_host: ServerHost): EngineHandle {
    return new PiEngine();
  },
  async findInstallations(): Promise<PluginInstallation[]> {
    return [];
  },
  skillRoots(): string[] {
    return [];
  },
};

export default piServerPlugin;

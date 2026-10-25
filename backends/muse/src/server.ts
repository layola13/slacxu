/**
 * Muse — server side (kind "backend"). Independent plugin.
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

import { MUSE_MANIFEST } from "./manifest.js";
import { MUSE_OFFICIAL_PROVIDER_ID } from "./runtime/museBridge.js";

export { MUSE_MANIFEST };

class MuseEngine implements EngineHandle {
  readonly pluginId = "muse";
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
    throw new Error("muse plugin engine is not wired to the host yet (phase 1 declaration)");
  }
}

export const museServerPlugin: ServerPlugin = {
  manifest: MUSE_MANIFEST,
  officialProviderId: MUSE_OFFICIAL_PROVIDER_ID,
  cliSettings: { slug: "muse-cli", enabledEnvVar: "CODEX_UI_MUSE_COMPATIBLE_CLI_ENABLED" },
  discovery: {
    preferredPathPrefKey: "cliPreferredMusePath",
    binaryNames: ["muse"],
    envBinVars: ["MUSE_BIN", "CODEX_UI_MUSE_BIN"],
    matchesKind: () => true,
  },
  createEngine(_host: ServerHost): EngineHandle {
    return new MuseEngine();
  },
  async findInstallations(): Promise<PluginInstallation[]> {
    return [];
  },
  skillRoots(): string[] {
    return [".codex/skills"];
  },
};

export default museServerPlugin;

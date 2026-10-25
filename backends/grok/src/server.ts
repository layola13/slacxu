/**
 * Grok — server side (kind "backend"). Independent plugin.
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

import { GROK_MANIFEST } from "./manifest.js";
import { GROK_OFFICIAL_PROVIDER_ID } from "./runtime/grokBridge.js";

export { GROK_MANIFEST };

class GrokEngine implements EngineHandle {
  readonly pluginId = "grok";
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
    throw new Error("grok plugin engine is not wired to the host yet (phase 1 declaration)");
  }
}

export const grokServerPlugin: ServerPlugin = {
  manifest: GROK_MANIFEST,
  officialProviderId: GROK_OFFICIAL_PROVIDER_ID,
  cliSettings: { slug: "grok-cli", enabledEnvVar: "CODEX_UI_GROK_COMPATIBLE_CLI_ENABLED", linkKey: "grokCompatibleCliSettings" },
  discovery: {
    preferredPathPrefKey: "cliPreferredGrokPath",
    binaryNames: ["grok", "agent"],
    envBinVars: ["GROK_BIN", "CODEX_UI_GROK_BIN"],
    matchesKind: () => true,
  },
  createEngine(_host: ServerHost): EngineHandle {
    return new GrokEngine();
  },
  async findInstallations(): Promise<PluginInstallation[]> {
    return [];
  },
  skillRoots(): string[] {
    return [];
  },
};

export default grokServerPlugin;

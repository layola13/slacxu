/**
 * Auggie (Augment Code) — server side (kind "backend"). Independent
 * plugin. Reopened 2026-10-24: the ACP runtime cluster lives under
 * src/runtime (ported from the pre-refactor host implementation); the
 * host constructs the bridge from there via staging imports.
 */
import type {
  EngineHandle,
  EngineStatus,
  PluginInstallation,
  ServerHost,
  ServerPlugin,
} from "@cxu/sdk-backend/server";

import { AUGGIE_MANIFEST } from "./manifest.js";

export { AUGGIE_MANIFEST };

class AuggieEngine implements EngineHandle {
  readonly pluginId = "auggie";
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
    throw new Error("auggie plugin engine is not wired to the host yet (phase 1 declaration)");
  }
}

export const auggieServerPlugin: ServerPlugin = {
  manifest: AUGGIE_MANIFEST,
  cliSettings: { slug: "auggie-cli", enabledEnvVar: "CODEX_UI_AUGGIE_COMPATIBLE_CLI_ENABLED" },
  discovery: {
    preferredPathPrefKey: "cliPreferredAuggiePath",
    binaryNames: ["auggie"],
    envBinVars: ["AUGGIE_BIN", "CODEX_UI_AUGGIE_BIN"],
    matchesKind: () => true,
  },
  createEngine(_host: ServerHost): EngineHandle {
    return new AuggieEngine();
  },
  async findInstallations(): Promise<PluginInstallation[]> {
    return [];
  },
  skillRoots(): string[] {
    return [".augment/skills"];
  },
};

export default auggieServerPlugin;

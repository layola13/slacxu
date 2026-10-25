/**
 * Codex CLI — server side (kind "backend"). Independent plugin.
 * Phase 1: declaration level — installation discovery (the CODEX_BIN
 * override and the packaged app-server locations) and the daemon bridge
 * move here from the host in Phase 2.
 */
import type {
  EngineHandle,
  EngineStatus,
  PluginInstallation,
  ServerHost,
  ServerPlugin,
} from "@cxu/sdk-backend/server";

import { CODEX_MANIFEST } from "./manifest.js";

export { CODEX_MANIFEST };

class CodexEngine implements EngineHandle {
  readonly pluginId = "codex";
  #status: EngineStatus = { phase: "stopped", transport: "daemon-unix" };
  async start(): Promise<EngineStatus> {
    this.#status = { phase: "ready", transport: "daemon-unix" };
    return this.#status;
  }
  async stop(): Promise<void> {
    this.#status = { phase: "stopped", transport: "daemon-unix" };
  }
  status(): EngineStatus {
    return this.#status;
  }
  async handleRpc(): Promise<unknown> {
    throw new Error("codex plugin engine is not wired to the host yet (phase 1 declaration)");
  }
}

export const codexServerPlugin: ServerPlugin = {
  manifest: CODEX_MANIFEST,
  cliSettings: { slug: "codex-cli", enabledEnvVar: "CODEX_UI_CODEX_COMPATIBLE_CLI_ENABLED", linkKey: "codexCompatibleCliSettings" },
  discovery: {
    preferredPathPrefKey: "cliPreferredCodexPath",
    binaryNames: ["codex"],
    envBinVars: ["CODEX_BIN"],
    matchesKind: () => true,
  },
  createEngine(_host: ServerHost): EngineHandle {
    return new CodexEngine();
  },
  async findInstallations(): Promise<PluginInstallation[]> {
    return [];
  },
  skillRoots(): string[] {
    return [".codex/skills"];
  },
};

export default codexServerPlugin;

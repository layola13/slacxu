/**
 * Cline (Augment Code) — server side (kind "backend"). Independent
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

import { CLINE_MANIFEST } from "./manifest.js";

export { CLINE_MANIFEST };

class ClineEngine implements EngineHandle {
  readonly pluginId = "cline";
  #status: EngineStatus = { phase: "stopped", transport: "websocket" };
  async start(): Promise<EngineStatus> {
    this.#status = { phase: "ready", transport: "websocket" };
    return this.#status;
  }
  async stop(): Promise<void> {
    this.#status = { phase: "stopped", transport: "websocket" };
  }
  status(): EngineStatus {
    return this.#status;
  }
  async handleRpc(): Promise<unknown> {
    throw new Error("cline plugin engine is not wired to the host yet (phase 1 declaration)");
  }
}

export const clineServerPlugin: ServerPlugin = {
  manifest: CLINE_MANIFEST,
  cliSettings: { slug: "cline-cli", enabledEnvVar: "CODEX_UI_CLINE_COMPATIBLE_CLI_ENABLED" },
  discovery: {
    preferredPathPrefKey: "cliPreferredClinePath",
    binaryNames: ["cline"],
    envBinVars: ["CLINE_BIN", "CODEX_UI_CLINE_BIN"],
    matchesKind: () => true,
  },
  createEngine(_host: ServerHost): EngineHandle {
    return new ClineEngine();
  },
  async findInstallations(): Promise<PluginInstallation[]> {
    return [];
  },
  skillRoots(): string[] {
    return [".cline/skills"];
  },
};

export default clineServerPlugin;

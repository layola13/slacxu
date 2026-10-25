/**
 * Command Code — server side (kind "backend"). Independent plugin.
 * The print-mode bridge lives under src/runtime; the host constructs the
 * bridge from there via staging imports.
 */
import type {
  EngineHandle,
  EngineStatus,
  PluginInstallation,
  ServerHost,
  ServerPlugin,
} from "@cxu/sdk-backend/server";

import { COMMAND_CODE_MANIFEST } from "./manifest.js";

export { COMMAND_CODE_MANIFEST };

class CommandCodeEngine implements EngineHandle {
  readonly pluginId = "command-code";
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
    throw new Error("command-code plugin engine is not wired to the host yet (phase 1 declaration)");
  }
}

export const commandCodeServerPlugin: ServerPlugin = {
  manifest: COMMAND_CODE_MANIFEST,
  cliSettings: { slug: "command-code-cli", enabledEnvVar: "CODEX_UI_COMMAND_CODE_COMPATIBLE_CLI_ENABLED" },
  discovery: {
    preferredPathPrefKey: "cliPreferredCommandCodePath",
    // Never the bare "cmd" alias: on Windows that is cmd.exe.
    binaryNames: ["command-code"],
    envBinVars: ["COMMAND_CODE_BIN", "CODEX_UI_COMMAND_CODE_BIN"],
    matchesKind: () => true,
  },
  createEngine(_host: ServerHost): EngineHandle {
    return new CommandCodeEngine();
  },
  async findInstallations(): Promise<PluginInstallation[]> {
    return [];
  },
  skillRoots(): string[] {
    return [".commandcode/skills"];
  },
};

export default commandCodeServerPlugin;

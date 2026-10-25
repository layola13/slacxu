/**
 * Claude Code — server side (kind "backend"). Independent plugin.
 * Phase 1: declaration level — the compatible runtime, session store
 * and sa-vm MCP wiring move here from the host in Phase 2.
 */
import type {
  EngineHandle,
  EngineStatus,
  PluginInstallation,
  ServerHost,
  ServerPlugin,
} from "@cxu/sdk-backend/server";

import { CLAUDE_MANIFEST } from "./manifest.js";

export { CLAUDE_MANIFEST };

class ClaudeEngine implements EngineHandle {
  readonly pluginId = "claude";
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
    throw new Error("claude plugin engine is not wired to the host yet (phase 1 declaration)");
  }
}

export const claudeServerPlugin: ServerPlugin = {
  manifest: CLAUDE_MANIFEST,
  cliSettings: { slug: "claude-compatible-cli", enabledEnvVar: "CODEX_UI_CLAUDE_COMPATIBLE_CLI_ENABLED", linkKey: "claudeCompatibleCliSettings" },
  discovery: {
    preferredPathPrefKey: "cliPreferredClaudePath",
    binaryNames: ["claude", "claudecode"],
    envBinVars: ["CODECLI_BIN", "CLAUDE_CODE_BIN"],
    matchesKind: () => true,
  },
  createEngine(_host: ServerHost): EngineHandle {
    return new ClaudeEngine();
  },
  async findInstallations(): Promise<PluginInstallation[]> {
    return [];
  },
  skillRoots(): string[] {
    return [".claude/skills"];
  },
};

export default claudeServerPlugin;

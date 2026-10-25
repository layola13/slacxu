import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Config files inside the isolated Command Code home (the bridge spawns
 * the CLI with HOME=<homeDir>, so `~/.commandcode` resolves there — never
 * the user's real home):
 *  - <homeDir>/.commandcode/providers.json — BYOK providers in the format
 *    command-code 1.88 parses: {"provider": {"<id>": {api, baseURL,
 *    apiKey, models}}}. Raw secrets are REJECTED by the CLI's parser, so
 *    the apiKey is an env reference the bridge sets at spawn time.
 *  - <homeDir>/.commandcode/mcp.json — user-scope MCP servers.
 */

export const COMMAND_CODE_RELAY_KEY_ENV = "CXU_COMMAND_CODE_RELAY_KEY";
/** Placeholder key value: the loopback relay gateway ignores it and
 *  resolves the real upstream keys server-side. */
export const COMMAND_CODE_RELAY_KEY_PLACEHOLDER = "command-code-relay-key";
/** Placeholder COMMAND_CODE_API_KEY: its mere presence satisfies the
 *  CLI's headless auth gate; with --local-only no Command Code account
 *  traffic happens and model calls go to the BYOK provider. */
export const COMMAND_CODE_LOCAL_API_KEY_PLACEHOLDER = "cxu-local-byok";

export function commandCodeProvidersPath(homeDir: string): string {
  return join(homeDir, ".commandcode", "providers.json");
}

export function commandCodeMcpPath(homeDir: string): string {
  return join(homeDir, ".commandcode", "mcp.json");
}

export function commandCodeProjectsDir(homeDir: string): string {
  return join(homeDir, ".commandcode", "projects");
}

interface CommandCodeProvidersFile {
  provider: Record<string, unknown>;
  [key: string]: unknown;
}

function readProvidersFile(path: string): CommandCodeProvidersFile {
  try {
    if (existsSync(path)) {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<CommandCodeProvidersFile>;
      if (parsed && typeof parsed === "object") {
        return { ...parsed, provider: (parsed.provider ?? {}) as Record<string, unknown> };
      }
    }
  } catch {
    // Malformed existing config: start from an empty shape rather than
    // failing the turn.
  }
  return { provider: {} };
}

/**
 * Register (or refresh) the relay station as a BYOK provider in the
 * isolated home. One slot ("cxu-relay") rewritten per configure — the
 * station's gateway URL and model change, the id stays stable so thread
 * metadata never dangles.
 */
export function writeCommandCodeRelayProvider(
  homeDir: string,
  providerId: string,
  entry: { baseUrl: string; model: string },
): void {
  const path = commandCodeProvidersPath(homeDir);
  mkdirSync(join(homeDir, ".commandcode"), { recursive: true });
  const file = readProvidersFile(path);
  file.provider[providerId] = {
    api: "openai-completions",
    baseURL: entry.baseUrl,
    apiKey: `$${COMMAND_CODE_RELAY_KEY_ENV}`,
    models: { [entry.model]: {} },
  };
  writeFileSync(path, JSON.stringify(file, null, 2) + "\n", "utf8");
}

/** Ensure the user-scope MCP file exists for the host's sa-vm upsert. */
export function ensureCommandCodeMcpFile(homeDir: string): string {
  const path = commandCodeMcpPath(homeDir);
  try {
    mkdirSync(join(homeDir, ".commandcode"), { recursive: true });
    if (!existsSync(path)) {
      writeFileSync(path, JSON.stringify({ mcpServers: {} }, null, 2) + "\n", "utf8");
    }
  } catch (error) {
    console.error(`[command-code] Failed to seed MCP config at ${path}:`, error);
  }
  return path;
}

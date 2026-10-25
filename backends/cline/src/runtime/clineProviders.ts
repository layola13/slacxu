import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Provider + MCP settings files inside the cline data dir — the same files
 * `cline auth` and the hub runtime read (verified against cline 3.0.73):
 *  - <dataDir>/settings/providers.json — BYOK provider entries keyed by id,
 *    each {settings:{provider, apiKey, baseUrl, model}, tokenSource}.
 *  - <dataDir>/settings/cline_mcp_settings.json — MCP servers for sessions.
 */

export function clineProvidersPath(dataDir: string): string {
  return join(dataDir, "settings", "providers.json");
}

export function clineMcpSettingsPath(dataDir: string): string {
  return join(dataDir, "settings", "cline_mcp_settings.json");
}

interface ClineProvidersFile {
  version: number;
  lastUsedProvider?: string;
  modes: Record<string, unknown>;
  providers: Record<string, unknown>;
  [key: string]: unknown;
}

function readProvidersFile(path: string): ClineProvidersFile {
  try {
    if (existsSync(path)) {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<ClineProvidersFile>;
      if (parsed && typeof parsed === "object") {
        return {
          version: typeof parsed.version === "number" ? parsed.version : 1,
          modes: (parsed.modes ?? {}) as Record<string, unknown>,
          providers: (parsed.providers ?? {}) as Record<string, unknown>,
          ...parsed,
        };
      }
    }
  } catch {
    // Malformed existing config: start from an empty shape rather than
    // failing the turn; the user's own entries are lost only if the file
    // was already unreadable.
  }
  return { version: 1, modes: {}, providers: {} };
}

/**
 * Register (or refresh) a relay station as an OpenAI-compatible provider
 * entry in the cline data dir. The hub resolves session providers against
 * cline's BUILT-IN provider ids (verified live: an unknown id fails the
 * run with `Unknown or disabled provider "<id>"`), so callers pass the
 * built-in slot id ("openai-compatible") and this writer rewrites that
 * single entry per station — the same singleton semantics as auggie's
 * process-wide redirector. The data dir is the app's isolated cline dir,
 * never the user's own `~/.cline`, so no user provider is clobbered.
 * The apiKey is whatever the caller passes — for CXU relay stations that
 * is a placeholder, because the loopback relay gateway resolves the real
 * upstream keys server-side.
 */
export function writeClineRelayProvider(
  dataDir: string,
  entryId: string,
  entry: { baseUrl: string; apiKey: string; model: string },
): void {
  const path = clineProvidersPath(dataDir);
  mkdirSync(join(dataDir, "settings"), { recursive: true });
  const file = readProvidersFile(path);
  file.providers[entryId] = {
    settings: {
      provider: "openai-compatible",
      apiKey: entry.apiKey,
      baseUrl: entry.baseUrl,
      model: entry.model,
    },
    updatedAt: new Date().toISOString(),
    tokenSource: "manual",
  };
  writeFileSync(path, JSON.stringify(file, null, 2) + "\n", "utf8");
}

/**
 * Ensure the MCP settings file exists so the host has a stable path to
 * upsert the platform servers (sa-vm / jev) into. Never overwrites an
 * existing file.
 */
export function ensureClineMcpSettingsFile(dataDir: string): string {
  const path = clineMcpSettingsPath(dataDir);
  try {
    mkdirSync(join(dataDir, "settings"), { recursive: true });
    if (!existsSync(path)) {
      writeFileSync(path, JSON.stringify({ mcpServers: {} }, null, 2) + "\n", "utf8");
    }
  } catch (error) {
    console.error(`[cline] Failed to seed MCP settings at ${path}:`, error);
  }
  return path;
}

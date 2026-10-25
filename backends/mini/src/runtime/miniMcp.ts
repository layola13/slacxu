// Mini MCP (Codex-style): expose `~/.codex/config.toml [mcp_servers.*]`
// tools to the ultra mini agent as `mcp__<server>__<tool>` function tools.
//
// Naming mirrors Codex (`mcp__server__tool`, sanitized to [0-9A-Za-z_],
// hash-suffixed on collision, 64-char cap) so prompts/skills written for
// Codex keep working. Transports: stdio (command/args/env/cwd) and
// streamable HTTP (url + http_headers + bearer_token_env_var).
// Failure policy: a broken server is skipped, never fails the turn.

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { resolveVirtualCodexConfigPath } from "@cxu/sdk-backend";

export const MINI_MCP_TOOL_PREFIX = "mcp__";
export const MINI_MCP_NAME_DELIMITER = "__";
export const MINI_MCP_MAX_NAME_LEN = 64;

export interface MiniMcpServerConfig {
  name: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  httpHeaders?: Record<string, string>;
  bearerTokenEnvVar?: string;
  enabled: boolean;
  startupTimeoutMs: number;
  toolTimeoutMs: number;
  enabledTools?: string[];
  disabledTools?: string[];
}

export interface MiniMcpToolDef {
  /** Model-visible qualified name: mcp__<server>__<tool>. */
  name: string;
  description: string;
  schema: Record<string, unknown>;
  server: string;
  rawName: string;
}

export function miniMcpEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env.MINI_MCP ?? "").trim().toLowerCase();
  return raw !== "off" && raw !== "false" && raw !== "0" && raw !== "no" && raw !== "disabled";
}

export const MINI_AGENT_NAME = "mini-agent";
export const MINI_AGENT_VERSION = "0.2.176";
export const MINI_AGENT_DEFAULT_USER_AGENT = "mini-agent/0.2.176";

export interface MiniAgentConfig {
  name?: string;
  userAgent?: string;
}

let cachedAgentConfig: MiniAgentConfig | null = null;

export function resolveMiniAgentUserAgent(env: NodeJS.ProcessEnv = process.env): string {
  if (env.MINI_USER_AGENT?.trim()) return env.MINI_USER_AGENT.trim();
  if (env.MINI_AGENT_USER_AGENT?.trim()) return env.MINI_AGENT_USER_AGENT.trim();
  if (cachedAgentConfig?.userAgent?.trim()) return cachedAgentConfig.userAgent.trim();
  return MINI_AGENT_DEFAULT_USER_AGENT;
}

export function setMiniAgentConfig(cfg: Partial<MiniAgentConfig> | null): void {
  if (cfg === null) {
    cachedAgentConfig = null;
    return;
  }
  cachedAgentConfig = { ...cachedAgentConfig, ...cfg };
}

export function resolveMiniAgentHome(env: NodeJS.ProcessEnv = process.env): string {
  const home = (env.MINI_AGENT_HOME ?? env.MINI_HOME ?? "").trim();
  if (home) return expandHome(home);
  return join(homedir(), ".mini-agent");
}

let runtimeCodexHome: string | null = null;

/** Register the running Codex daemon home path so Mini can inspect its config.toml. */
export function setMiniMcpRuntimeCodexHome(home: string | null | undefined): void {
  runtimeCodexHome = typeof home === "string" && home.trim() ? home.trim() : null;
}

/**
 * Return all candidate config.toml paths in priority order:
 * 1. MINI_AGENT_CONFIG_PATH / MINI_MCP_CONFIG_PATH explicit env override
 * 2. Dedicated workspace project config (<root>/.mini-agent/config.toml, <root>/.mini/config.toml)
 * 3. Dedicated user/data directory config (~/.mini-agent/config.toml, <dataDir>/mini-agent/config.toml, ~/.config/mini-agent/config.toml)
 * 4. Active workspace project legacy configs (<root>/.codex/config.toml, <root>/.codex-ultra/config.toml)
 * 5. Virtual Codex config (where Codex Ultra UI / VirtualCodexConfigStore persists)
 * 6. Runtime Codex daemon home (from daemon status)
 * 7. CODEX_HOME env override
 * 8. Legacy global ~/.codex/config.toml, ~/.codex-ultra/config.toml, ~/.config/codex/config.toml
 */
export function resolveMiniMcpConfigPaths(env: NodeJS.ProcessEnv = process.env): string[] {
  const paths: string[] = [];
  const add = (p: string | undefined | null) => {
    if (!p) return;
    const trimmed = p.trim();
    if (!trimmed) return;
    try {
      const normalized = resolve(expandHome(trimmed));
      if (!paths.includes(normalized)) paths.push(normalized);
    } catch {
      // ignore
    }
  };

  const explicitPath = env.MINI_AGENT_CONFIG_PATH?.trim() || env.MINI_MCP_CONFIG_PATH?.trim();
  if (explicitPath) {
    add(explicitPath);
    return paths;
  }

  // 1. Dedicated workspace configs for mini-agent (JSON & TOML)
  for (const root of workspaceRoots) {
    add(join(root, ".mini-agent", "config.json"));
    add(join(root, ".mini-agent", "config.toml"));
    add(join(root, ".mini-agent", "mcp.json"));
    add(join(root, ".mini", "config.json"));
    add(join(root, ".mini", "config.toml"));
    // OpenCode project configs (大众惯例 & OpenCode 惯例)
    add(join(root, "opencode.json"));
    add(join(root, "opencode.jsonc"));
    add(join(root, ".opencode", "opencode.json"));
    add(join(root, ".opencode", "opencode.jsonc"));
    // General MCP editor / workspace configs
    add(join(root, "mcp.json"));
    add(join(root, ".mcp.json"));
    add(join(root, ".cursor", "mcp.json"));
    add(join(root, ".vscode", "mcp.json"));
  }

  // 2. Dedicated user and data directory configs for mini-agent & OpenCode global
  const miniAgentHome = resolveMiniAgentHome(env);
  add(join(miniAgentHome, "config.json"));
  add(join(miniAgentHome, "config.toml"));
  add(join(miniAgentHome, "mcp.json"));

  // OpenCode global configs
  add(join(homedir(), ".config", "opencode", "opencode.json"));
  add(join(homedir(), ".config", "opencode", "opencode.jsonc"));
  add(join(homedir(), ".opencode", "opencode.json"));

  const dataDir = env.CODEX_UI_DATA_DIR?.trim() || join(homedir(), ".codex-ultra");
  add(join(dataDir, "mini-agent", "config.json"));
  add(join(dataDir, "mini-agent", "config.toml"));
  add(join(homedir(), ".config", "mini-agent", "config.json"));
  add(join(homedir(), ".config", "mini-agent", "config.toml"));

  // 3. Workspace-level inherited configs
  for (const root of workspaceRoots) {
    add(join(root, ".codex", "config.toml"));
    add(join(root, ".codex-ultra", "config.toml"));
  }

  // 4. Codex Ultra UI virtual config
  try {
    add(resolveVirtualCodexConfigPath(env));
  } catch {}

  // 5. Runtime Codex daemon home
  if (runtimeCodexHome) {
    add(join(expandHome(runtimeCodexHome), "config.toml"));
  }

  // 6. CODEX_HOME
  if (env.CODEX_HOME?.trim()) {
    add(join(expandHome(env.CODEX_HOME.trim()), "config.toml"));
  }

  // 7. Legacy global configs
  add(join(homedir(), ".codex", "config.toml"));
  add(join(homedir(), ".codex-ultra", "config.toml"));
  add(join(homedir(), ".config", "codex", "config.toml"));

  return paths;
}

export function resolveMiniMcpConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  const candidates = resolveMiniMcpConfigPaths(env);
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  const miniAgentHome = resolveMiniAgentHome(env);
  if (existsSync(join(miniAgentHome, "config.json"))) return join(miniAgentHome, "config.json");
  return join(miniAgentHome, "config.toml");
}

function expandHome(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) return join(homedir(), p.slice(2));
  return p;
}

function expandEnvVars(text: string, env: NodeJS.ProcessEnv = process.env): string {
  return text.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (_, braced, plain) => {
    const key = String(braced ?? plain ?? "");
    return env[key] ?? "";
  });
}

/** Codex `sanitize_responses_api_tool_name`: [^0-9A-Za-z_] -> `_`. */
export function sanitizeMcpNamePart(v: string): string {
  let out = "";
  for (const ch of v) {
    out += /[0-9A-Za-z_]/.test(ch) ? ch : "_";
  }
  return out || "_";
}

function shortHash(text: string, len = 12): string {
  return createHash("sha1").update(text).digest("hex").slice(0, len);
}

function fitQualifiedName(qualified: string, rawIdentity: string): string {
  if (qualified.length <= MINI_MCP_MAX_NAME_LEN) return qualified;
  const suffix = `_${shortHash(rawIdentity)}`;
  const keep = MINI_MCP_MAX_NAME_LEN - suffix.length;
  return `${qualified.slice(0, Math.max(1, keep))}${suffix}`;
}

/** Raw (server, tool) -> model-visible qualified name, before dedup. */
export function qualifiedMcpToolName(server: string, tool: string): string {
  const rawIdentity = `${server}\0${tool}`;
  const base = `${MINI_MCP_TOOL_PREFIX}${sanitizeMcpNamePart(server)}${MINI_MCP_NAME_DELIMITER}${sanitizeMcpNamePart(tool)}`;
  return fitQualifiedName(base, rawIdentity);
}

export function isMiniMcpToolName(name: unknown): boolean {
  return typeof name === "string" && name.startsWith(MINI_MCP_TOOL_PREFIX) && name.includes(MINI_MCP_NAME_DELIMITER);
}

function numEnv(key: string, fallback: number, min: number, max: number): number {
  const text = (process.env[key] ?? "").trim();
  if (!text) return fallback;
  const raw = Number(text);
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(raw)));
}

export function miniMcpStartupTimeoutMs(): number {
  return numEnv("MINI_MCP_STARTUP_TIMEOUT_MS", 15_000, 1_000, 120_000);
}

export function miniMcpToolTimeoutMs(): number {
  return numEnv("MINI_MCP_TOOL_TIMEOUT_MS", 60_000, 1_000, 300_000);
}

export function miniMcpMaxTools(): number {
  return numEnv("MINI_MCP_MAX_TOOLS", 64, 0, 256);
}

// ---- workspace roots (Codex parity: servers see real file:// roots) ----

let workspaceRoots: string[] = [];

/** Advertise workspace roots to MCP servers via `roots/list`. Call per turn with the session cwd (+ extra roots). */
export function setMiniMcpWorkspaceRoots(roots: Array<string | undefined | null>): void {
  const seen = new Set<string>();
  workspaceRoots = (roots ?? [])
    .filter((r): r is string => typeof r === "string" && r.trim().length > 0)
    .map((r) => r.trim())
    .filter((r) => {
      if (seen.has(r)) return false;
      seen.add(r);
      return true;
    })
    .slice(0, 8);
}

function workspaceRootEntries(): Array<{ uri: string; name?: string }> {
  return workspaceRoots.map((r) => {
    const uri = r.startsWith("file://") ? r : `file://${r}`;
    const leaf = r.split(/[\\/]/).filter(Boolean).pop();
    return leaf && leaf !== r ? { uri, name: leaf } : { uri };
  });
}

function miniMcpRefreshMs(): number {
  return numEnv("MINI_MCP_REFRESH_MS", 60_000, 5_000, 600_000);
}

// ---- Multi-format config parsing (JSON / JSONC / TOML) ----

type TomlTable = Record<string, unknown>;

/**
 * Safely strips comments (// and /* ... *\/) from JSONC text while preserving string literals,
 * and strips trailing commas before } or ].
 */
export function stripJsonComments(text: string): string {
  let out = "";
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;
  let escape = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    const next = text[i + 1];

    if (inLineComment) {
      if (ch === "\n") {
        inLineComment = false;
        out += ch;
      }
      continue;
    }

    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i++;
      }
      continue;
    }

    if (inString) {
      out += ch;
      if (escape) {
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }

    if (ch === "/" && next === "/") {
      inLineComment = true;
      i++;
      continue;
    }

    if (ch === "/" && next === "*") {
      inBlockComment = true;
      i++;
      continue;
    }

    out += ch;
  }

  return out.replace(/,\s*([}\]])/g, "$1");
}

export async function parseConfigFile(filePath: string, text: string): Promise<Record<string, unknown>> {
  const trimmed = text.trim();
  const isJsonLike = filePath.endsWith(".json") || filePath.endsWith(".jsonc") || trimmed.startsWith("{");
  if (isJsonLike) {
    try {
      const parsed = JSON.parse(stripJsonComments(trimmed));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Fallback to toml parser if JSON parsing failed
    }
  }

  try {
    return await parseConfigToml(text);
  } catch (e) {
    if (!isJsonLike && trimmed.startsWith("{")) {
      try {
        const parsed = JSON.parse(stripJsonComments(trimmed));
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch {}
    }
    throw e;
  }
}

async function parseConfigToml(text: string): Promise<TomlTable> {
  try {
    const mod = await import("smol-toml");
    return (mod.parse(text) ?? {}) as TomlTable;
  } catch {
    return parseMcpServersSubset(text);
  }
}

/** Minimal subset parser: only `[mcp_servers.*]` tables + their scalars. Exported for tests/CLI. */
export function parseMcpServersSubset(text: string): TomlTable {
  const servers: TomlTable = {};
  const lines = text.split(/\r?\n/);
  // Track current server + nested sub-table path (e.g. [mcp_servers.fs.env]).
  let server: string | null = null;
  let sub: string[] = [];
  let acc: TomlTable = {};
  const commit = (): void => {
    if (!server) return;
    const root = ((servers[server] ?? {}) as TomlTable);
    servers[server] = root;
    let node = root;
    for (const key of sub) {
      const next = (node[key] ?? {}) as TomlTable;
      if (typeof next !== "object" || Array.isArray(next)) break;
      node[key] = next;
      node = next as TomlTable;
    }
    for (const [k, v] of Object.entries(acc)) node[k] = v;
  };
  for (const rawLine of lines) {
    const line = rawLine.split(/(^|[^\\])#/)[0]?.trim() ?? "";
    if (!line) continue;
    const header = line.match(/^\[([^\]]+)\]$/);
    if (header) {
      commit();
      const path = (header[1] ?? "").trim().split(".").map((s) => s.trim().replace(/^["']|["']$/g, ""));
      if (path[0] !== "mcp_servers" || path.length < 2) {
        server = null;
        sub = [];
        acc = {};
        continue;
      }
      server = path[1]!;
      sub = path.slice(2);
      acc = {};
      continue;
    }
    if (!server) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim().replace(/^["']|["']$/g, "");
    if (!key || key.includes(".")) continue;
    acc[key] = parseTomlValue(line.slice(eq + 1).trim());
  }
  commit();
  return { mcp_servers: servers };
}

function parseTomlValue(text: string): unknown {
  if (text === "true") return true;
  if (text === "false") return false;
  const str = text.match(/^"""([\s\S]*)"""$/) ?? text.match(/^'''([\s\S]*)'''$/);
  if (str) return str[1];
  const quoted = text.match(/^"((?:[^"\\]|\\.)*)"$/) ?? text.match(/^'([^']*)'$/);
  if (quoted) {
    const body = quoted[1] ?? "";
    try {
      return JSON.parse(`"${body.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`);
    } catch {
      return body;
    }
  }
  if (/^-?\d+$/.test(text)) return Number(text);
  if (/^-?\d*\.\d+$/.test(text)) return Number(text);
  if (text.startsWith("[") && text.endsWith("]")) {
    const inner = text.slice(1, -1).trim();
    if (!inner) return [];
    // Split on commas not inside quotes/brackets (good enough for string arrays).
    const parts: string[] = [];
    let cur = "";
    let depth = 0;
    let quote: string | null = null;
    for (let i = 0; i < inner.length; i++) {
      const ch = inner[i]!;
      if (quote) {
        cur += ch;
        if (ch === quote && inner[i - 1] !== "\\") quote = null;
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        cur += ch;
        continue;
      }
      if (ch === "[" || ch === "{") depth++;
      if (ch === "]" || ch === "}") depth--;
      if (ch === "," && depth === 0) {
        parts.push(cur);
        cur = "";
        continue;
      }
      cur += ch;
    }
    if (cur.trim()) parts.push(cur);
    return parts.map((p) => parseTomlValue(p.trim()));
  }
  if (text.startsWith("{") && text.endsWith("}")) {
    const out: TomlTable = {};
    const inner = text.slice(1, -1).trim();
    if (!inner) return out;
    for (const part of inner.split(",")) {
      const eq = part.indexOf("=");
      if (eq < 0) continue;
      const k = part.slice(0, eq).trim().replace(/^["']|["']$/g, "");
      if (k) out[k] = parseTomlValue(part.slice(eq + 1).trim());
    }
    return out;
  }
  return text;
}

function asStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((x): x is string => typeof x === "string");
  return out.length || v.length === 0 ? out : undefined;
}

function asStringMap(v: unknown): Record<string, string> | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as TomlTable)) {
    if (typeof val === "string") out[k] = val;
    else if (typeof val === "number" || typeof val === "boolean") out[k] = String(val);
  }
  return out;
}

function toServerConfig(name: string, raw: unknown): MiniMcpServerConfig | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const enabled = r.enabled === undefined ? true : r.enabled === true;
  const startupSec = typeof r.startup_timeout_sec === "number" ? r.startup_timeout_sec
    : typeof r.startup_timeout_secs === "number" ? r.startup_timeout_secs
    : typeof r.startupTimeoutSec === "number" ? r.startupTimeoutSec : undefined;
  const toolSec = typeof r.tool_timeout_sec === "number" ? r.tool_timeout_sec
    : typeof r.tool_timeout_secs === "number" ? r.tool_timeout_secs
    : typeof r.toolTimeoutSec === "number" ? r.toolTimeoutSec
    : typeof r.timeout === "number" ? (r.timeout > 1000 ? r.timeout / 1000 : r.timeout) : undefined;

  let command: string | undefined;
  let args: string[] | undefined = asStringArray(r.args);

  if (Array.isArray(r.command)) {
    // OpenCode array style: command: ["node", "path/to/script.js", "--arg"]
    const cmdArray = r.command.filter((x): x is string => typeof x === "string");
    if (cmdArray.length > 0) {
      command = cmdArray[0];
      const cmdArgs = cmdArray.slice(1);
      args = [...cmdArgs, ...(args ?? [])];
    }
  } else if (typeof r.command === "string") {
    command = r.command;
  }

  const env = asStringMap(r.env ?? r.environment ?? r.env_vars);
  const cwd = typeof r.cwd === "string" ? r.cwd : undefined;
  const url = typeof r.url === "string" ? r.url : undefined;
  const httpHeaders = asStringMap(r.http_headers ?? r.headers);
  const envHttpHeaders = asStringMap(r.env_http_headers);
  const bearerTokenEnvVar = typeof r.bearer_token_env_var === "string" ? r.bearer_token_env_var
    : typeof r.bearerTokenEnvVar === "string" ? r.bearerTokenEnvVar : undefined;
  if (!command && !url) return null;
  // OAuth-gated servers need an interactive Codex login flow mini cannot
  // perform: an explicit `[mcp_servers.<name>.oauth]` table or
  // `auth = "ema_auth"` (enterprise no-fallback flow) means skip with a
  // clear warning instead of failing at runtime. Plain `auth = "oauth"`
  // (the Codex default) is still attempted — local servers often need no
  // credentials, and 401/403 surfaces a login hint at call time.
  const auth = typeof r.auth === "string" ? r.auth.trim().toLowerCase() : "";
  if (auth === "ema_auth" || auth === "ema") {
    console.warn(`[mini-mcp] server '${name}' needs enterprise auth (auth = "ema_auth"), skipping: not supported by mini`);
    return null;
  }
  if (r.oauth && typeof r.oauth === "object" && !Array.isArray(r.oauth) && Object.keys(r.oauth as Record<string, unknown>).length > 0) {
    console.warn(`[mini-mcp] server '${name}' declares [mcp_servers.${name}.oauth], skipping: interactive OAuth login is not supported by mini`);
    return null;
  }
  const mergedHeaders = { ...(envHttpHeaders ? resolveEnvHeaders(envHttpHeaders) : {}), ...(httpHeaders ?? {}) };
  return {
    name,
    command,
    args: args ?? [],
    env,
    cwd,
    url,
    httpHeaders: Object.keys(mergedHeaders).length ? mergedHeaders : undefined,
    bearerTokenEnvVar,
    enabled,
    startupTimeoutMs: startupSec !== undefined
      ? Math.min(120_000, Math.max(1_000, Math.floor(startupSec * 1000)))
      : miniMcpStartupTimeoutMs(),
    toolTimeoutMs: toolSec !== undefined
      ? Math.min(300_000, Math.max(1_000, Math.floor(toolSec * 1000)))
      : miniMcpToolTimeoutMs(),
    enabledTools: asStringArray(r.enabled_tools ?? r.enabledTools),
    disabledTools: asStringArray(r.disabled_tools ?? r.disabledTools),
  };
}

function resolveEnvHeaders(mapping: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [header, envName] of Object.entries(mapping)) {
    const value = process.env[envName.trim()];
    if (value) out[header] = value;
  }
  return out;
}

export async function loadMiniMcpServers(configPath?: string, env: NodeJS.ProcessEnv = process.env): Promise<MiniMcpServerConfig[]> {
  if (!miniMcpEnabled(env)) return [];
  const paths = configPath ? [configPath] : resolveMiniMcpConfigPaths(env);
  const serverMap = new Map<string, MiniMcpServerConfig>();
  const loadedFromPaths: string[] = [];

  // Iterate in reverse priority order (global default -> CODEX_HOME -> virtual -> workspace -> explicit env)
  // so higher-priority definitions override earlier ones by server name.
  const reversePaths = [...paths].reverse();
  for (const path of reversePaths) {
    let text: string;
    try {
      text = await readFile(path, "utf8");
    } catch {
      continue;
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = await parseConfigFile(path, text);
    } catch (e) {
      console.warn(`[mini-mcp] failed to parse ${path}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    if (parsed.agent && typeof parsed.agent === "object" && !Array.isArray(parsed.agent)) {
      const ag = parsed.agent as Record<string, unknown>;
      if (!cachedAgentConfig) cachedAgentConfig = {};
      if (typeof ag.name === "string" && ag.name.trim()) cachedAgentConfig.name = ag.name.trim();
      const ua = (typeof ag.user_agent === "string" && ag.user_agent.trim())
        || (typeof ag.userAgent === "string" && ag.userAgent.trim());
      if (ua) cachedAgentConfig.userAgent = ua;
    }

    let countInFile = 0;
    const registerTable = (table: unknown) => {
      if (!table || typeof table !== "object" || Array.isArray(table)) return;
      for (const [name, raw] of Object.entries(table as Record<string, unknown>)) {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
        try {
          const cfg = toServerConfig(name, raw);
          if (cfg) {
            serverMap.set(name, cfg);
            countInFile++;
          }
        } catch {}
      }
    };

    // 1. OpenCode format: `mcp: { <name>: { ... } }` or `mcp: { servers: { <name>: { ... } } }`
    if (parsed.mcp && typeof parsed.mcp === "object" && !Array.isArray(parsed.mcp)) {
      const mcpObj = parsed.mcp as Record<string, unknown>;
      if (mcpObj.servers && typeof mcpObj.servers === "object" && !Array.isArray(mcpObj.servers)) {
        registerTable(mcpObj.servers);
      }
      for (const [name, raw] of Object.entries(mcpObj)) {
        if (name === "servers") continue;
        if (raw && typeof raw === "object" && !Array.isArray(raw)) {
          try {
            const cfg = toServerConfig(name, raw);
            if (cfg) {
              serverMap.set(name, cfg);
              countInFile++;
            }
          } catch {}
        }
      }
    }

    // 2. Standard / Claude / Cursor / VSCode format: `mcpServers: { <name>: { ... } }`
    if (parsed.mcpServers) {
      registerTable(parsed.mcpServers);
    }

    // 3. Codex TOML / snake_case format: `mcp_servers: { <name>: { ... } }`
    if (parsed.mcp_servers) {
      registerTable(parsed.mcp_servers);
    }

    // 4. Generic servers table: `servers: { <name>: { ... } }`
    if (parsed.servers) {
      registerTable(parsed.servers);
    }

    if (countInFile > 0 && !loadedFromPaths.includes(path)) {
      loadedFromPaths.push(path);
    }
  }

  const out: MiniMcpServerConfig[] = [];
  for (const cfg of serverMap.values()) {
    if (cfg.enabled) out.push(cfg);
  }
  return out;
}

// ---- MCP wire clients ----

interface McpRawTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

interface McpRawResource {
  uri: string;
  name?: string;
  title?: string;
  description?: string;
  mimeType?: string;
}

export interface MiniMcpResource {
  server: string;
  uri: string;
  name: string;
  title?: string;
  description?: string;
  mimeType?: string;
}

export interface MiniMcpResourceContent {
  uri: string;
  mimeType?: string;
  text?: string;
  blob?: string;
}

interface McpConnection {
  server: MiniMcpServerConfig;
  init(timeoutMs: number): Promise<void>;
  listTools(): Promise<McpRawTool[]>;
  callTool(name: string, args: Record<string, unknown>, timeoutMs: number): Promise<string>;
  listResources(): Promise<McpRawResource[]>;
  readResource(uri: string): Promise<MiniMcpResourceContent[]>;
  close(): void;
}

type JsonRpcId = number | string;

function rpcRequest(id: JsonRpcId, method: string, params?: unknown): string {
  return `${JSON.stringify({ jsonrpc: "2.0", id, ...{ method, ...(params !== undefined ? { params } : {}) } })}\n`;
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

/** 存活中的 stdio MCP 子进程：父进程退出时同步整树杀掉，防止孤儿常驻后台。 */
const liveStdioMcpProcs = new Set<ChildProcess>();
let miniMcpShutdownHooksInstalled = false;

function ensureMiniMcpShutdownHooks(): void {
  if (miniMcpShutdownHooksInstalled) return;
  miniMcpShutdownHooksInstalled = true;
  const killAllSync = () => {
    for (const proc of Array.from(liveStdioMcpProcs)) {
      try {
        const pid = proc.pid;
        if (pid && process.platform === "win32") {
          spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
        } else {
          try { proc.kill("SIGKILL"); } catch {}
        }
      } catch { /* best-effort */ }
    }
    liveStdioMcpProcs.clear();
  };
  try {
    process.on("exit", () => {
      try { killAllSync(); } catch { /* ignore */ }
    });
  } catch { /* ignore */ }
  try { process.once("SIGINT", () => { try { killAllSync(); } catch {} }); } catch { /* ignore */ }
  try { process.once("SIGTERM", () => { try { killAllSync(); } catch {} }); } catch { /* ignore */ }
}

class StdioMcpConnection implements McpConnection {
  private proc: ChildProcess;
  private nextId = 1;
  private pending = new Map<JsonRpcId, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private buffer = "";
  private closed = false;

  constructor(readonly server: MiniMcpServerConfig) {
    const env: NodeJS.ProcessEnv = { ...process.env };
    if (server.env) {
      for (const [k, v] of Object.entries(server.env)) env[k] = expandEnvVars(v);
    }
    const command = expandEnvVars(server.command ?? "");
    const args = (server.args ?? []).map((a) => expandEnvVars(a));
    const cwd = server.cwd ? expandHome(expandEnvVars(server.cwd)) : undefined;
    this.proc = spawn(command, args, { env, cwd, stdio: ["pipe", "pipe", "ignore"], windowsHide: true });
    liveStdioMcpProcs.add(this.proc);
    ensureMiniMcpShutdownHooks();
    const untrack = () => { liveStdioMcpProcs.delete(this.proc); };
    this.proc.stdout?.on("data", (chunk) => this.onData(String(chunk)));
    this.proc.on("error", (e) => this.failAll(e instanceof Error ? e : new Error(String(e))));
    this.proc.on("exit", () => { untrack(); this.failAll(new Error(`MCP server '${server.name}' exited`)); });
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let idx: number;
    while ((idx = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (msg.id === undefined || msg.id === null) continue; // notification
      // Server-initiated request (has `method`): answer it so servers that
      // require roots/capability negotiation never hang. Responses (result /
      // error, no `method`) resolve our pending calls below.
      if (typeof msg.method === "string") {
        this.answerServerRequest(msg.id as JsonRpcId, String(msg.method));
        continue;
      }
      const entry = this.pending.get(msg.id as JsonRpcId);
      if (!entry) continue;
      this.pending.delete(msg.id as JsonRpcId);
      if (msg.error !== undefined && msg.error !== null) {
        const err = msg.error as Record<string, unknown>;
        entry.reject(new Error(String(err.message ?? JSON.stringify(err)).slice(0, 500)));
      } else {
        entry.resolve(msg.result ?? null);
      }
    }
  }

  /** Answer one server-initiated JSON-RPC request (roots/ping supported). */
  private answerServerRequest(id: JsonRpcId, method: string): void {
    let payload: Record<string, unknown>;
    if (method === "roots/list") payload = { result: { roots: workspaceRootEntries() } };
    else if (method === "ping") payload = { result: {} };
    else payload = { error: { code: -32601, message: `Method not found: ${method.slice(0, 120)}` } };
    try {
      this.proc.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", id, ...payload })}\n`);
    } catch {
      // Best-effort: a dead pipe surfaces via exit/error handlers.
    }
  }

  private failAll(e: Error): void {
    if (this.closed) return;
    for (const [, entry] of this.pending) entry.reject(e);
    this.pending.clear();
  }

  private send<T>(method: string, params: unknown, timeoutMs: number): Promise<T> {
    if (this.closed) return Promise.reject(new Error(`MCP server '${this.server.name}' is closed`));
    const id = this.nextId++;
    const p = new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    });
    try {
      this.proc.stdin?.write(rpcRequest(id, method, params));
    } catch (e) {
      this.pending.delete(id);
      return Promise.reject(e instanceof Error ? e : new Error(String(e)));
    }
    return withTimeout(p, timeoutMs, `MCP '${this.server.name}' ${method}`);
  }

  async init(timeoutMs: number): Promise<void> {
    await this.send("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "mini-codex", version: "0.1.26" },
    }, timeoutMs);
    try {
      this.proc.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
    } catch {
      // Non-fatal: some servers proceed without the notification.
    }
  }

  async listTools(): Promise<McpRawTool[]> {
    const result = await this.send<{ tools?: McpRawTool[] }>("tools/list", {}, this.server.startupTimeoutMs);
    return Array.isArray(result.tools) ? result.tools : [];
  }

  async listResources(): Promise<McpRawResource[]> {
    const result = await this.send<{ resources?: McpRawResource[] }>(
      "resources/list",
      {},
      this.server.startupTimeoutMs,
    );
    return Array.isArray(result.resources) ? result.resources : [];
  }

  async readResource(uri: string): Promise<MiniMcpResourceContent[]> {
    const result = await this.send<{ contents?: MiniMcpResourceContent[] }>(
      "resources/read",
      { uri },
      this.server.toolTimeoutMs,
    );
    return Array.isArray(result.contents) ? result.contents : [];
  }

  async callTool(name: string, args: Record<string, unknown>, timeoutMs: number): Promise<string> {
    const result = await this.send<{ content?: unknown; structuredContent?: unknown; isError?: boolean }>(
      "tools/call",
      { name, arguments: args },
      timeoutMs,
    );
    return mcpResultToText(result);
  }

  close(): void {
    this.closed = true;
    this.failAll(new Error("closed"));
    liveStdioMcpProcs.delete(this.proc);
    try {
      const pid = this.proc.pid;
      if (pid && process.platform === "win32") {
        // Windows 上只 kill 直接子进程会留下孙进程（node 包装器拉起的真实 server）。
        // 用 taskkill /T /F 杀整棵树，与 agy/grok/opencode manager 一致。
        const killer = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true });
        killer.on("error", () => {
          try { this.proc.kill("SIGKILL"); } catch {}
        });
      } else {
        this.proc.kill();
      }
    } catch {
      // ignore
    }
  }
}

function parseSseRpcPayload(text: string): unknown {
  // Streamable HTTP may return `text/event-stream` with `data: {...}` lines.
  if (!text.includes("data:")) {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }
  let last: unknown = null;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      last = JSON.parse(payload);
    } catch {
      // keep scanning
    }
  }
  return last;
}

class StreamableHttpMcpConnection implements McpConnection {
  private sessionId: string | null = null;
  private nextId = 1;

  constructor(readonly server: MiniMcpServerConfig) {}

  private headers(extra?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = {
      "User-Agent": resolveMiniAgentUserAgent(),
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...extra,
    };
    if (this.sessionId) headers["Mcp-Session-Id"] = this.sessionId;
    const bearerEnv = this.server.bearerTokenEnvVar?.trim();
    const token = bearerEnv ? process.env[bearerEnv] : undefined;
    if (token && !headers.Authorization && !headers.authorization) headers.Authorization = `Bearer ${token}`;
    if (this.server.httpHeaders) {
      for (const [k, v] of Object.entries(this.server.httpHeaders)) headers[k] = expandEnvVars(v);
    }
    return headers;
  }

  private async rpc<T>(method: string, params: unknown, timeoutMs: number): Promise<T> {
    try {
      return await this.doRpc<T>(method, params, timeoutMs);
    } catch (e) {
      // Expired streamable-HTTP session: drop it, run one fresh initialize
      // via doRpc (never via rpc — no recursion), then retry the call once.
      if (this.sessionId && e instanceof Error && /HTTP 404/.test(e.message)) {
        this.sessionId = null;
        await this.doRpc("initialize", {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: MINI_AGENT_NAME, version: MINI_AGENT_VERSION },
        }, this.server.startupTimeoutMs);
        return this.doRpc<T>(method, params, timeoutMs);
      }
      throw e;
    }
  }

  private async doRpc<T>(method: string, params: unknown, timeoutMs: number): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(this.server.url ?? "", {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ jsonrpc: "2.0", id: this.nextId++, method, params }),
        signal: ctrl.signal,
      });
      const session = res.headers.get("mcp-session-id");
      if (session) this.sessionId = session;
      const text = await res.text();
      if (res.status === 401 || res.status === 403) {
        throw new Error(
          `HTTP ${res.status}: MCP server '${this.server.name}' needs OAuth login — run \`codex mcp login ${this.server.name}\` (or set bearer_token_env_var/http_headers in config.toml), then retry.`,
        );
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
      const parsed = parseSseRpcPayload(text) as Record<string, unknown> | null;
      if (!parsed || typeof parsed !== "object") throw new Error("empty MCP HTTP response");
      if (parsed.error !== undefined && parsed.error !== null) {
        const err = parsed.error as Record<string, unknown>;
        throw new Error(String(err.message ?? JSON.stringify(err)).slice(0, 500));
      }
      return (parsed.result ?? null) as T;
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") throw new Error(`MCP '${this.server.name}' ${method} timed out after ${timeoutMs}ms`);
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  async init(timeoutMs: number): Promise<void> {
    await this.rpc("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: MINI_AGENT_NAME, version: MINI_AGENT_VERSION },
    }, timeoutMs);
    // Spec-mandated initialized notification (separate POST on streamable
    // HTTP). Best-effort: stateless servers answer 202/404, both are fine.
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), Math.min(5_000, timeoutMs));
      try {
        await fetch(this.server.url ?? "", {
          method: "POST",
          headers: this.headers(),
          body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
          signal: ctrl.signal,
        });
      } finally {
        clearTimeout(timer);
      }
    } catch {
      // Non-fatal: initialization already succeeded.
    }
  }

  async listTools(): Promise<McpRawTool[]> {
    const result = await this.rpc<{ tools?: McpRawTool[] }>("tools/list", {}, this.server.startupTimeoutMs);
    return Array.isArray(result.tools) ? result.tools : [];
  }

  async listResources(): Promise<McpRawResource[]> {
    const result = await this.rpc<{ resources?: McpRawResource[] }>(
      "resources/list",
      {},
      this.server.startupTimeoutMs,
    );
    return Array.isArray(result.resources) ? result.resources : [];
  }

  async readResource(uri: string): Promise<MiniMcpResourceContent[]> {
    const result = await this.rpc<{ contents?: MiniMcpResourceContent[] }>(
      "resources/read",
      { uri },
      this.server.toolTimeoutMs,
    );
    return Array.isArray(result.contents) ? result.contents : [];
  }

  async callTool(name: string, args: Record<string, unknown>, timeoutMs: number): Promise<string> {
    const result = await this.rpc<{ content?: unknown; structuredContent?: unknown; isError?: boolean }>(
      "tools/call",
      { name, arguments: args },
      timeoutMs,
    );
    return mcpResultToText(result);
  }

  close(): void {
    this.sessionId = null;
  }
}

/** MCP `tools/call` result -> plain text (Codex renders the same text blocks). Exported for tests. */
export function mcpResultToText(result: { content?: unknown; structuredContent?: unknown; isError?: boolean } | null): string {
  if (!result || typeof result !== "object") return "(empty MCP result)";
  const parts: string[] = [];
  if (Array.isArray(result.content)) {
    for (const block of result.content) {
      if (!block || typeof block !== "object") continue;
      const b = block as Record<string, unknown>;
      if (typeof b.text === "string" && b.text) parts.push(b.text);
      else if (b.type === "image" || b.type === "audio") parts.push(`[${String(b.type)} content omitted]`);
      else if (typeof b.data === "string") parts.push(b.data);
    }
  }
  if (!parts.length && result.structuredContent !== undefined) {
    try {
      parts.push(JSON.stringify(result.structuredContent));
    } catch {
      parts.push(String(result.structuredContent));
    }
  }
  const text = parts.join("\n").trim();
  return text || "(empty MCP result)";
}

// ---- connection cache + tool registry ----

type CachedServer = {
  config: MiniMcpServerConfig;
  conn: McpConnection | null;
  tools: MiniMcpToolDef[];
  rawByQualified: Map<string, string>;
  listedAt: number;
  failedAt: number;
  failReason: string;
};

const mcpCache = new Map<string, CachedServer>();

function allowsTool(cfg: MiniMcpServerConfig, rawName: string): boolean {
  if (cfg.enabledTools && !cfg.enabledTools.includes(rawName)) return false;
  if (cfg.disabledTools && cfg.disabledTools.includes(rawName)) return false;
  return true;
}

function buildToolDefs(server: string, rawTools: McpRawTool[], cfg: MiniMcpServerConfig): { tools: MiniMcpToolDef[]; rawByQualified: Map<string, string> } {
  const candidates = rawTools
    .filter((t) => t && typeof t.name === "string" && t.name && allowsTool(cfg, t.name))
    .map((t) => ({
      raw: t.name,
      base: qualifiedMcpToolName(server, t.name),
      description: typeof t.description === "string" && t.description ? t.description.slice(0, 500) : `MCP tool ${t.name} from server ${server}`,
      schema: t.inputSchema && typeof t.inputSchema === "object" ? (t.inputSchema as Record<string, unknown>) : { type: "object", properties: {} },
    }));
  // Collision handling mirrors Codex: hash-suffix duplicates.
  const counts = new Map<string, number>();
  for (const c of candidates) counts.set(c.base, (counts.get(c.base) ?? 0) + 1);
  const used = new Set<string>();
  const tools: MiniMcpToolDef[] = [];
  const rawByQualified = new Map<string, string>();
  for (const c of candidates) {
    let name = c.base;
    if ((counts.get(c.base) ?? 0) > 1 || used.has(name)) {
      const rawIdentity = `${server}\0${c.raw}`;
      name = fitQualifiedName(`${c.base}_${shortHash(rawIdentity, 8)}`, rawIdentity);
      let n = 1;
      while (used.has(name)) {
        name = fitQualifiedName(`${c.base}_${shortHash(`${rawIdentity}${n}`, 8)}`, rawIdentity);
        n++;
        if (n > 10) break;
      }
    }
    if (used.has(name)) continue;
    used.add(name);
    rawByQualified.set(name, c.raw);
    tools.push({
      name,
      description: `[${server}] ${c.description}`,
      schema: { ...c.schema, additionalProperties: true },
      server,
      rawName: c.raw,
    });
  }
  return { tools, rawByQualified };
}

async function connectServer(cfg: MiniMcpServerConfig): Promise<McpConnection> {
  const conn: McpConnection = cfg.url
    ? new StreamableHttpMcpConnection(cfg)
    : new StdioMcpConnection(cfg);
  await withTimeout(conn.init(cfg.startupTimeoutMs), cfg.startupTimeoutMs + 2_000, `MCP '${cfg.name}' initialize`);
  return conn;
}

/** List + cache tools for all enabled servers. Never throws. */
export async function listMiniMcpTools(forceRefresh = false): Promise<MiniMcpToolDef[]> {
  if (!miniMcpEnabled()) return [];
  const servers = await loadMiniMcpServers();
  const now = Date.now();
  const refreshMs = miniMcpRefreshMs();
  const maxTools = miniMcpMaxTools();
  const out: MiniMcpToolDef[] = [];
  const seen = new Set<string>();
  if (forceRefresh || mcpCache.size === 0) {
    if (servers.length === 0) {
      const paths = resolveMiniMcpConfigPaths();
      console.info(`[mini-mcp] no enabled servers found (checked config paths: ${paths.join("; ")})`);
    } else {
      console.info(`[mini-mcp] discovered ${servers.length} enabled server(s): ${servers.map((s) => s.name).join(", ")}`);
    }
  }
  for (const cfg of servers) {
    if (!seen.has(cfg.name)) seen.add(cfg.name);
    let cached = mcpCache.get(cfg.name);
    const stale = !cached || forceRefresh || now - cached.listedAt > refreshMs;
    // Config changed (command/url/args) -> drop the old connection.
    if (cached && (cached.config.command !== cfg.command || cached.config.url !== cfg.url || JSON.stringify(cached.config.args) !== JSON.stringify(cfg.args))) {
      try {
        cached.conn?.close();
      } catch {
        // ignore
      }
      mcpCache.delete(cfg.name);
      cached = undefined;
    }
    if (cached && !stale && cached.conn) {
      out.push(...cached.tools);
      continue;
    }
    if (cached && !cached.conn && now - cached.failedAt < 30_000 && !forceRefresh) {
      continue; // recent failure: avoid reconnect storm
    }
    try {
      const oldConn = cached?.conn;
      const conn = await connectServer(cfg);
      const rawTools = await withTimeout(conn.listTools(), cfg.startupTimeoutMs, `MCP '${cfg.name}' tools/list`);
      const built = buildToolDefs(cfg.name, rawTools, cfg);
      mcpCache.set(cfg.name, { config: cfg, conn, tools: built.tools, rawByQualified: built.rawByQualified, listedAt: now, failedAt: 0, failReason: "" });
      // 重连成功后 capabilities 可能变化：清除 resources 不支持标记，允许重新探测一次。
      mcpResourcesUnsupported.delete(cfg.name);
      // Reconnect succeeded: now safe to retire the previous process.
      // (Closed here — not before connect — so a failed reconnect keeps
      // serving stale tools instead of blanking the model.)
      try { oldConn?.close(); } catch {}
      out.push(...built.tools);
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      console.warn(`[mini-mcp] server '${cfg.name}' unavailable, skipping: ${reason.slice(0, 200)}`);
      mcpCache.set(cfg.name, {
        config: cfg,
        conn: null,
        tools: cached?.tools ?? [],
        rawByQualified: cached?.rawByQualified ?? new Map(),
        listedAt: cached?.listedAt ?? 0,
        failedAt: now,
        failReason: reason.slice(0, 300),
      });
      // Serve stale tools (if any) so a restart doesn't blank the model.
      if (cached?.tools.length) out.push(...cached.tools);
    }
    if (maxTools > 0 && out.length >= maxTools) break;
  }
  // Drop servers removed from config.
  for (const key of [...mcpCache.keys()]) {
    if (!seen.has(key)) {
      try {
        mcpCache.get(key)?.conn?.close();
      } catch {
        // ignore
      }
      mcpCache.delete(key);
    }
  }
  return maxTools > 0 ? out.slice(0, maxTools) : out;
}

/** Resolve a qualified name across the cache (refreshes once when unknown). */
async function resolveMcpCall(qualified: string): Promise<{ conn: McpConnection; rawName: string; timeoutMs: number } | null> {
  for (const cached of mcpCache.values()) {
    if (!cached.conn) continue;
    const raw = cached.rawByQualified.get(qualified);
    if (raw) return { conn: cached.conn, rawName: raw, timeoutMs: cached.config.toolTimeoutMs };
  }
  await listMiniMcpTools(false);
  for (const cached of mcpCache.values()) {
    if (!cached.conn) continue;
    const raw = cached.rawByQualified.get(qualified);
    if (raw) return { conn: cached.conn, rawName: raw, timeoutMs: cached.config.toolTimeoutMs };
  }
  return null;
}

/** Execute one qualified MCP tool. Returns model-facing text (never throws). */
export async function runMiniMcpTool(qualified: string, args: Record<string, unknown>): Promise<string> {
  const target = await resolveMcpCall(qualified);
  if (!target) return `unknown MCP tool: ${qualified.slice(0, 120)}. Use list_agents-style discovery: MCP tools come from ~/.codex/config.toml [mcp_servers.*] and are named mcp__<server>__<tool>.`;
  try {
    const text = await target.conn.callTool(target.rawName, args ?? {}, target.timeoutMs);
    return text.slice(0, 8000);
  } catch (e) {
    return `MCP tool error (${qualified.slice(0, 80)}): ${(e instanceof Error ? e.message : String(e)).slice(0, 500)}`;
  }
}

/** Model-facing text for one `resources/read` result (text preferred, binary described). */
export function mcpResourceContentsToText(contents: MiniMcpResourceContent[] | null | undefined): string {
  if (!Array.isArray(contents) || !contents.length) return "(empty MCP resource)";
  const parts: string[] = [];
  for (const entry of contents) {
    if (!entry || typeof entry !== "object") continue;
    if (typeof entry.text === "string" && entry.text) {
      parts.push(entry.text);
    } else if (typeof entry.blob === "string" && entry.blob) {
      const bytes = Math.floor((entry.blob.length * 3) / 4);
      parts.push(`[binary content${entry.mimeType ? ` (${entry.mimeType})` : ""} ~${bytes} bytes, base64 omitted]`);
    }
  }
  const text = parts.join("\n").trim().slice(0, 8000);
  return text || "(empty MCP resource)";
}

/** Resolve a connected server (refreshes once when unknown/disconnected). */
async function resolveMcpServerConn(name: string): Promise<{ conn: McpConnection; config: MiniMcpServerConfig } | null> {
  const want = String(name ?? "").trim();
  if (!want) return null;
  for (const [key, cached] of mcpCache) {
    if (cached.conn && (key === want || key.toLowerCase() === want.toLowerCase())) {
      return { conn: cached.conn, config: cached.config };
    }
  }
  await listMiniMcpTools(false);
  for (const [key, cached] of mcpCache) {
    if (cached.conn && (key === want || key.toLowerCase() === want.toLowerCase())) {
      return { conn: cached.conn, config: cached.config };
    }
  }
  return null;
}

/** 不实现 resources/* 的 server 名集合：命中后跳过探测，不再刷 warn（sa-vm/jev 等轻量 server 常见）。重连成功或测试重置时清除。 */
const mcpResourcesUnsupported = new Set<string>();

function isResourcesUnsupportedError(e: unknown): boolean {
  const msg = (e instanceof Error ? e.message : String(e)).toLowerCase();
  return (
    msg.includes("not supported") ||
    msg.includes("unknown method") ||
    msg.includes("method not found") ||
    msg.includes("-32601")
  );
}

/** List resources across connected servers (optionally one server). Never throws. */
export async function listMiniMcpResources(server?: string): Promise<MiniMcpResource[]> {
  if (!miniMcpEnabled()) return [];
  const out: MiniMcpResource[] = [];
  const names = new Set<string>();
  if (server?.trim()) {
    names.add(server.trim());
  } else {
    for (const [key, cached] of mcpCache) {
      if (cached.conn) names.add(key);
    }
    if (!names.size) {
      await listMiniMcpTools(false);
      for (const [key, cached] of mcpCache) {
        if (cached.conn) names.add(key);
      }
    }
  }
  for (const name of names) {
    // 已知不支持 resources 的 server：直接跳过，避免每次调用都刷一条 warn 淹没有效日志。
    if (mcpResourcesUnsupported.has(name)) continue;
    const target = await resolveMcpServerConn(name);
    if (!target) continue;
    try {
      const raw = await withTimeout(
        target.conn.listResources(),
        target.config.startupTimeoutMs,
        `MCP '${name}' resources/list`,
      );
      for (const r of raw) {
        if (!r || typeof r.uri !== "string" || !r.uri) continue;
        out.push({
          server: name,
          uri: r.uri,
          name: typeof r.name === "string" && r.name ? r.name : r.uri,
          title: typeof r.title === "string" && r.title ? r.title : undefined,
          description: typeof r.description === "string" && r.description ? r.description.slice(0, 500) : undefined,
          mimeType: typeof r.mimeType === "string" && r.mimeType ? r.mimeType : undefined,
        });
        if (out.length >= 200) return out;
      }
    } catch (e) {
      if (isResourcesUnsupportedError(e)) {
        // 能力缺失是稳定状态（非故障）：记一次，后续调用静默跳过。
        if (!mcpResourcesUnsupported.has(name)) {
          mcpResourcesUnsupported.add(name);
          console.debug(`[mini-mcp] resources/list not supported by '${name}', skipping further probes`);
        }
      } else {
        console.warn(`[mini-mcp] resources/list failed for '${name}': ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`);
      }
    }
  }
  return out;
}

/** Read one MCP resource. Returns model-facing text (never throws). */
export async function readMiniMcpResource(server: string, uri: string): Promise<string> {
  const name = String(server ?? "").trim();
  const id = String(uri ?? "").trim();
  if (!name || !id) return "read_mcp_resource needs {server, uri}.";
  if (!miniMcpEnabled()) return "MCP is disabled (MINI_MCP=off).";
  const target = await resolveMcpServerConn(name);
  if (!target) {
    return `unknown or unavailable MCP server: ${name.slice(0, 120)}. Resources come from ~/.codex/config.toml [mcp_servers.*]; list them with list_mcp_resources first.`;
  }
  try {
    const contents = await withTimeout(
      target.conn.readResource(id),
      target.config.toolTimeoutMs,
      `MCP '${name}' resources/read`,
    );
    return mcpResourceContentsToText(contents);
  } catch (e) {
    return `MCP resource error (${name.slice(0, 80)} ${id.slice(0, 120)}): ${(e instanceof Error ? e.message : String(e)).slice(0, 500)}`;
  }
}

/** Structured `resources/read` contents for the `mcpServer/resource/read` RPC. Never throws. */
export async function tryReadMiniMcpResourceContents(server: string, uri: string): Promise<MiniMcpResourceContent[]> {
  const name = String(server ?? "").trim();
  const id = String(uri ?? "").trim();
  if (!name || !id || !miniMcpEnabled()) return [];
  const target = await resolveMcpServerConn(name);
  if (!target) return [];
  try {
    const contents = await withTimeout(
      target.conn.readResource(id),
      target.config.toolTimeoutMs,
      `MCP '${name}' resources/read`,
    );
    return contents;
  } catch (e) {
    if (isResourcesUnsupportedError(e)) {
      if (!mcpResourcesUnsupported.has(name)) {
        mcpResourcesUnsupported.add(name);
        console.debug(`[mini-mcp] resources/read not supported by '${name}', skipping further probes`);
      }
    } else {
      console.warn(`[mini-mcp] resources/read failed for '${name}': ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`);
    }
    return [];
  }
}

export interface MiniMcpServerStatus {
  name: string;
  connected: boolean;
  tools: number;
  failReason?: string;
  transport: "stdio" | "http";
}

/** Structured per-server state for `mcpServerStatus/list` and diagnostics. */
export function miniMcpServerStatus(): MiniMcpServerStatus[] {
  const out: MiniMcpServerStatus[] = [];
  for (const [name, cached] of mcpCache) {
    out.push({
      name,
      connected: Boolean(cached.conn),
      tools: cached.tools.length,
      ...(cached.conn ? {} : cached.failReason ? { failReason: cached.failReason } : {}),
      transport: cached.config.url ? "http" : "stdio",
    });
  }
  return out;
}

/** One-line status for `/status` and diagnostics. */
export function miniMcpStatusLine(): string {
  if (!miniMcpEnabled()) return "mcp: off (MINI_MCP=off)";
  if (!mcpCache.size) return "mcp: no servers cached (loads on next turn from ~/.codex/config.toml [mcp_servers.*])";
  const parts: string[] = [];
  for (const [name, cached] of mcpCache) {
    if (cached.conn) parts.push(`${name} (${cached.tools.length} tools)`);
    else parts.push(cached.failReason ? `${name} (unavailable: ${cached.failReason.slice(0, 120)})` : `${name} (unavailable)`);
  }
  return `mcp: ${parts.join(", ")}`;
}

export async function closeMiniMcpClients(): Promise<void> {
  for (const cached of mcpCache.values()) {
    try {
      cached.conn?.close();
    } catch {
      // ignore
    }
  }
  mcpCache.clear();
}

/** Test hook: reset the module cache. */
export function __clearMiniMcpCacheForTests(): void {
  mcpCache.clear();
  mcpResourcesUnsupported.clear();
  cachedAgentConfig = null;
}

/** Test hook: seed a fake server entry. */
export function __seedMiniMcpCacheForTests(server: string, tools: MiniMcpToolDef[], rawByQualified: Record<string, string>): void {
  mcpCache.set(server, {
    config: { name: server, enabled: true, startupTimeoutMs: 1000, toolTimeoutMs: 1000 },
    conn: null,
    tools,
    rawByQualified: new Map(Object.entries(rawByQualified)),
    listedAt: Date.now(),
    failedAt: 0,
    failReason: "",
  });
}

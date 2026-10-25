// mini-codex standalone MCP client (Codex-style, zero-dep).
// Mirrors apps/server/src/agentRuntime/miniMcp.ts semantics:
// config ~/.codex/config.toml [mcp_servers.*] -> `mcp__<server>__<tool>`.
// Keep the two files in sync (sanitize / qualified names / filtering /
// result-to-text must match or prompts behave differently).
import { spawn, type ChildProcess } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { ToolDef } from "./types.ts";

export const MCP_TOOL_PREFIX = "mcp__";
const DELIM = "__";
const MAX_NAME_LEN = 64;

export interface McpToolEntry extends ToolDef {
  server: string;
  rawName: string;
}

type ServerCfg = {
  name: string;
  command?: string;
  args: string[];
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
};

function envOff(v: string | undefined): boolean {
  const s = (v ?? "").trim().toLowerCase();
  return s === "off" || s === "false" || s === "0" || s === "no" || s === "disabled";
}

export function mcpEnabled(): boolean {
  return !envOff(process.env.MINI_MCP);
}

function numEnv(key: string, fallback: number, min: number, max: number): number {
  const t = (process.env[key] ?? "").trim();
  if (!t) return fallback;
  const n = Number(t);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

let workspaceRoots: string[] = [];

/** Advertise workspace roots to MCP servers via `roots/list`. Call with the session cwd. */
export function setMcpWorkspaceRoots(roots: Array<string | undefined | null>): void {
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

function expandHome(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) return join(homedir(), p.slice(2));
  return p;
}

function expandVars(text: string): string {
  return text.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (_, b, p) => process.env[String(b ?? p ?? "")] ?? "");
}

export function sanitizeMcpPart(v: string): string {
  let out = "";
  for (const ch of v) out += /[0-9A-Za-z_]/.test(ch) ? ch : "_";
  return out || "_";
}

function shortHash(text: string, len = 12): string {
  return createHash("sha1").update(text).digest("hex").slice(0, len);
}

export function qualifiedMcpName(server: string, tool: string): string {
  const base = `${MCP_TOOL_PREFIX}${sanitizeMcpPart(server)}${DELIM}${sanitizeMcpPart(tool)}`;
  if (base.length <= MAX_NAME_LEN) return base;
  const suffix = `_${shortHash(`${server}\0${tool}`)}`;
  return `${base.slice(0, Math.max(1, MAX_NAME_LEN - suffix.length))}${suffix}`;
}

export function isMcpTool(name: string): boolean {
  return name.startsWith(MCP_TOOL_PREFIX) && name.includes(DELIM);
}

function parseValue(text: string): unknown {
  if (text === "true") return true;
  if (text === "false") return false;
  const q = text.match(/^"((?:[^"\\]|\\.)*)"$/) ?? text.match(/^'([^']*)'$/);
  if (q) {
    try {
      return JSON.parse(`"${q[1].replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`);
    } catch {
      return q[1];
    }
  }
  if (/^-?\d+$/.test(text) || /^-?\d*\.\d+$/.test(text)) return Number(text);
  if (text.startsWith("[") && text.endsWith("]")) {
    const inner = text.slice(1, -1).trim();
    if (!inner) return [];
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
    return parts.map((p) => parseValue(p.trim()));
  }
  return text;
}

function parseSubset(text: string): Record<string, Record<string, unknown>> {
  const servers: Record<string, Record<string, unknown>> = {};
  let server: string | null = null;
  let sub: string[] = [];
  let acc: Record<string, unknown> = {};
  const commit = (): void => {
    if (!server) return;
    const root = (servers[server] ??= {});
    let node = root;
    for (const k of sub) {
      const next = (node[k] ?? {}) as Record<string, unknown>;
      if (typeof next !== "object" || Array.isArray(next)) break;
      node[k] = next;
      node = next as Record<string, unknown>;
    }
    for (const [k, v] of Object.entries(acc)) node[k] = v;
  };
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.split(/(^|[^\\])#/)[0]?.trim() ?? "";
    if (!line) continue;
    const header = line.match(/^\[([^\]]+)\]$/);
    if (header) {
      commit();
      const path = header[1].trim().split(".").map((s) => s.trim().replace(/^["']|["']$/g, ""));
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
    acc[key] = parseValue(line.slice(eq + 1).trim());
  }
  commit();
  return servers;
}

function strMap(v: unknown): Record<string, string> | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === "string") out[k] = val;
    else if (typeof val === "number" || typeof val === "boolean") out[k] = String(val);
  }
  return out;
}

function strArr(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((x): x is string => typeof x === "string");
  return out;
}

function toCfg(name: string, r: Record<string, unknown>): ServerCfg | null {
  const command = typeof r.command === "string" ? r.command : undefined;
  const url = typeof r.url === "string" ? r.url : undefined;
  if (!command && !url) return null;
  const auth = typeof r.auth === "string" ? r.auth.trim().toLowerCase() : "";
  if (auth === "ema_auth" || auth === "ema") {
    console.warn(`[mini-mcp] server '${name}' needs enterprise auth (auth = "ema_auth"), skipping: not supported by mini`);
    return null;
  }
  const oauth = r.oauth as Record<string, unknown> | undefined;
  if (oauth && typeof oauth === "object" && !Array.isArray(oauth) && Object.keys(oauth).length > 0) {
    console.warn(`[mini-mcp] server '${name}' declares [mcp_servers.${name}.oauth], skipping: interactive OAuth login is not supported by mini`);
    return null;
  }
  const startupSec = typeof r.startup_timeout_sec === "number" ? r.startup_timeout_sec
    : typeof r.startup_timeout_secs === "number" ? r.startup_timeout_secs : undefined;
  const toolSec = typeof r.tool_timeout_sec === "number" ? r.tool_timeout_sec
    : typeof r.tool_timeout_secs === "number" ? r.tool_timeout_secs : undefined;
  const envHttpHeaders = strMap(r.env_http_headers);
  const mergedHeaders = { ...(envHttpHeaders ? resolveEnvHeaders(envHttpHeaders) : {}), ...(strMap(r.http_headers ?? r.headers) ?? {}) };
  return {
    name,
    command,
    args: strArr(r.args) ?? [],
    env: strMap(r.env ?? r.env_vars),
    cwd: typeof r.cwd === "string" ? r.cwd : undefined,
    url,
    httpHeaders: Object.keys(mergedHeaders).length ? mergedHeaders : undefined,
    bearerTokenEnvVar: typeof r.bearer_token_env_var === "string" ? r.bearer_token_env_var
      : typeof r.bearerTokenEnvVar === "string" ? r.bearerTokenEnvVar : undefined,
    enabled: r.enabled === undefined ? true : r.enabled === true,
    startupTimeoutMs: startupSec !== undefined ? Math.min(120_000, Math.max(1_000, Math.floor(startupSec * 1000))) : numEnv("MINI_MCP_STARTUP_TIMEOUT_MS", 15_000, 1_000, 120_000),
    toolTimeoutMs: toolSec !== undefined ? Math.min(300_000, Math.max(1_000, Math.floor(toolSec * 1000))) : numEnv("MINI_MCP_TOOL_TIMEOUT_MS", 60_000, 1_000, 300_000),
    enabledTools: strArr(r.enabled_tools),
    disabledTools: strArr(r.disabled_tools),
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

async function loadServers(): Promise<ServerCfg[]> {
  if (!mcpEnabled()) return [];
  const home = (process.env.CODEX_HOME ?? "").trim();
  const path = join(home ? expandHome(home) : join(homedir(), ".codex"), "config.toml");
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return [];
  }
  const tables = parseSubset(text);
  const out: ServerCfg[] = [];
  for (const [name, raw] of Object.entries(tables)) {
    try {
      const cfg = toCfg(name, raw);
      if (cfg?.enabled) out.push(cfg);
    } catch {
      // skip bad server
    }
  }
  return out;
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const t = new Promise<never>((_, rej) => {
    timer = setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([p, t]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

function resultToText(result: { content?: unknown; structuredContent?: unknown } | null): string {
  if (!result || typeof result !== "object") return "(empty MCP result)";
  const parts: string[] = [];
  if (Array.isArray(result.content)) {
    for (const b of result.content) {
      if (!b || typeof b !== "object") continue;
      const rec = b as Record<string, unknown>;
      if (typeof rec.text === "string" && rec.text) parts.push(rec.text);
      else if (typeof rec.data === "string") parts.push(rec.data);
    }
  }
  if (!parts.length && result.structuredContent !== undefined) {
    try {
      parts.push(JSON.stringify(result.structuredContent));
    } catch {
      parts.push(String(result.structuredContent));
    }
  }
  return (parts.join("\n").trim() || "(empty MCP result)").slice(0, 8000);
}

/** Codex parity: keep the raw tool result for PostToolUse tool_response. */
export interface McpCallResult {
  text: string;
  response: { content: unknown; structuredContent: unknown };
}

function toMcpResponse(result: { content?: unknown; structuredContent?: unknown } | null): McpCallResult["response"] {
  if (!result || typeof result !== "object") return { content: [], structuredContent: null };
  return {
    content: Array.isArray(result.content) ? result.content : [],
    structuredContent: result.structuredContent ?? null,
  };
}

type RawTool = { name: string; description?: string; inputSchema?: Record<string, unknown> };
type RawResource = { uri: string; name?: string; title?: string; description?: string; mimeType?: string };
export type McpResourceContent = { uri: string; mimeType?: string; text?: string; blob?: string };
export type McpResource = { server: string; uri: string; name: string; mimeType?: string };

class StdioConn {
  private proc: ChildProcess;
  private nextId = 1;
  private pending = new Map<number | string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private buffer = "";
  private closed = false;

  constructor(private cfg: ServerCfg) {
    const env: NodeJS.ProcessEnv = { ...process.env };
    if (cfg.env) for (const [k, v] of Object.entries(cfg.env)) env[k] = expandVars(v);
    this.proc = spawn(expandVars(cfg.command ?? ""), (cfg.args ?? []).map(expandVars), {
      env,
      cwd: cfg.cwd ? expandHome(expandVars(cfg.cwd)) : undefined,
      stdio: ["pipe", "pipe", "ignore"],
      windowsHide: true,
    });
    this.proc.stdout?.on("data", (c) => this.onData(String(c)));
    this.proc.on("error", (e) => this.failAll(e instanceof Error ? e : new Error(String(e))));
    this.proc.on("exit", () => this.failAll(new Error(`MCP server '${cfg.name}' exited`)));
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
      if (msg.id === undefined || msg.id === null) continue;
      // Server-initiated request (has `method`): answer roots/ping so
      // negotiating servers never hang; responses resolve pending calls.
      if (typeof msg.method === "string") {
        const method = String(msg.method);
        const id = msg.id as number | string;
        let payload: Record<string, unknown>;
        if (method === "roots/list") payload = { result: { roots: workspaceRootEntries() } };
        else if (method === "ping") payload = { result: {} };
        else payload = { error: { code: -32601, message: `Method not found: ${method.slice(0, 120)}` } };
        try {
          this.proc.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", id, ...payload })}\n`);
        } catch {
          // ignore; exit/error handlers surface dead pipes
        }
        continue;
      }
      const entry = this.pending.get(msg.id as number | string);
      if (!entry) continue;
      this.pending.delete(msg.id as number | string);
      if (msg.error != null) {
        const err = msg.error as Record<string, unknown>;
        entry.reject(new Error(String(err.message ?? "MCP error").slice(0, 500)));
      } else entry.resolve(msg.result ?? null);
    }
  }

  private failAll(e: Error): void {
    for (const [, entry] of this.pending) entry.reject(e);
    this.pending.clear();
  }

  private send<T>(method: string, params: unknown, timeoutMs: number): Promise<T> {
    const id = this.nextId++;
    const p = new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    });
    try {
      this.proc.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    } catch (e) {
      this.pending.delete(id);
      return Promise.reject(e instanceof Error ? e : new Error(String(e)));
    }
    return withTimeout(p, timeoutMs, `MCP '${this.cfg.name}' ${method}`).finally(() => {
      // A timed-out stdio request may never receive a response. Do not retain
      // its resolver in the pending map or let a late response revive it.
      this.pending.delete(id);
    });
  }

  async init(): Promise<void> {
    await this.send("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "mini-codex", version: "0.1.12" },
    }, this.cfg.startupTimeoutMs);
    try {
      this.proc.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
    } catch {
      // ignore
    }
  }

  async list(): Promise<RawTool[]> {
    const r = await this.send<{ tools?: RawTool[] }>("tools/list", {}, this.cfg.startupTimeoutMs);
    return Array.isArray(r.tools) ? r.tools : [];
  }

  async listResources(): Promise<RawResource[]> {
    const r = await this.send<{ resources?: RawResource[] }>("resources/list", {}, this.cfg.startupTimeoutMs);
    return Array.isArray(r.resources) ? r.resources : [];
  }

  async readResource(uri: string): Promise<McpResourceContent[]> {
    const r = await this.send<{ contents?: McpResourceContent[] }>("resources/read", { uri }, this.cfg.toolTimeoutMs);
    return Array.isArray(r.contents) ? r.contents : [];
  }

  async call(name: string, args: Record<string, unknown>): Promise<string> {
    const r = await this.callDetailed(name, args);
    return r.text;
  }

  async callDetailed(name: string, args: Record<string, unknown>, timeoutMs = this.cfg.toolTimeoutMs): Promise<McpCallResult> {
    const r = await this.send<{ content?: unknown; structuredContent?: unknown }>("tools/call", { name, arguments: args }, timeoutMs);
    return { text: resultToText(r), response: toMcpResponse(r) };
  }

  close(): void {
    this.closed = true;
    this.failAll(new Error("closed"));
    try {
      this.proc.kill();
    } catch {
      // ignore
    }
    void this.closed;
  }
}

class HttpConn {
  private sessionId: string | null = null;
  private nextId = 1;

  constructor(private cfg: ServerCfg) {}

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
    if (this.sessionId) h["Mcp-Session-Id"] = this.sessionId;
    const envName = this.cfg.bearerTokenEnvVar?.trim();
    const token = envName ? process.env[envName] : undefined;
    if (token && !h.Authorization) h.Authorization = `Bearer ${token}`;
    if (this.cfg.httpHeaders) for (const [k, v] of Object.entries(this.cfg.httpHeaders)) h[k] = expandVars(v);
    return h;
  }

  private async rpc<T>(method: string, params: unknown, timeoutMs: number): Promise<T> {
    try {
      return await this.doRpc<T>(method, params, timeoutMs);
    } catch (e) {
      // Expired session: fresh initialize via doRpc (no recursion), retry once.
      if (this.sessionId && e instanceof Error && /HTTP 404/.test(e.message)) {
        this.sessionId = null;
        await this.doRpc("initialize", {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "mini-codex", version: "0.1.12" },
        }, this.cfg.startupTimeoutMs);
        return this.doRpc<T>(method, params, timeoutMs);
      }
      throw e;
    }
  }

  private async doRpc<T>(method: string, params: unknown, timeoutMs: number): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(this.cfg.url ?? "", {
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
          `HTTP ${res.status}: MCP server '${this.cfg.name}' needs OAuth login — run \`codex mcp login ${this.cfg.name}\` (or set bearer_token_env_var/http_headers in config.toml), then retry.`,
        );
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
      let parsed: Record<string, unknown> | null = null;
      if (text.includes("data:")) {
        for (const line of text.split(/\r?\n/)) {
          const t = line.trim();
          if (!t.startsWith("data:")) continue;
          const payload = t.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;
          try {
            parsed = JSON.parse(payload) as Record<string, unknown>;
          } catch {
            // keep scanning
          }
        }
      } else {
        try {
          parsed = JSON.parse(text) as Record<string, unknown>;
        } catch {
          parsed = null;
        }
      }
      if (!parsed) throw new Error("empty MCP HTTP response");
      if (parsed.error != null) {
        const err = parsed.error as Record<string, unknown>;
        throw new Error(String(err.message ?? "MCP error").slice(0, 500));
      }
      return (parsed.result ?? null) as T;
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") throw new Error(`MCP '${this.cfg.name}' ${method} timed out after ${timeoutMs}ms`);
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  async init(): Promise<void> {
    await this.rpc("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "mini-codex", version: "0.1.12" },
    }, this.cfg.startupTimeoutMs);
    // Spec-mandated initialized notification; best-effort (202/404 both fine).
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), Math.min(5_000, this.cfg.startupTimeoutMs));
      try {
        await fetch(this.cfg.url ?? "", {
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

  async list(): Promise<RawTool[]> {
    const r = await this.rpc<{ tools?: RawTool[] }>("tools/list", {}, this.cfg.startupTimeoutMs);
    return Array.isArray(r.tools) ? r.tools : [];
  }

  async listResources(): Promise<RawResource[]> {
    const r = await this.rpc<{ resources?: RawResource[] }>("resources/list", {}, this.cfg.startupTimeoutMs);
    return Array.isArray(r.resources) ? r.resources : [];
  }

  async readResource(uri: string): Promise<McpResourceContent[]> {
    const r = await this.rpc<{ contents?: McpResourceContent[] }>("resources/read", { uri }, this.cfg.toolTimeoutMs);
    return Array.isArray(r.contents) ? r.contents : [];
  }

  async call(name: string, args: Record<string, unknown>): Promise<string> {
    const r = await this.callDetailed(name, args);
    return r.text;
  }

  async callDetailed(name: string, args: Record<string, unknown>, timeoutMs = this.cfg.toolTimeoutMs): Promise<McpCallResult> {
    const r = await this.rpc<{ content?: unknown; structuredContent?: unknown }>("tools/call", { name, arguments: args }, timeoutMs);
    return { text: resultToText(r), response: toMcpResponse(r) };
  }

  close(): void {
    this.sessionId = null;
  }
}

const route = new Map<string, { conn: StdioConn | HttpConn; raw: string }>();
const serverConns = new Map<string, StdioConn | HttpConn>();
let cachedTools: McpToolEntry[] | null = null;
let cachedAt = 0;

function allows(cfg: ServerCfg, raw: string): boolean {
  if (cfg.enabledTools && !cfg.enabledTools.includes(raw)) return false;
  if (cfg.disabledTools && cfg.disabledTools.includes(raw)) return false;
  return true;
}

/** Discover MCP tools (cached 60s). Never throws. */
export async function loadMcpTools(force = false): Promise<McpToolEntry[]> {
  if (!mcpEnabled()) return [];
  const now = Date.now();
  const refreshMs = numEnv("MINI_MCP_REFRESH_MS", 60_000, 5_000, 600_000);
  if (!force && cachedTools && now - cachedAt < refreshMs) return cachedTools;
  const servers = await loadServers();
  const maxTools = numEnv("MINI_MCP_MAX_TOOLS", 64, 0, 256);
  const out: McpToolEntry[] = [];
  const nextRoute = new Map<string, { conn: StdioConn | HttpConn; raw: string }>();
  const counts = new Map<string, number>();
  const staged: Array<{ cfg: ServerCfg; conn: StdioConn | HttpConn; raw: RawTool }> = [];
  for (const cfg of servers) {
    let conn: StdioConn | HttpConn;
    try {
      conn = cfg.url ? new HttpConn(cfg) : new StdioConn(cfg);
      await withTimeout(conn.init(), cfg.startupTimeoutMs + 2_000, `MCP '${cfg.name}' initialize`);
      const tools = await withTimeout(conn.list(), cfg.startupTimeoutMs, `MCP '${cfg.name}' tools/list`);
      for (const t of tools) {
        if (!t || typeof t.name !== "string" || !t.name || !allows(cfg, t.name)) continue;
        staged.push({ cfg, conn, raw: t });
        const base = qualifiedMcpName(cfg.name, t.name);
        counts.set(base, (counts.get(base) ?? 0) + 1);
      }
    } catch (e) {
      console.warn(`[mini-mcp] server '${cfg.name}' unavailable, skipping: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`);
      try {
        conn!.close();
      } catch {
        // ignore
      }
    }
    if (maxTools > 0 && staged.length >= maxTools) break;
  }
  const used = new Set<string>();
  for (const s of staged) {
    if (maxTools > 0 && out.length >= maxTools) {
      try {
        s.conn.close();
      } catch {
        // ignore
      }
      continue;
    }
    let name = qualifiedMcpName(s.cfg.name, s.raw.name);
    if ((counts.get(name) ?? 0) > 1 || used.has(name)) {
      const rawId = `${s.cfg.name}\0${s.raw.name}`;
      name = qualifiedMcpName(`${s.cfg.name}_${shortHash(rawId, 6)}`, s.raw.name);
      let n = 1;
      while (used.has(name) && n < 10) {
        name = qualifiedMcpName(`${s.cfg.name}_${shortHash(`${rawId}${n}`, 6)}`, s.raw.name);
        n++;
      }
    }
    if (used.has(name)) continue;
    used.add(name);
    nextRoute.set(name, { conn: s.conn, raw: s.raw.name });
    out.push({
      name,
      description: `[${s.cfg.name}] ${(typeof s.raw.description === "string" && s.raw.description ? s.raw.description : `MCP tool ${s.raw.name}`).slice(0, 500)}`,
      schema: { ...(s.raw.inputSchema && typeof s.raw.inputSchema === "object" ? s.raw.inputSchema : { type: "object", properties: {} }), additionalProperties: true },
      server: s.cfg.name,
      rawName: s.raw.name,
    });
  }
  for (const [, r] of route) {
    if (![...nextRoute.values()].includes(r)) {
      try {
        r.conn.close();
      } catch {
        // ignore
      }
    }
  }
  route.clear();
  for (const [k, v] of nextRoute) route.set(k, v);
  serverConns.clear();
  for (const [, r] of nextRoute) {
    const owner = staged.find((s) => s.conn === r.conn);
    if (owner && !serverConns.has(owner.cfg.name)) serverConns.set(owner.cfg.name, r.conn);
  }
  cachedTools = out;
  cachedAt = now;
  return out;
}

export async function runMcpTool(qualified: string, args: Record<string, unknown>): Promise<string> {
  const r = await runMcpToolDetailed(qualified, args);
  return r.text;
}

/** Detailed variant: keeps raw {content, structuredContent} for PostToolUse tool_response (Codex parity). */
export async function runMcpToolDetailed(qualified: string, args: Record<string, unknown>): Promise<McpCallResult> {
  let target = route.get(qualified);
  if (!target) {
    await loadMcpTools(false);
    target = route.get(qualified);
  }
  if (!target) {
    const text = `unknown MCP tool: ${qualified.slice(0, 120)}. MCP tools come from ~/.codex/config.toml [mcp_servers.*] as mcp__<server>__<tool>.`;
    return { text, response: { content: [], structuredContent: null } };
  }
  try {
    return await target.conn.callDetailed(target.raw, args ?? {});
  } catch (e) {
    const text = `MCP tool error (${qualified.slice(0, 80)}): ${(e instanceof Error ? e.message : String(e)).slice(0, 500)}`;
    return { text, response: { content: [], structuredContent: null } };
  }
}

/** Raw server/tool caller for mcp_tool hook handlers (bypasses hook pipeline; no recursion). */
export async function callMcpByServerRaw(server: string, tool: string, input: Record<string, unknown>, timeoutMs?: number): Promise<string> {
  const deadline = timeoutMs === undefined ? undefined : Date.now() + timeoutMs;
  const connPromise = serverConn(server);
  const conn = timeoutMs === undefined
    ? await connPromise
    : await withTimeout(connPromise, timeoutMs, `MCP hook '${server}/${tool}'`);
  if (!conn) throw new Error(`unknown or unavailable MCP server: ${String(server).slice(0, 120)}`);
  const remainingMs = deadline === undefined ? undefined : Math.max(1, deadline - Date.now());
  const callPromise = conn.callDetailed(tool, input ?? {}, remainingMs);
  const r = remainingMs === undefined
    ? await callPromise
    : await withTimeout(callPromise, remainingMs, `MCP hook '${server}/${tool}'`);
  return r.text;
}

export function mcpStatusLine(): string {
  if (!mcpEnabled()) return "mcp: off (MINI_MCP=off)";
  if (!cachedTools) return "mcp: not loaded yet (from ~/.codex/config.toml [mcp_servers.*])";
  if (!cachedTools.length) return "mcp: no servers/tools";
  const byServer = new Map<string, number>();
  for (const t of cachedTools) byServer.set(t.server, (byServer.get(t.server) ?? 0) + 1);
  return `mcp: ${[...byServer].map(([s, n]) => `${s} (${n} tools)`).join(", ")}`;
}

function resourceContentsToText(contents: McpResourceContent[] | null | undefined): string {
  if (!Array.isArray(contents) || !contents.length) return "(empty MCP resource)";
  const parts: string[] = [];
  for (const entry of contents) {
    if (!entry || typeof entry !== "object") continue;
    if (typeof entry.text === "string" && entry.text) parts.push(entry.text);
    else if (typeof entry.blob === "string" && entry.blob) {
      const bytes = Math.floor((entry.blob.length * 3) / 4);
      parts.push(`[binary content${entry.mimeType ? ` (${entry.mimeType})` : ""} ~${bytes} bytes, base64 omitted]`);
    }
  }
  return (parts.join("\n").trim() || "(empty MCP resource)").slice(0, 8000);
}

async function serverConn(name: string): Promise<(StdioConn | HttpConn) | null> {
  const want = String(name ?? "").trim();
  if (!want) return null;
  const hit = [...serverConns].find(([k]) => k === want || k.toLowerCase() === want.toLowerCase());
  if (hit) return hit[1];
  await loadMcpTools(false);
  const retry = [...serverConns].find(([k]) => k === want || k.toLowerCase() === want.toLowerCase());
  return retry ? retry[1] : null;
}

/** List resources across connected servers (optionally one server). Never throws. */
export async function listMcpResources(server?: string): Promise<McpResource[]> {
  if (!mcpEnabled()) return [];
  const out: McpResource[] = [];
  const names = new Set<string>();
  if (server?.trim()) {
    names.add(server.trim());
  } else {
    for (const k of serverConns.keys()) names.add(k);
    if (!names.size) {
      await loadMcpTools(false);
      for (const k of serverConns.keys()) names.add(k);
    }
  }
  for (const name of names) {
    const conn = await serverConn(name);
    if (!conn) continue;
    try {
      const raw = await withTimeout(conn.listResources(), 15_000, `MCP '${name}' resources/list`);
      for (const r of raw) {
        if (!r || typeof r.uri !== "string" || !r.uri) continue;
        out.push({
          server: name,
          uri: r.uri,
          name: typeof r.name === "string" && r.name ? r.name : r.uri,
          ...(typeof r.mimeType === "string" && r.mimeType ? { mimeType: r.mimeType } : {}),
        });
        if (out.length >= 200) return out;
      }
    } catch (e) {
      console.warn(`[mini-mcp] resources/list failed for '${name}': ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`);
    }
  }
  return out;
}

/** Read one MCP resource as text. Never throws. */
export async function readMcpResource(server: string, uri: string): Promise<string> {
  const name = String(server ?? "").trim();
  const id = String(uri ?? "").trim();
  if (!name || !id) return "read_mcp_resource needs {server, uri}.";
  if (!mcpEnabled()) return "MCP is disabled (MINI_MCP=off).";
  const conn = await serverConn(name);
  if (!conn) {
    return `unknown or unavailable MCP server: ${name.slice(0, 120)}. Resources come from ~/.codex/config.toml [mcp_servers.*]; list them with list_mcp_resources first.`;
  }
  try {
    const contents = await withTimeout(conn.readResource(id), 60_000, `MCP '${name}' resources/read`);
    return resourceContentsToText(contents);
  } catch (e) {
    return `MCP resource error (${name.slice(0, 80)} ${id.slice(0, 120)}): ${(e instanceof Error ? e.message : String(e)).slice(0, 500)}`;
  }
}

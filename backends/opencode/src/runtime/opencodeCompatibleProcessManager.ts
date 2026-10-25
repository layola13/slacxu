import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { createServer } from "node:net";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ModelCapabilityDescriptor } from "@codex-ui/shared";
import { resolveModelContextWindow } from "@codex-ui/shared";
import { findOpencodeBin, findOpencodeV2Bin, probeOpencodeCliCommand, isOpencodeVersionSupported, isOpencodeV2Version, OPENCODE_MIN_SUPPORTED_VERSION } from "./opencodeCompatibleProbe.js";
import { pluginHostServices } from "@cxu/sdk-backend";

export interface OpencodeRelayProviderConfig {
  /** Custom provider ID injected into OPENCODE_CONFIG_CONTENT, e.g. "codex-relay". */
  providerId: string;
  /** Loopback relay-gateway baseURL, e.g. http://127.0.0.1:PORT/api/relay-gateway/<provider>/<group>/v1 */
  baseURL: string;
  /** Placeholder key; loopback callers are trusted server-side. */
  apiKey: string;
  /** Model IDs declared under the custom provider. */
  models: string[];
  /** Optional context window configured on the relay group or model. */
  contextWindow?: number;
  /** Optional model capabilities descriptor. */
  modelCapability?: ModelCapabilityDescriptor | null;
}

export interface OpencodeProcessConfig {
  binPath?: string;
  /**
   * OpenCode API generation of the spawned binary: 1 = the v1 line
   * (`/session`, `/event`, pass-through plugin hook), 2 = the v2 line
   * (`/api/session`, `/api/event`, no system-transform hook). A v1 and a
   * v2 server must never share a pooled process; the fingerprint covers
   * this field. Defaults to 1.
   */
  apiVersion?: 1 | 2;
  /**
   * Args prepended before `serve ...` (embedded JS bundle entry, e.g.
   * `<bundle>/index.js`). Empty for real binaries.
   */
  serverEntryArgs?: string[];
  cwd?: string;
  hostname?: string;
  port?: number;
  dangerous?: boolean;
  readyTimeoutMs?: number;
  envOverrides?: Record<string, string>;
  relayProvider?: OpencodeRelayProviderConfig;
  saVmMcp?: OpencodeSaVmMcpConfig;
  /**
   * Pass-through (`opencode/*`) models only: isolate opencode from
   * project/global config, external plugins/skills, and all MCP/tool
   * injection. Only `opencode-go/*` keeps the normal opencode
   * configuration.
   */
  isolateThirdParty?: boolean;
}

/**
 * SA-VM MCP server injected through OPENCODE_CONFIG_CONTENT.
 *
 * Mirrors the Gemini/Antigravity path (`saVmBundle.ensureSaVmMcpInstalled`
 * writes `sa-vm` into the agy global `mcp_config.json`): opencode `serve`
 * reads its MCP servers from the JSON config, and OPENCODE_CONFIG_CONTENT
 * is the inline highest-precedence source, so a per-turn injection enables
 * the VM tools without touching the user's `~/.config/opencode/opencode.json`.
 */
export interface OpencodeSaVmMcpConfig {
  /** Absolute path to `sa-vm-mcp.mjs` (stdio MCP server). */
  scriptPath: string;
  /** Set false to skip the injection. Defaults to true. */
  enabled?: boolean;
}

export function buildOpencodeSaVmMcpEntry(scriptPath: string): {
  type: "local";
  command: string[];
  enabled: boolean;
} {
  return {
    type: "local",
    command: ["node", scriptPath],
    enabled: true,
  };
}

export const OPENCODE_RELAY_PROVIDER_ID = "codex-relay";

/**
 * 共享中转 `cli/v1` 契约（mini-opencodex）。
 *
 * 所有 CLI 后端（codex/mini/claude/agy/grok/pi/opencode）共用同一个
 * loopback 网关形状：
 *   `http://<host>:<port>/api/relay-gateway/<provider>/<group>/v1`
 * opencode CLI 侧称之为 `opencode/v1`：即把该 URL 填进
 * `OPENCODE_CONFIG_CONTENT` 的 `provider.codex-relay`
 *（`npm:@ai-sdk/openai-compatible`）`baseURL`，模型走
 * `model:{providerID:"codex-relay"}`。与 `index.ts` 里各 bridge 的
 * `resolveRelayTarget` 生成的 `baseUrl` 完全同形，任一后端换
 * provider/group 都只是换 URL 的两段 path，不新增网关。
 *
 * Zen 免费池（`opencode.ai/zen`、`opencode`/`opencode-free` 分组）自
 * 2026-09-09 起只能在 OpenCode 官方客户端内使用，外部 `/v1` 代理会
 * 直接 400/403，因此绝不允许为它们生成共享中转 URL：这类模型必须走
 * `opencode-local` 直连登录，而不是经 relay-gateway 转发。
 */
export function isOpencodeSharedRelayBlocked(
  providerId?: string | null,
  groupId?: string | null,
  baseUrl?: string | null,
): boolean {
  const ids = [String(providerId ?? "").toLowerCase(), String(groupId ?? "").toLowerCase()];
  if (ids.includes("opencode") || ids.includes("opencode-free")) return true;
  if (baseUrl && /opencode\.ai/i.test(baseUrl)) return true;
  return false;
}

export function buildOpencodeSharedRelayUrl(
  providerId: string,
  groupId: string,
  port: number,
  host = "127.0.0.1",
): string {
  const provider = (providerId ?? "").trim();
  const group = (groupId ?? "").trim();
  const cleanHost = (host ?? "").trim() || "127.0.0.1";
  if (!provider) throw new Error("buildOpencodeSharedRelayUrl requires a non-empty providerId");
  if (!group) throw new Error("buildOpencodeSharedRelayUrl requires a non-empty groupId");
  if (!Number.isFinite(port) || port <= 0 || port >= 65536) {
    throw new Error(`buildOpencodeSharedRelayUrl requires a valid port, got ${String(port)}`);
  }
  if (isOpencodeSharedRelayBlocked(provider, group)) {
    throw new Error(
      `Refusing shared relay for Zen free target "${provider}/${group}": ` +
        "OpenCode free tier only works inside the official OpenCode client (opencode-local login), not via relay-gateway proxy.",
    );
  }
  return `http://${cleanHost}:${port}/api/relay-gateway/${encodeURIComponent(provider)}/${encodeURIComponent(group)}/v1`;
}

export function buildOpencodeSharedRelayProvider(
  relayUrl: string,
  models: string[],
  opts?: { apiKey?: string; contextWindow?: number; modelCapability?: ModelCapabilityDescriptor | null },
): OpencodeRelayProviderConfig {
  const baseURL = (relayUrl ?? "").trim();
  if (!baseURL) throw new Error("buildOpencodeSharedRelayProvider requires a non-empty relayUrl");
  if (isOpencodeSharedRelayBlocked(undefined, undefined, baseURL)) {
    throw new Error(
      "Refusing shared relay provider for an opencode.ai upstream: " +
        "Zen free models must use opencode-local, never a codex-relay loopback.",
    );
  }
  const cleanModels = [...new Set((models ?? []).map((m) => String(m ?? "").trim()).filter(Boolean))];
  if (cleanModels.length === 0) throw new Error("buildOpencodeSharedRelayProvider requires at least one model");
  return {
    providerId: OPENCODE_RELAY_PROVIDER_ID,
    baseURL,
    apiKey: opts?.apiKey?.trim() || "loopback",
    models: cleanModels,
    contextWindow: typeof opts?.contextWindow === "number" && (opts.contextWindow ?? 0) > 0
      ? Math.round(opts.contextWindow as number)
      : undefined,
    modelCapability: opts?.modelCapability ?? null,
  };
}

export interface OpencodeModelLimit {
  context: number;
  output: number;
}

function inferOpencodeOutputLimit(modelId?: string): number {
  const m = (modelId || "").toLowerCase();
  if (m.includes("claude-3-5") || m.includes("sonnet-3-5") || m.includes("opus-3")) {
    return 8_192;
  }
  if (m.includes("gpt-4o") || m.includes("o1") || m.includes("o3")) {
    return 16_384;
  }
  return 8_192;
}

export function inferOpencodeModelLimits(
  modelId?: string,
  explicitContextWindow?: number | null,
  modelCapability?: ModelCapabilityDescriptor | null,
): OpencodeModelLimit {
  if (typeof explicitContextWindow === "number" && explicitContextWindow > 0) {
    return {
      context: Math.round(explicitContextWindow),
      output: inferOpencodeOutputLimit(modelId),
    };
  }
  if (modelId) {
    const resolved = resolveModelContextWindow(modelId, modelCapability ?? undefined);
    if (typeof resolved === "number" && resolved > 0) {
      return {
        context: Math.round(resolved),
        output: inferOpencodeOutputLimit(modelId),
      };
    }
  }

  const m = (modelId || "").toLowerCase();
  let context = m.includes("muse-spark") ? 272_000 : 128_000;
  if (m.includes("1m") || m.includes("1000k")) {
    context = 1_000_000;
  } else if (m.includes("200k") || m.includes("claude") || m.includes("sonnet") || m.includes("opus")) {
    context = 200_000;
  } else if (m.includes("128k") || m.includes("gpt-4") || m.includes("o1") || m.includes("o3") || m.includes("deepseek") || m.includes("gemini")) {
    context = 128_000;
  } else if (m.includes("64k")) {
    context = 65_536;
  } else if (m.includes("32k")) {
    context = 32_768;
  } else if (m.includes("16k")) {
    context = 16_384;
  } else if (m.includes("8k")) {
    context = 8_192;
  }

  return { context, output: inferOpencodeOutputLimit(modelId) };
}

export function buildOpencodeConfigContent(
  dangerous: boolean | undefined,
  relayProvider?: OpencodeRelayProviderConfig,
  saVmMcp?: OpencodeSaVmMcpConfig,
  passThrough = false,
  apiVersion: 1 | 2 = 1,
): string {
  // Pass-through models (`opencode/*` only) may not call any tool or
  // trigger extra model work. Only the user's text is sent.
  const permissionConfig = passThrough
    ? { permission: { "*": "deny" } }
    : dangerous
      ? { permission: { "*": "allow" } }
      : { permission: { "*": "ask" } };
  const toolsConfig = passThrough ? { tools: { "*": false, read: true } } : {}; // `read` must stay advertised: the free-tier gate 403s an emptied tool list; `permission: deny` still blocks execution.
  // The system-stripping plugin relies on the v1-only
  // `experimental.chat.system.transform` hook. OpenCode v2 removed that
  // hook, so v2 pass-through gets the permission/tools/compaction/MCP
  // restrictions (which v2 normalizes from this v1-shaped config) but
  // cannot strip the built-in system prompt.
  const pluginConfig = passThrough && apiVersion !== 2
    ? { plugin: [opencodePassThroughPluginPath()] }
    : {};
  const compactionConfig = passThrough
    ? { compaction: { auto: false, prune: false } }
    : {
      compaction: {
        auto: true,
        prune: true,
        reserved: 20_000,
      },
    };
  // SA-VM MCP (opencode schema): v1 reads `mcp.<name>`, v2 reads
  // `mcp.servers.<name>`. Emit both shapes — each version consumes its own
  // key and ignores the other — so `sa-vm` resolves regardless of CLI version.
  // Only `opencode-go/*` models receive saVmMcp from the bridge.
  const saVmMcpScript = !passThrough && saVmMcp && saVmMcp.enabled !== false ? saVmMcp.scriptPath.trim() : "";
  const mcpConfig = !saVmMcpScript
    ? {}
    : {
      mcp: {
        "sa-vm": buildOpencodeSaVmMcpEntry(saVmMcpScript),
        servers: {
          "sa-vm": {
            type: "local",
            command: ["node", saVmMcpScript],
          },
        },
      },
    };
  if (!relayProvider || relayProvider.models.length === 0) {
    return JSON.stringify({
      ...permissionConfig,
      ...toolsConfig,
      ...pluginConfig,
      ...compactionConfig,
      ...mcpConfig,
    });
  }
  const models: Record<string, { name: string; limit: OpencodeModelLimit }> = {};
  for (const m of relayProvider.models) {
    if (m.trim()) {
      models[m] = {
        name: m,
        limit: inferOpencodeModelLimits(m, relayProvider.contextWindow, relayProvider.modelCapability),
      };
    }
  }
  return JSON.stringify({
    ...permissionConfig,
    ...toolsConfig,
    ...pluginConfig,
    ...compactionConfig,
    ...mcpConfig,
    provider: {
      [relayProvider.providerId]: {
        npm: "@ai-sdk/openai-compatible",
        name: "Codex Relay",
        options: {
          baseURL: relayProvider.baseURL,
          apiKey: relayProvider.apiKey,
        },
        models,
      },
    },
  });
}

export interface OpencodeServerInfo {
  url: string;
  hostname: string;
  port: number;
  password: string;
}

/** Stable empty dir used to isolate opencode's global/home config. */
export function opencodeIsolationDir(): string {
  return join(tmpdir(), "codex-ui-opencode-isolated");
}

/** Per-process plugin path so concurrent app servers never race on the file. */
export function opencodePassThroughPluginPath(pid = process.pid): string {
  return join(opencodeIsolationDir(), `pass-through-system-strip-${pid}.mjs`);
}

const OPENCODE_PASS_THROUGH_PLUGIN_SOURCE = `export default async () => ({
  "experimental.chat.system.transform": async (_input, output) => {
    output.system.length = 0;
  },
});
`;

/**
 * Materialize the pass-through plugin. It removes every system message —
 * including opencode's built-in agent prompt and environment block — so the
 * upstream request contains only the user's parts.
 *
 * Verified against OpenCode v1.19.4 (sst/opencode): the request preparer
 * joins the agent prompt, environment, instructions, and skill/MCP text
 * into one system array and runs `experimental.chat.system.transform`
 * before sending, so clearing the array strips all of it; the `OPENCODE_*`
 * isolation flags used here also exist in v1. The v2 line removes this
 * hook and several of those flags — re-audit before upgrading opencode.
 */
export function ensureOpencodePassThroughPlugin(): string {
  const dir = opencodeIsolationDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = opencodePassThroughPluginPath();
  writeFileSync(path, OPENCODE_PASS_THROUGH_PLUGIN_SOURCE, { mode: 0o600 });
  return path;
}

/**
 * Env for pass-through (`opencode/*`) models. It prevents opencode from loading the
 * user's global/project config, prompts, plugins, external skills, MCP, and
 * automatic compaction/pruning. Auth still uses the real XDG data dir.
 */
export function buildOpencodeIsolationEnv(platform: NodeJS.Platform = process.platform, apiVersion: 1 | 2 = 1): Record<string, string> {
  const isolationDir = opencodeIsolationDir();
  try { mkdirSync(isolationDir, { recursive: true }); } catch { /* best-effort */ }
  if (apiVersion === 2) {
    // OpenCode v2 honors only a subset of the v1 isolation flags (checked
    // against the v2 core config discovery): project-config and
    // Claude-compat loading can still be disabled and the XDG config
    // home still redirects, but OPENCODE_DISABLE_EXTERNAL_SKILLS /
    // _DEFAULT_PLUGINS / _AUTOCOMPACT / _PRUNE / OPENCODE_PURE no longer
    // exist there.
    return {
      OPENCODE_CONFIG: "",
      OPENCODE_CONFIG_DIR: "",
      OPENCODE_DISABLE_PROJECT_CONFIG: "1",
      OPENCODE_DISABLE_CLAUDE_CODE: "1",
      OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: "1",
      OPENCODE_TEST_HOME: isolationDir,
      XDG_CONFIG_HOME: isolationDir,
      ...(platform === "win32" ? { APPDATA: isolationDir } : {}),
    };
  }
  return {
    OPENCODE_CONFIG: "",
    OPENCODE_CONFIG_DIR: "",
    OPENCODE_PERMISSION: "",
    OPENCODE_DISABLE_PROJECT_CONFIG: "1",
    OPENCODE_DISABLE_EXTERNAL_SKILLS: "1",
    OPENCODE_DISABLE_CLAUDE_CODE: "1",
    OPENCODE_DISABLE_CLAUDE_CODE_PROMPT: "1",
    OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: "1",
    OPENCODE_DISABLE_DEFAULT_PLUGINS: "1",
    OPENCODE_DISABLE_AUTOCOMPACT: "1",
    OPENCODE_DISABLE_PRUNE: "1",
    // The only external plugin is the system-stripping pass-through plugin
    // injected through OPENCODE_CONFIG_CONTENT. Global/project config and
    // project plugin discovery stay disabled above.
    OPENCODE_PURE: "0",
    OPENCODE_TEST_HOME: isolationDir,
    XDG_CONFIG_HOME: isolationDir,
    ...(platform === "win32" ? { APPDATA: isolationDir } : {}),
  };
}

/**
 * Check if a TCP port is available on loopback.
 */
export async function isPortAvailable(port: number, hostname = "127.0.0.1"): Promise<boolean> {
  // Never bind on Codex Ultra reserved ports
  if (port === 43120 || port === 43121) return false;

  return new Promise<boolean>((resolve) => {
    const tester = createServer();
    tester.once("error", () => resolve(false));
    tester.once("listening", () => {
      tester.close(() => resolve(true));
    });
    tester.listen(port, hostname);
  });
}

/**
 * Find an available TCP port starting from startPort (default 4096),
 * strictly avoiding port 43120 and 43121.
 */
export async function findAvailableOpencodePort(startPort = 4096, hostname = "127.0.0.1"): Promise<number> {
  let candidate = startPort;
  while (candidate < 65535) {
    if (candidate !== 43120 && candidate !== 43121) {
      const available = await isPortAvailable(candidate, hostname);
      if (available) return candidate;
    }
    candidate += 1;
  }
  throw new Error("No available port found for OpenCode server");
}

export class OpencodeCompatibleProcessManager extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null;
  private serverInfo: OpencodeServerInfo | null = null;
  private stopping = false;
  private stderrTail: string[] = [];
  private maxStderrLines = 100;

  constructor(public readonly config: OpencodeProcessConfig = {}) {
    super();
  }

  get isRunning(): boolean {
    return this.child !== null && !this.stopping;
  }

  get url(): string | undefined {
    return this.serverInfo?.url;
  }

  get password(): string | undefined {
    return this.serverInfo?.password;
  }

  get info(): OpencodeServerInfo | null {
    return this.serverInfo;
  }

  /** OS pid of the spawned `opencode serve` child (if any). Used for exit-hook tree kill. */
  get pid(): number | undefined {
    return this.child?.pid;
  }

  /**
   * Best-effort synchronous process-tree kill for `exit` hooks (async stop() cannot run there).
   * Windows: `taskkill /pid <pid> /T /F` kills the whole tree (bun serve + its shells).
   * POSIX: kill the direct child; grandchildren of `serve` are not expected there.
   */
  killTreeSync(): void {
    const pid = this.child?.pid;
    if (!pid) return;
    this.stopping = true;
    try {
      if (process.platform === "win32") {
        spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      } else {
        try { this.child?.kill("SIGKILL"); } catch {}
      }
    } catch { /* best-effort */ }
    this.child = null;
    this.serverInfo = null;
  }

  async start(): Promise<OpencodeServerInfo> {
    if (this.serverInfo && this.isRunning) {
      return this.serverInfo;
    }

    const hostname = this.config.hostname ?? "127.0.0.1";
    const port = this.config.port ?? (await findAvailableOpencodePort(4096, hostname));
    const password = randomUUID();
    const apiVersion = this.config.apiVersion ?? 1;
    const binPath = this.config.binPath ?? (apiVersion === 2 ? findOpencodeV2Bin() : findOpencodeBin());
    if (this.config.isolateThirdParty && apiVersion !== 2) ensureOpencodePassThroughPlugin();
    const readyTimeoutMs = this.config.readyTimeoutMs ?? 15_000;
    // Version visibility (warn-only): an ancient binary may predate the
    // verified headless contract. Never block here; 404 fallbacks in the
    // runtime cover API variance and callers fall back to mini when the
    // binary is missing entirely.
    try {
      const probed = probeOpencodeCliCommand(binPath);
      if (probed.version && apiVersion === 2 && !isOpencodeV2Version(probed.version)) {
        console.warn(`[opencode-v2] binary version ${probed.version} is not an OpenCode v2 line; the v2 API flow will not work against it. Point OPENCODE_V2_BIN at a v2 binary.`);
      } else if (probed.version && apiVersion !== 2 && isOpencodeV2Version(probed.version)) {
        console.warn(`[opencode] binary version ${probed.version} is an OpenCode v2 line but this flow speaks the v1 API; use the OpenCode v2 backend for this binary.`);
      } else if (probed.version && !isOpencodeVersionSupported(probed.version)) {
        console.warn(`[opencode] binary version ${probed.version} is below the verified floor ${OPENCODE_MIN_SUPPORTED_VERSION}; proceeding anyway, watch for 404s.`);
      }
    } catch { /* probing is best-effort; serve readiness is authoritative */ }

    // Permissions configuration:
    // Dangerous mode经 OPENCODE_CONFIG_CONTENT 注入 permission: {"*": "allow"}
    // 且 dangerous 下显式 deny 不得混入
    // Relay 模式额外注入 provider.codex-relay（openai-compatible），把中转
    // 收敛到本地 loopback relay-gateway，opencode 不再直连上游。
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      OPENCODE_SERVER_PASSWORD: password,
      OPENCODE_CONFIG_CONTENT: buildOpencodeConfigContent(
        this.config.dangerous,
        this.config.relayProvider,
        this.config.saVmMcp,
        this.config.isolateThirdParty === true,
        apiVersion,
      ),
      OPENCODE_DISABLE_AUTOUPDATE: "1",
      OPENCODE_DISABLE_MODELS_FETCH: "1",
      ...this.config.envOverrides,
    };
    if (this.config.isolateThirdParty) {
      Object.assign(env, buildOpencodeIsolationEnv(process.platform, apiVersion));
    }

    const args = [...(this.config.serverEntryArgs ?? []), "serve", `--hostname=${hostname}`, `--port=${port}`];

    const child = pluginHostServices().codex.spawnCodexCommand(binPath, args, {
      env,
      ...(this.config.cwd && existsSync(this.config.cwd) ? { cwd: this.config.cwd } : {}),
    });
    this.child = child;
    this.stopping = false;
    this.stderrTail = [];

    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      this.stderrTail.push(text);
      if (this.stderrTail.length > this.maxStderrLines) {
        this.stderrTail.shift();
      }
      this.emit("stderr", text);
    });

    const readyPromise = new Promise<OpencodeServerInfo>((resolve, reject) => {
      let resolved = false;
      let outputBuffer = "";

      const timeoutId = setTimeout(() => {
        if (resolved) return;
        resolved = true;
        this.stop().catch(() => {});
        const errDetails = this.stderrTail.join("").slice(-2000);
        reject(new Error(`OpenCode server did not become ready within ${readyTimeoutMs}ms. Stderr: ${errDetails}`));
      }, readyTimeoutMs);

      const onStdoutData = (chunk: Buffer) => {
        if (resolved) return;
        outputBuffer += chunk.toString("utf8");
        const lines = outputBuffer.split(/\r?\n/);
        outputBuffer = lines.pop() ?? "";

        for (const line of lines) {
          this.emit("stdoutLine", line);
          // Match standard opencode listening line: "opencode server listening on http://127.0.0.1:4096"
          const match = line.match(/listening on (https?:\/\/([^\s:]+):(\d+))/i)
            || line.match(/opencode server listening on (https?:\/\/[^\s]+)/i);

          if (match) {
            clearTimeout(timeoutId);
            resolved = true;
            child.stdout.off("data", onStdoutData);

            const serverUrl = match[1] ?? match[0];
            if (!serverUrl) continue;
            const parsed = new URL(serverUrl);
            const actualHostname = parsed.hostname;
            const actualPort = Number(parsed.port || port);

            const info: OpencodeServerInfo = {
              url: `http://${actualHostname}:${actualPort}`,
              hostname: actualHostname,
              port: actualPort,
              password,
            };
            this.serverInfo = info;
            resolve(info);
            return;
          }
        }
      };

      child.stdout.on("data", onStdoutData);

      child.on("exit", (code, signal) => {
        clearTimeout(timeoutId);
        this.child = null;
        this.serverInfo = null;
        this.emit("exit", { code, signal, stopping: this.stopping });
        if (!resolved) {
          resolved = true;
          const errDetails = this.stderrTail.join("").slice(-2000);
          reject(new Error(`OpenCode server exited prematurely with code ${code}. Stderr: ${errDetails}`));
        }
      });

      child.on("error", (err) => {
        clearTimeout(timeoutId);
        this.child = null;
        this.serverInfo = null;
        this.emit("error", err);
        if (!resolved) {
          resolved = true;
          reject(err);
        }
      });
    });

    return readyPromise;
  }

  async stop(): Promise<void> {
    this.stopping = true;
    const child = this.child;
    if (!child) {
      this.serverInfo = null;
      return;
    }

    return new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (!done) {
          done = true;
          this.child = null;
          this.serverInfo = null;
          resolve();
        }
      };

      child.once("exit", finish);
      child.once("close", finish);

      try {
        if (process.platform === "win32" && child.pid) {
          // Windows: SIGTERM 只杀直接子进程，`opencode serve` 拉起的孙进程会残留。
          // 用 taskkill /T /F 杀整棵树（与 agy/grok manager 一致），失败时回退 SIGKILL。
          const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
          killer.on("error", () => {
            try { child.kill("SIGKILL"); } catch {}
          });
        } else {
          child.kill("SIGTERM");
        }
      } catch {
        finish();
        return;
      }

      setTimeout(() => {
        if (!done) {
          try {
            child.kill("SIGKILL");
          } catch {}
          finish();
        }
      }, 3000);
    });
  }
}

function stableStringify(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? String(value);
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(record[k])}`).join(",")}}}`;
}

/**
 * 共享 serve 进程的配置指纹。
 *
 * 说明：`cwd` / `port` 不进指纹 —— cwd 通过每请求的
 * `x-opencode-directory` 头传递，port 由池内唯一进程持有。
 * 其余决定 `OPENCODE_CONFIG_CONTENT` / 拉起命令的字段都必须进指纹，
 * 否则不同 relay / 权限 / MCP 会错用同一个固化进程。
 */
export function fingerprintOpencodeProcessConfig(config: OpencodeProcessConfig): string {
  const relay = config.relayProvider
    ? {
      providerId: config.relayProvider.providerId,
      baseURL: config.relayProvider.baseURL,
      apiKey: config.relayProvider.apiKey,
      models: [...config.relayProvider.models].sort(),
      contextWindow: config.relayProvider.contextWindow ?? null,
      modelCapability: config.relayProvider.modelCapability ?? null,
    }
    : null;
  return stableStringify({
    binPath: (config.binPath ?? "<auto>").trim(),
    apiVersion: config.apiVersion ?? 1,
    serverEntryArgs: config.serverEntryArgs ?? [],
    hostname: config.hostname ?? "127.0.0.1",
    dangerous: config.dangerous ?? false,
    isolateThirdParty: config.isolateThirdParty ?? false,
    relay,
    saVmMcp: !config.saVmMcp || config.saVmMcp.enabled === false || !config.saVmMcp.scriptPath.trim()
      ? null
      : { scriptPath: config.saVmMcp.scriptPath.trim() },
    envOverrides: config.envOverrides ?? {},
  });
}

interface PooledOpencodeServer {
  manager: OpencodeCompatibleProcessManager;
  info: OpencodeServerInfo;
  refCount: number;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

const pooledServers = new Map<string, PooledOpencodeServer>();
const pooledInflight = new Map<string, Promise<{ manager: OpencodeCompatibleProcessManager; info: OpencodeServerInfo }>>();

/** 零引用后保留进程的可复用窗口，避免对话切换时反复拉起 400MB bun。测试可通过环境变量调小。 */
export function opencodeSharedPoolIdleMs(): number {
  const rawText = (process.env.CODEX_UI_OPENCODE_POOL_IDLE_MS ?? "").trim();
  if (!rawText) return 5 * 60_000;
  const raw = Number(rawText);
  if (Number.isFinite(raw) && raw >= 0) return raw;
  return 5 * 60_000;
}

function clearPooledIdleTimer(entry: PooledOpencodeServer): void {
  if (entry.idleTimer) {
    clearTimeout(entry.idleTimer);
    entry.idleTimer = null;
  }
}

/**
 * 按配置指纹复用 `opencode serve` 进程。
 *
 * 根因修复：此前每个 `OpencodeCompatibleRuntime`（即每个对话线程）在
 * `ensureServer()` 里 `new OpencodeCompatibleProcessManager().start()`，
 * 每个 `opencode serve` 都是内嵌 bun 的单文件可执行程序（常驻 ~400MB），
 * 新建 N 个对话就多 N 个 bun 进程。改为同一指纹共享同一进程 + 引用计数，
 * 最后一个持有者释放后延时回收，空闲复用直接返回已有进程，不再 spawn。
 */
export async function acquireSharedOpencodeServer(
  config: OpencodeProcessConfig,
): Promise<{ key: string; manager: OpencodeCompatibleProcessManager; info: OpencodeServerInfo }> {
  ensureOpencodeShutdownHooks();
  const key = fingerprintOpencodeProcessConfig(config);
  const existing = pooledServers.get(key);
  if (existing && existing.manager.isRunning && existing.info) {
    clearPooledIdleTimer(existing);
    existing.refCount += 1;
    return { key, manager: existing.manager, info: existing.info };
  }
  if (existing && !existing.manager.isRunning) {
    clearPooledIdleTimer(existing);
    pooledServers.delete(key);
  }
  const inflight = pooledInflight.get(key);
  if (inflight) {
    const shared = await inflight;
    const raced = pooledServers.get(key);
    if (raced && raced.manager === shared.manager && raced.manager.isRunning) {
      clearPooledIdleTimer(raced);
      raced.refCount += 1;
      return { key, manager: raced.manager, info: raced.info };
    }
    // 竞争失败（首个启动者已退出/被回收）：退回重新排队一次。
    if (!pooledServers.has(key) && !pooledInflight.has(key)) {
      return acquireSharedOpencodeServer(config);
    }
    const retry = pooledServers.get(key);
    if (retry && retry.manager.isRunning) {
      clearPooledIdleTimer(retry);
      retry.refCount += 1;
      return { key, manager: retry.manager, info: retry.info };
    }
    return acquireSharedOpencodeServer(config);
  }

  const starter = (async () => {
    const manager = new OpencodeCompatibleProcessManager(config);
    const info = await manager.start();
    return { manager, info };
  })();
  pooledInflight.set(key, starter);
  try {
    const { manager, info } = await starter;
    const entry: PooledOpencodeServer = { manager, info, refCount: 1, idleTimer: null };
    pooledServers.set(key, entry);
    manager.once("exit", () => {
      const current = pooledServers.get(key);
      if (current && current.manager === manager) {
        clearPooledIdleTimer(current);
        pooledServers.delete(key);
      }
    });
    return { key, manager, info };
  } catch (err) {
    throw err;
  } finally {
    if (pooledInflight.get(key) === starter) pooledInflight.delete(key);
  }
}

export function releaseSharedOpencodeServer(
  key: string,
  manager: OpencodeCompatibleProcessManager,
  opts?: { stopWhenLast?: boolean },
): number {
  const entry = pooledServers.get(key);
  if (!entry || entry.manager !== manager) {
    // 非池内实例（或已被新进程替换的旧实例）：直接停掉，避免泄漏。
    void manager.stop().catch(() => {});
    return 0;
  }
  entry.refCount = Math.max(0, entry.refCount - 1);
  if (entry.refCount > 0 || !entry.manager.isRunning) {
    if (!entry.manager.isRunning) {
      clearPooledIdleTimer(entry);
      pooledServers.delete(key);
    }
    return entry.refCount;
  }
  if (opts?.stopWhenLast) {
    // 中断恢复等需要干净状态的场景：仅当本会话是最后一个持有者时才立即
    // 停掉（有其他同指纹会话在用时绝不停，避免误伤他人）。
    clearPooledIdleTimer(entry);
    pooledServers.delete(key);
    void entry.manager.stop().catch(() => {});
    return 0;
  }
  // 零引用：延时回收，窗口内新对话可直接复用，不再 spawn 新 bun。
  clearPooledIdleTimer(entry);
  const idleMs = opencodeSharedPoolIdleMs();
  if (idleMs <= 0) {
    pooledServers.delete(key);
    void entry.manager.stop().catch(() => {});
    return 0;
  }
  entry.idleTimer = setTimeout(() => {
    const current = pooledServers.get(key);
    if (!current || current.manager !== entry.manager) return;
    if (current.refCount > 0) return;
    pooledServers.delete(key);
    void entry.manager.stop().catch(() => {});
  }, idleMs);
  // 空闲 timer 不应阻止宿主进程退出。
  (entry.idleTimer as unknown as { unref?: () => void }).unref?.();
  return 0;
}

/** 仅测试使用：清空池并停掉所有共享进程。 */
export async function __resetSharedOpencodePoolForTests(): Promise<void> {
  pooledInflight.clear();
  const entries = Array.from(pooledServers.entries());
  pooledServers.clear();
  for (const [, entry] of entries) {
    clearPooledIdleTimer(entry);
    await entry.manager.stop().catch(() => {});
  }
}

/** 仅测试/诊断使用：当前池快照（指纹 -> 引用数/存活）。 */
export function __sharedOpencodePoolSnapshotForTests(): Array<{ key: string; refCount: number; running: boolean }> {
  return Array.from(pooledServers.entries()).map(([key, entry]) => ({
    key,
    refCount: entry.refCount,
    running: entry.manager.isRunning,
  }));
}

/**
 * 当前指纹的池引用数（0 = 池中无此进程）。
 *
 * 用途：无归属 `session.error` 这类无法按 sessionID 过滤的事件，
 * 只有在引用数为 0/1（实际独占）时才能安全投递给本会话；
 * 多持有者共享时投递会误伤他人 turn，必须丢弃。
 */
export function sharedOpencodePoolRefCount(key: string): number {
  return pooledServers.get(key)?.refCount ?? 0;
}

/** 仅测试使用：向池中预置一个条目（fake manager/info），引用数可指定。 */
export function __seedSharedOpencodePoolForTests(
  key: string,
  manager: OpencodeCompatibleProcessManager,
  info: OpencodeServerInfo,
  refCount = 1,
): void {
  const prev = pooledServers.get(key);
  if (prev) clearPooledIdleTimer(prev);
  pooledServers.set(key, { manager, info, refCount, idleTimer: null });
}

/**
 * 父进程退出时同步杀掉所有池内 `opencode serve` 整棵树。
 *
 * 背景：Node/Bun 退出不会自动杀子进程。CXU 服务退出（窗口关闭、崩溃、
 * 被 taskkill 只杀父 pid）后，池内 bun serve 会变成孤儿常驻后台，
 * 用户在任务管理器看到一堆残留。`exit` 钩子不能跑 async，
 * 这里用同步 taskkill /T /F 做最后兜底。
 */
export function shutdownSharedOpencodePoolSync(): void {
  const entries = Array.from(pooledServers.entries());
  pooledServers.clear();
  pooledInflight.clear();
  for (const [, entry] of entries) {
    try { clearPooledIdleTimer(entry); } catch { /* ignore */ }
    try {
      const manager = entry.manager as Partial<OpencodeCompatibleProcessManager> & {
        killTreeSync?: () => void;
        stop?: () => Promise<void>;
      };
      if (typeof manager.killTreeSync === "function") manager.killTreeSync();
      else if (typeof manager.stop === "function") {
        // 测试注入的 fake manager 没有 killTreeSync：尽力同步调用 stop，
        // 浮动 promise 用 catch 吞掉（exit 钩子内无法 await）。
        try { void (manager.stop as () => Promise<void>)().catch(() => {}); } catch { /* ignore */ }
      }
    } catch { /* best-effort */ }
  }
}

/** 优雅关闭：逐个 await stop()（SIG 信号路径使用，允许 async）。 */
export async function shutdownSharedOpencodePool(): Promise<void> {
  const entries = Array.from(pooledServers.entries());
  pooledServers.clear();
  pooledInflight.clear();
  for (const [, entry] of entries) {
    try { clearPooledIdleTimer(entry); } catch { /* ignore */ }
    try { await entry.manager.stop().catch(() => {}); } catch { /* ignore */ }
  }
}

let opencodeShutdownHooksInstalled = false;

/**
 * 注册父进程退出钩子，保证退出即清理池内子进程树。
 *
 * 惰性安装：在首次 acquire 时调用，无需改动 12k 行的 index.ts。
 * - SIGINT/SIGTERM：先优雅 shutdown 再退出（给 synchronize 的 stop 留时间）。
 * - exit：同步 taskkill 兜底（async 已来不及）。
 */
export function ensureOpencodeShutdownHooks(): void {
  if (opencodeShutdownHooksInstalled) return;
  opencodeShutdownHooksInstalled = true;
  const graceful = (signal: NodeJS.Signals) => {
    try {
      void shutdownSharedOpencodePool()
        .catch(() => {})
        .finally(() => {
          try { shutdownSharedOpencodePoolSync(); } catch { /* ignore */ }
        });
    } catch { /* ignore */ }
    // 让已注册的其它信号处理器先跑；若无人退出，短延时后强制结束，
    // 避免优雅 stop 卡住导致父进程 perl 挂起、用户以为没退掉。
    setTimeout(() => {
      try { shutdownSharedOpencodePoolSync(); } catch { /* ignore */ }
      try { process.exit(signal === "SIGINT" ? 130 : 143); } catch { /* ignore */ }
    }, 1500).unref?.();
  };
  try { process.once("SIGINT", () => graceful("SIGINT")); } catch { /* ignore */ }
  try { process.once("SIGTERM", () => graceful("SIGTERM")); } catch { /* ignore */ }
  try {
    process.on("exit", () => {
      try { shutdownSharedOpencodePoolSync(); } catch { /* ignore */ }
    });
  } catch { /* ignore */ }
}

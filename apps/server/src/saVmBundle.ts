import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { MINI_AGENT_DEFAULT_USER_AGENT, MINI_AGENT_NAME } from "../../../backends/mini/src/runtime/miniMcp.js";
import { getSaVmGlobalDataDir, getSaVmProjectDataDir, resolveSaVmMcpScriptPath, resolveSaVmMcpSourceCandidates, SA_VM_MCP_SCRIPT_NAME } from "@cxu/sdk-backend";
export { getSaVmGlobalDataDir, getSaVmProjectDataDir, resolveSaVmMcpScriptPath, SA_VM_MCP_SCRIPT_NAME };


/**
 * 工程目录优先的 sa-vm 数据目录：`<cwd>/.codex-ultra/sa-vm`。
 * Linux 远程新机器 home 为空时，全局目录不可写，MCP 必须跟工程走。
 */

/**
 * 稳健解析 `sa-vm-mcp.mjs` 源码位置。
 * 打包/远程场景 process.cwd() 不再是仓库根，仅靠它会找不到文件。
 * 优先级：显式 sourceRoot > 环境变量 > 仓库 scripts > 已落盘的全局副本。
 */

/**
 * 工程优先解析 MCP 脚本：先看 `<cwd>/.codex-ultra/sa-vm`，再回退全局。
 * 只读判定，不触碰 home，Linux 新机器无 home 写入也不影响。
 */

/**
 * 确保工程目录的 MCP 落盘（不写任何 home 全局配置）。
 * 与 `ensureSaVmMcpInstalled` 的区别：只管 `<cwd>/.codex-ultra/sa-vm`，
 * 绝不注册 gemini/claude/grok/opencode 的 home 配置。
 */
export async function ensureSaVmProjectBundleInstalled(
  cwd: string,
  options?: { force?: boolean; sourceRoot?: string },
): Promise<{ scriptPath: string; installed: boolean }> {
  const targetRoot = getSaVmProjectDataDir(cwd);
  const scriptPath = join(targetRoot, SA_VM_MCP_SCRIPT_NAME);
  const versionPath = join(targetRoot, ".bundle-version");
  await mkdir(targetRoot, { recursive: true, mode: 0o755 });
  // 版本戳一致且非强制时走快路径；旧拷贝（无版本/版本落后）必须重刷，
  // 否则后端拉起的是 stale 脚本（缺动作尾行 → 瀑布流全 vm-run）。
  let versionOk = false;
  try {
    versionOk = (await readFile(versionPath, "utf8")).trim() === String(SA_VM_MCP_BUNDLE_VERSION);
  } catch { versionOk = false; }
  if (!options?.force && versionOk && existsSync(scriptPath)) {
    await registerProjectMiniAgentConfig(cwd, scriptPath).catch(() => {});
    return { scriptPath, installed: true };
  }
  for (const candidate of resolveSaVmMcpSourceCandidates(options?.sourceRoot)) {
    try {
      if (existsSync(candidate) && resolve(candidate) !== resolve(scriptPath)) {
        await cp(candidate, scriptPath, { force: true });
        break;
      }
    } catch {
      // 换下一个候选源
    }
  }
  const installed = existsSync(scriptPath);
  if (installed) {
    try { await writeFile(versionPath, String(SA_VM_MCP_BUNDLE_VERSION), "utf8"); } catch { /* 版本戳写失败不影响使用 */ }
    await registerProjectMiniAgentConfig(cwd, scriptPath).catch(() => {});
  }
  return { scriptPath, installed };
}

async function registerProjectMiniAgentConfig(cwd: string, scriptPath: string): Promise<void> {
  const projectRoot = resolve(cwd);
  const miniDir = join(projectRoot, ".mini-agent");
  await mkdir(miniDir, { recursive: true, mode: 0o755 });

  // 1. Maintain .mini-agent/config.toml (for Codex/TOML backwards compatibility)
  const miniToml = join(miniDir, "config.toml");
  const existingToml = existsSync(miniToml) ? await readFile(miniToml, "utf8") : "";
  const updatedToml = mergeMiniAgentTomlMcpConfig(existingToml, scriptPath);
  if (updatedToml !== existingToml) {
    await writeFile(miniToml, updatedToml, "utf8");
  }

  // 2. Maintain .mini-agent/config.json (大众惯例 JSON)
  const miniJson = join(miniDir, "config.json");
  let existingJson: Record<string, any> = {};
  if (existsSync(miniJson)) {
    try {
      existingJson = JSON.parse(await readFile(miniJson, "utf8"));
    } catch {}
  }
  const updatedJson = mergeMcpServersJsonConfig(existingJson, scriptPath);
  await writeFile(miniJson, JSON.stringify(updatedJson, null, 2), "utf8");

  // 3. Keep opencode.json synchronized if present in workspace (OpenCode 惯例)
  const opencodeJson = join(projectRoot, "opencode.json");
  if (existsSync(opencodeJson)) {
    try {
      const ocConf = JSON.parse(await readFile(opencodeJson, "utf8"));
      const ocMerged = mergeOpencodeMcpConfig(ocConf, scriptPath);
      await writeFile(opencodeJson, JSON.stringify(ocMerged, null, 2), "utf8");
    } catch {}
  }

  // 4. Keep mcp.json synchronized if present in workspace (Cursor / 大众惯例)
  const mcpJson = join(projectRoot, "mcp.json");
  if (existsSync(mcpJson)) {
    try {
      const mcpConf = JSON.parse(await readFile(mcpJson, "utf8"));
      const mcpMerged = mergeMcpServersJsonConfig(mcpConf, scriptPath);
      await writeFile(mcpJson, JSON.stringify(mcpMerged, null, 2), "utf8");
    } catch {}
  }

  // 5. Muse 项目级 MCP（`.mcp.json`，mcpServers 约定）：
  //    实测（2026-10-22，muse 1.4.11）：Muse CLI 的项目级配置只读取
  //    `<project>/.mcp.json`；`<project>/.muse/settings.json` 完全不会被加载
  //    （用户级才是 `$XDG_CONFIG_HOME/muse/settings.json`）。因此这里写 `.mcp.json`。
  //    只合并 sa-vm /（opt-in）jev，保留用户已有的其它 server 与顶层键。
  try {
    const museMcpJson = join(projectRoot, ".mcp.json");
    let museConf: Record<string, any> = {};
    if (existsSync(museMcpJson)) {
      try {
        const parsed = JSON.parse(await readFile(museMcpJson, "utf8"));
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) museConf = parsed;
      } catch {}
    }
    const servers = (museConf.mcpServers && typeof museConf.mcpServers === "object" && !Array.isArray(museConf.mcpServers)
      ? { ...(museConf.mcpServers as Record<string, any>) }
      : {}) as Record<string, any>;
    if (isJevMcpEnabled()) {
      servers["jev"] = { command: "node", args: [scriptPath] };
    } else if (isSelfManagedMcpEntry(servers["jev"])) {
      delete servers["jev"];
    }
    servers["sa-vm"] = { command: "node", args: [scriptPath] };
    museConf = { ...museConf, mcpServers: servers };
    await writeFile(museMcpJson, JSON.stringify(museConf, null, 2), "utf8");
  } catch {}
}

export function resolveBuiltinSaVmSourceRoot(): string | null {
  return null;
}

export async function ensureSaVmGlobalBundleInstalled(options?: {
  force?: boolean;
  sourceRoot?: string;
  targetRoot?: string;
  autoRegisterClients?: boolean;
}): Promise<{ root: string; installed: boolean }> {
  const targetRoot = options?.targetRoot ?? getSaVmGlobalDataDir();
  await ensureSaVmMcpInstalled({ targetRoot, autoRegisterClients: options?.autoRegisterClients }).catch(() => {});
  return { root: targetRoot, installed: false };
}

/**
 * 工程/global MCP 拷贝版本戳。`sa-vm-mcp.mjs` 发生影响运行时的变更
 * （如新增 MUSE_SA_VM_ENVELOPE 动作尾行）时 bump 此值，
 * `ensureSaVmProjectBundleInstalled` 会把旧拷贝强制刷新，
 * 否则 muse 等后端永远跑着 stale 脚本（瀑布流拿不到 action → 全 vm-run）。
 */
export const SA_VM_MCP_BUNDLE_VERSION = 6;
export const SA_VM_PI_EXTENSION_SOURCE_NAME = "sa-vm-pi-extension.ts";
export const SA_VM_OPENCODE_SERVER_NAME = "sa-vm";
export const JEV_OPENCODE_SERVER_NAME = "jev";

/**
 * JEV MCP server registration is opt-in (`JEV_MCP_ENABLED=1`).
 *
 * Background: the auto-registration below used to inject the `jev` server
 * (17 decision tools) into every client config on the machine — project +
 * global `opencode.json`, `.mini-agent` configs, Gemini/Claude-Desktop
 * configs — so models saw `jev_*` in ALL sessions and invoked them
 * unprompted (global trigger). The per-turn `OPENCODE_CONFIG_CONTENT`
 * injection already carries only `sa-vm`, so product runtime never needed
 * the global `jev` entry. Default keeps `sa-vm` everywhere and stops
 * writing `jev`; previously auto-written `jev` entries that point at our
 * own `sa-vm-mcp.mjs` are removed, user-configured foreign `jev` servers
 * are always preserved.
 */
export function isJevMcpEnabled(): boolean {
  const v = (process.env.JEV_MCP_ENABLED ?? "").trim().toLowerCase();
  return v === "1" || v === "true";
}

/** True when an MCP entry was written by our own auto-registration. */
function isSelfManagedMcpEntry(entry: unknown): boolean {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
  const rec = entry as Record<string, unknown>;
  const parts: unknown[] = [
    ...(Array.isArray(rec.command) ? rec.command : typeof rec.command === "string" ? [rec.command] : []),
    ...(Array.isArray(rec.args) ? rec.args : []),
  ];
  return parts.some(
    (p) => typeof p === "string" && p.replace(/\\/g, "/").endsWith(`/${SA_VM_MCP_SCRIPT_NAME}`),
  );
}

/** Drop a `[mcp_servers.<name>]` TOML section only when it points at our script. */
function stripSelfManagedTomlServer(content: string, name: string): string {
  const lines = content.split(/\r?\n/);
  const header = `[mcp_servers.${name}]`;
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i]!.trim() === header) {
      const block: string[] = [lines[i]!];
      i++;
      while (i < lines.length && !/^\s*\[/.test(lines[i]!)) {
        block.push(lines[i]!);
        i++;
      }
      if (!block.some((l) => l.replace(/\\/g, "/").includes(SA_VM_MCP_SCRIPT_NAME))) {
        out.push(...block);
      }
    } else {
      out.push(lines[i]!);
      i++;
    }
  }
  return out.join("\n");
}

/**
 * Merge the `sa-vm` stdio entry (plus opt-in `jev`, see `isJevMcpEnabled`)
 * into a parsed `opencode.json` object.
 *
 * opencode v1 reads `mcp.<name>`, v2 reads `mcp.servers.<name>`; both shapes
 * are written so either CLI version picks the server up. Pure helper —
 * unit-tested without touching the user's home directory.
 */
export function mergeOpencodeMcpConfig(
  existing: Record<string, any>,
  scriptPath: string,
): Record<string, any> {
  const conf = { ...existing };
  const mcp = (conf.mcp && typeof conf.mcp === "object" && !Array.isArray(conf.mcp)
    ? { ...conf.mcp }
    : {}) as Record<string, any>;
  mcp[SA_VM_OPENCODE_SERVER_NAME] = {
    type: "local",
    command: ["node", scriptPath],
    enabled: true,
  };
  if (isJevMcpEnabled()) {
    mcp[JEV_OPENCODE_SERVER_NAME] = {
      type: "local",
      command: ["node", scriptPath],
      enabled: true,
    };
  } else if (isSelfManagedMcpEntry(mcp[JEV_OPENCODE_SERVER_NAME])) {
    delete mcp[JEV_OPENCODE_SERVER_NAME];
  }
  const servers = (mcp.servers && typeof mcp.servers === "object" && !Array.isArray(mcp.servers)
    ? { ...mcp.servers }
    : {}) as Record<string, any>;
  servers[SA_VM_OPENCODE_SERVER_NAME] = {
    type: "local",
    command: ["node", scriptPath],
  };
  if (isJevMcpEnabled()) {
    servers[JEV_OPENCODE_SERVER_NAME] = {
      type: "local",
      command: ["node", scriptPath],
    };
  } else if (isSelfManagedMcpEntry(servers[JEV_OPENCODE_SERVER_NAME])) {
    delete servers[JEV_OPENCODE_SERVER_NAME];
  }
  mcp.servers = servers;
  conf.mcp = mcp;
  return conf;
}

/**
 * Merge JEV and SA-VM MCP server entries into standard `mcpServers` JSON object (Claude Desktop / Cursor / VS Code / Mini Agent JSON).
 */
export function mergeMcpServersJsonConfig(
  existing: Record<string, any>,
  scriptPath: string,
): Record<string, any> {
  const conf = { ...existing };
  const mcpServers = (conf.mcpServers && typeof conf.mcpServers === "object" && !Array.isArray(conf.mcpServers)
    ? { ...conf.mcpServers }
    : {}) as Record<string, any>;
  if (isJevMcpEnabled()) {
    mcpServers["jev"] = {
      command: "node",
      args: [scriptPath],
      enabled: true,
    };
  } else if (isSelfManagedMcpEntry(mcpServers["jev"])) {
    delete mcpServers["jev"];
  }
  mcpServers["sa-vm"] = {
    command: "node",
    args: [scriptPath],
    enabled: true,
  };
  conf.mcpServers = mcpServers;
  if (!conf.agent || typeof conf.agent !== "object") {
    conf.agent = {
      name: MINI_AGENT_NAME,
      user_agent: MINI_AGENT_DEFAULT_USER_AGENT,
    };
  }
  return conf;
}

/**
 * Merge the SA-VM MCP server entry (plus opt-in `jev`, see `isJevMcpEnabled`)
 * into Mini Agent's `config.toml` text.
 */
export function mergeMiniAgentTomlMcpConfig(
  existingContent: string,
  scriptPath: string,
): string {
  let content = existingContent.trim();
  const jevEntry = `[mcp_servers.jev]\ncommand = "node"\nargs = [${JSON.stringify(scriptPath)}]\nstartup_timeout_sec = 30\n`;
  const saVmEntry = `[mcp_servers.sa-vm]\ncommand = "node"\nargs = [${JSON.stringify(scriptPath)}]\nstartup_timeout_sec = 30\n`;

  if (!content) {
    const head = `[agent]\nname = "${MINI_AGENT_NAME}"\nuser_agent = "${MINI_AGENT_DEFAULT_USER_AGENT}"\n\n`;
    return isJevMcpEnabled() ? `${head}${jevEntry}\n${saVmEntry}` : `${head}${saVmEntry}`;
  }
  if (isJevMcpEnabled()) {
    if (!content.includes("[mcp_servers.jev]")) {
      content = `${content.trimEnd()}\n\n${jevEntry}`;
    }
  } else {
    content = stripSelfManagedTomlServer(content, "jev");
  }
  if (!content.includes("[mcp_servers.sa-vm]")) {
    content = `${content.trimEnd()}\n\n${saVmEntry}`;
  }
  return content.endsWith("\n") ? content : content + "\n";
}

/**
 * Parse a JSON object config. Tolerates a UTF-8 BOM, which Windows editors
 * prepend — a bare `JSON.parse` throws on it. Throws on anything that is not
 * an object so callers can fail closed instead of overwriting the file.
 */
export function parseJsonObjectConfig(raw: string): Record<string, any> {
  const parsed: unknown = JSON.parse(raw.replace(/^﻿/, ""));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("config root must be a JSON object");
  }
  return parsed as Record<string, any>;
}

/**
 * Upsert the sa-vm stdio entry into a `{ mcpServers }` JSON file (Gemini / agy).
 * An existing file that fails to parse throws and is left untouched — rewriting
 * it from `{}` would drop the user's other servers.
 */
export async function upsertSaVmMcpServerJsonFile(confPath: string, scriptPath: string): Promise<void> {
  const conf: Record<string, any> = existsSync(confPath)
    ? parseJsonObjectConfig(await readFile(confPath, "utf8"))
    : {};
  if (!conf.mcpServers || typeof conf.mcpServers !== "object") conf.mcpServers = {};
  if (isJevMcpEnabled()) {
    conf.mcpServers["jev"] = { command: "node", args: [scriptPath] };
  } else if (isSelfManagedMcpEntry(conf.mcpServers["jev"])) {
    delete conf.mcpServers["jev"];
  }
  conf.mcpServers["sa-vm"] = { command: "node", args: [scriptPath] };
  await writeFile(confPath, JSON.stringify(conf, null, 4), "utf8");
}

/** Pure: does `claude mcp get sa-vm` output already run this script at user scope? */
export function isClaudeCodeSaVmRegistered(getOutput: string, scriptPath: string): boolean {
  const norm = (s: string) => s.replace(/\\/g, "/").toLowerCase();
  const field = (name: string) => {
    const line = getOutput.split(/\r?\n/).find((l) => l.trim().startsWith(`${name}:`));
    return line ? line.slice(line.indexOf(":") + 1).trim() : "";
  };
  return (
    /^user config/i.test(field("Scope")) &&
    field("Command") === "node" &&
    norm(field("Args")) === norm(scriptPath)
  );
}

const execFileAsync = promisify(execFile);

function runClaudeCli(args: string[]): Promise<{ stdout: string; stderr: string }> {
  const win = process.platform === "win32";
  // npm installs `claude` as `claude.cmd` on Windows; a .cmd shim only runs
  // through a shell, so quote args for the shell there.
  const quoted = args.map((a) => (/\s/.test(a) ? `"${a}"` : a));
  return execFileAsync("claude", win ? quoted : args, { shell: win, timeout: 30_000, windowsHide: true });
}

/**
 * Register sa-vm in Claude Code's own user-scope MCP config via the `claude` CLI.
 * Claude Code keeps MCP servers in its CLI-managed `~/.claude.json`, which the
 * Desktop / Gemini / Grok writers never touch — without this step
 * `claude mcp list` stays empty and `sa_vm_run` is unavailable in Claude Code.
 * Idempotent: an entry already pointing at `scriptPath` is left alone; a stale
 * entry is replaced. Returns "unavailable" when the `claude` CLI cannot run.
 */
export async function ensureClaudeCodeSaVmRegistered(
  scriptPath: string,
): Promise<"added" | "updated" | "unchanged" | "unavailable"> {
  let current: string | null = null;
  try {
    current = (await runClaudeCli(["mcp", "get", "sa-vm"])).stdout;
  } catch (err) {
    // `mcp get` exits non-zero when the server is not configured — not an error here.
    const code = (err as { code?: unknown }).code;
    if (code === "ENOENT") return "unavailable";
    current = null;
  }
  if (current !== null && isClaudeCodeSaVmRegistered(current, scriptPath)) return "unchanged";
  if (current !== null) await runClaudeCli(["mcp", "remove", "sa-vm", "-s", "user"]);
  await runClaudeCli(["mcp", "add", "-s", "user", "sa-vm", "--", "node", scriptPath]);
  return current === null ? "added" : "updated";
}

export async function ensureSaVmMcpInstalled(options?: {
  targetRoot?: string;
  autoRegisterClients?: boolean;
}): Promise<{ scriptPath: string; installed: boolean; clientsConfigured: string[] }> {
  const targetRoot = options?.targetRoot ?? getSaVmGlobalDataDir();
  const scriptPath = join(targetRoot, SA_VM_MCP_SCRIPT_NAME);
  const clientsConfigured: string[] = [];

  await mkdir(targetRoot, { recursive: true, mode: 0o755 });

  const builtinSource = resolveBuiltinSaVmSourceRoot();
  const candidateSource = builtinSource ? join(builtinSource, SA_VM_MCP_SCRIPT_NAME) : null;

  if (candidateSource && existsSync(candidateSource) && resolve(candidateSource) !== resolve(scriptPath)) {
    await cp(candidateSource, scriptPath, { force: true });
  } else {
    const repoCandidate = join(process.cwd(), "scripts", SA_VM_MCP_SCRIPT_NAME);
    if (existsSync(repoCandidate) && resolve(repoCandidate) !== resolve(scriptPath)) {
      await cp(repoCandidate, scriptPath, { force: true });
    }
  }

  // pi 扩展源文件与 MCP 脚本同步落到 targetRoot，pi 注册从这里读取，
  // 因此即使仓库 scripts 目录不可用，也沿用上一次已部署的副本。
  const piExtensionPath = join(targetRoot, SA_VM_PI_EXTENSION_SOURCE_NAME);
  try {
    const piExtensionRepoCandidate = join(process.cwd(), "scripts", SA_VM_PI_EXTENSION_SOURCE_NAME);
    if (existsSync(piExtensionRepoCandidate) && resolve(piExtensionRepoCandidate) !== resolve(piExtensionPath)) {
      await cp(piExtensionRepoCandidate, piExtensionPath, { force: true });
    }
  } catch {}

  // 悬空指针防护：脚本没落盘成功就绝不写客户端配置，否则 MCP 指向
  // 不存在的文件，agent 启动时取不到 sa_vm_run（linux 新机器常见，
  // Windows 因安装包自带副本不受影响）。
  const installed = existsSync(scriptPath);
  if (!installed) {
    return { scriptPath, installed: false, clientsConfigured };
  }

  if (!options || options.autoRegisterClients !== false) {
    const home = homedir();

    // 1. Gemini / Antigravity CLI configs
    const geminiConfigs = [
      join(home, ".gemini", "config", "mcp_config.json"),
      join(home, ".gemini", "mcp_config.json"),
    ];

    for (const confPath of geminiConfigs) {
      try {
        //Like opencode below: create the directory instead of skipping, so a
        //fresh machine still gets sa-vm (agy depends on this MCP path).
        await mkdir(dirname(confPath), { recursive: true, mode: 0o755 });
        await upsertSaVmMcpServerJsonFile(confPath, scriptPath);
        clientsConfigured.push(`gemini:${confPath}`);
      } catch {}
    }

    // 2. Claude Desktop config if Claude directory exists
    try {
      const claudeDesktopDir = process.platform === "win32"
        ? join(process.env.APPDATA || join(home, "AppData", "Roaming"), "Claude")
        : process.platform === "darwin"
          ? join(home, "Library", "Application Support", "Claude")
          : join(home, ".config", "Claude");
      const claudeConfigPath = join(claudeDesktopDir, "claude_desktop_config.json");
      if (existsSync(claudeDesktopDir)) {
        let conf: { mcpServers?: Record<string, { command: string; args: string[] }> } = {};
        if (existsSync(claudeConfigPath)) {
          conf = parseJsonObjectConfig(await readFile(claudeConfigPath, "utf8"));
        }
        if (!conf.mcpServers) conf.mcpServers = {};
        conf.mcpServers["jev"] = {
          command: "node",
          args: [scriptPath],
        };
        conf.mcpServers["sa-vm"] = {
          command: "node",
          args: [scriptPath],
        };
        await writeFile(claudeConfigPath, JSON.stringify(conf, null, 2), "utf8");
        clientsConfigured.push(`claude:${claudeConfigPath}`);
      }
    } catch {}

    // 3. Grok CLI config (create the directory instead of skipping, same as
    // gemini/opencode above, so a fresh machine still gets sa-vm).
    try {
      const grokDir = join(home, ".grok");
      const grokConfigPath = join(grokDir, "config.toml");
      await mkdir(grokDir, { recursive: true, mode: 0o755 });
      {
        let content = existsSync(grokConfigPath) ? await readFile(grokConfigPath, "utf8") : "";
        if (!content.includes("[mcp_servers.sa-vm]")) {
          const mcpEntry = `\n[mcp_servers.sa-vm]\ncommand = "node"\nargs = [${JSON.stringify(scriptPath)}]\nenabled = true\n`;
          content = content ? `${content.trimEnd()}\n${mcpEntry}` : mcpEntry;
          await writeFile(grokConfigPath, content, "utf8");
          clientsConfigured.push(`grok:${grokConfigPath}`);
        }
      }
    } catch {}
    // 4. OpenCode global config (`~/.config/opencode/opencode.json`, stdio MCP).
    // Per-turn OPENCODE_CONFIG_CONTENT injection (see
    // `buildOpencodeConfigContent`) is the primary path — this file registration
    // is the offline fallback so plain `opencode` CLI runs also see `sa-vm`.
    try {
      const opencodeDir = join(home, ".config", "opencode");
      const opencodeConfigPath = join(opencodeDir, "opencode.json");
      // linux 新机器 ~/.config/opencode 往往不存在（Windows 安装包会建好），
      // 直接建出来而不是静默跳过，否则全局 opencode 永远挂不上 sa-vm。
      // 目录已存在时 mkdir 递归调用是 no-op，Windows 行为不变。
      await mkdir(opencodeDir, { recursive: true, mode: 0o755 });
      {
        let conf: Record<string, any> = {};
        if (existsSync(opencodeConfigPath)) {
          // Unparsable config throws to the catch below and is left as-is,
          // never reset to `{}` and rewritten (that would drop the user's config).
          conf = parseJsonObjectConfig(await readFile(opencodeConfigPath, "utf8"));
        }
        const merged = mergeOpencodeMcpConfig(conf, scriptPath);
        await writeFile(opencodeConfigPath, JSON.stringify(merged, null, 2), "utf8");
        clientsConfigured.push(`opencode:${opencodeConfigPath}`);
      }
    } catch {}

    // 5. Mini Agent dedicated global config (`~/.mini-agent/config.toml` & `~/.mini-agent/config.json`).
    try {
      const miniHome = (process.env.MINI_AGENT_HOME ?? process.env.MINI_HOME ?? "").trim() || join(home, ".mini-agent");
      await mkdir(miniHome, { recursive: true, mode: 0o755 });

      // TOML
      const miniConfigPath = join(miniHome, "config.toml");
      const existing = existsSync(miniConfigPath) ? await readFile(miniConfigPath, "utf8") : "";
      const updated = mergeMiniAgentTomlMcpConfig(existing, scriptPath);
      if (updated !== existing) {
        await writeFile(miniConfigPath, updated, "utf8");
        clientsConfigured.push(`mini-agent:${miniConfigPath}`);
      }

      // JSON (大众惯例)
      const miniJsonPath = join(miniHome, "config.json");
      let globalJson: Record<string, any> = {};
      if (existsSync(miniJsonPath)) {
        globalJson = parseJsonObjectConfig(await readFile(miniJsonPath, "utf8"));
      }
      const updatedGlobalJson = mergeMcpServersJsonConfig(globalJson, scriptPath);
      await writeFile(miniJsonPath, JSON.stringify(updatedGlobalJson, null, 2), "utf8");
      clientsConfigured.push(`mini-agent-json:${miniJsonPath}`);
    } catch {}

    // 6. Claude Code (`claude` CLI user-scope MCP). See ensureClaudeCodeSaVmRegistered.
    try {
      const status = await ensureClaudeCodeSaVmRegistered(scriptPath);
      if (status !== "unavailable") clientsConfigured.push(`claude-code:${status}`);
    } catch {}

    // 7. pi CLI has no MCP support; it auto-discovers extensions under
    // `<agentDir>/extensions/<name>/index.ts`. Install sa_vm_run as a pi tool there.
    try {
      if (existsSync(piExtensionPath)) {
        const piAgentDir = (process.env.PI_CODING_AGENT_DIR ?? "").trim() || join(home, ".pi", "agent");
        const piExtensionDir = join(piAgentDir, "extensions", "sa-vm");
        const piExtensionTarget = join(piExtensionDir, "index.ts");
        const next = await readFile(piExtensionPath, "utf8");
        const prev = existsSync(piExtensionTarget) ? await readFile(piExtensionTarget, "utf8") : null;
        if (prev !== next) {
          await mkdir(piExtensionDir, { recursive: true, mode: 0o755 });
          await writeFile(piExtensionTarget, next, "utf8");
          clientsConfigured.push(`pi:${piExtensionTarget}`);
        }
      }
    } catch {}

    // 8. Muse 全局 MCP（~/.config/muse/settings.json，缺失则创建；同时兼容 ~/.muse/settings.json）。
    //    与 mini/opencode 全局注册对等：默认 sa-vm，jev 仅 opt-in（JEV_MCP_ENABLED=1）。
    for (const museConfPath of [join(home, ".config", "muse", "settings.json"), join(home, ".muse", "settings.json")]) {
      try {
        await mkdir(dirname(museConfPath), { recursive: true, mode: 0o755 });
        let museConf: Record<string, any> = {};
        if (existsSync(museConfPath)) {
          try {
            const parsed = JSON.parse(await readFile(museConfPath, "utf8"));
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) museConf = parsed;
          } catch {
            museConf = {};
          }
        }
        const servers = (museConf.mcpServers && typeof museConf.mcpServers === "object" && !Array.isArray(museConf.mcpServers)
          ? { ...(museConf.mcpServers as Record<string, any>) }
          : {}) as Record<string, any>;
        if (isJevMcpEnabled()) {
          servers["jev"] = { command: "node", args: [scriptPath] };
        } else if (isSelfManagedMcpEntry(servers["jev"])) {
          delete servers["jev"];
        }
        // muse 实测形状（1.4.7）：{id, command, args?, env?}，顶层 schema_version 必填
        // （缺失报 malformed settings file）。与 per-run XDG 注入同形。
        servers["sa-vm"] = { id: "sa-vm", command: "node", args: [scriptPath] };
        museConf = { ...museConf, mcpServers: servers };
        // muse settings.json 要求顶层 schema_version 为 u32（缺失报 malformed）。
        if (typeof museConf.schema_version !== "number") museConf.schema_version = 1;
        await writeFile(museConfPath, JSON.stringify(museConf, null, 2), "utf8");
        clientsConfigured.push(`muse:${museConfPath}`);
      } catch {}
    }
  }

  return {
    scriptPath,
    installed: existsSync(scriptPath),
    clientsConfigured,
  };
}


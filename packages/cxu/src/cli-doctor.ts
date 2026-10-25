import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { getBunInstallHint, isBunAvailable } from "./bun-runtime.js";

export type DoctorToolId = "bun" | "codex" | "claude" | "agy" | "auggie" | "cline" | "command-code" | "grok" | "pi" | "opencode" | "muse" | "mini";

export type DoctorStatus = {
  id: DoctorToolId;
  label: string;
  required: boolean;
  found: boolean;
  path?: string;
  version?: string;
  installHint: string;
  note?: string;
};

type InstallSpec = { win32?: string; posix?: string; all?: string; manual?: string };

type ToolDef = {
  id: DoctorToolId;
  label: string;
  required: boolean;
  bins: string[];
  envVars: string[];
  extraDirs: string[];
  install: InstallSpec;
  minVersion?: string;
};

const HOME = process.env.HOME || process.env.USERPROFILE || homedir();

export const BUN_MIN_VERSION = "1.4.0";

const TOOLS: ToolDef[] = [
  {
    id: "bun",
    label: "Bun",
    required: false,
    bins: ["bun"],
    envVars: [],
    extraDirs: [join(HOME, ".bun", "bin")],
    install: { all: getBunInstallHint() },
    minVersion: BUN_MIN_VERSION,
  },
  {
    id: "codex",
    label: "Codex CLI",
    required: false,
    bins: ["codex", "codex-app-server", "codex_app_server"],
    envVars: ["CODEX_BIN"],
    extraDirs: [
      join(HOME, ".codex", "bin"),
      ...(process.platform === "win32" && process.env.LOCALAPPDATA ? [
        join(process.env.LOCALAPPDATA, "Programs", "OpenAI", "Codex", "bin"),
      ] : []),
    ],
    install: {
      win32: 'powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"',
      posix: "curl -fsSL https://chatgpt.com/codex/install.sh | sh",
    },
    minVersion: "0.46.0",
  },
  {
    id: "claude",
    label: "Claude CLI",
    required: false,
    bins: ["claude", "claudecode"],
    envVars: ["CODECLI_BIN", "CLAUDE_CODE_BIN"],
    extraDirs: [
      join(HOME, ".claude", "bin"),
      ...(process.env.LOCALAPPDATA ? [join(process.env.LOCALAPPDATA, "Programs", "claude")] : []),
      ...(process.env.APPDATA ? [join(process.env.APPDATA, "npm")] : []),
      join(HOME, ".local", "bin"),
    ],
    install: {
      win32: 'powershell -ExecutionPolicy ByPass -c "irm https://claude.ai/install.ps1 | iex"',
      posix: "curl -fsSL https://claude.ai/install.sh | bash",
      manual: "WinGet: winget install Anthropic.ClaudeCode | Homebrew: brew install --cask claude-code | NPM (deprecated): npm install -g @anthropic-ai/claude-code",
    },
  },
  {
    id: "agy",
    label: "Antigravity CLI",
    required: false,
    bins: ["agy"],
    envVars: ["AGY_BIN", "CODEX_UI_AGY_BIN"],
    extraDirs: [
      join(HOME, ".agy", "bin"),
      ...(process.platform === "win32" && process.env.LOCALAPPDATA ? [join(process.env.LOCALAPPDATA, "agy", "bin")] : []),
    ],
    install: {
      win32: 'powershell -ExecutionPolicy ByPass -c "irm https://antigravity.google/cli/install.ps1 | iex"',
      manual: "Install Antigravity CLI manually, then set AGY_BIN to its path.",
    },
  },
  {
    id: "auggie",
    label: "Auggie CLI",
    required: false,
    bins: ["auggie"],
    envVars: ["AUGGIE_BIN", "CODEX_UI_AUGGIE_BIN"],
    extraDirs: [join(HOME, ".local", "bin")],
    install: { all: "npm install -g @augmentcode/auggie" },
  },
  {
    id: "cline",
    label: "Cline CLI",
    required: false,
    bins: ["cline"],
    envVars: ["CLINE_BIN", "CODEX_UI_CLINE_BIN"],
    extraDirs: [join(HOME, ".local", "bin")],
    install: { all: "npm install -g cline" },
  },
  {
    id: "command-code",
    label: "Command Code CLI",
    required: false,
    bins: ["command-code"],
    envVars: ["COMMAND_CODE_BIN", "CODEX_UI_COMMAND_CODE_BIN"],
    extraDirs: [join(HOME, ".local", "bin")],
    install: { all: "npm install -g command-code" },
  },
  {
    id: "grok",
    label: "Grok CLI",
    required: false,
    bins: ["grok", "agent"],
    envVars: ["GROK_BIN", "CODEX_UI_GROK_BIN"],
    extraDirs: [
      join(HOME, ".grok", "bin"),
      ...(process.platform === "win32" && process.env.LOCALAPPDATA ? [join(process.env.LOCALAPPDATA, "grok", "bin")] : []),
    ],
    install: {
      win32: 'powershell -ExecutionPolicy ByPass -c "irm https://x.ai/cli/install.ps1 | iex"',
      posix: "curl -fsSL https://x.ai/cli/install.sh | bash",
    },
  },
  {
    id: "pi",
    label: "Pi coding agent",
    required: false,
    bins: ["pi"],
    envVars: ["PI_BIN", "CODEX_UI_PI_BIN"],
    extraDirs: [join(HOME, ".pi", "bin")],
    install: { all: "npm install -g @earendil-works/pi-coding-agent" },
  },
  {
    id: "opencode",
    label: "OpenCode",
    required: false,
    bins: ["opencode"],
    envVars: ["OPENCODE_BIN", "CODEX_UI_OPENCODE_BIN"],
    extraDirs: [join(HOME, ".opencode", "bin")],
    install: {
      win32: "npm i -g opencode-ai@latest",
      posix: "curl -fsSL https://opencode.ai/install | bash",
      manual: "npm i -g opencode-ai@latest, or brew install anomalyco/tap/opencode, scoop/choco install opencode, mise use -g opencode",
    },
  },
  {
    id: "muse",
    label: "Muse CLI",
    required: false,
    bins: ["muse"],
    envVars: ["MUSE_BIN", "CODEX_UI_MUSE_BIN"],
    extraDirs: [
      join(HOME, ".local", "bin"),
      join(HOME, ".muse", "bin"),
      ...(process.platform === "win32" && process.env.LOCALAPPDATA ? [join(process.env.LOCALAPPDATA, "Programs", "muse"), join(process.env.LOCALAPPDATA, "muse", "bin")] : []),
      ...(process.platform === "win32" && process.env.USERPROFILE ? [join(process.env.USERPROFILE, ".muse", "bin")] : []),
    ],
    install: {
      win32: 'powershell -ExecutionPolicy ByPass -c "irm https://dev.meta.ai/install.ps1 | iex"',
      posix: "curl -fsSL https://dev.meta.ai/install.sh | bash",
      manual: "Windows: powershell -ExecutionPolicy ByPass -c \"irm https://dev.meta.ai/install.ps1 | iex\" | Linux/macOS: curl -fsSL https://dev.meta.ai/install.sh | bash",
    },
  },
];

function normalizeDir(raw: string): string | undefined {
  let dir = raw.trim();
  if (dir.length >= 2 && ((dir.startsWith('"') && dir.endsWith('"')) || (dir.startsWith("'") && dir.endsWith("'")))) {
    dir = dir.slice(1, -1).trim();
  }
  return dir || undefined;
}

function pathDirs(): string[] {
  const raw = process.env.PATH ?? process.env.Path ?? process.env.path ?? "";
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(delimiter)) {
    const dir = normalizeDir(part);
    if (!dir) continue;
    const key = process.platform === "win32" ? dir.toLowerCase() : dir;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(dir);
  }
  return out;
}

function isFile(candidate: string): boolean {
  try {
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}

/**
 * Server-side discovery (canExecute/isLaunchableFile) and every launch path
 * require the executable bit on posix. A found-but-not-executable file must
 * NOT be reported as installed: otherwise `cxu install --yes` skips the
 * reinstall (`found && !note`) while the CLI list can never show it — the
 * permanent "installed but not listed" state.
 */
function isLaunchableFile(candidate: string): boolean {
  if (process.platform === "win32") return isFile(candidate);
  try {
    const stats = statSync(candidate);
    return stats.isFile() && (stats.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

let npmPrefixDirCache: string | undefined;
let npmPrefixDirProbed = false;

function npmPrefixDir(): string | undefined {
  if (npmPrefixDirProbed) return npmPrefixDirCache;
  npmPrefixDirProbed = true;
  const firstLine = (res: { stdout?: unknown }): string | undefined =>
    String(res.stdout ?? "").split(/\r?\n/)[0]?.trim() || undefined;
  try {
    const res = spawnSync("npm", ["config", "get", "prefix"], { encoding: "utf8", timeout: 8000, windowsHide: true });
    const out = firstLine(res);
    if (res.status === 0 && out && out.toLowerCase() !== "null" && out.toLowerCase() !== "undefined") {
      npmPrefixDirCache = out;
      return npmPrefixDirCache;
    }
  } catch {
  }
  try {
    const res = spawnSync("npm config get prefix", { encoding: "utf8", timeout: 8000, shell: true, windowsHide: true });
    const out = firstLine(res);
    if (res.status === 0 && out) npmPrefixDirCache = out;
  } catch {
  }
  return npmPrefixDirCache;
}

function npmGlobalBinDirs(): string[] {
  const dirs: string[] = [];
  if (process.platform === "win32") {
    if (process.env.APPDATA) dirs.push(join(process.env.APPDATA, "npm"));
    if (process.env.LOCALAPPDATA) dirs.push(join(process.env.LOCALAPPDATA, "npm"));
    const prefix = npmPrefixDir();
    if (prefix) dirs.push(prefix);
    dirs.push(join(HOME, ".local", "bin"));
    dirs.push(join(HOME, ".bun", "bin"));
  } else {
    const prefix = npmPrefixDir();
    if (prefix) dirs.push(join(prefix, "bin"));
    // npm prefix 只能覆盖一种安装；cargo/go/mise 等工具链目录常不在 PATH，逐个兜底。
    dirs.push(join(HOME, ".cargo", "bin"));
    dirs.push(join(HOME, "go", "bin"));
    dirs.push(join(HOME, ".local", "bin"));
    dirs.push(join(HOME, ".local", "share", "mise", "shims"));
    dirs.push(join(HOME, ".local", "share", "pnpm"));
    dirs.push(join(HOME, ".bun", "bin"));
    dirs.push("/usr/local/bin");
    dirs.push("/opt/homebrew/bin");
    dirs.push("/home/linuxbrew/.linuxbrew/bin");
    dirs.push("/var/lib/flatpak/exports/bin");
    dirs.push(join(HOME, ".nix-profile", "bin"));
  }
  return dirs;
}

/**
 * 跨包管理器与工具链的全局扩展目录（WinGet / Scoop / Chocolatey /
 * Homebrew / Cargo / Go / Volta / pnpm / Yarn / Mise / Node-msi）。
 * 与服务端 candidateDirectories() 保持对齐；改了一端记得改另一端。
 */
export function platformGlobalBinDirs(): string[] {
  const dirs: string[] = [];
  if (process.platform === "win32") {
    const localApp = process.env.LOCALAPPDATA;
    const programData = process.env.ProgramData ?? process.env.PROGRAMDATA;
    const programFiles = process.env.ProgramFiles ?? process.env.ProgramW6432;
    const programFilesX86 = process.env["ProgramFiles(x86)"];
    if (localApp) {
      dirs.push(join(localApp, "Microsoft", "WinGet", "Links"));
      dirs.push(join(localApp, "mise", "shims"));
      dirs.push(join(localApp, "Volta", "bin"));
      dirs.push(join(localApp, "pnpm"));
      dirs.push(join(localApp, "Yarn", "bin"));
    }
    if (process.env.USERPROFILE) dirs.push(join(process.env.USERPROFILE, "scoop", "shims"));
    dirs.push(join(HOME, "scoop", "shims"));
    if (programData) {
      dirs.push(join(programData, "scoop", "shims"));
      dirs.push(join(programData, "chocolatey", "bin"));
    }
    dirs.push(join(HOME, ".cargo", "bin"));
    dirs.push(join(HOME, "go", "bin"));
    if (programFiles) dirs.push(join(programFiles, "nodejs"));
    if (programFilesX86) dirs.push(join(programFilesX86, "nodejs"));
  } else {
    dirs.push("/snap/bin");
    dirs.push("/var/lib/snapd/snap/bin");
    dirs.push(join(HOME, ".local", "share", "flatpak", "exports", "bin"));
    dirs.push("/nix/var/nix/profiles/default/bin");
    dirs.push(join(HOME, ".volta", "bin"));
    dirs.push(join(HOME, ".asdf", "shims"));
    dirs.push(join(HOME, ".proto", "shims"));
    dirs.push(join(HOME, ".local", "share", "rtx", "shims"));
    dirs.push(join(HOME, ".deno", "bin"));
    dirs.push(join(HOME, ".yarn", "bin"));
    dirs.push(join(HOME, ".config", "yarn", "global", "node_modules", ".bin"));
    if (process.env.GOPATH?.trim()) dirs.push(join(process.env.GOPATH.trim(), "bin"));
    if (process.env.CARGO_HOME?.trim()) dirs.push(join(process.env.CARGO_HOME.trim(), "bin"));
    // fnm 版本 bin（~/.local/share/fnm/node-versions/*/installation/bin），与服务端对齐
    dirs.push(...fnmVersionBinDirs(join(HOME, ".local", "share", "fnm")));
    if (process.env.FNM_DIR?.trim()) dirs.push(...fnmVersionBinDirs(process.env.FNM_DIR.trim()));
  }
  return dirs;
}

function fnmVersionBinDirs(root: string): string[] {
  try {
    const entries = readdirSync(join(root, "node-versions"), { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => join(root, "node-versions", e.name, "installation", "bin"));
  } catch {
    return [];
  }
}

function whereBinary(bin: string): string | undefined {
  if (process.platform !== "win32") return undefined;
  try {
    const res = spawnSync("where.exe", [bin], { encoding: "utf8", timeout: 8000, windowsHide: true });
    if (res.status !== 0) return undefined;
    const lines = String(res.stdout ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    for (const line of lines) {
      const candidate = normalizeDir(line) ?? line;
      if (isFile(candidate)) return candidate;
    }
  } catch {
  }
  return undefined;
}

function findBinary(def: ToolDef): string | undefined {
  for (const name of def.envVars) {
    const configured = process.env[name]?.trim();
    if (configured && isFile(configured)) return configured;
  }
  const extensions = process.platform === "win32" ? [".exe", ".cmd", ".bat", ".com", ".ps1", ""] : [""];
  const dirs = [...new Set([...pathDirs(), ...def.extraDirs, ...npmGlobalBinDirs(), ...platformGlobalBinDirs()])];
  for (const dir of dirs) {
    for (const bin of def.bins) {
      for (const ext of extensions) {
        const candidate = join(dir, `${bin}${ext}`);
        if (isFile(candidate)) return candidate;
      }
    }
  }
  if (process.platform === "win32") {
    for (const bin of def.bins) {
      const viaWhere = whereBinary(bin);
      if (viaWhere) return viaWhere;
    }
  }
  if (def.id === "bun" && isBunAvailable()) return "bun";
  return undefined;
}

function parseVersionOutput(output: string): string | undefined {
  const text = String(output || "").trim();
  if (!text) return undefined;
  return text.match(/(\d+\.\d+\.\d+)/)?.[1] ?? text.split(/\r?\n/)[0]?.slice(0, 64) ?? undefined;
}

function probeVersion(command: string): string | undefined {
  if (process.platform === "win32" && /\.ps1$/i.test(command)) {
    try {
      const psExe = commandExists("pwsh") ? "pwsh.exe" : "powershell.exe";
      const result = spawnSync(psExe, ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", command, "--version"], {
        encoding: "utf8",
        windowsHide: true,
        timeout: 8000,
      });
      if (result.error || result.status !== 0) return undefined;
      return parseVersionOutput(String(result.stdout || result.stderr || ""));
    } catch {
      return undefined;
    }
  }
  const needsShell = process.platform === "win32" && (/\.(cmd|bat)$/i.test(command) || (!command.includes("/") && !command.includes("\\")));
  const executable = needsShell ? (process.env.ComSpec || process.env.COMSPEC || "cmd.exe") : command;
  const args = needsShell ? ["/d", "/s", "/c", `call "${command}" --version`] : ["--version"];
  try {
    const result = spawnSync(executable, args, {
      encoding: "utf8",
      windowsHide: true,
      windowsVerbatimArguments: needsShell,
      timeout: 8000,
    });
    if (result.error || result.status !== 0) return undefined;
    return parseVersionOutput(String(result.stdout || result.stderr || ""));
  } catch {
    return undefined;
  }
}

export function installCommandFor(def: ToolDef): string {
  if (def.id === "codex" && process.platform !== "win32" && process.platform !== "darwin" && process.platform !== "linux") {
    return `Not supported on ${process.platform}; built-in MiniAgent is used.`;
  }
  if (def.install.all) return def.install.all;
  if (process.platform === "win32" && def.install.win32) return def.install.win32;
  if (process.platform !== "win32" && def.install.posix) return def.install.posix;
  return def.install.manual ?? def.install.win32 ?? def.install.posix ?? "Manual install required.";
}

function checkTool(def: ToolDef): DoctorStatus {
  const found = findBinary(def);
  if (found && !isLaunchableFile(found)) {
    return {
      id: def.id,
      label: def.label,
      required: def.required,
      found: false,
      path: found,
      version: undefined,
      note: `${def.label} exists at ${found} but is not executable; fix with: chmod +x ${found} (then re-run doctor), or reinstall.`,
      installHint: installCommandFor(def),
    };
  }
  const version = found ? probeVersion(found) : undefined;
  if (found && !version) {
    const note = def.id === "muse"
      ? `${def.label} found at ${found} but version check failed (launcher requires sign-in or first-time setup). Run \`muse\` in terminal to complete setup.`
      : `${def.label} found at ${found} but failed to run (binary uninitialized or broken). Run \`${def.bins[0]} --version\` manually to verify.`;
    return {
      id: def.id,
      label: def.label,
      required: def.required,
      found: false,
      path: found,
      version: undefined,
      note,
      installHint: installCommandFor(def),
    };
  }
  if (found && def.minVersion && version && compareVersions(version, def.minVersion) < 0) {
    return {
      id: def.id,
      label: def.label,
      required: def.required,
      found: false,
      path: found,
      version,
      note: `Requires ${def.label} >= ${def.minVersion} (found ${version}); please upgrade.`,
      installHint: installCommandFor(def),
    };
  }
  return {
    id: def.id,
    label: def.label,
    required: def.required,
    found: Boolean(found && version),
    path: found,
    version,
    installHint: installCommandFor(def),
  };
}

export function compareVersions(a: string, b: string): number {
  const pa = String(a).match(/\d+/g)?.map(Number) ?? [];
  const pb = String(b).match(/\d+/g)?.map(Number) ?? [];
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

export function doctor(): { statuses: DoctorStatus[]; codexReady: boolean; isReady: boolean } {
  const statuses = TOOLS.map(checkTool);
  const miniStatus: DoctorStatus = {
    id: "mini",
    label: "MiniAgent (Built-in)",
    required: false,
    found: true,
    path: "builtin",
    installHint: "Built-in, no install needed.",
  };
  const all = [...statuses, miniStatus];
  return { statuses: all, codexReady: Boolean(statuses.find((s) => s.id === "codex")?.found), isReady: true };
}

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

export function printDoctor(): boolean {
  const { statuses, codexReady, isReady } = doctor();
  console.log(`
${BOLD}=== Codex Ultra Environment Doctor ===${RESET}
`);
  for (const s of statuses) {
    const tag = (s.id === "mini") ? `${GREEN}[BUILTIN]${RESET}` : s.required ? `${RED}[REQUIRED]${RESET}` : `${DIM}[optional]${RESET}`;
    if (s.found) {
      const ver = s.version ? ` ${DIM}v${s.version}${RESET}` : "";
      const pathInfo = s.path ? ` ${DIM}(${s.path})${RESET}` : "";
      console.log(`  ${GREEN}✔${RESET} ${BOLD}${s.label.padEnd(20)}${RESET} ${tag}${ver}${pathInfo}`);
      if (s.note) console.log(`    ${YELLOW}⚠${RESET} ${YELLOW}${s.note}${RESET}`);
    } else {
      console.log(`  ${RED}✖${RESET} ${BOLD}${s.label.padEnd(20)}${RESET} ${tag}`);
      if (s.note) console.log(`    ${YELLOW}⚠${RESET} ${YELLOW}${s.note}${RESET}`);
      console.log(`    ${DIM}Install:${RESET} ${CYAN}${s.installHint}${RESET}`);
    }
  }
  console.log("");
  if (!codexReady) {
    console.log(`${DIM}Codex CLI not detected; defaulting to built-in MiniAgent runtime.${RESET}
`);
  }
  return isReady;
}

import { createInterface } from "node:readline";

export async function promptDoctorInteractive(options?: { noPrompt?: boolean }): Promise<void> {
  const { statuses, codexReady } = doctor();
  const needsAttention = statuses.filter((s) => (s.id !== "mini") && (!s.found || s.note));
  if (needsAttention.length === 0) return;

  // If stdin is not a terminal (e.g. running in background, pipe, CI) or noPrompt requested, don't hang, just continue
  if (options?.noPrompt || !process.stdin.isTTY || !process.stdout.isTTY) {
    if (!codexReady) {
      console.log(`${DIM}Codex CLI not detected; defaulting to built-in MiniAgent runtime.${RESET}`);
    }
    return;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string): Promise<string> =>
    new Promise((resolve) => rl.question(q, (ans) => resolve(ans.trim().toLowerCase())));

  try {
    const defOf = (id: DoctorToolId): ToolDef | undefined => TOOLS.find((t) => t.id === id);
    const isAuto = (id: DoctorToolId): boolean => {
      const def = defOf(id);
      if (!def) return false;
      if (def.install.all) return true;
      return process.platform === "win32" ? Boolean(def.install.win32) : Boolean(def.install.posix);
    };
    const autoInstallable = needsAttention.filter((m) => isAuto(m.id));
    const manualOnly = needsAttention.filter((m) => !isAuto(m.id));

    console.log(`${BOLD}Tools needing attention:${RESET} ${needsAttention.map((m) => m.label).join(", ")}`);
    for (const m of needsAttention) {
      const tag = m.required ? `${RED}[REQUIRED]${RESET}` : `${DIM}[optional]${RESET}`;
      const mark = m.found ? `${YELLOW}!${RESET}` : `${RED}✖${RESET}`;
      console.log(`  ${mark} ${BOLD}${m.label}${RESET} ${tag}`);
      if (!m.found) console.log(`    ${DIM}Install:${RESET} ${CYAN}${m.installHint}${RESET}`);
      if (m.note) console.log(`    ${DIM}Note:${RESET} ${YELLOW}${m.note}${RESET}`);
    }
    console.log(`  ${CYAN}[a]${RESET} Auto-install tools needing attention (${autoInstallable.length} of ${needsAttention.length} support auto-install)`);
    console.log(`  ${CYAN}[s]${RESET} Skip and continue starting workbench (Default)`);
    console.log(`  ${CYAN}[m]${RESET} View manual installation commands`);
    if (manualOnly.length > 0) {
      console.log(`${DIM}Manual-only on this platform: ${manualOnly.map((m) => m.label).join(", ")} — use [m] to view commands.${RESET}`);
    }
    console.log("");

    const choice = await ask(`${BOLD}Select an action [a/s/m] (default: s): ${RESET}`);
    if (choice === "a" || choice === "all" || choice === "y" || choice === "yes") {
      console.log(`
${BOLD}Starting auto-installation...${RESET}
`);
      if (autoInstallable.length === 0) {
        console.log(`${YELLOW}No auto-installer available on this platform for the missing tools.${RESET}`);
      }
      for (const item of autoInstallable) {
        console.log(`${CYAN}Installing ${item.label}...${RESET}`);
        const res = runInstall(item.id);
        console.log(res.note ?? (res.ran ? `  ${GREEN}✔${RESET} Done.` : `  ${RED}✖${RESET} Skipped.`));
      }
      const after = doctor();
      const stillMissing = after.statuses.filter((s) => !s.found || s.note);
      if (stillMissing.length > 0) {
        console.log(`
${BOLD}Still needing attention:${RESET} ${stillMissing.map((m) => m.label).join(", ")}`);
        for (const m of stillMissing) {
          console.log(`  ${BOLD}${m.label}:${RESET}\n    ${CYAN}${m.installHint}${RESET}`);
          if (m.note) console.log(`    ${YELLOW}${m.note}${RESET}`);
        }
        if (!after.codexReady) {
          console.log(`
${DIM}Codex CLI is still missing; continuing with built-in MiniAgent runtime.${RESET}
`);
        }
      } else {
      console.log(`
${GREEN}✔ Installation completed.${RESET}
`);
      }
    } else if (choice === "m" || choice === "manual") {
      console.log(`
${BOLD}Manual Installation Commands:${RESET}`);
      for (const m of needsAttention) {
        console.log(`  ${BOLD}${m.label}:${RESET}
    ${CYAN}${m.installHint}${RESET}`);
        if (m.note) console.log(`    ${YELLOW}${m.note}${RESET}`);
      }
      console.log("");
      await ask(`Press Enter to continue starting workbench...`);
    } else {
      console.log(`${DIM}Skipping installation, proceeding to start workbench...${RESET}
`);
      if (!doctor().codexReady) {
        console.log(`${DIM}Codex CLI not detected; defaulting to built-in MiniAgent runtime.${RESET}
`);
      }
    }
  } finally {
    rl.close();
  }
}

export function listToolIds(): DoctorToolId[] {
  return TOOLS.map((t) => t.id);
}

export function extractPowerShellScript(command: string): string | null {
  const match = command.match(/^(?:powershell|pwsh)(?:\.exe)?\s+(?:-(?:ExecutionPolicy|EP)\s+\S+\s+)?-(?:Command|c)\s+["']?([\s\S]*?)["']?$/i);
  return match?.[1]?.trim() ?? null;
}

export function runInstall(id: DoctorToolId): { ran: boolean; command?: string; note?: string } {
  if (id === "mini") return { ran: false, note: "MiniAgent is built-in, no install needed." };
  const def = TOOLS.find((t) => t.id === id);
  if (!def) return { ran: false, note: `Unknown tool: ${id}. Choices: ${listToolIds().join(", ")}` };
  const current = checkTool(def);
  if (current.found && !current.note) return { ran: false, note: `${def.label} already installed (${current.path}).` };
  if (def.id === "bun" && process.platform !== "win32" && !ensureUnzipAvailable()) {
    const fallback = installBunViaNpm(def);
    if (fallback.ran) return fallback;
    return {
      ran: false,
      note: `Bun needs the 'unzip' binary and it could not be installed automatically (npm fallback also failed${fallback.detail ? `: ${fallback.detail}` : ""}). Install unzip with your package manager (e.g. apt-get install -y unzip) and rerun: ${installCommandFor(def)}, or run: npm install -g bun`,
    };
  }
  const command = installCommandFor(def);
  if (!def.install.all && !def.install.win32 && !def.install.posix) {
    return { ran: false, note: `${def.label} has no automated installer. ${command}` };
  }
  let shell: string;
  let args: string[];
  const spawnEnv: NodeJS.ProcessEnv = { ...process.env };

  if (process.platform === "win32") {
    const hasPwsh = commandExists("pwsh");
    shell = hasPwsh ? "pwsh.exe" : "powershell.exe";
    const script = extractPowerShellScript(command);

    if (script) {
      if (hasPwsh) {
        args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script];
      } else {
        // In Windows PowerShell 5.1, having PowerShell 7 paths in PSModulePath causes
        // binary cmdlet load failures (.NET Framework vs .NET Core assembly conflict, e.g. Get-FileHash).
        if (spawnEnv.PSModulePath) {
          spawnEnv.PSModulePath = spawnEnv.PSModulePath
            .split(";")
            .filter((p) => !/powershell[\\/]7/i.test(p))
            .join(";");
        }
        // Ensure standard utility cmdlets (like Get-FileHash) and TLS 1.2 are initialized in PS 5.1
        const wrappedScript = `Import-Module Microsoft.PowerShell.Utility -ErrorAction SilentlyContinue; [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; ${script}`;
        args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", wrappedScript];
      }
    } else {
      args = ["-NoProfile", "-Command", command];
    }
  } else {
    shell = "bash";
    args = ["-c", command];
  }

  // Detach stdin: some vendor installers end with their own interactive
  // prompt (e.g. Codex CLI's "Start Codex now? [y/N]"). Inheriting our stdin
  // lets that prompt steal the terminal — or hang when our own readline is
  // still attached — and stalls the remaining installs. With stdin closed the
  // prompt reads EOF, takes its default (No), and the installer exits so cxu
  // can continue with the next tool.
  console.log(`${DIM}Non-interactive install: follow-up prompts from the vendor installer are auto-declined.${RESET}`);
  const result = spawnSync(shell, args, { stdio: ["ignore", "inherit", "inherit"], windowsHide: false, env: spawnEnv });
  if (result.error || result.status !== 0) {
    return { ran: false, note: `Installer exited ${result.status ?? "with error"}. Run manually: ${command}` };
  }
  // Vendor installers update shell rc files, not our live PATH. Refresh the
  // known install dirs in-process so the re-probe below sees same-run installs.
  refreshKnownBinDirs();
  const after = checkTool(def);
  return after.found
    ? { ran: true, command, note: `${def.label} installed (${after.path}).` }
    : { ran: false, command, note: `Installer finished but ${def.label} still not detected. Run manually: ${command}` };
}

function commandExists(cmd: string): boolean {
  try {
    const probe = process.platform === "win32"
      ? spawnSync("where", [cmd], { stdio: "ignore", windowsHide: true })
      : spawnSync(`command -v ${cmd}`, { stdio: "ignore", shell: true, timeout: 5000 });
    return probe.status === 0;
  } catch {
    return false;
  }
}

function refreshKnownBinDirs(): void {
  const dirs = [
    join(HOME, ".local", "bin"),
    join(HOME, ".bun", "bin"),
    join(HOME, ".codex", "bin"),
    join(HOME, ".claude", "bin"),
    join(HOME, ".opencode", "bin"),
    join(HOME, ".grok", "bin"),
    join(HOME, ".agy", "bin"),
    join(HOME, ".pi", "bin"),
    join(HOME, ".cargo", "bin"),
    join(HOME, ".muse", "bin"),
    ...(process.platform === "win32" && process.env.LOCALAPPDATA ? [
      join(process.env.LOCALAPPDATA, "Programs", "muse"),
      join(process.env.LOCALAPPDATA, "muse", "bin"),
    ] : []),
    ...npmGlobalBinDirs(),
    ...platformGlobalBinDirs(),
  ];
  const current = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  const missing = dirs.filter((d) => !current.includes(d));
  if (missing.length > 0) {
    process.env.PATH = [...missing, ...current].join(delimiter);
  }
}

// Returns true when `unzip` is usable. When it is missing, tries the host
// package manager (sudo only when not root). Never throws, never prompts.
type BunNpmFallback = { ran: boolean; note?: string; detail?: string };

function installBunViaNpm(def: ToolDef): BunNpmFallback {
  if (!commandExists("npm")) return { ran: false, detail: "npm not found" };
  console.log(`${DIM}unzip is unavailable, falling back to: npm install -g bun${RESET}`);
  try {
    const res = spawnSync("npm", ["install", "-g", "bun"], { stdio: "inherit", timeout: 300000, windowsHide: false });
    if (res.error || res.status !== 0) {
      return { ran: false, detail: `npm install exited ${res.status ?? "with error"}` };
    }
  } catch {
    return { ran: false, detail: "npm install threw" };
  }
  addNpmGlobalBinToPath();
  refreshKnownBinDirs();
  const after = checkTool(def);
  return after.found
    ? { ran: true, note: `${def.label} installed via npm (${after.path}).` }
    : { ran: false, detail: "installed but bun still not detected (global npm bin dir not on PATH?)" };
}

function addNpmGlobalBinToPath(): void {
  try {
    const prefix = npmPrefixDir();
    if (!prefix) return;
    const binDir = process.platform === "win32" ? prefix : join(prefix, "bin");
    const current = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
    if (!current.includes(binDir)) {
      process.env.PATH = [binDir, ...current].join(delimiter);
    }
  } catch {
  }
}

function ensureUnzipAvailable(): boolean {
  if (commandExists("unzip")) return true;
  const useSudo = typeof process.getuid === "function" && process.getuid() !== 0 && commandExists("sudo");
  const prefix = useSudo ? "sudo " : "";
  const attempts: string[] = [];
  if (commandExists("apt-get")) {
    attempts.push(`${prefix}apt-get update -qq && ${prefix}apt-get install -y -qq unzip`);
  } else if (commandExists("dnf")) {
    attempts.push(`${prefix}dnf install -y -q unzip`);
  } else if (commandExists("yum")) {
    attempts.push(`${prefix}yum install -y -q unzip`);
  } else if (commandExists("apk")) {
    attempts.push(`${prefix}apk add --no-cache unzip`);
  } else if (commandExists("pacman")) {
    attempts.push(`${prefix}pacman -Sy --noconfirm unzip`);
  } else if (commandExists("brew")) {
    attempts.push(`brew install unzip`);
  }
  for (const cmd of attempts) {
    console.log(`${DIM}unzip not found, attempting: ${cmd}${RESET}`);
    try {
      const res = spawnSync("bash", ["-c", cmd], { stdio: "inherit", timeout: 180000 });
      if (res.status === 0 && commandExists("unzip")) return true;
    } catch {
      // fall through to the next manager / manual hint
    }
  }
  return commandExists("unzip");
}

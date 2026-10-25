import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { findCodexBinary } from "./codexCommand.js";

const execFileAsync = promisify(execFile);

export type CodexCliUpdateProbe = {
  scope: "local" | "ssh";
  path: string;
  version: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  updateSupported: boolean;
  checkedAt: number;
};

export async function probeLocalCodexCliUpdate(): Promise<CodexCliUpdateProbe> {
  const path = findCodexBinary();
  const [version, help] = await Promise.all([
    execFileAsync(path, ["--version"], { timeout: 15_000, maxBuffer: 64 * 1024 }),
    execFileAsync(path, ["update", "--help"], { timeout: 15_000, maxBuffer: 256 * 1024 }).catch(() => ({ stdout: "", stderr: "" }))
  ]);
  return {
    scope: "local",
    path,
    version: String(version.stdout).trim(),
    latestVersion: null,
    updateAvailable: false,
    updateSupported: /Update Codex|Usage:\s+codex update/i.test(String(help.stdout)),
    checkedAt: Date.now(),
  };
}

const GITHUB_RELEASES_URL = "https://api.github.com/repos/openai/codex/releases/latest";
const NPM_REGISTRY_URL = "https://registry.npmjs.org/@openai%2fcodex";

function parseVersion(v: string): [number, number, number] | null {
  const match = v.trim().match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function isNewer(latest: string, current: string): boolean {
  const l = parseVersion(latest);
  const c = parseVersion(current);
  if (!l || !c) return false;
  if (l[0] !== c[0]) return l[0] > c[0];
  if (l[1] !== c[1]) return l[1] > c[1];
  return l[2] > c[2];
}

async function fetchLatestVersion(): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const response = await fetch(GITHUB_RELEASES_URL, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "codex-ultra" },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!response.ok) {
      return await fetchLatestVersionFromNpm();
    }
    const data = (await response.json()) as { tag_name?: string };
    const tag = data.tag_name;
    if (!tag) return await fetchLatestVersionFromNpm();
    const version = tag.replace(/^rust-v/, "").replace(/^v/, "");
    return parseVersion(version) ? version : null;
  } catch {
    return await fetchLatestVersionFromNpm();
  }
}

async function fetchLatestVersionFromNpm(): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const response = await fetch(NPM_REGISTRY_URL, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!response.ok) return null;
    const data = (await response.json()) as { "dist-tags"?: { latest?: string } };
    const latest = data["dist-tags"]?.latest;
    return latest && parseVersion(latest) ? latest : null;
  } catch {
    return null;
  }
}

export type CodexCliUpdateStatus = {
  installed: boolean;
  currentVersion: string | null;
  latestVersion: string | null;
  updateAvailable: boolean;
  installCommand: string;
  checkedAt: number;
};

const WINDOWS_INSTALL_COMMAND = "powershell -ExecutionPolicy ByPass -c \"irm https://chatgpt.com/codex/install.ps1 | iex\"";
const DEFAULT_INSTALL_COMMAND = "npm install -g @openai/codex@latest";

export async function checkLocalCodexCliUpdateStatus(): Promise<CodexCliUpdateStatus> {
  const platform = process.platform;
  const installCommand = platform === "win32" ? WINDOWS_INSTALL_COMMAND : DEFAULT_INSTALL_COMMAND;
  try {
    const probe = await probeLocalCodexCliUpdate();
    const latestVersion = await fetchLatestVersion();
    const currentVersion = probe.version || null;
    const updateAvailable = latestVersion && currentVersion
      ? isNewer(latestVersion, currentVersion)
      : false;
    return {
      installed: true,
      currentVersion,
      latestVersion,
      updateAvailable,
      installCommand,
      checkedAt: Date.now(),
    };
  } catch {
    return {
      installed: false,
      currentVersion: null,
      latestVersion: null,
      updateAvailable: false,
      installCommand,
      checkedAt: Date.now(),
    };
  }
}

export async function updateLocalCodexCli(): Promise<{ before: CodexCliUpdateProbe; after: CodexCliUpdateProbe; output: string }> {
  const before = await probeLocalCodexCliUpdate();
  if (!before.updateSupported) throw new Error("This Codex CLI does not support `codex update`; use the platform installer instead");
  const result = await execFileAsync(before.path, ["update"], { timeout: 300_000, maxBuffer: 4 * 1024 * 1024 });
  const after = await probeLocalCodexCliUpdate();
  return { before, after, output: redact([result.stdout, result.stderr].map(String).join("\n").trim()) };
}

export async function probeSshCodexCliUpdate(command: string): Promise<CodexCliUpdateProbe> {
  const args = sshArgs(command);
  const script = "codex_bin=\"$(command -v codex 2>/dev/null || true)\"; [ -n \"$codex_bin\" ] || codex_bin=\"$HOME/.local/bin/codex\"; [ -x \"$codex_bin\" ] || exit 127; printf 'path=%s\n' \"$codex_bin\"; printf 'version=%s\n' \"$(\"$codex_bin\" --version 2>/dev/null | head -n1)\"; if \"$codex_bin\" update --help 2>/dev/null | grep -q 'Update Codex'; then echo updateSupported=1; else echo updateSupported=0; fi";
  const result = await execFileAsync("ssh", [...args, script], { timeout: 30_000, maxBuffer: 256 * 1024 });
  const values = Object.fromEntries(String(result.stdout).split(/\r?\n/).flatMap((line) => { const i = line.indexOf("="); return i > 0 ? [[line.slice(0, i), line.slice(i + 1)]] : []; }));
  return { scope: "ssh", path: values.path ?? "", version: values.version ?? "", latestVersion: null, updateAvailable: false, updateSupported: values.updateSupported === "1", checkedAt: Date.now() };
}

export async function updateSshCodexCli(command: string): Promise<{ before: CodexCliUpdateProbe; after: CodexCliUpdateProbe; output: string }> {
  const before = await probeSshCodexCliUpdate(command);
  if (!before.updateSupported || !before.path) throw new Error("The remote Codex CLI does not support `codex update`");
  const result = await execFileAsync("ssh", [...sshArgs(command), shellQuote(before.path) + " update"], { timeout: 300_000, maxBuffer: 4 * 1024 * 1024 });
  const after = await probeSshCodexCliUpdate(command);
  return { before, after, output: redact([result.stdout, result.stderr].map(String).join("\n").trim()) };
}

function sshArgs(command: string): string[] {
  const parts = command.trim().match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)?.map((value) => value.replace(/^["']|["']$/g, "")) ?? [];
  if (parts[0] !== "ssh" || parts.length < 2) throw new Error("SSH command must look like: ssh user@host");
  return parts.slice(1);
}
function shellQuote(value: string): string { return "'" + value.replace(/'/g, "'\\''") + "'"; }
function redact(value: string): string { return value.replace(/sk-[A-Za-z0-9_-]{12,}/g, "sk-***").slice(-16_384); }
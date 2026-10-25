import { createReadStream, existsSync } from "node:fs";
import { createServer } from "node:net";
import { arch, platform } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { CLAUDE_POSIX_INSTALL_COMMAND, ensureRemoteClaudeCli, remoteClaudeProbeFragment } from "./sshCodeCliBridge.js";

const execFileAsync = promisify(execFile);
const DEFAULT_PORT = 43130;
const SERVICE = "codex-ultra-remote.service";
const tunnels = new Map<string, { child: ChildProcess; localPort: number; remotePort: number; command: string; token: string }>();

export type RemoteBunNodeProbe = {
  connected: boolean;
  os: string;
  arch: string;
  home: string;
  bunPath: string;
  bunVersion: string;
  codexPath: string;
  codexVersion: string;
  claudePath: string;
  claudeVersion: string;
  systemdUser: boolean;
  installed: boolean;
  serviceState: string;
  releaseId: string;
  remotePort: number;
  health: Record<string, unknown> | null;
  reasons: string[];
};

/** One SSH round trip that reports everything the installer and the UI need. */
export function remoteBunNodeProbeScript(port: number): string {
  return [
    "printf 'os=%s\\n' \"$(uname -s 2>/dev/null)\"",
    "printf 'arch=%s\\n' \"$(uname -m 2>/dev/null)\"",
    "printf 'home=%s\\n' \"$HOME\"",
    "bun_bin=\"$(command -v bun 2>/dev/null || true)\"; [ -x \"$bun_bin\" ] || bun_bin=\"$HOME/.bun/bin/bun\"; [ -x \"$bun_bin\" ] || bun_bin=/usr/local/bin/bun",
    "if [ -x \"$bun_bin\" ]; then printf 'bunPath=%s\\n' \"$bun_bin\"; printf 'bunVersion=%s\\n' \"$(\"$bun_bin\" --version 2>/dev/null)\"; else echo bunPath=; echo bunVersion=; fi",
    "codex_bin=\"$(command -v codex 2>/dev/null || true)\"; [ -x \"$codex_bin\" ] || codex_bin=\"$HOME/.local/bin/codex\"",
    "if [ -x \"$codex_bin\" ]; then printf 'codexPath=%s\\n' \"$codex_bin\"; printf 'codexVersion=%s\\n' \"$(\"$codex_bin\" --version 2>/dev/null | head -n 1)\"; else echo codexPath=; echo codexVersion=; fi",
    // Share the SSH bridge's candidate list so a host that can launch a
    // foreground Claude thread is never reported as Claude-less here.
    remoteClaudeProbeFragment(),
    "if command -v systemctl >/dev/null 2>&1 && systemctl --user show-environment >/dev/null 2>&1; then echo systemdUser=1; else echo systemdUser=0; fi",
    "[ -f \"$HOME/.codex-ultra/remote/current/server.js\" ] && echo installed=1 || echo installed=0",
    "printf 'releaseId=%s\\n' \"$(cat \"$HOME/.codex-ultra/remote/current/release-id\" 2>/dev/null || true)\"",
    "printf 'serviceState=%s\\n' \"$(systemctl --user is-active " + SERVICE + " 2>/dev/null || true)\"",
    "printf 'healthBase64=%s\\n' \"$(curl -fsS --max-time 3 http://127.0.0.1:" + port + "/api/runtime/health 2>/dev/null | base64 -w 0 2>/dev/null || true)\""
  ].join("; ");
}

export type RemoteClaudeInstallPlan = "enabled" | "disabled" | "install" | "missing";

/**
 * Decides what the remote node should do about the Claude CLI. Kept separate
 * from the install so the policy is readable and testable on its own.
 *
 * Omitting `enableClaude` means "follow the host": a Codex-only machine stays
 * Codex-only rather than pulling in a CLI nobody asked for. Asking for the
 * backend, on the other hand, is asking for the binary — the same way starting
 * a foreground SSH Claude thread is (see `ensureRemoteClaudeCli`) — so it
 * installs rather than reporting success with the backend quietly off, which
 * looks identical to a working node until the first thread fails. The official
 * installer is user-scope, so honouring that costs no privilege escalation;
 * `installClaude: false` still opts out and surfaces the gap instead.
 */
export function planRemoteClaudeInstall(input: { enableClaude?: boolean; installClaude?: boolean; claudePath: string }): RemoteClaudeInstallPlan {
  if (input.enableClaude === false) return "disabled";
  if (input.claudePath) return "enabled";
  if (input.installClaude === true) return "install";
  if (input.enableClaude !== true) return "disabled";
  return input.installClaude === false ? "missing" : "install";
}

export async function probeRemoteBunNode(command: string, portInput = DEFAULT_PORT): Promise<RemoteBunNodeProbe> {
  const args = sshArgs(command);
  const port = validPort(portInput);
  const result = await execFileAsync("ssh", [...args, remoteBunNodeProbeScript(port)], { timeout: 25_000, maxBuffer: 512 * 1024 });
  const values = keyValues(String(result.stdout));
  const health = decodeHealth(values.healthBase64);
  const reasons: string[] = [];
  if (!values.bunPath) reasons.push("Bun is not installed on the SSH host");
  if (!values.codexPath) reasons.push("Codex CLI is not installed on the SSH host");
  if (values.systemdUser !== "1") reasons.push("systemd --user is unavailable");
  if (values.installed !== "1") reasons.push("Codex Ultra remote Bun Server is not installed");
  if (values.installed === "1" && !health) reasons.push("Codex Ultra remote Bun Server is not responding");
  return {
    connected: true,
    os: values.os || "unknown",
    arch: values.arch || "unknown",
    home: values.home || "",
    bunPath: values.bunPath || "",
    bunVersion: values.bunVersion || "",
    codexPath: values.codexPath || "",
    codexVersion: values.codexVersion || "",
    claudePath: values.claudePath || "",
    claudeVersion: values.claudeVersion || "",
    systemdUser: values.systemdUser === "1",
    installed: values.installed === "1",
    serviceState: values.serviceState || "inactive",
    releaseId: values.releaseId || "",
    remotePort: port,
    health,
    reasons
  };
}

export async function installRemoteBunNode(input: {
  command: string;
  artifactPath?: string;
  remotePort?: number;
  installBun?: boolean;
  /**
   * Allow autonomous threads on this host to run the Claude-compatible CLI.
   * Defaults to whether the host actually has the binary. The remote node
   * serves its own relay gateway, so a Claude thread there reaches the upstream
   * relay directly instead of through this machine's reverse tunnel.
   */
  enableClaude?: boolean;
  /**
   * Opt out of installing the Claude CLI when the backend is wanted and the
   * host has no binary. Defaults to installing, because the official installer
   * is user-scope: it lands in ~/.local/bin as the SSH user and needs no root,
   * unlike Bun, whose absence is a hard prerequisite failure worth confirming.
   */
  installClaude?: boolean;
}): Promise<{ probe: RemoteBunNodeProbe; token: string; artifactPath: string }> {
  const args = sshArgs(input.command);
  const port = validPort(input.remotePort ?? DEFAULT_PORT);
  let before = await probeRemoteBunNode(input.command, port);
  if (before.os.toLowerCase() !== "linux") throw new Error("Remote Bun Server installation currently supports Linux; detected " + before.os);
  if (!/^(x86_64|amd64|aarch64|arm64)$/i.test(before.arch)) throw new Error("Unsupported remote architecture: " + before.arch);
  if (!before.codexPath) throw new Error("Install Codex CLI on the SSH host first");
  if (!before.bunPath) {
    if (!input.installBun) throw new Error("Bun was not found. Retry with installBun=true only after user confirmation.");
    await execFileAsync("ssh", [...args, "curl -fsSL https://bun.sh/install | bash"], { timeout: 180_000, maxBuffer: 4 * 1024 * 1024 });
    before = await probeRemoteBunNode(input.command, port);
  }
  if (!before.bunPath) throw new Error("Bun installation completed but the executable was not found");
  if (!before.systemdUser) throw new Error("systemd --user is required by the first remote-node implementation");
  const artifactPath = resolve(input.artifactPath?.trim() || defaultArtifact());
  if (!existsSync(artifactPath)) throw new Error("Remote bundle is missing: " + artifactPath + ". Run npm run remote-node:build first.");
  // Decided before anything is written to the host, so a rejected Claude
  // request costs nothing and leaves no half-installed node behind.
  const claudePlan = planRemoteClaudeInstall({ enableClaude: input.enableClaude, installClaude: input.installClaude, claudePath: before.claudePath });
  if (claudePlan === "missing") {
    throw new Error("Claude CLI was not found on the SSH host and installClaude=false was set. Install it there with: " + CLAUDE_POSIX_INSTALL_COMMAND + " (user-scope, no root), or drop installClaude to let this install do it.");
  }
  if (claudePlan === "install") {
    // The official installer is user-scope by design; the unit's PATH already
    // covers ~/.local/bin, so nothing else has to be reconfigured.
    await ensureRemoteClaudeCli(args, "posix");
  }
  const releaseId = await artifactReleaseId(artifactPath);
  const existingTokenResult = await execFileAsync("ssh", [...args, "sed -n 's/^CODEX_UI_TOKEN=//p' \"$HOME/.codex-ultra/remote/server.env\" 2>/dev/null | head -n 1"], { timeout: 15_000, maxBuffer: 64 * 1024 });
  const token = String(existingTokenResult.stdout).trim() || randomBytes(32).toString("base64url");
  const root = "$HOME/.codex-ultra/remote";
  const releaseRoot = "~/.codex-ultra/remote/releases/" + releaseId;
  await execFileAsync("ssh", [...args, "mkdir -p \"" + root + "/releases/" + releaseId + "\" \"" + root + "/data\" \"$HOME/.config/systemd/user\"; chmod 700 \"$HOME/.codex-ultra\" \"" + root + "\" \"" + root + "/releases\" \"" + root + "/releases/" + releaseId + "\" \"" + root + "/data\""], { timeout: 20_000 });
  await upload(args, artifactPath, releaseRoot + "/server.js", "600");
  await uploadText(args, releaseId + "\n", releaseRoot + "/release-id", "600");
  const env = buildRemoteBunNodeEnv({
    releaseId,
    port,
    token,
    home: before.home,
    claudeEnabled: claudePlan !== "disabled",
  });
  const unit = [
    "[Unit]",
    "Description=Codex Ultra Remote Bun Server",
    "After=network-online.target",
    "Wants=network-online.target",
    "",
    "[Service]",
    "Type=simple",
    "EnvironmentFile=%h/.codex-ultra/remote/server.env",
    "ExecStart=" + before.bunPath + " %h/.codex-ultra/remote/current/server.js",
    "Restart=on-failure",
    "RestartSec=3",
    "WorkingDirectory=%h/.codex-ultra/remote/current",
    "NoNewPrivileges=true",
    "",
    "[Install]",
    "WantedBy=default.target",
    ""
  ].join("\n");
  await uploadText(args, env, "~/.codex-ultra/remote/server.env", "600");
  await uploadText(args, unit, "~/.config/systemd/user/" + SERVICE, "600");
  await execFileAsync("ssh", [...args, "rm -rf \"$HOME/.codex-ultra/remote/previous\"; rm -f \"$HOME/.codex-ultra/remote/current.next\"; ln -s \"$HOME/.codex-ultra/remote/releases/" + releaseId + "\" \"$HOME/.codex-ultra/remote/current.next\"; if [ -e \"$HOME/.codex-ultra/remote/current\" ] || [ -L \"$HOME/.codex-ultra/remote/current\" ]; then mv -Tf \"$HOME/.codex-ultra/remote/current\" \"$HOME/.codex-ultra/remote/previous\"; fi; mv -Tf \"$HOME/.codex-ultra/remote/current.next\" \"$HOME/.codex-ultra/remote/current\""], { timeout: 20_000, maxBuffer: 256 * 1024 });
  await execFileAsync("ssh", [...args, "systemctl --user daemon-reload && systemctl --user enable --now " + SERVICE + " && systemctl --user restart " + SERVICE], { timeout: 45_000, maxBuffer: 512 * 1024 });
  try {
    await waitHealth(input.command, port, 30_000, releaseId);
  } catch (error) {
    await rollbackRelease(args).catch(() => undefined);
    throw error;
  }
  return { probe: await probeRemoteBunNode(input.command, port), token, artifactPath };
}

export async function openRemoteBunNodeTunnel(command: string, portInput = DEFAULT_PORT): Promise<{ tunnelId: string; localPort: number; remotePort: number; baseUrl: string; token: string }> {
  const args = sshArgs(command);
  const remotePort = validPort(portInput);
  const tokenResult = await execFileAsync("ssh", [...args, "sed -n 's/^CODEX_UI_TOKEN=//p' \"$HOME/.codex-ultra/remote/server.env\" | head -n 1"], { timeout: 15_000, maxBuffer: 64 * 1024 });
  const token = String(tokenResult.stdout).trim();
  if (!token) throw new Error("Remote node token is unavailable");
  const localPort = await freePort();
  const child = spawn("ssh", ["-o", "ExitOnForwardFailure=yes", "-N", "-L", "127.0.0.1:" + localPort + ":127.0.0.1:" + remotePort, ...args], { stdio: ["ignore", "ignore", "pipe"] });
  await waitTunnel(child, localPort, 15_000);
  const tunnelId = randomBytes(16).toString("hex");
  tunnels.set(tunnelId, { child, localPort, remotePort, command, token });
  child.once("exit", () => tunnels.delete(tunnelId));
  return { tunnelId, localPort, remotePort, baseUrl: "http://127.0.0.1:" + localPort, token };
}

export function closeRemoteBunNodeTunnel(tunnelId: string): boolean {
  const tunnel = tunnels.get(tunnelId);
  if (!tunnel) return false;
  tunnels.delete(tunnelId);
  tunnel.child.kill("SIGTERM");
  return true;
}

export async function syncRelayToRemoteEndpoint(
  baseUrl: string,
  token: string,
  payload: Record<string, unknown>,
  fetchImpl: typeof fetch = fetch
): Promise<unknown> {
  const headers = { "content-type": "application/json", "x-codex-ui-token": token };
  const body = JSON.stringify(payload);
  let response = await fetchImpl(baseUrl + "/api/codex/relay-settings", {
    method: "POST",
    headers,
    body
  });
  let result = await response.json().catch(() => ({})) as Record<string, unknown>;

  // Relay synchronization is an upsert from the local node. A remote node may
  // retain the provider from an earlier SSH session, so update that provider
  // instead of turning an otherwise healthy start into a duplicate error.
  const providerId = typeof payload.providerId === "string" ? payload.providerId.trim() : "";
  const duplicate = response.status === 409
    && typeof result.error === "string"
    && result.error.startsWith("Relay already exists:");
  if (duplicate && providerId) {
    response = await fetchImpl(baseUrl + "/api/codex/relay-settings/" + encodeURIComponent(providerId), {
      method: "PUT",
      headers,
      body
    });
    result = await response.json().catch(() => ({})) as Record<string, unknown>;
  }
  if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "Remote relay synchronization failed (" + response.status + ")");
  return result;
}

export async function syncRelayToRemoteBunNode(tunnelId: string, payload: Record<string, unknown>): Promise<unknown> {
  const tunnel = tunnels.get(tunnelId);
  if (!tunnel) throw new Error("Remote Bun Server tunnel was not found");
  return syncRelayToRemoteEndpoint("http://127.0.0.1:" + tunnel.localPort, tunnel.token, payload);
}

/**
 * Paths a local node may reach on a remote node. The tunnel forwards a whole
 * HTTP server, so this allowlist is what keeps a remote request from reaching
 * install, config or filesystem routes.
 */
const REMOTE_REQUEST_PATH_PATTERN = /^\/api\/(?:session|engine\/(?:start|status)|thread\/start|codex\/(?:rpc|sessions(?:\/[^/]+)?|events|relays(?:\/[^/]+\/groups)?|provider\/activate|settings\/(?:codex-cli|claude-compatible-cli|agy-cli|grok-cli|pi-cli|opencode-cli)|workbench\/(?:state|threads|send|stop|runtime|history|history\/open)|goal\/(?:start|pause|resume)|plan\/(?:start|respond)|server-request\/respond))(?:\?|$)/;

export function isAllowedRemoteBunNodePath(path: string): boolean {
  return REMOTE_REQUEST_PATH_PATTERN.test(path);
}

/**
 * `server.env` for the remote unit. The node serves its own relay gateway on
 * `CODEX_UI_PORT`, which is what lets an autonomous Claude thread reach the
 * upstream relay directly instead of through this machine's reverse tunnel.
 */
export function buildRemoteBunNodeEnv(input: {
  releaseId: string;
  port: number;
  token: string;
  home: string;
  claudeEnabled: boolean;
}): string {
  return [
    "CODEX_UI_NODE_MODE=remote",
    "CODEX_UI_REMOTE_RELEASE_ID=" + input.releaseId,
    "CODEX_UI_HOST=127.0.0.1",
    "CODEX_UI_PORT=" + input.port,
    "CODEX_UI_AUTH=off",
    "CODEX_UI_TOKEN=" + input.token,
    "CODEX_UI_WS_PROFILE=desktop",
    "CODEX_UI_DATA_DIR=" + input.home + "/.codex-ultra/remote/data",
    "CODEX_UI_APP_SERVER_MODE=stdio",
    "CODEX_UI_CLAUDE_COMPATIBLE_CLI_ENABLED=" + (input.claudeEnabled ? "1" : "0"),
    "PATH=" + input.home + "/.bun/bin:" + input.home + "/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
  ].join("\n") + "\n";
}

export async function requestRemoteBunNode(tunnelId: string, method: string, path: string, body?: unknown, apiSession?: string): Promise<unknown> {
  const tunnel = tunnels.get(tunnelId);
  if (!tunnel) throw new Error("Remote Bun Server tunnel was not found");
  if (!/^(GET|POST|PUT|DELETE)$/.test(method)) throw new Error("Unsupported remote request method");
  if (!isAllowedRemoteBunNodePath(path)) {
    throw new Error("Remote request path is not allowed");
  }
  const response = await fetch("http://127.0.0.1:" + tunnel.localPort + path, {
    method,
    headers: { "x-codex-ui-token": tunnel.token, ...(apiSession?.trim() ? { "x-codex-api-session": apiSession.trim() } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const result = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "Remote request failed (" + response.status + ")");
  return result;
}

export function remoteBunNodeRuntime() {
  return { mode: process.env.CODEX_UI_NODE_MODE === "remote" ? "remote" : "local", releaseId: process.env.CODEX_UI_REMOTE_RELEASE_ID?.trim() || null, platform: platform(), arch: arch(), tunnels: [...tunnels].map(([id, value]) => ({ id, localPort: value.localPort, remotePort: value.remotePort, command: value.command })) };
}

function sshArgs(command: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quote: string | null = null;
  for (const char of command.trim()) {
    if (quote) { if (char === quote) quote = null; else current += char; continue; }
    if (char === "'" || char === '"') { quote = char; continue; }
    if (/\s/.test(char)) { if (current) { parts.push(current); current = ""; } continue; }
    current += char;
  }
  if (quote) throw new Error("Unclosed quote in SSH command");
  if (current) parts.push(current);
  if (parts[0] !== "ssh" || parts.length < 2) throw new Error("SSH command must look like: ssh user@host");
  return parts.slice(1);
}

function keyValues(output: string): Record<string, string> {
  return Object.fromEntries(output.split(/\r?\n/).flatMap((line) => { const index = line.indexOf("="); return index > 0 ? [[line.slice(0, index), line.slice(index + 1)]] : []; }));
}

function decodeHealth(value?: string): Record<string, unknown> | null {
  if (!value) return null;
  try { return JSON.parse(Buffer.from(value, "base64").toString("utf8")) as Record<string, unknown>; } catch { return null; }
}

async function upload(args: string[], local: string, remote: string, mode: string): Promise<void> {
  const child = spawn("ssh", [...args, "cat > " + quotePath(remote) + " && chmod " + mode + " " + quotePath(remote)], { stdio: ["pipe", "ignore", "pipe"] });
  createReadStream(local).pipe(child.stdin!);
  await completed(child, 60_000);
}

async function uploadText(args: string[], content: string, remote: string, mode: string): Promise<void> {
  const child = spawn("ssh", [...args, "cat > " + quotePath(remote) + " && chmod " + mode + " " + quotePath(remote)], { stdio: ["pipe", "ignore", "pipe"] });
  child.stdin!.end(content);
  await completed(child, 30_000);
}

function completed(child: ChildProcess, timeoutMs: number): Promise<void> {
  return new Promise((done, reject) => {
    let stderr = "";
    const timer = setTimeout(() => { child.kill("SIGTERM"); reject(new Error("SSH operation timed out")); }, timeoutMs);
    child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("exit", (code) => { clearTimeout(timer); code === 0 ? done() : reject(new Error(stderr.trim() || "SSH exited with code " + code)); });
  });
}

async function waitHealth(command: string, port: number, timeoutMs: number, releaseId?: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const probe = await probeRemoteBunNode(command, port).catch(() => null);
    const remoteRelease = (probe?.health?.node as Record<string, unknown> | undefined)?.releaseId;
    if (probe?.health?.ok === true && (!releaseId || remoteRelease === releaseId)) return;
    await delay(750);
  }
  throw new Error("Remote Bun Server did not become healthy before timeout");
}

async function rollbackRelease(args: string[]): Promise<void> {
  const script = "if [ -e \"$HOME/.codex-ultra/remote/previous\" ] || [ -L \"$HOME/.codex-ultra/remote/previous\" ]; then rm -rf \"$HOME/.codex-ultra/remote/failed\"; mv -Tf \"$HOME/.codex-ultra/remote/current\" \"$HOME/.codex-ultra/remote/failed\"; mv -Tf \"$HOME/.codex-ultra/remote/previous\" \"$HOME/.codex-ultra/remote/current\"; systemctl --user restart " + SERVICE + "; fi";
  await execFileAsync("ssh", [...args, script], { timeout: 45_000, maxBuffer: 512 * 1024 });
}

async function freePort(): Promise<number> {
  return await new Promise((done, reject) => { const server = createServer(); server.once("error", reject); server.listen(0, "127.0.0.1", () => { const address = server.address(); const port = address && typeof address === "object" ? address.port : 0; server.close((error) => error ? reject(error) : done(port)); }); });
}

async function waitTunnel(child: ChildProcess, port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let stopped = false;
  let stderr = "";
  child.once("exit", () => { stopped = true; });
  child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
  while (Date.now() < deadline) {
    if (stopped) throw new Error(stderr.trim() || "SSH tunnel exited before ready");
    try { if ((await fetch("http://127.0.0.1:" + port + "/api/runtime/health")).ok) return; } catch {}
    await delay(150);
  }
  child.kill("SIGTERM");
  throw new Error("SSH tunnel did not become ready before timeout");
}

function quotePath(value: string): string { const quote = (part: string) => "'" + part.replace(/'/g, "'\\''") + "'"; return value === "~" ? '"$HOME"' : value.startsWith("~/") ? '"$HOME"' + quote("/" + value.slice(2)) : quote(value); }
function validPort(value: number): number { if (!Number.isInteger(value) || value < 1024 || value > 65535) throw new Error("Remote port must be between 1024 and 65535"); return value; }
function delay(ms: number): Promise<void> { return new Promise((done) => setTimeout(done, ms)); }
function defaultArtifact(): string { return resolve(projectRoot(), "artifacts", "remote-node", "server.js"); }
function projectRoot(): string { return resolve(dirname(fileURLToPath(import.meta.url)), "../../.."); }
async function artifactReleaseId(path: string): Promise<string> { return createHash("sha256").update(await readFile(path)).digest("hex").slice(0, 16); }

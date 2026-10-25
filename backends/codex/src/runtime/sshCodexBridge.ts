import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { EventEmitter } from "node:events";
import { promisify } from "node:util";
import { type EngineStatus, type JsonRpcFailure, type JsonRpcId, type JsonRpcMessage, type JsonValue } from "@codex-ui/shared";
import type { CodexRuntimeClient } from "@cxu/sdk-backend";
import { CODEX_ULTRA_MODEL_CATALOG_FILE } from "@cxu/sdk-backend";

export type SshWorkspaceProfile = { command: string; cwd: string; providerId?: string; groupId?: string };
export type RemoteOs = "posix" | "windows";
export type SshCodexBridgeOptions = {
  remoteForwardPort?: number;
  localServerPort?: number;
  relayGatewayToken?: string;
  configEdits?: Array<{ keyPath: string; value: JsonValue; mergeStrategy: "replace" }>;
  modelCatalog?: Record<string, JsonValue>;
};
type Pending = { method: string; resolve: (value: JsonValue) => void; reject: (error: JsonRpcFailure["error"]) => void; timer?: ReturnType<typeof setTimeout> };
const execFileAsync = promisify(execFile);

export class SshCodexBridge extends EventEmitter implements CodexRuntimeClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private pending = new Map<string, Pending>();
  private nextId = 1;
  private starting: Promise<EngineStatus> | null = null;
  private status: EngineStatus = { phase: "idle", transport: "stdio" };
  public constructor(public readonly profile: SshWorkspaceProfile, private readonly options: SshCodexBridgeOptions = {}) { super(); }
  public getStatus(): EngineStatus { return { ...this.status }; }
  public async start(): Promise<EngineStatus> {
    if (this.status.phase === "ready") return this.getStatus();
    if (this.starting) return await this.starting;
    this.starting = this.startInternal();
    try { return await this.starting; } finally { this.starting = null; }
  }
  private async startInternal(): Promise<EngineStatus> {
    const parts = splitSshCommand(this.profile.command);
    if (parts[0] !== "ssh" || parts.length < 2) throw new Error("SSH command must look like: ssh user@host");
    this.status = { phase: "starting", transport: "stdio", message: "Starting remote Codex app-server", startedAt: Date.now() };
    this.emit("status", this.getStatus());
    const remoteOs = await detectRemoteOs(parts.slice(1));
    const remote = remoteOs === "windows"
      ? powershellEncodedCommand([
          "$ErrorActionPreference = 'Stop'",
          `Set-Location -LiteralPath ${quotePowerShell(expandRemoteHome(this.profile.cwd))}`,
          "$cmd = Get-Command codex -ErrorAction Stop",
          ...(this.options.relayGatewayToken ? ["$env:CODEX_UI_RELAY_GATEWAY_TOKEN = [Console]::In.ReadLine()"] : []),
          "& $cmd.Source app-server --stdio"
        ].join("; "))
      : "cd -- " + quoteRemotePath(this.profile.cwd)
        + " && codex_bin=\"$(command -v codex 2>/dev/null || true)\"; "
        + "[ -n \"$codex_bin\" ] || codex_bin=\"$HOME/.local/bin/codex\"; "
        + "[ -x \"$codex_bin\" ] || { echo 'Codex CLI is not installed on the SSH host' >&2; exit 127; }; "
        + (this.options.relayGatewayToken ? "IFS= read -r CODEX_UI_RELAY_GATEWAY_TOKEN; export CODEX_UI_RELAY_GATEWAY_TOKEN; " : "")
        + "exec \"$codex_bin\" app-server --stdio";
    const forwardArgs = this.options.remoteForwardPort && this.options.localServerPort
      ? ["-o", "ExitOnForwardFailure=yes", "-R", "127.0.0.1:" + this.options.remoteForwardPort + ":127.0.0.1:" + this.options.localServerPort]
      : [];
    const child = spawn("ssh", [...forwardArgs, ...parts.slice(1), remote], { stdio: "pipe", env: process.env });
    this.child = child;
    if (this.options.relayGatewayToken) child.stdin.write(this.options.relayGatewayToken + "\n");
    const fail = (message: string) => {
      for (const pending of this.pending.values()) { if (pending.timer) clearTimeout(pending.timer); if (pending.method === "turn/interrupt") pending.resolve({}); else pending.reject({ message }); }
      this.pending.clear(); this.child = null; this.status = { ...this.status, phase: "error", message }; this.emit("status", this.getStatus());
    };
    child.once("error", (error) => fail(error.message));
    child.once("exit", (code, signal) => { if (this.child === child) fail("Remote Codex app-server exited with code " + (code ?? "null") + " signal " + (signal ?? "null")); });
    createInterface({ input: child.stdout }).on("line", (line) => this.handleLine(line));
    child.stderr.on("data", (chunk: Buffer) => { const text = chunk.toString("utf8").trim(); if (text) this.emit("stderr", text); });
    try {
      const init = await this.request("initialize", { clientInfo: { name: "codex-tui", title: "Codex TUI", version: "0.1.0" }, capabilities: { experimentalApi: true, mcpServerOpenaiFormElicitation: true } });
      await this.notify("initialized", {});
      const record = init as Record<string, JsonValue>;
      const codexHome = typeof record.codexHome === "string" ? record.codexHome : undefined;
      if (this.options.modelCatalog) {
        if (!codexHome) throw new Error("Remote Codex app-server did not report an absolute codexHome");
        await writeRemoteModelCatalog(parts.slice(1), remoteOs, codexHome, this.options.modelCatalog);
      }
      if (this.options.configEdits?.length) {
        const configEdits = this.options.configEdits.map((edit) => edit.keyPath === "model_catalog_json" && codexHome
          ? { ...edit, value: remoteCatalogPath(codexHome, remoteOs) }
          : edit);
        await this.request("config/batchWrite", { edits: configEdits, reloadUserConfig: true }, 120_000);
      }
      this.status = { ...this.status, phase: "ready", appServerUserAgent: typeof record.userAgent === "string" ? record.userAgent : undefined, codexHome, message: "Remote Codex app-server ready" };
      this.emit("status", this.getStatus()); return this.getStatus();
    } catch (error) { this.stop(); throw new Error(rpcErrorMessage(error)); }
  }
  public stop(): void {
    this.starting = null;
    for (const pending of this.pending.values()) { if (pending.timer) clearTimeout(pending.timer); if (pending.method === "turn/interrupt") pending.resolve({}); else pending.reject({ message: "Remote Codex bridge stopped" }); }
    this.pending.clear(); try { this.child?.kill("SIGTERM"); } catch {} this.child = null; this.status = { ...this.status, phase: "stopped", message: "Stopped" }; this.emit("status", this.getStatus());
  }
  public async restart(): Promise<EngineStatus> { this.stop(); return this.start(); }
  public async request(method: string, params?: JsonValue, timeoutMs = 15000): Promise<JsonValue> {
    if (!this.child && method === "turn/interrupt") return {};
    if (!this.child) await this.start();
    if (!this.child) throw new Error("Remote Codex app-server is not running"); const id = this.nextId++;
    return new Promise((resolve, reject) => { const pending: Pending = { method, resolve, reject }; if (timeoutMs > 0) pending.timer = setTimeout(() => { this.pending.delete(String(id)); if (method === "turn/interrupt") { this.stop(); resolve({}); return; } reject({ message: "Request '" + method + "' timed out after " + timeoutMs + "ms" }); }, timeoutMs); this.pending.set(String(id), pending); this.child?.stdin.write(JSON.stringify({ id, method, params }) + "\n"); });
  }
  public async notify(method: string, params?: JsonValue): Promise<void> { if (!this.child) await this.start(); if (!this.child) throw new Error("Remote Codex app-server is not running"); this.child.stdin.write(JSON.stringify({ method, params }) + "\n"); }
  public respond(id: JsonRpcId, result?: JsonValue, error?: JsonRpcFailure["error"]): void { if (this.child) this.child.stdin.write(JSON.stringify({ id, ...(error ? { error } : { result: result ?? {} }) }) + "\n"); }
  private handleLine(line: string): void {
    if (!line.trim()) return; let message: JsonRpcMessage; try { message = JSON.parse(line) as JsonRpcMessage; } catch { this.emit("stderr", "Unparseable remote app-server stdout: " + line); return; }
    const messageId = "id" in message ? (message as { id: JsonRpcId }).id : undefined;
    const pending = messageId !== undefined ? this.pending.get(String(messageId)) : undefined;
    if (pending) { this.pending.delete(String(messageId)); if (pending.timer) clearTimeout(pending.timer); if ("error" in message) pending.reject(message.error); else pending.resolve("result" in message ? message.result : {}); return; }
    this.emit("message", message);
  }
}
export function quote(value: string): string { return "'" + value.replace(/'/g, "'\\''") + "'"; }
function rpcErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") return error.message;
  try { return JSON.stringify(error); } catch { return String(error); }
}
export function quoteRemotePath(value: string): string { return value === "~" ? "\"$HOME\"" : value.startsWith("~/") ? "\"$HOME\"" + quote("/" + value.slice(2)) : quote(value); }
export function expandRemoteHome(value: string): string { return value === "~" ? "$HOME" : value.startsWith("~/") ? "$HOME/" + value.slice(2) : value; }
export function quotePowerShell(value: string): string { return "'" + value.replace(/'/g, "''") + "'"; }
export function powershellEncodedCommand(script: string): string { return "powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand " + Buffer.from(script, "utf16le").toString("base64"); }
export async function detectRemoteOs(args: string[]): Promise<RemoteOs> {
  // Without a connect deadline an unreachable host stalls until the exec
  // timeout, which callers pay twice: once here and once on the CLI probe.
  const connectArgs = ["-o", "ConnectTimeout=15"];
  try {
    const { stdout } = await execFileAsync("ssh", [...connectArgs, ...args, "uname -s 2>/dev/null"], { timeout: 15_000, maxBuffer: 64 * 1024 });
    if (String(stdout).trim()) return "posix";
  } catch {}
  const { stdout } = await execFileAsync("ssh", [...connectArgs, ...args, powershellEncodedCommand("Write-Output Windows")], { timeout: 15_000, maxBuffer: 64 * 1024 });
  if (String(stdout).trim().toLowerCase().includes("windows")) return "windows";
  throw new Error("Unable to determine the SSH host operating system");
}
async function writeRemoteModelCatalog(args: string[], remoteOs: "posix" | "windows", codexHome: string, catalog: Record<string, JsonValue>): Promise<void> {
  const encoded = Buffer.from(`${JSON.stringify(catalog, null, 2)}\n`, "utf8").toString("base64");
  const catalogPath = remoteCatalogPath(codexHome, remoteOs);
  const remote = remoteOs === "windows"
    ? powershellEncodedCommand(`New-Item -ItemType Directory -Force -Path ${quotePowerShell(codexHome)} | Out-Null; [IO.File]::WriteAllBytes(${quotePowerShell(catalogPath)}, [Convert]::FromBase64String('${encoded}'))`)
    : `mkdir -p ${quote(codexHome)} && printf %s ${quote(encoded)} | base64 -d > ${quote(catalogPath)}`;
  await execFileAsync("ssh", [...args, remote], { timeout: 30_000, maxBuffer: 128 * 1024 });
}
function remoteCatalogPath(codexHome: string, remoteOs: "posix" | "windows"): string {
  const separator = remoteOs === "windows" ? "\\" : "/";
  return codexHome.replace(/[\\\/]+$/, "") + separator + CODEX_ULTRA_MODEL_CATALOG_FILE;
}
export function splitSshCommand(value: string): string[] { const out: string[] = []; let current = ""; let quoteChar: string | null = null; for (const char of value.trim()) { if (quoteChar) { if (char === quoteChar) quoteChar = null; else current += char; } else if (char === "'" || char === "\"") quoteChar = char; else if (/\s/.test(char)) { if (current) { out.push(current); current = ""; } } else current += char; } if (quoteChar) throw new Error("Unclosed quote in SSH command"); if (current) out.push(current); return out; }

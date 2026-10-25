import { normalizeWorkspaceRoots } from "../../workspacePaths";
import type { SshConfigHost, SshPreflightResult, WorkspaceMode } from "./appConstants";
import { asRecord, numberValue, stringValue } from "./appUtils";
import type { JsonValue } from "@codex-ui/shared";

export function normalizeSshWorkspaceCwd(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  return trimmed.replace(/\/+$/, "") || "/";
}

export function isSshWorkspaceCommand(value: string): boolean {
  return value.trim().startsWith("ssh ") || value.trim() === "ssh";
}

export function addWorkspaceRpcMetadata(
  params: Record<string, JsonValue>,
  mode: WorkspaceMode,
  sshCommand: string,
  cwd: string,
  providerId?: string | null,
  groupId?: string | null,
  additionalRoots: string[] = []
): void {
  if (mode === "local") {
    params.runtimeWorkspaceRoots = [cwd, ...normalizeWorkspaceRoots(cwd, additionalRoots)];
    return;
  }
  params.workspace = {
    type: "ssh",
    command: sshCommand.trim(),
    cwd,
    ...(providerId ? { providerId } : {}),
    ...(groupId ? { groupId } : {})
  };
  params.remoteWorkspace = params.workspace;
}

export async function fetchSshDirectory(token: string, command: string, path: string): Promise<JsonValue> {
  const response = await fetch("/api/ssh/list-directory", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-codex-ui-token": token
    },
    body: JSON.stringify({ command, path })
  });
  const body = (await response.json().catch(() => ({}))) as JsonValue;
  if (!response.ok) {
    throw new Error(stringValue(asRecord(body).error) ?? `SSH directory read failed: ${response.status}`);
  }
  return body;
}

export async function fetchSshFile(token: string, command: string, path: string): Promise<JsonValue> {
  const response = await fetch("/api/ssh/read-file", {
    method: "POST", headers: { "Content-Type": "application/json", "x-codex-ui-token": token },
    body: JSON.stringify({ command, path })
  });
  const body = (await response.json().catch(() => ({}))) as JsonValue;
  if (!response.ok) throw new Error(stringValue(asRecord(body).error) ?? `SSH file read failed: ${response.status}`);
  return body;
}

export async function writeSshFile(token: string, command: string, path: string, dataBase64: string): Promise<void> {
  const response = await fetch("/api/ssh/write-file", {
    method: "POST", headers: { "Content-Type": "application/json", "x-codex-ui-token": token },
    body: JSON.stringify({ command, path, dataBase64 })
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as JsonValue;
    throw new Error(stringValue(asRecord(body).error) ?? `SSH file write failed: ${response.status}`);
  }
}

export async function createSshWorkspaceDirectory(token: string, command: string, path: string): Promise<void> {
  const response = await fetch("/api/ssh/create-directory", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-codex-ui-token": token },
    body: JSON.stringify({ command, path })
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as JsonValue;
    throw new Error(stringValue(asRecord(body).error) || `SSH directory creation failed: ${response.status}`);
  }
}

export async function preflightSshWorkspace(token: string, command: string, path: string): Promise<SshPreflightResult> {
  const response = await fetch("/api/ssh/preflight", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-codex-ui-token": token
    },
    body: JSON.stringify({ command, path })
  });
  const body = (await response.json().catch(() => ({}))) as JsonValue;
  const record = asRecord(body);
  const data = asRecord(record.data);
  const reasons = Array.isArray(data.reasons)
    ? data.reasons.filter((entry: unknown): entry is string => typeof entry === "string")
    : [];
  if (!Object.keys(data).length) throw new Error(stringValue(record.error) || `SSH workspace preflight failed: ${response.status}`);
  return {
    ready: data.ready === true, connected: data.connected === true, os: stringValue(data.os) ?? "", arch: stringValue(data.arch) ?? "",
    codexPath: stringValue(data.codexPath) ?? "", codexVersion: stringValue(data.codexVersion) ?? "",
    appServerAvailable: data.appServerAvailable === true, cwdExists: data.cwdExists === true, cwdReadable: data.cwdReadable === true,
    cwdWritable: data.cwdWritable === true, reasons
  };
}

export async function fetchSshConfigHosts(token: string): Promise<SshConfigHost[]> {
  const response = await fetch("/api/ssh/config-hosts", { headers: { "x-codex-ui-token": token } });
  const body = (await response.json().catch(() => ({}))) as JsonValue;
  const record = asRecord(body);
  if (!response.ok) throw new Error(stringValue(record.error) || `SSH config discovery failed: ${response.status}`);
  return Array.isArray(record.data) ? record.data.flatMap((entry: unknown) => {
    const host = asRecord(entry);
    const alias = stringValue(host.alias);
    const hostname = stringValue(host.hostname);
    if (!alias || !hostname) return [];
    return [{ alias, hostname, user: stringValue(host.user) ?? "", port: numberValue(host.port) ?? 22, configFile: stringValue(host.configFile) ?? "" }];
  }) : [];
}

export async function probeSshConfigHost(token: string, alias: string): Promise<{ command: string; home: string; user: string; os: string; arch: string }> {
  const response = await fetch("/api/ssh/config-hosts/probe", {
    method: "POST",
    headers: { "content-type": "application/json", "x-codex-ui-token": token },
    body: JSON.stringify({ alias })
  });
  const body = (await response.json().catch(() => ({}))) as JsonValue;
  const record = asRecord(body);
  const data = asRecord(record.data);
  if (!response.ok) throw new Error(stringValue(record.error) || `SSH host probe failed: ${response.status}`);
  const command = stringValue(data.command);
  const home = stringValue(data.home);
  if (!command || !home) throw new Error("SSH host probe returned an incomplete result");
  return { command, home, user: stringValue(data.user) ?? "", os: stringValue(data.os) ?? "unknown", arch: stringValue(data.arch) ?? "unknown" };
}

export async function installSshCodexCli(token: string, command: string, path: string): Promise<SshPreflightResult> {
  const response = await fetch("/api/ssh/install-codex", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-codex-ui-token": token },
    body: JSON.stringify({ command, path })
  });
  const body = (await response.json().catch(() => ({}))) as JsonValue;
  const record = asRecord(body);
  const preflight = asRecord(asRecord(record.data).preflight);
  if (!response.ok && !Object.keys(preflight).length) throw new Error(stringValue(record.error) || `SSH Codex install failed: ${response.status}`);
  const reasons = Array.isArray(preflight.reasons) ? preflight.reasons.filter((entry: unknown): entry is string => typeof entry === "string") : [];
  return {
    ready: preflight.ready === true, connected: preflight.connected === true, os: stringValue(preflight.os) ?? "", arch: stringValue(preflight.arch) ?? "",
    codexPath: stringValue(preflight.codexPath) ?? "", codexVersion: stringValue(preflight.codexVersion) ?? "",
    appServerAvailable: preflight.appServerAvailable === true, cwdExists: preflight.cwdExists === true, cwdReadable: preflight.cwdReadable === true,
    cwdWritable: preflight.cwdWritable === true, reasons
  };
}

export function sshCodexInstallCommand(os: string): string {
  const normalized = os.toLowerCase();
  if (normalized === "linux" || normalized === "darwin") return "curl -fsSL https://chatgpt.com/codex/install.sh | sh";
  if (normalized.includes("windows")) return 'powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"';
  return "";
}

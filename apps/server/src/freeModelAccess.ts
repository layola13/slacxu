import type { AsyncEntry } from "@napi-rs/keyring";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { hostname } from "node:os";
import { promisify } from "node:util";

const require = createRequire(import.meta.url);
const execFileAsync = promisify(execFile);
const KEY_PATTERN = /^cxu-[A-Za-z0-9]{48}$/;
const DEFAULT_DISCORD_INVITE = "https://discord.gg/QCNUx8FaV";
const DEVELOPMENT_MACHINE_HASHES = new Set([
  "260da01345ac81b7afd81db88267fd8f65363357c5499c433517c83a77f6a146"
]);

let AsyncEntryClass: (new (service: string, user: string) => AsyncEntry) | null = null;
try {
  const keyring = require("@napi-rs/keyring") as { AsyncEntry?: new (service: string, user: string) => AsyncEntry };
  AsyncEntryClass = keyring.AsyncEntry ?? null;
} catch {
  AsyncEntryClass = null;
}

export type FreeModelCampaign = {
  id: string;
  title: string;
  message: string;
  imageUrl?: string;
  targetUrl?: string;
  startsAt?: number;
  endsAt?: number;
};

export type FreeModelLicenseStatus = {
  valid: boolean;
  reason: "active" | "missing" | "invalid" | "machine_mismatch" | "expired" | "revoked";
  keyPreview?: string;
  issuedAt?: number;
  expiresAt?: number;
};

export type FreeModelAccessStatus = {
  configured: boolean;
  developmentMachine: boolean;
  machineCode: string;
  license: FreeModelLicenseStatus;
  refreshIntervalHours: number;
  lastRefreshedAt: number | null;
  nextRequiredRefreshAt: number | null;
  refreshRequired: boolean;
  discordInviteUrl: string;
  campaign: FreeModelCampaign | null;
  storage: "keyring" | "memory" | "environment" | "none";
  requirement?: { requiredCode: string; expiresAt: number };
  serviceError?: string;
};

export type FreeModelRefreshAuthorization = FreeModelAccessStatus & {
  allowed: boolean;
  authorizationId?: string;
  authorizationExpiresAt?: number;
};

type RemoteAccessStatus = Omit<FreeModelAccessStatus, "configured" | "developmentMachine" | "machineCode" | "storage" | "serviceError">;

export class FreeModelAccessManager {
  private readonly serviceUrl: string | null;
  private readonly serviceSecret: string | null;
  private readonly envKey: string | null;
  private memoryKey: string | null = null;
  private machineHashPromise: Promise<string> | null = null;
  private statusCache: { key: string | null; expiresAt: number; value: FreeModelAccessStatus } | null = null;

  public constructor(private readonly env: NodeJS.ProcessEnv = process.env, machineHashOverride?: string) {
    this.serviceUrl = env.CODEX_ULTRA_FREE_KEY_SERVICE_URL?.trim().replace(/\/+$/, "") || null;
    this.serviceSecret = env.CODEX_ULTRA_FREE_KEY_SERVICE_SECRET?.trim() || null;
    this.envKey = env.CODEX_ULTRA_FREE_KEY?.trim() || null;
    if (machineHashOverride) {
      const normalized = machineHashOverride.trim().toLowerCase();
      if (!/^[a-f0-9]{64}$/.test(normalized)) throw new Error("machineHashOverride must be a 64-character SHA-256 hex string");
      this.machineHashPromise = Promise.resolve(normalized);
    }
  }

  public async status(): Promise<FreeModelAccessStatus> {
    const machineHash = await this.machineHash();
    if (isDevelopmentMachine(machineHash)) return this.developmentStatus(machineHash);
    const stored = await this.readKey();
    if (this.statusCache && this.statusCache.key === stored.key && this.statusCache.expiresAt > Date.now()) {
      return this.statusCache.value;
    }
    if (!this.serviceUrl) return this.unconfiguredStatus(machineHash, stored.storage);
    try {
      const remote = await this.request<RemoteAccessStatus>("/v1/access/status", { machineHash, key: stored.key });
      const value = this.decorate(remote, machineHash, stored.storage);
      this.statusCache = { key: stored.key, expiresAt: Date.now() + 60_000, value };
      return value;
    } catch (error) {
      return { ...this.unconfiguredStatus(machineHash, stored.storage), configured: true, serviceError: errorMessage(error) };
    }
  }

  public async createRequirement(): Promise<FreeModelAccessStatus> {
    const machineHash = await this.machineHash();
    if (isDevelopmentMachine(machineHash)) return this.developmentStatus(machineHash);
    const stored = await this.readKey();
    if (!this.serviceUrl) return this.unconfiguredStatus(machineHash, stored.storage);
    const [remote, requirement] = await Promise.all([
      this.request<RemoteAccessStatus>("/v1/access/status", { machineHash, key: stored.key }),
      this.request<{ requiredCode: string; expiresAt: number }>("/v1/access/requirement", { machineHash })
    ]);
    return { ...this.decorate(remote, machineHash, stored.storage), requirement };
  }

  public async saveKey(keyInput: string): Promise<FreeModelAccessStatus> {
    const machineHash = await this.machineHash();
    if (isDevelopmentMachine(machineHash)) return this.developmentStatus(machineHash);
    const key = keyInput.trim();
    if (!KEY_PATTERN.test(key)) throw new Error("密钥格式应为 cxu- 加 48 位字母数字");
    if (!this.serviceUrl) throw new Error("免费模型密钥服务尚未配置");
    const remote = await this.request<RemoteAccessStatus>("/v1/access/status", { machineHash, key });
    if (!remote.license.valid) throw new Error(licenseError(remote.license.reason));
    const storage = await this.writeKey(key);
    const value = this.decorate(remote, machineHash, storage);
    this.statusCache = { key, expiresAt: Date.now() + 60_000, value };
    return value;
  }

  public async clearKey(): Promise<FreeModelAccessStatus> {
    this.memoryKey = null;
    this.statusCache = null;
    const entry = this.keyringEntry();
    if (entry) {
      try {
        await entry.deleteCredential();
      } catch {
        // A missing keyring entry is already the desired state.
      }
    }
    return this.status();
  }

  public async prepareRefresh(): Promise<FreeModelRefreshAuthorization> {
    const machineHash = await this.machineHash();
    if (isDevelopmentMachine(machineHash)) {
      return { ...this.developmentStatus(machineHash), allowed: true, authorizationId: "development-machine" };
    }
    const stored = await this.readKey();
    if (!this.serviceUrl) return { ...this.unconfiguredStatus(machineHash, stored.storage), allowed: false };
    try {
      const remote = await this.request<RemoteAccessStatus & {
        allowed: boolean;
        authorizationId?: string;
        authorizationExpiresAt?: number;
        requirement?: { requiredCode: string; expiresAt: number };
      }>("/v1/access/prepare", { machineHash, key: stored.key });
      return { ...this.decorate(remote, machineHash, stored.storage), ...remote };
    } catch (error) {
      return {
        ...this.unconfiguredStatus(machineHash, stored.storage),
        configured: true,
        allowed: false,
        serviceError: errorMessage(error)
      };
    }
  }

  public async completeRefresh(authorizationId: string | undefined, success: boolean, importedModels: number): Promise<void> {
    if (authorizationId === "development-machine") return;
    if (!authorizationId || !this.serviceUrl) return;
    await this.request("/v1/access/complete", {
      machineHash: await this.machineHash(),
      authorizationId,
      success,
      importedModels
    });
    this.statusCache = null;
  }

  private decorate(remote: RemoteAccessStatus, machineHash: string, storage: FreeModelAccessStatus["storage"]): FreeModelAccessStatus {
    return {
      ...remote,
      configured: true,
      developmentMachine: false,
      machineCode: machineHash.slice(0, 12).toUpperCase(),
      storage
    };
  }

  private developmentStatus(machineHash: string): FreeModelAccessStatus {
    return {
      configured: true,
      developmentMachine: true,
      machineCode: machineHash.slice(0, 12).toUpperCase(),
      license: { valid: true, reason: "active", keyPreview: "开发机器免密" },
      refreshIntervalHours: 5,
      lastRefreshedAt: null,
      nextRequiredRefreshAt: null,
      refreshRequired: false,
      discordInviteUrl: this.env.CODEX_ULTRA_DISCORD_INVITE_URL?.trim() || DEFAULT_DISCORD_INVITE,
      campaign: null,
      storage: "none"
    };
  }

  private unconfiguredStatus(machineHash: string, storage: FreeModelAccessStatus["storage"]): FreeModelAccessStatus {
    return {
      configured: false,
      developmentMachine: false,
      machineCode: machineHash.slice(0, 12).toUpperCase(),
      license: { valid: false, reason: "missing" },
      refreshIntervalHours: 5,
      lastRefreshedAt: null,
      nextRequiredRefreshAt: null,
      refreshRequired: true,
      discordInviteUrl: this.env.CODEX_ULTRA_DISCORD_INVITE_URL?.trim() || DEFAULT_DISCORD_INVITE,
      campaign: null,
      storage,
      serviceError: "CODEX_ULTRA_FREE_KEY_SERVICE_URL is not configured"
    };
  }

  private async readKey(): Promise<{ key: string | null; storage: FreeModelAccessStatus["storage"] }> {
    if (this.envKey) return { key: this.envKey, storage: "environment" };
    if (this.memoryKey) return { key: this.memoryKey, storage: "memory" };
    const entry = this.keyringEntry();
    if (entry) {
      try {
        const key = await entry.getPassword();
        if (key) {
          this.memoryKey = key;
          return { key, storage: "keyring" };
        }
      } catch {
        // Headless sessions may not expose a system credential store.
      }
    }
    return { key: null, storage: "none" };
  }

  private async writeKey(key: string): Promise<FreeModelAccessStatus["storage"]> {
    this.memoryKey = key;
    const entry = this.keyringEntry();
    if (!entry) return "memory";
    try {
      await entry.setPassword(key);
      return "keyring";
    } catch {
      return "memory";
    }
  }

  private keyringEntry(): AsyncEntry | null {
    if (!AsyncEntryClass) return null;
    try {
      return new AsyncEntryClass("codex-react-ui", "free-model-access");
    } catch {
      return null;
    }
  }

  private machineHash(): Promise<string> {
    this.machineHashPromise ??= resolveMachineHash(this.env);
    return this.machineHashPromise;
  }

  private async request<T = unknown>(path: string, body: Record<string, unknown>): Promise<T> {
    if (!this.serviceUrl) throw new Error("Free-key service is not configured");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
      if (this.serviceSecret) headers.Authorization = `Bearer ${this.serviceSecret}`;
      const response = await fetch(`${this.serviceUrl}${path}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal
      });
      const payload = await response.json().catch(() => ({})) as { data?: T; error?: string };
      if (!response.ok || payload.data === undefined) throw new Error(payload.error || `Free-key service returned HTTP ${response.status}`);
      return payload.data;
    } finally {
      clearTimeout(timer);
    }
  }
}

export async function resolveMachineHash(env: NodeJS.ProcessEnv = process.env, targetPlatform = process.platform): Promise<string> {
  const override = env.CODEX_ULTRA_MACHINE_GUID?.trim();
  let machineId = override || "";
  if (!machineId && targetPlatform === "win32") {
    try {
      const { stdout } = await execFileAsync("reg.exe", ["query", "HKLM\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid"], {
        windowsHide: true,
        timeout: 5_000
      });
      machineId = stdout.match(/MachineGuid\s+REG_SZ\s+([^\r\n]+)/i)?.[1]?.trim() || "";
    } catch {
      machineId = "";
    }
  }
  if (!machineId && targetPlatform !== "win32") {
    for (const path of ["/etc/machine-id", "/var/lib/dbus/machine-id"]) {
      try {
        machineId = (await readFile(path, "utf8")).trim();
        if (machineId) break;
      } catch {
        machineId = "";
      }
    }
  }
  if (!machineId) machineId = `fallback:${hostname()}`;
  return createHash("sha256").update(`codex-ultra/free-model-access/v1:${machineId.toLowerCase()}`).digest("hex");
}

function licenseError(reason: FreeModelLicenseStatus["reason"]): string {
  switch (reason) {
    case "machine_mismatch": return "该密钥不属于当前 Windows 机器";
    case "expired": return "该密钥已经过期，请重新获取";
    case "revoked": return "该密钥已经被撤销，请重新获取";
    default: return "密钥无效，请检查后重试";
  }
}

export function isDevelopmentMachine(machineHash: string): boolean {
  return DEVELOPMENT_MACHINE_HASHES.has(machineHash.trim().toLowerCase());
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

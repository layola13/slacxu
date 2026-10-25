import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import type { FreeKeyServerConfig } from "./config.js";

const ALPHANUMERIC = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
const MACHINE_HASH_PATTERN = /^[a-f0-9]{64}$/;

export type Campaign = {
  id: string;
  title: string;
  message: string;
  imageUrl?: string;
  targetUrl?: string;
  startsAt?: number;
  endsAt?: number;
};

export type LicenseStatus = {
  valid: boolean;
  reason: "active" | "missing" | "invalid" | "machine_mismatch" | "expired" | "revoked";
  keyPreview?: string;
  issuedAt?: number;
  expiresAt?: number;
  discordUserId?: string;
};

export type AccessStatus = {
  license: LicenseStatus;
  refreshIntervalHours: number;
  lastRefreshedAt: number | null;
  nextRequiredRefreshAt: number | null;
  refreshRequired: boolean;
  discordInviteUrl: string;
  campaign: Campaign | null;
};

export type AdminLicenseRow = {
  id: string;
  keyPreview: string;
  machineHash: string;
  discordUserId: string;
  issuedAt: number;
  expiresAt: number;
  status: string;
  revokedAt: number | null;
  refreshAt: number | null;
};

type RequiredCodeRecord = {
  machine_hash: string;
  expires_at: number;
  consumed_at: number | null;
};

function randomText(length: number): string {
  let result = "";
  while (result.length < length) {
    for (const byte of randomBytes(length)) {
      if (byte >= Math.floor(256 / ALPHANUMERIC.length) * ALPHANUMERIC.length) continue;
      result += ALPHANUMERIC[byte % ALPHANUMERIC.length];
      if (result.length === length) break;
    }
  }
  return result;
}

function normalizeMachineHash(machineHash: string): string {
  const normalized = machineHash.trim().toLowerCase();
  if (!MACHINE_HASH_PATTERN.test(normalized)) throw new Error("A valid machineHash is required");
  return normalized;
}

function safeCampaign(value: unknown): Campaign | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const id = typeof input.id === "string" ? input.id.trim() : "";
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const message = typeof input.message === "string" ? input.message.trim() : "";
  if (!id || !title || !message) return null;
  const campaign: Campaign = { id, title, message };
  const imageUrl = httpUrl(input.imageUrl);
  const targetUrl = httpUrl(input.targetUrl);
  if (imageUrl) campaign.imageUrl = imageUrl;
  if (targetUrl) campaign.targetUrl = targetUrl;
  if (typeof input.startsAt === "number" && Number.isFinite(input.startsAt)) campaign.startsAt = input.startsAt;
  if (typeof input.endsAt === "number" && Number.isFinite(input.endsAt)) campaign.endsAt = input.endsAt;
  return campaign;
}

function httpUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

export class LicenseStore {
  private readonly db: any;

  public constructor(private readonly config: FreeKeyServerConfig) {
    mkdirSync(dirname(config.databasePath), { recursive: true });
    this.db = new Database(config.databasePath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("busy_timeout = 5000");
    this.migrate();
    this.seedSettings();
  }

  public close(): void {
    this.db.close();
  }

  public getSettings(): Record<string, unknown> {
    return {
      defaultValidityDays: this.numberSetting("default_validity_days", this.config.defaultValidityDays),
      refreshIntervalHours: this.numberSetting("refresh_interval_hours", this.config.refreshIntervalHours),
      requiredTtlMinutes: this.numberSetting("required_ttl_minutes", this.config.requiredTtlMinutes),
      discordInviteUrl: this.textSetting("discord_invite_url", this.config.discordInviteUrl),
      campaign: this.currentCampaign()
    };
  }

  public updateSettings(input: Record<string, unknown>): Record<string, unknown> {
    const updates = new Map<string, string>();
    const positiveFields: Array<[string, string]> = [
      ["defaultValidityDays", "default_validity_days"],
      ["refreshIntervalHours", "refresh_interval_hours"],
      ["requiredTtlMinutes", "required_ttl_minutes"]
    ];
    for (const [inputKey, settingKey] of positiveFields) {
      const value = input[inputKey];
      if (typeof value === "number" && Number.isFinite(value) && value > 0) updates.set(settingKey, String(value));
    }
    if (typeof input.discordInviteUrl === "string" && input.discordInviteUrl.trim()) {
      const discordInviteUrl = httpUrl(input.discordInviteUrl);
      if (!discordInviteUrl) throw new Error("discordInviteUrl must use HTTP or HTTPS");
      updates.set("discord_invite_url", discordInviteUrl);
    }
    if (Object.prototype.hasOwnProperty.call(input, "campaign")) {
      const campaign = input.campaign === null ? null : safeCampaign(input.campaign);
      if (input.campaign !== null && !campaign) throw new Error("campaign requires id, title and message");
      updates.set("campaign_json", JSON.stringify(campaign));
    }
    const statement = this.db.prepare(`
      INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `);
    this.db.transaction(() => {
      const now = Date.now();
      for (const [key, value] of updates) statement.run(key, value, now);
    })();
    return this.getSettings();
  }

  public adminTotpSecret(): string | null {
    const value = this.textSetting("admin_totp_secret", "").trim();
    return value || null;
  }

  public setAdminTotpSecret(encryptedSecret: string): void {
    if (!encryptedSecret.trim()) throw new Error("Encrypted TOTP secret is required");
    this.db.prepare(`
      INSERT INTO settings (key, value, updated_at) VALUES ('admin_totp_secret', ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(encryptedSecret, Date.now());
  }

  public resetAdminTotp(): void {
    this.db.prepare(`DELETE FROM settings WHERE key = 'admin_totp_secret'`).run();
  }

  public listLicenses(query = "", limit = 100): AdminLicenseRow[] {
    const normalized = query.trim().toLowerCase();
    const boundedLimit = Math.min(200, Math.max(1, Math.floor(limit)));
    const pattern = `%${normalized.replace(/[\\%_]/g, "\\$&")}%`;
    const rows = this.db.prepare(`
      SELECT l.id, l.key_preview, l.machine_hash, l.discord_user_id, l.issued_at,
             l.expires_at, l.status, l.revoked_at, a.last_refreshed_at
      FROM licenses l LEFT JOIN machine_access a ON a.machine_hash = l.machine_hash
      WHERE (? = '' OR lower(l.machine_hash) LIKE ? ESCAPE '\\'
             OR lower(l.discord_user_id) LIKE ? ESCAPE '\\'
             OR lower(l.key_preview) LIKE ? ESCAPE '\\')
      ORDER BY l.issued_at DESC LIMIT ?
    `).all(normalized, pattern, pattern, pattern, boundedLimit) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id), keyPreview: String(row.key_preview), machineHash: String(row.machine_hash),
      discordUserId: String(row.discord_user_id), issuedAt: Number(row.issued_at),
      expiresAt: Number(row.expires_at), status: String(row.status),
      revokedAt: row.revoked_at === null ? null : Number(row.revoked_at),
      refreshAt: row.last_refreshed_at === null ? null : Number(row.last_refreshed_at)
    }));
  }

  public issueAdminLicense(machineHashInput: string, discordUserIdInput: string, validityDays: number, now = Date.now()): { key: string; machineHash: string; issuedAt: number; expiresAt: number } {
    const machineHash = normalizeMachineHash(machineHashInput);
    const discordUserId = discordUserIdInput.trim() || "admin";
    if (!Number.isFinite(validityDays) || validityDays <= 0 || validityDays > 3650) throw new Error("validityDays must be between 0 and 3650");
    return this.db.transaction(() => {
      const key = `cxu-${randomText(48)}`;
      const expiresAt = now + validityDays * 24 * 60 * 60_000;
      this.db.prepare(`UPDATE licenses SET status = 'revoked', revoked_at = ? WHERE machine_hash = ? AND status = 'active'`).run(now, machineHash);
      this.db.prepare(`INSERT INTO licenses (id, key_hash, key_preview, machine_hash, discord_user_id, issued_at, expires_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'active')`)
        .run(randomUUID(), this.hashKey(key), `${key.slice(0, 8)}…${key.slice(-4)}`, machineHash, discordUserId, now, expiresAt);
      return { key, machineHash, issuedAt: now, expiresAt };
    })();
  }

  public revokeLicense(id: string, actor = "admin", now = Date.now()): boolean {
    const result = this.db.prepare(`UPDATE licenses SET status = 'revoked', revoked_at = ? WHERE id = ? AND status = 'active'`).run(now, id.trim());
    if (result.changes > 0) this.recordAudit(actor, "revoke_license", { licenseId: id });
    return result.changes > 0;
  }

  public recordAudit(actor: string, action: string, details: Record<string, unknown>): void {
    this.db.prepare(`INSERT INTO admin_audit (id, actor, action, details_json, created_at) VALUES (?, ?, ?, ?, ?)`).run(randomUUID(), actor, action, JSON.stringify(details), Date.now());
  }

  public createRequirement(machineHashInput: string, now = Date.now()): { requiredCode: string; expiresAt: number } {
    const machineHash = normalizeMachineHash(machineHashInput);
    const existing = this.db.prepare(`
      SELECT code, expires_at FROM required_codes
      WHERE machine_hash = ? AND consumed_at IS NULL AND expires_at > ?
      ORDER BY created_at DESC LIMIT 1
    `).get(machineHash, now) as { code: string; expires_at: number } | undefined;
    if (existing) return { requiredCode: existing.code, expiresAt: existing.expires_at };
    const requiredCode = `REQ-${randomText(16).toUpperCase()}`;
    const ttlMinutes = this.numberSetting("required_ttl_minutes", this.config.requiredTtlMinutes);
    const expiresAt = now + ttlMinutes * 60_000;
    this.db.prepare(`
      INSERT INTO required_codes (code, machine_hash, created_at, expires_at)
      VALUES (?, ?, ?, ?)
    `).run(requiredCode, machineHash, now, expiresAt);
    return { requiredCode, expiresAt };
  }

  public issueLicense(requiredCodeInput: string, discordUserId: string, now = Date.now()): {
    key: string;
    machineHash: string;
    issuedAt: number;
    expiresAt: number;
  } {
    const requiredCode = requiredCodeInput.trim().toUpperCase();
    if (!/^REQ-[A-Z0-9]{16}$/.test(requiredCode)) throw new Error("required code format is invalid");
    if (!discordUserId.trim()) throw new Error("Discord user is required");
    return this.db.transaction(() => {
      const record = this.db.prepare(`
        SELECT machine_hash, expires_at, consumed_at FROM required_codes WHERE code = ?
      `).get(requiredCode) as RequiredCodeRecord | undefined;
      if (!record) throw new Error("required code was not found");
      if (record.consumed_at !== null) throw new Error("required code was already used");
      if (record.expires_at <= now) throw new Error("required code has expired");
      const key = `cxu-${randomText(48)}`;
      const expiresAt = now + this.numberSetting("default_validity_days", this.config.defaultValidityDays) * 24 * 60 * 60_000;
      this.db.prepare(`UPDATE licenses SET status = 'revoked', revoked_at = ? WHERE machine_hash = ? AND status = 'active'`).run(now, record.machine_hash);
      this.db.prepare(`
        INSERT INTO licenses (id, key_hash, key_preview, machine_hash, discord_user_id, issued_at, expires_at, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'active')
      `).run(
        randomUUID(),
        this.hashKey(key),
        `${key.slice(0, 8)}…${key.slice(-4)}`,
        record.machine_hash,
        discordUserId.trim(),
        now,
        expiresAt
      );
      this.db.prepare(`UPDATE required_codes SET consumed_at = ?, discord_user_id = ? WHERE code = ?`).run(now, discordUserId.trim(), requiredCode);
      return { key, machineHash: record.machine_hash, issuedAt: now, expiresAt };
    })();
  }

  public status(machineHashInput: string, keyInput?: string | null, now = Date.now()): AccessStatus {
    const machineHash = normalizeMachineHash(machineHashInput);
    const license = this.licenseStatus(machineHash, keyInput, now);
    const access = this.db.prepare(`SELECT last_refreshed_at FROM machine_access WHERE machine_hash = ?`).get(machineHash) as { last_refreshed_at: number } | undefined;
    const refreshIntervalHours = this.numberSetting("refresh_interval_hours", this.config.refreshIntervalHours);
    const intervalMs = refreshIntervalHours * 60 * 60_000;
    const lastRefreshedAt = access?.last_refreshed_at ?? null;
    const nextRequiredRefreshAt = lastRefreshedAt === null ? null : lastRefreshedAt + intervalMs;
    return {
      license,
      refreshIntervalHours,
      lastRefreshedAt,
      nextRequiredRefreshAt,
      refreshRequired: lastRefreshedAt === null || now >= lastRefreshedAt + intervalMs,
      discordInviteUrl: this.textSetting("discord_invite_url", this.config.discordInviteUrl),
      campaign: this.currentCampaign(now)
    };
  }

  public prepareRefresh(machineHashInput: string, keyInput?: string | null, now = Date.now()): AccessStatus & {
    allowed: boolean;
    authorizationId?: string;
    authorizationExpiresAt?: number;
    requirement?: { requiredCode: string; expiresAt: number };
  } {
    const machineHash = normalizeMachineHash(machineHashInput);
    const status = this.status(machineHash, keyInput, now);
    if (!status.license.valid) {
      return { ...status, allowed: false, requirement: this.createRequirement(machineHash, now) };
    }
    const authorizationId = randomUUID();
    const authorizationExpiresAt = now + 10 * 60_000;
    this.db.prepare(`
      INSERT INTO refresh_authorizations (id, machine_hash, created_at, expires_at, status)
      VALUES (?, ?, ?, ?, 'pending')
    `).run(authorizationId, machineHash, now, authorizationExpiresAt);
    return { ...status, allowed: true, authorizationId, authorizationExpiresAt };
  }

  public completeRefresh(machineHashInput: string, authorizationId: string, success: boolean, importedModels: number, now = Date.now()): void {
    const machineHash = normalizeMachineHash(machineHashInput);
    this.db.transaction(() => {
      const authorization = this.db.prepare(`
        SELECT machine_hash, expires_at, status FROM refresh_authorizations WHERE id = ?
      `).get(authorizationId) as { machine_hash: string; expires_at: number; status: string } | undefined;
      if (!authorization || authorization.machine_hash !== machineHash) throw new Error("refresh authorization was not found");
      if (authorization.status !== "pending") throw new Error("refresh authorization was already completed");
      if (authorization.expires_at <= now) throw new Error("refresh authorization has expired");
      this.db.prepare(`
        UPDATE refresh_authorizations SET status = ?, completed_at = ?, imported_models = ? WHERE id = ?
      `).run(success ? "completed" : "failed", now, Math.max(0, Math.floor(importedModels)), authorizationId);
      if (success) {
        this.db.prepare(`
          INSERT INTO machine_access (machine_hash, last_refreshed_at, updated_at)
          VALUES (?, ?, ?)
          ON CONFLICT(machine_hash) DO UPDATE SET last_refreshed_at = excluded.last_refreshed_at, updated_at = excluded.updated_at
        `).run(machineHash, now, now);
      }
    })();
  }

  private licenseStatus(machineHash: string, keyInput: string | null | undefined, now: number): LicenseStatus {
    const key = keyInput?.trim();
    if (!key) return { valid: false, reason: "missing" };
    if (!/^cxu-[A-Za-z0-9]{48}$/.test(key)) return { valid: false, reason: "invalid" };
    const record = this.db.prepare(`
      SELECT key_preview, machine_hash, discord_user_id, issued_at, expires_at, status
      FROM licenses WHERE key_hash = ?
    `).get(this.hashKey(key)) as {
      key_preview: string;
      machine_hash: string;
      discord_user_id: string;
      issued_at: number;
      expires_at: number;
      status: string;
    } | undefined;
    if (!record) return { valid: false, reason: "invalid" };
    if (record.machine_hash !== machineHash) return { valid: false, reason: "machine_mismatch", keyPreview: record.key_preview };
    if (record.status !== "active") return { valid: false, reason: "revoked", keyPreview: record.key_preview };
    if (record.expires_at <= now) return { valid: false, reason: "expired", keyPreview: record.key_preview, issuedAt: record.issued_at, expiresAt: record.expires_at };
    return {
      valid: true,
      reason: "active",
      keyPreview: record.key_preview,
      issuedAt: record.issued_at,
      expiresAt: record.expires_at,
      discordUserId: record.discord_user_id
    };
  }

  private currentCampaign(now = Date.now()): Campaign | null {
    let campaign: Campaign | null = null;
    try {
      campaign = safeCampaign(JSON.parse(this.textSetting("campaign_json", "null")));
    } catch {
      campaign = null;
    }
    if (!campaign) return null;
    if (campaign.startsAt !== undefined && campaign.startsAt > now) return null;
    if (campaign.endsAt !== undefined && campaign.endsAt <= now) return null;
    return campaign;
  }

  private hashKey(key: string): string {
    return createHmac("sha256", this.config.hashPepper).update(key).digest("hex");
  }

  private numberSetting(key: string, fallback: number): number {
    const value = Number(this.textSetting(key, String(fallback)));
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  private textSetting(key: string, fallback: string): string {
    const row = this.db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as { value: string } | undefined;
    return row?.value ?? fallback;
  }

  private seedSettings(): void {
    const now = Date.now();
    const insert = this.db.prepare(`INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES (?, ?, ?)`);
    insert.run("default_validity_days", String(this.config.defaultValidityDays), now);
    insert.run("refresh_interval_hours", String(this.config.refreshIntervalHours), now);
    insert.run("required_ttl_minutes", String(this.config.requiredTtlMinutes), now);
    insert.run("discord_invite_url", this.config.discordInviteUrl, now);
    insert.run("campaign_json", "null", now);
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS required_codes (
        code TEXT PRIMARY KEY,
        machine_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        consumed_at INTEGER,
        discord_user_id TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_required_codes_machine ON required_codes(machine_hash, created_at DESC);
      CREATE TABLE IF NOT EXISTS licenses (
        id TEXT PRIMARY KEY,
        key_hash TEXT NOT NULL UNIQUE,
        key_preview TEXT NOT NULL,
        machine_hash TEXT NOT NULL,
        discord_user_id TEXT NOT NULL,
        issued_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        status TEXT NOT NULL,
        revoked_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_licenses_machine ON licenses(machine_hash, issued_at DESC);
      CREATE INDEX IF NOT EXISTS idx_licenses_discord ON licenses(discord_user_id, issued_at DESC);
      CREATE TABLE IF NOT EXISTS machine_access (
        machine_hash TEXT PRIMARY KEY,
        last_refreshed_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS refresh_authorizations (
        id TEXT PRIMARY KEY,
        machine_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        status TEXT NOT NULL,
        completed_at INTEGER,
        imported_models INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_refresh_authorizations_machine ON refresh_authorizations(machine_hash, created_at DESC);
      CREATE TABLE IF NOT EXISTS admin_audit (
        id TEXT PRIMARY KEY,
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        details_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit(created_at DESC);
    `);
  }
}

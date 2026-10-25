import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { RuntimeDatabase } from "./runtime/database.js";
import { hashPassword, verifyPassword } from "./runtime/password.js";
import type {
  AuthUser,
  AuthUserRole,
  AuthUserStatus,
  MemberCapabilities,
  PermissionPresetId
} from "@codex-ui/shared";
import { LocalDatabase, codexUiDataDir } from "./localDatabase.js";

export type { AuthUser, AuthUserRole, AuthUserStatus, MemberCapabilities };

export interface LoginResult {
  token: string;
  user: AuthUser;
  expiresAt: number;
}

export interface CreateMemberInput {
  email: string;
  password: string;
  username?: string;
  role?: AuthUserRole;
  status?: AuthUserStatus;
  balance?: number;
  concurrency?: number;
  maxPermission?: PermissionPresetId;
  allowWrite?: boolean;
  allowNetwork?: boolean;
  allowDangerBypass?: boolean;
  notes?: string;
}

export interface UpdateMemberInput {
  email?: string;
  username?: string;
  role?: AuthUserRole;
  status?: AuthUserStatus;
  balance?: number;
  concurrency?: number;
  maxPermission?: PermissionPresetId;
  allowWrite?: boolean;
  allowNetwork?: boolean;
  allowDangerBypass?: boolean;
  notes?: string;
  password?: string;
}

interface AuthConfig {
  jwtSecret: string;
  adminEmail: string;
  adminPassword: string;
  tokenExpireHours: number;
  membersRoot: string;
}

interface UserRow {
  id: string;
  email: string;
  username: string;
  password_hash: string;
  role: AuthUserRole;
  status: AuthUserStatus;
  balance: number;
  concurrency: number;
  max_permission: PermissionPresetId;
  allow_write: number;
  allow_network: number;
  allow_danger_bypass: number;
  workspace_root: string;
  notes: string;
  totp_secret: string;
  totp_enabled: number;
  totp_enabled_at: number | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

interface JwtPayload {
  sub: string;
  email: string;
  role: AuthUserRole;
  sid: string;
  iat: number;
  exp: number;
}

const PERMISSION_RANK: Record<PermissionPresetId, number> = {
  readonlyAsk: 0,
  workspaceAsk: 1,
  fullAsk: 2,
  dangerBypass: 3
};

export class AuthStore {
  private readonly db: RuntimeDatabase;
  private readonly config: AuthConfig;

  public constructor(database = new LocalDatabase(), config = configFromEnv()) {
    this.db = database.connection;
    this.config = config;
    mkdirSync(this.config.membersRoot, { recursive: true, mode: 0o700 });
  }

  public static fromEnv(env: NodeJS.ProcessEnv = process.env, database = new LocalDatabase()): AuthStore | null {
    let mode = env.CODEX_UI_AUTH?.trim().toLowerCase();
    if (mode === undefined) {
      try {
        if (/codex-standalone(\.exe)?$/i.test(process.execPath ?? "")) {
          mode = "off";
        }
      } catch {}
    }
    mode = mode ?? "1";
    if (mode === "0" || mode === "false" || mode === "off" || mode === "local-token") {
      return null;
    }
    return new AuthStore(database, configFromEnv(env));
  }

  public async initialize(): Promise<void> {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        username TEXT NOT NULL DEFAULT '',
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
        balance REAL NOT NULL DEFAULT 0,
        concurrency INTEGER NOT NULL DEFAULT 5,
        max_permission TEXT NOT NULL DEFAULT 'workspaceAsk'
          CHECK (max_permission IN ('readonlyAsk', 'workspaceAsk', 'fullAsk', 'dangerBypass')),
        allow_write INTEGER NOT NULL DEFAULT 1,
        allow_network INTEGER NOT NULL DEFAULT 0,
        allow_danger_bypass INTEGER NOT NULL DEFAULT 0,
        workspace_root TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        totp_secret TEXT NOT NULL DEFAULT '',
        totp_enabled INTEGER NOT NULL DEFAULT 0,
        totp_enabled_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted_at INTEGER,
        last_login_at INTEGER,
        last_active_at INTEGER
      );
      CREATE UNIQUE INDEX IF NOT EXISTS users_email_active_idx ON users (email) WHERE deleted_at IS NULL;
      CREATE INDEX IF NOT EXISTS users_status_idx ON users (status);
      CREATE INDEX IF NOT EXISTS users_deleted_at_idx ON users (deleted_at);

      CREATE TABLE IF NOT EXISTS thread_owners (
        thread_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS thread_owners_user_idx ON thread_owners (user_id);

      CREATE TABLE IF NOT EXISTS balance_ledger (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        delta REAL NOT NULL,
        balance_after REAL NOT NULL,
        operation TEXT NOT NULL,
        reason TEXT NOT NULL DEFAULT '',
        thread_id TEXT NOT NULL DEFAULT '',
        method TEXT NOT NULL DEFAULT '',
        reference_id TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS balance_ledger_user_idx ON balance_ledger (user_id, created_at);
    `);
    try {
      this.db.prepare("ALTER TABLE balance_ledger ADD COLUMN reference_id TEXT NOT NULL DEFAULT ''").run();
    } catch {
      // Column already exists.
    }
    this.db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS balance_ledger_reference_idx
        ON balance_ledger (user_id, reference_id) WHERE reference_id <> '';
    `);
    await this.ensureDefaultAdmin();
  }

  public async login(email: string, password: string): Promise<LoginResult | null> {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail || !password) {
      return null;
    }
    const user = this.db
      .prepare(
        `SELECT * FROM users WHERE email = ? AND deleted_at IS NULL LIMIT 1`
      )
      .get(normalizedEmail) as UserRow | undefined;
    if (!user || user.status !== "active") {
      return null;
    }
    if (!(await verifyPassword(password, user.password_hash))) {
      return null;
    }
    const now = Math.floor(Date.now() / 1000);
    const exp = now + this.config.tokenExpireHours * 3600;
    const token = signJwt(
      {
        sub: user.id,
        email: user.email,
        role: user.role,
        sid: randomBytes(8).toString("hex"),
        iat: now,
        exp
      },
      this.config.jwtSecret
    );
    const ts = Date.now();
    this.db
      .prepare(`UPDATE users SET last_login_at = ?, last_active_at = ?, updated_at = ? WHERE id = ?`)
      .run(ts, ts, ts, user.id);
    return { token, user: authUserFromRow(user), expiresAt: exp * 1000 };
  }

  public async getUserByToken(token: string | null | undefined): Promise<AuthUser | null> {
    const claims = token ? verifyJwt(token, this.config.jwtSecret) : null;
    if (!claims) {
      return null;
    }
    const user = this.db
      .prepare(`SELECT * FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1`)
      .get(claims.sub) as UserRow | undefined;
    if (!user || user.status !== "active" || user.email !== claims.email || user.role !== claims.role) {
      return null;
    }
    this.db.prepare(`UPDATE users SET last_active_at = ? WHERE id = ?`).run(Date.now(), user.id);
    return authUserFromRow(user);
  }

  public listUsers(): AuthUser[] {
    const rows = this.db
      .prepare(`SELECT * FROM users WHERE deleted_at IS NULL ORDER BY created_at ASC`)
      .all() as UserRow[];
    return rows.map(authUserFromRow);
  }

  public getUser(id: string): AuthUser | null {
    const row = this.db
      .prepare(`SELECT * FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1`)
      .get(id) as UserRow | undefined;
    return row ? authUserFromRow(row) : null;
  }

  public async createUser(input: CreateMemberInput): Promise<AuthUser> {
    const email = normalizeEmail(input.email);
    if (!email) {
      throw new Error("Invalid email");
    }
    if (!input.password || input.password.length < 8) {
      throw new Error("Password must be at least 8 characters");
    }
    const existing = this.db
      .prepare(`SELECT id FROM users WHERE email = ? AND deleted_at IS NULL LIMIT 1`)
      .get(email) as { id: string } | undefined;
    if (existing) {
      throw new Error("Email already exists");
    }
    const id = randomUUID();
    const now = Date.now();
    const role: AuthUserRole = input.role === "admin" ? "admin" : "user";
    const status: AuthUserStatus = input.status === "disabled" ? "disabled" : "active";
    const maxPermission = normalizePermission(input.maxPermission, role === "admin" ? "dangerBypass" : "workspaceAsk");
    const allowWrite = input.allowWrite ?? maxPermission !== "readonlyAsk";
    const allowNetwork = input.allowNetwork ?? false;
    const allowDangerBypass = input.allowDangerBypass ?? (role === "admin" && maxPermission === "dangerBypass");
    const workspaceRoot = join(this.config.membersRoot, id, "workspace");
    mkdirSync(workspaceRoot, { recursive: true, mode: 0o700 });
    const hash = await hashPassword(input.password);
    this.db
      .prepare(
        `INSERT INTO users (
          id, email, username, password_hash, role, status, balance, concurrency,
          max_permission, allow_write, allow_network, allow_danger_bypass, workspace_root, notes,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        email,
        (input.username ?? "").trim() || (role === "admin" ? "Admin" : email.split("@")[0] || "member"),
        hash,
        role,
        status,
        Number(input.balance ?? 0),
        Math.min(100, Math.max(1, Math.floor(input.concurrency ?? 5))),
        maxPermission,
        allowWrite ? 1 : 0,
        allowNetwork ? 1 : 0,
        allowDangerBypass ? 1 : 0,
        workspaceRoot,
        input.notes ?? "",
        now,
        now
      );
    const created = this.getUser(id);
    if (!created) {
      throw new Error("Failed to create user");
    }
    return created;
  }

  public async updateUser(id: string, input: UpdateMemberInput): Promise<AuthUser> {
    const existing = this.db
      .prepare(`SELECT * FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1`)
      .get(id) as UserRow | undefined;
    if (!existing) {
      throw new Error("User not found");
    }
    const email = input.email !== undefined ? normalizeEmail(input.email) : existing.email;
    if (!email) {
      throw new Error("Invalid email");
    }
    if (email !== existing.email) {
      const clash = this.db
        .prepare(`SELECT id FROM users WHERE email = ? AND deleted_at IS NULL AND id != ? LIMIT 1`)
        .get(email, id) as { id: string } | undefined;
      if (clash) {
        throw new Error("Email already exists");
      }
    }
    const role: AuthUserRole = input.role ?? existing.role;
    const status: AuthUserStatus = input.status ?? existing.status;
    const maxPermission = normalizePermission(input.maxPermission ?? existing.max_permission, existing.max_permission);
    const allowWrite = input.allowWrite ?? Boolean(existing.allow_write);
    const allowNetwork = input.allowNetwork ?? Boolean(existing.allow_network);
    const allowDangerBypass = input.allowDangerBypass ?? Boolean(existing.allow_danger_bypass);
    let passwordHash = existing.password_hash;
    if (input.password) {
      if (input.password.length < 8) {
        throw new Error("Password must be at least 8 characters");
      }
      passwordHash = await hashPassword(input.password);
    }
    this.db
      .prepare(
        `UPDATE users SET
          email = ?, username = ?, password_hash = ?, role = ?, status = ?, balance = ?, concurrency = ?,
          max_permission = ?, allow_write = ?, allow_network = ?, allow_danger_bypass = ?, notes = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        email,
        input.username !== undefined ? input.username.trim() : existing.username,
        passwordHash,
        role,
        status,
        Number(input.balance ?? existing.balance),
        Math.min(100, Math.max(1, Math.floor(input.concurrency ?? existing.concurrency))),
        maxPermission,
        allowWrite ? 1 : 0,
        allowNetwork ? 1 : 0,
        allowDangerBypass ? 1 : 0,
        input.notes !== undefined ? input.notes : existing.notes,
        Date.now(),
        id
      );
    if (role !== "admin" && existing.role === "admin") {
      this.ensureAtLeastOneAdmin(id);
    }
    if (status === "disabled" && existing.role === "admin") {
      this.ensureAtLeastOneAdmin(id);
    }
    const updated = this.getUser(id);
    if (!updated) {
      throw new Error("User not found after update");
    }
    return updated;
  }

  public softDeleteUser(id: string): void {
    const existing = this.getUser(id);
    if (!existing) {
      throw new Error("User not found");
    }
    if (existing.role === "admin") {
      this.ensureAtLeastOneAdmin(id);
    }
    this.db.prepare(`UPDATE users SET deleted_at = ?, updated_at = ?, status = 'disabled' WHERE id = ?`).run(Date.now(), Date.now(), id);
  }

  /** Require positive balance for billable members (admin may bypass when balance is unlimited). */
  public assertCanStartTurn(user: AuthUser): void {
    if (user.role === "admin") {
      return;
    }
    if (user.balance <= 0) {
      throw new Error("Insufficient balance. Ask an admin to allocate credit.");
    }
  }

  /**
   * Debit member balance. Returns updated user.
   * Admins are never auto-debited.
   * amount must be > 0.
   */
  public debitBalance(userId: string, amount: number, meta?: { reason?: string; threadId?: string; method?: string; referenceId?: string }): AuthUser {
    if (!(amount > 0) || !Number.isFinite(amount)) {
      throw new Error("Debit amount must be positive");
    }
    const referenceId = meta?.referenceId?.trim() ?? "";
    const existing = this.db
      .prepare(`SELECT * FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1`)
      .get(userId) as UserRow | undefined;
    if (!existing) {
      throw new Error("User not found");
    }
    if (referenceId) {
      const alreadyDebited = this.db
        .prepare(`SELECT 1 FROM balance_ledger WHERE user_id = ? AND reference_id = ? LIMIT 1`)
        .get(userId, referenceId);
      if (alreadyDebited) return authUserFromRow(existing);
    }
    if (existing.role === "admin") {
      return authUserFromRow(existing);
    }
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const locked = this.db
        .prepare(`SELECT * FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1`)
        .get(userId) as UserRow | undefined;
      if (!locked) throw new Error("User not found");
      const next = Number(locked.balance) - amount;
      if (next < 0) throw new Error("Insufficient balance");
      const now = Date.now();
      this.db.prepare(`UPDATE users SET balance = ?, updated_at = ? WHERE id = ?`).run(next, now, userId);
      this.db
        .prepare(
          `INSERT INTO balance_ledger (id, user_id, delta, balance_after, operation, reason, thread_id, method, reference_id, created_at)
           VALUES (?, ?, ?, ?, 'debit', ?, ?, ?, ?, ?)`
        )
        .run(randomUUID(), userId, -amount, next, meta?.reason ?? "usage", meta?.threadId ?? "", meta?.method ?? "", referenceId, now);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      if (referenceId) {
        const alreadyDebited = this.db
          .prepare(`SELECT 1 FROM balance_ledger WHERE user_id = ? AND reference_id = ? LIMIT 1`)
          .get(userId, referenceId);
        if (alreadyDebited) {
          const current = this.getUser(userId);
          if (current) return current;
        }
      }
      throw error;
    }
    const updated = this.getUser(userId);
    if (!updated) {
      throw new Error("User not found after debit");
    }
    return updated;
  }

  /**
   * Admin balance operations: set | add | subtract (Sub2API-style).
   */
  public adjustBalance(
    userId: string,
    amount: number,
    operation: "set" | "add" | "subtract",
    notes = ""
  ): AuthUser {
    if (!Number.isFinite(amount)) {
      throw new Error("Invalid amount");
    }
    if ((operation === "add" || operation === "subtract") && !(amount > 0)) {
      throw new Error("Amount must be > 0 for add/subtract");
    }
    if (operation === "set" && amount < 0) {
      throw new Error("Balance cannot be negative");
    }
    const existing = this.db
      .prepare(`SELECT * FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1`)
      .get(userId) as UserRow | undefined;
    if (!existing) {
      throw new Error("User not found");
    }
    const current = Number(existing.balance);
    let next = current;
    if (operation === "set") {
      next = amount;
    } else if (operation === "add") {
      next = current + amount;
    } else {
      next = current - amount;
    }
    if (next < 0) {
      throw new Error("Balance cannot be negative");
    }
    const now = Date.now();
    this.db.prepare(`UPDATE users SET balance = ?, updated_at = ? WHERE id = ?`).run(next, now, userId);
    this.db
      .prepare(
        `INSERT INTO balance_ledger (id, user_id, delta, balance_after, operation, reason, thread_id, method, created_at)
         VALUES (?, ?, ?, ?, ?, ?, '', 'admin', ?)`
      )
      .run(randomUUID(), userId, next - current, next, operation, notes || `admin ${operation}`, now);
    const updated = this.getUser(userId);
    if (!updated) {
      throw new Error("User not found after balance update");
    }
    return updated;
  }

  public listBalanceLedger(userId: string, limit = 50): Array<Record<string, unknown>> {
    const rows = this.db
      .prepare(
        `SELECT id, user_id, delta, balance_after, operation, reason, thread_id, method, reference_id, created_at
         FROM balance_ledger WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`
      )
      .all(userId, Math.max(1, Math.min(200, Math.floor(limit)))) as Array<Record<string, unknown>>;
    return rows;
  }


  /**
   * Server-side policy for all member RPCs:
   * - non-admin cannot write codex config
   * - non-admin cannot leave workspace root (cwd/path params)
   * - admin-only methods rejected
   */

  public listBalanceLedgerForAdmin(limit = 100, userId?: string): Array<Record<string, unknown>> {
    const lim = Math.max(1, Math.min(500, Math.floor(limit)));
    if (userId) {
      return this.listBalanceLedger(userId, lim);
    }
    const rows = this.db
      .prepare(
        `SELECT l.id, l.user_id, u.email as user_email, l.delta, l.balance_after, l.operation, l.reason, l.thread_id, l.method, l.reference_id, l.created_at
         FROM balance_ledger l
         LEFT JOIN users u ON u.id = l.user_id
         ORDER BY l.created_at DESC LIMIT ?`
      )
      .all(lim) as Array<Record<string, unknown>>;
    return rows;
  }

  /**
   * Usage summary for charts (Sub2API-inspired): spend, top-ups, turn counts, daily series.
   */
  public getUsageSummary(options?: { userId?: string; days?: number; isAdmin?: boolean }): {
    balance: number | null;
    totalDebit: number;
    totalCredit: number;
    turnCount: number;
    todayDebit: number;
    periodDays: number;
    daily: Array<{ date: string; debit: number; credit: number; turns: number }>;
    byOperation: Array<{ operation: string; count: number; total: number }>;
    topUsers?: Array<{ userId: string; email: string; debit: number; turns: number }>;
  } {
    const days = Math.max(1, Math.min(90, Math.floor(options?.days ?? 7)));
    const since = Date.now() - days * 24 * 60 * 60 * 1000;
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const todayStart = dayStart.getTime();
    const userId = options?.userId;

    let balance: number | null = null;
    if (userId) {
      const u = this.getUser(userId);
      balance = u ? Number(u.balance) : null;
    }

    const whereUser = userId ? "AND user_id = ?" : "";
    const paramsBase = userId ? [since, userId] : [since];

    const totals = this.db
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN delta < 0 THEN -delta ELSE 0 END), 0) as total_debit,
           COALESCE(SUM(CASE WHEN delta > 0 THEN delta ELSE 0 END), 0) as total_credit,
           COALESCE(SUM(CASE WHEN operation = 'debit' THEN 1 ELSE 0 END), 0) as turn_count
         FROM balance_ledger
         WHERE created_at >= ? ${whereUser}`
      )
      .get(...paramsBase) as { total_debit: number; total_credit: number; turn_count: number };

    const todayParams = userId ? [todayStart, userId] : [todayStart];
    const today = this.db
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN delta < 0 THEN -delta ELSE 0 END), 0) as today_debit
         FROM balance_ledger WHERE created_at >= ? ${whereUser}`
      )
      .get(...todayParams) as { today_debit: number };

    const rows = this.db
      .prepare(
        `SELECT created_at, delta, operation FROM balance_ledger WHERE created_at >= ? ${whereUser} ORDER BY created_at ASC`
      )
      .all(...paramsBase) as Array<{ created_at: number; delta: number; operation: string }>;

    const byDay = new Map<string, { debit: number; credit: number; turns: number }>();
    for (let i = days - 1; i >= 0; i -= 1) {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      byDay.set(key, { debit: 0, credit: 0, turns: 0 });
    }
    for (const row of rows) {
      const key = new Date(row.created_at).toISOString().slice(0, 10);
      const bucket = byDay.get(key) ?? { debit: 0, credit: 0, turns: 0 };
      if (row.delta < 0) {
        bucket.debit += -Number(row.delta);
      } else if (row.delta > 0) {
        bucket.credit += Number(row.delta);
      }
      if (row.operation === "debit") {
        bucket.turns += 1;
      }
      byDay.set(key, bucket);
    }
    const daily = [...byDay.entries()].map(([date, v]) => ({ date, ...v }));

    const byOpRows = this.db
      .prepare(
        `SELECT operation, COUNT(*) as count, COALESCE(SUM(ABS(delta)), 0) as total
         FROM balance_ledger WHERE created_at >= ? ${whereUser}
         GROUP BY operation ORDER BY total DESC`
      )
      .all(...paramsBase) as Array<{ operation: string; count: number; total: number }>;

    let topUsers: Array<{ userId: string; email: string; debit: number; turns: number }> | undefined;
    if (options?.isAdmin && !userId) {
      topUsers = (
        this.db
          .prepare(
            `SELECT l.user_id as userId, COALESCE(u.email, l.user_id) as email,
                    COALESCE(SUM(CASE WHEN l.delta < 0 THEN -l.delta ELSE 0 END), 0) as debit,
                    COALESCE(SUM(CASE WHEN l.operation = 'debit' THEN 1 ELSE 0 END), 0) as turns
             FROM balance_ledger l
             LEFT JOIN users u ON u.id = l.user_id
             WHERE l.created_at >= ?
             GROUP BY l.user_id
             ORDER BY debit DESC
             LIMIT 10`
          )
          .all(since) as Array<{ userId: string; email: string; debit: number; turns: number }>
      ).map((r) => ({
        userId: r.userId,
        email: r.email,
        debit: Number(r.debit),
        turns: Number(r.turns)
      }));
    }

    return {
      balance,
      totalDebit: Number(totals.total_debit) || 0,
      totalCredit: Number(totals.total_credit) || 0,
      turnCount: Number(totals.turn_count) || 0,
      todayDebit: Number(today.today_debit) || 0,
      periodDays: days,
      daily,
      byOperation: byOpRows.map((r) => ({
        operation: r.operation,
        count: Number(r.count),
        total: Number(r.total)
      })),
      topUsers
    };
  }

  public enforceMemberRpc(user: AuthUser, method: string, params: unknown): Record<string, unknown> {
    const record = asRecord(params);

    if (user.role !== "admin") {
      if (isAdminOnlyMethod(method)) {
        throw new Error(`Admin only: ${method}`);
      }
      // Force workspace boundaries for path-bearing methods.
      if (method === "thread/start" || method === "turn/start") {
        return this.enforcePermissionParams(user, method, params);
      }
      return clampPathsForMember(record, user.workspaceRoot);
    }

    if (method === "thread/start" || method === "turn/start") {
      return this.enforcePermissionParams(user, method, params);
    }
    return record;
  }

  public claimThread(threadId: string, userId: string): void {
    if (!threadId || !userId) {
      return;
    }
    const existing = this.db
      .prepare(`SELECT user_id FROM thread_owners WHERE thread_id = ? LIMIT 1`)
      .get(threadId) as { user_id: string } | undefined;
    if (existing) {
      if (existing.user_id !== userId) {
        throw new Error("Thread belongs to another member");
      }
      return;
    }
    this.db
      .prepare(`INSERT INTO thread_owners (thread_id, user_id, created_at) VALUES (?, ?, ?)`)
      .run(threadId, userId, Date.now());
  }

  public ownsThread(threadId: string, userId: string): boolean {
    const existing = this.db
      .prepare(`SELECT user_id FROM thread_owners WHERE thread_id = ? LIMIT 1`)
      .get(threadId) as { user_id: string } | undefined;
    if (!existing) {
      return true;
    }
    return existing.user_id === userId;
  }

  public threadOwnerId(threadId: string): string | null {
    const existing = this.db
      .prepare(`SELECT user_id FROM thread_owners WHERE thread_id = ? LIMIT 1`)
      .get(threadId) as { user_id: string } | undefined;
    return existing?.user_id ?? null;
  }

  public listThreadIdsForUser(userId: string): string[] {
    const rows = this.db
      .prepare(`SELECT thread_id FROM thread_owners WHERE user_id = ? ORDER BY created_at DESC`)
      .all(userId) as Array<{ thread_id: string }>;
    return rows.map((row) => row.thread_id);
  }

  public enforcePermissionParams(user: AuthUser, method: string, params: unknown): Record<string, unknown> {
    const record = asRecord(params);
    if (method !== "thread/start" && method !== "turn/start") {
      return record;
    }

    const requested = inferRequestedPermission(record);
    const allowed = clampPermission(requested, user);
    const cwd = coerceWorkspaceCwd(stringValue(record.cwd), user.workspaceRoot, user.role === "admin");

    if (user.role !== "admin") {
      if (!user.allowDangerBypass && (allowed === "dangerBypass" || requested === "dangerBypass")) {
        throw new Error("Member policy forbids dangerously-bypass-approvals-and-sandbox");
      }
      if (!pathAllowed(cwd, user.workspaceRoot)) {
        throw new Error(`Workspace path outside member root: ${user.workspaceRoot}`);
      }
    }

    const overrides = permissionToSandbox(allowed, cwd, user.allowNetwork);
    const next: Record<string, unknown> = {
      ...record,
      cwd,
      sandbox: overrides.sandbox,
      approvalPolicy: overrides.approvalPolicy
    };
    if (method === "turn/start" || record.sandboxPolicy !== undefined) {
      next.sandboxPolicy = overrides.sandboxPolicy;
    }
    // Strip client attempts to smuggle unrestricted modes.
    if (!user.allowDangerBypass || allowed !== "dangerBypass") {
      if (next.approvalPolicy === "never" && allowed !== "dangerBypass") {
        next.approvalPolicy = "on-request";
      }
      if (next.sandbox === "danger-full-access" && allowed !== "dangerBypass" && allowed !== "fullAsk") {
        next.sandbox = allowed === "readonlyAsk" ? "read-only" : "workspace-write";
      }
    }
    return next;
  }

  public filterThreadsForUser(user: AuthUser, threads: unknown): unknown {
    // Admin: never filter history list (shared host Codex sessions must all be visible).
    if (user.role === "admin") {
      return threads;
    }
    // TEMP: also skip member history filtering so Web/TUI shared sessions are fully visible.
    // Resume/read/delete of another member's claimed thread is still gated by ownsThread.
    // Restore member-owned-only filtering here when multi-tenant isolation is re-enabled.
    return threads;
  }


  public getUserRowByEmail(email: string): UserRow | null {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) return null;
    const user = this.db
      .prepare(`SELECT * FROM users WHERE email = ? AND deleted_at IS NULL LIMIT 1`)
      .get(normalizedEmail) as UserRow | undefined;
    return user ?? null;
  }

  public getUserRow(id: string): UserRow | null {
    const row = this.db
      .prepare(`SELECT * FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1`)
      .get(id) as UserRow | undefined;
    return row ?? null;
  }


  public async changeOwnPassword(userId: string, currentPassword: string, newPassword: string): Promise<AuthUser> {
    if (!currentPassword || !newPassword) {
      throw new Error("Current and new password are required");
    }
    if (newPassword.length < 8) {
      throw new Error("New password must be at least 8 characters");
    }
    if (currentPassword === newPassword) {
      throw new Error("New password must be different from current password");
    }
    const existing = this.getUserRow(userId);
    if (!existing || existing.status !== "active") {
      throw new Error("User not found");
    }
    if (!(await verifyPassword(currentPassword, existing.password_hash))) {
      throw new Error("Current password is incorrect");
    }
    const hash = await hashPassword(newPassword);
    this.db.prepare(`UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`).run(hash, Date.now(), userId);
    const user = this.getUser(userId);
    if (!user) {
      throw new Error("User not found after password change");
    }
    return user;
  }

  /** Fresh concurrency limit from DB (admin may have just updated it). */
  public getConcurrencyLimit(userId: string): number {
    const row = this.getUserRow(userId);
    if (!row) {
      return 1;
    }
    if (row.role === "admin") {
      return Math.max(1, Math.floor(row.concurrency || 20));
    }
    return Math.max(1, Math.floor(row.concurrency || 1));
  }

  public async verifyPassword(email: string, password: string): Promise<UserRow | null> {
    const user = this.getUserRowByEmail(email);
    if (!user || user.status !== "active") {
      return null;
    }
    if (!(await verifyPassword(password, user.password_hash))) {
      return null;
    }
    return user;
  }

  /**
   * Sliding renewal. A workbench that stays open keeps polling `/api/session`,
   * so a token past half its lifetime is rotated instead of expiring underneath
   * a running app and bouncing the user to the login screen. Returns null when
   * the token is invalid or still fresh, so callers keep the current session.
   */
  public renewIfExpiring(token: string | null | undefined): LoginResult | null {
    const claims = token ? verifyJwt(token, this.config.jwtSecret) : null;
    if (!claims) {
      return null;
    }
    const lifetimeSeconds = claims.exp - claims.iat;
    const remainingSeconds = claims.exp - Math.floor(Date.now() / 1000);
    if (lifetimeSeconds <= 0 || remainingSeconds > lifetimeSeconds / 2) {
      return null;
    }
    try {
      return this.issueSessionForUser(claims.sub);
    } catch {
      // A deleted or disabled account must fall back to the normal expiry path.
      return null;
    }
  }

  public issueSessionForUser(userId: string): LoginResult {
    const user = this.db
      .prepare(`SELECT * FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1`)
      .get(userId) as UserRow | undefined;
    if (!user || user.status !== "active") {
      throw new Error("User not found or inactive");
    }
    const now = Math.floor(Date.now() / 1000);
    const exp = now + this.config.tokenExpireHours * 3600;
    const token = signJwt(
      {
        sub: user.id,
        email: user.email,
        role: user.role,
        sid: randomBytes(8).toString("hex"),
        iat: now,
        exp
      },
      this.config.jwtSecret
    );
    const ts = Date.now();
    this.db
      .prepare(`UPDATE users SET last_login_at = ?, last_active_at = ?, updated_at = ? WHERE id = ?`)
      .run(ts, ts, ts, user.id);
    return { token, user: authUserFromRow(user), expiresAt: exp * 1000 };
  }

  public enableTotp(userId: string, secret: string): AuthUser {
    this.db
      .prepare(`UPDATE users SET totp_secret = ?, totp_enabled = 1, totp_enabled_at = ?, updated_at = ? WHERE id = ?`)
      .run(secret, Date.now(), Date.now(), userId);
    const user = this.getUser(userId);
    if (!user) throw new Error("User not found");
    return user;
  }

  public disableTotp(userId: string): AuthUser {
    this.db
      .prepare(`UPDATE users SET totp_secret = '', totp_enabled = 0, totp_enabled_at = NULL, updated_at = ? WHERE id = ?`)
      .run(Date.now(), userId);
    const user = this.getUser(userId);
    if (!user) throw new Error("User not found");
    return user;
  }

  public getTotpSecret(userId: string): string | null {
    const row = this.getUserRow(userId);
    if (!row || !row.totp_enabled || !row.totp_secret) return null;
    return row.totp_secret;
  }

  private ensureAtLeastOneAdmin(excludeId: string): void {
    const count = this.db
      .prepare(
        `SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND status = 'active' AND deleted_at IS NULL AND id != ?`
      )
      .get(excludeId) as { count: number };
    if ((count?.count ?? 0) < 1) {
      throw new Error("At least one active admin is required");
    }
  }

  private async ensureDefaultAdmin(): Promise<void> {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND deleted_at IS NULL`)
      .get() as { count: number };
    if ((row?.count ?? 0) > 0) {
      return;
    }
    const email = normalizeEmail(this.config.adminEmail);
    if (!email) {
      throw new Error("CODEX_UI_ADMIN_EMAIL is invalid");
    }
    await this.createUser({
      email,
      password: this.config.adminPassword,
      username: "Super Admin",
      role: "admin",
      status: "active",
      concurrency: 20,
      maxPermission: "dangerBypass",
      allowWrite: true,
      allowNetwork: true,
      allowDangerBypass: true
    });
    console.info(`[auth] Created default admin user: ${email}`);
    if (!process.env.CODEX_UI_ADMIN_PASSWORD && !process.env.ADMIN_PASSWORD) {
      console.warn("[auth] Using default admin password ChangeMe123!; set CODEX_UI_ADMIN_PASSWORD before production use.");
    }
  }
}

export function permissionAllowedForUser(user: AuthUser, permission: PermissionPresetId): boolean {
  if (user.role === "admin") {
    return true;
  }
  if (!user.allowDangerBypass && permission === "dangerBypass") {
    return false;
  }
  if (!user.allowWrite && permission !== "readonlyAsk") {
    return false;
  }
  return PERMISSION_RANK[permission] <= PERMISSION_RANK[user.maxPermission];
}

function configFromEnv(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  let jwtSecret = env.CODEX_UI_JWT_SECRET ?? env.JWT_SECRET;
  if (!jwtSecret) {
    const configEnvPath = join(homedir(), ".config", "codex-ultra", ".env");
    const legacyConfigEnvPath = join(homedir(), ".config", "codex-react-ui", ".env");
    const fallbackSecretPath = join(codexUiDataDir(env), "jwt.secret");
    try {
      const readableConfigEnvPath = existsSync(configEnvPath) ? configEnvPath : legacyConfigEnvPath;
      if (existsSync(readableConfigEnvPath)) {
        const content = readFileSync(readableConfigEnvPath, "utf-8");
        const match = content.match(/CODEX_UI_JWT_SECRET=(.+)/);
        if (match && match[1]?.trim()) {
          jwtSecret = match[1].trim();
        }
      }
    } catch {
      /* ignore env read error */
    }
    if (!jwtSecret) {
      try {
        if (existsSync(fallbackSecretPath)) {
          jwtSecret = readFileSync(fallbackSecretPath, "utf-8").trim();
        } else {
          mkdirSync(dirname(fallbackSecretPath), { recursive: true });
          jwtSecret = randomBytes(32).toString("base64url");
          writeFileSync(fallbackSecretPath, jwtSecret, "utf-8");
        }
      } catch {
        jwtSecret = randomBytes(32).toString("base64url");
      }
    }
  }
  return {
    jwtSecret: jwtSecret || randomBytes(32).toString("base64url"),
    adminEmail: env.CODEX_UI_ADMIN_EMAIL ?? env.ADMIN_EMAIL ?? "admin@example.com",
    adminPassword: env.CODEX_UI_ADMIN_PASSWORD ?? env.ADMIN_PASSWORD ?? "ChangeMe123!",
    tokenExpireHours: positiveNumber(env.CODEX_UI_JWT_EXPIRE_HOURS ?? env.JWT_EXPIRE_HOURS, 24),
    membersRoot: env.CODEX_UI_MEMBERS_ROOT ?? join(codexUiDataDir(env), "members")
  };
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizePermission(value: unknown, fallback: PermissionPresetId): PermissionPresetId {
  if (value === "readonlyAsk" || value === "workspaceAsk" || value === "fullAsk" || value === "dangerBypass") {
    return value;
  }
  return fallback;
}

function authUserFromRow(row: UserRow): AuthUser {
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    role: row.role,
    status: row.status,
    balance: Number(row.balance),
    concurrency: row.concurrency,
    maxPermission: row.max_permission,
    allowWrite: Boolean(row.allow_write),
    allowNetwork: Boolean(row.allow_network),
    allowDangerBypass: Boolean(row.allow_danger_bypass),
    workspaceRoot: row.workspace_root,
    notes: row.notes,
    totpEnabled: Boolean(row.totp_enabled)
  };
}

function inferRequestedPermission(record: Record<string, unknown>): PermissionPresetId {
  const approval = stringValue(record.approvalPolicy);
  const sandbox = stringValue(record.sandbox);
  const policyType = stringValue(asRecord(record.sandboxPolicy).type);
  if (approval === "never" || sandbox === "danger-full-access" || policyType === "dangerFullAccess") {
    if (approval === "never") {
      return "dangerBypass";
    }
    return "fullAsk";
  }
  if (sandbox === "read-only" || policyType === "readOnly") {
    return "readonlyAsk";
  }
  if (sandbox === "workspace-write" || policyType === "workspaceWrite") {
    return "workspaceAsk";
  }
  return "workspaceAsk";
}

function clampPermission(requested: PermissionPresetId, user: AuthUser): PermissionPresetId {
  let next = requested;
  if (user.role !== "admin") {
    if (!user.allowDangerBypass && next === "dangerBypass") {
      next = user.allowWrite ? user.maxPermission === "readonlyAsk" ? "readonlyAsk" : "workspaceAsk" : "readonlyAsk";
    }
    if (!user.allowWrite) {
      next = "readonlyAsk";
    }
    if (PERMISSION_RANK[next] > PERMISSION_RANK[user.maxPermission]) {
      next = user.maxPermission;
    }
  }
  return next;
}

function permissionToSandbox(
  permission: PermissionPresetId,
  cwd: string,
  allowNetwork: boolean
): {
  sandbox: string;
  approvalPolicy: string;
  sandboxPolicy: Record<string, unknown>;
} {
  switch (permission) {
    case "readonlyAsk":
      return {
        sandbox: "read-only",
        approvalPolicy: "on-request",
        sandboxPolicy: { type: "readOnly", networkAccess: allowNetwork }
      };
    case "workspaceAsk":
      return {
        sandbox: "workspace-write",
        approvalPolicy: "on-request",
        sandboxPolicy: {
          type: "workspaceWrite",
          writableRoots: [cwd],
          networkAccess: allowNetwork,
          excludeTmpdirEnvVar: false,
          excludeSlashTmp: false
        }
      };
    case "fullAsk":
      return {
        sandbox: "danger-full-access",
        approvalPolicy: "on-request",
        sandboxPolicy: { type: "dangerFullAccess" }
      };
    case "dangerBypass":
      return {
        sandbox: "danger-full-access",
        approvalPolicy: "never",
        sandboxPolicy: { type: "dangerFullAccess" }
      };
  }
}

function coerceWorkspaceCwd(requested: string | undefined, workspaceRoot: string, isAdmin: boolean): string {
  const fallback = workspaceRoot || join(codexUiDataDir(), "workspace");
  mkdirSync(fallback, { recursive: true, mode: 0o700 });
  if (!requested || requested === "~/" || requested === "~") {
    return fallback;
  }
  const expanded = requested.startsWith("~/") ? join(homedir(), requested.slice(2)) : requested;
  if (isAdmin) {
    return expanded;
  }
  if (!pathAllowed(expanded, workspaceRoot)) {
    return fallback;
  }
  return expanded;
}

function pathAllowed(path: string, root: string): boolean {
  const normalizedPath = join(path);
  const normalizedRoot = join(root);
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
}

function signJwt(payload: JwtPayload, secret: string): string {
  const header = { alg: "HS256", typ: "JWT" };
  const unsigned = `${base64UrlJson(header)}.${base64UrlJson(payload)}`;
  return `${unsigned}.${hmac(unsigned, secret)}`;
}

function verifyJwt(token: string, secret: string): JwtPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }
  const [headerPart, payloadPart, signature] = parts;
  if (!headerPart || !payloadPart || !signature) {
    return null;
  }
  const unsigned = `${headerPart}.${payloadPart}`;
  const expected = hmac(unsigned, secret);
  if (!safeEqual(signature, expected)) {
    return null;
  }
  const header = parseBase64UrlJson(headerPart);
  const payload = parseBase64UrlJson(payloadPart) as Partial<JwtPayload> | null;
  if (!header || header.alg !== "HS256" || !payload) {
    return null;
  }
  const now = Math.floor(Date.now() / 1000);
  if (
    typeof payload.sub !== "string" ||
    typeof payload.email !== "string" ||
    (payload.role !== "admin" && payload.role !== "user") ||
    typeof payload.sid !== "string" ||
    typeof payload.iat !== "number" ||
    typeof payload.exp !== "number" ||
    payload.exp <= now
  ) {
    return null;
  }
  return payload as JwtPayload;
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function parseBase64UrlJson(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function hmac(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}


const ADMIN_ONLY_METHODS = new Set([
  "config/batchWrite",
  "config/write",
  "config/valueWrite",
  "plugin/install",
  "plugin/uninstall",
  "mcpServer/add",
  "mcpServer/remove",
  "mcpServer/update"
]);

function isAdminOnlyMethod(method: string): boolean {
  if (ADMIN_ONLY_METHODS.has(method)) {
    return true;
  }
  // Block any config mutation method for members.
  if (method.startsWith("config/") && method !== "config/read") {
    return true;
  }
  return false;
}

function clampPathsForMember(record: Record<string, unknown>, workspaceRoot: string): Record<string, unknown> {
  const next: Record<string, unknown> = { ...record };
  if (typeof next.cwd === "string") {
    next.cwd = coerceWorkspaceCwd(next.cwd, workspaceRoot, false);
  }
  if (typeof next.path === "string") {
    const allowed = pathAllowed(next.path, workspaceRoot);
    if (!allowed) {
      throw new Error(`Path outside member workspace: ${workspaceRoot}`);
    }
  }
  if (Array.isArray(next.cwds)) {
    next.cwds = next.cwds.map((entry) => {
      if (typeof entry !== "string") {
        return entry;
      }
      return coerceWorkspaceCwd(entry, workspaceRoot, false);
    });
  }
  // Nested thread params occasionally carry cwd.
  if (next.thread && typeof next.thread === "object" && !Array.isArray(next.thread)) {
    const thread = { ...(next.thread as Record<string, unknown>) };
    if (typeof thread.cwd === "string") {
      thread.cwd = coerceWorkspaceCwd(thread.cwd, workspaceRoot, false);
    }
    next.thread = thread;
  }
  return next;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

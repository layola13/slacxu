import {
  ALL_SA_VM_BUN_SUBCOMMANDS,
  createDefaultSaVmPolicyConfig,
  hasEnhanceToolsEnabled,
  parseAgentRuntimeOverride,
  type AgentRuntimeOverride,
  type CompactMode,
  type PermissionPresetId,
  type SaVmBunProfile,
  type SaVmBunSubcommand,
  type SaVmPolicyConfig,
  type ThreadRuntimeMetadata
} from "@codex-ui/shared";
import { LocalDatabase } from "./localDatabase.js";
import type { RuntimeDatabase } from "./runtime/database.js";

export type ThreadRuntimeMetadataInput = Omit<
  Pick<
    ThreadRuntimeMetadata,
    "threadId" | "providerId" | "groupId" | "model" | "reasoningEffort" | "agents" | "cwd" | "additionalRoots" | "workspaceFilePath" | "cliBackend"
  >,
  "providerId" | "groupId" | "model" | "reasoningEffort"
> & {
  // Route fields are optional so partial saves (permission-only, workspace-only)
  // merge with the stored route instead of wiping the per-conversation relay.
  providerId?: string | null;
  groupId?: string | null;
  model?: string;
  reasoningEffort?: string;
  permission: PermissionPresetId;
  fastModeEnabled?: boolean;
  planModeEnabled?: boolean;
  enhanceEnabled?: boolean;
  vmEnabled?: boolean;
  vmPolicy?: SaVmPolicyConfig;
  freeAutoCompactEnabled?: boolean;
  freeAutoCompactThreshold?: number;
  freeAutoCompactModel?: string | null;
  freeAutoCompactProviderId?: string | null;
  freeAutoCompactGroupId?: string | null;
  compactMode?: CompactMode;
  jevCompressThreshold?: number;
};

export type ThreadWorkspaceMetadataInput = Pick<ThreadRuntimeMetadata, "threadId" | "cwd" | "additionalRoots" | "workspaceFilePath">;

type ThreadRuntimeMetadataRow = {
  thread_id: string;
  provider_id: string | null;
  group_id: string | null;
  model: string;
  reasoning_effort: string;
  free_auto_compact_enabled: number;
  free_auto_compact_threshold: number;
  free_auto_compact_model: string | null;
  free_auto_compact_provider_id: string | null;
  free_auto_compact_group_id: string | null;
  compact_mode: string | null;
  jev_compress_threshold: number;
  permission: string | null;
  permission_schema_version: number;
  agents_json: string | null;
  cwd: string | null;
  additional_roots_json: string | null;
  workspace_file_path: string | null;
  cli_backend: string | null;
  fast_mode_enabled: number;
  plan_mode_enabled: number;
  vm_enabled: number;
  vm_policy_json: string | null;
  created_at: number;
  updated_at: number;
};

export class ThreadRuntimeMetadataStore {
  private readonly db: RuntimeDatabase;

  public constructor(database: Pick<LocalDatabase, "connection"> = new LocalDatabase()) {
    this.db = database.connection;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS thread_runtime_metadata (
        owner_id TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        provider_id TEXT,
        group_id TEXT,
        model TEXT NOT NULL DEFAULT '',
        reasoning_effort TEXT NOT NULL DEFAULT '',
        free_auto_compact_enabled INTEGER NOT NULL DEFAULT 0,
        free_auto_compact_threshold INTEGER NOT NULL DEFAULT 80,
        free_auto_compact_model TEXT,
        free_auto_compact_provider_id TEXT,
        free_auto_compact_group_id TEXT,
        compact_mode TEXT,
        jev_compress_threshold INTEGER NOT NULL DEFAULT 85,
        permission TEXT,
        permission_schema_version INTEGER NOT NULL DEFAULT 0,
        agents_json TEXT,
        cwd TEXT,
        additional_roots_json TEXT,
        workspace_file_path TEXT,
        cli_backend TEXT,
        fast_mode_enabled INTEGER NOT NULL DEFAULT 0,
        plan_mode_enabled INTEGER NOT NULL DEFAULT 0,
        vm_enabled INTEGER NOT NULL DEFAULT 0,
        vm_policy_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (owner_id, thread_id)
      );

      CREATE INDEX IF NOT EXISTS idx_thread_runtime_metadata_owner_updated
        ON thread_runtime_metadata(owner_id, updated_at DESC);
    `);
    try {
      this.db.prepare("ALTER TABLE thread_runtime_metadata ADD COLUMN permission TEXT").run();
    } catch {
      // Column already exists.
    }
    try {
      this.db.prepare("ALTER TABLE thread_runtime_metadata ADD COLUMN free_auto_compact_enabled INTEGER NOT NULL DEFAULT 0").run();
    } catch {
      // Column already exists.
    }
    try {
      this.db.prepare("ALTER TABLE thread_runtime_metadata ADD COLUMN free_auto_compact_threshold INTEGER NOT NULL DEFAULT 80").run();
    } catch {
      // Column already exists.
    }
    try {
      this.db.prepare("ALTER TABLE thread_runtime_metadata ADD COLUMN free_auto_compact_model TEXT").run();
    } catch {
      // Column already exists.
    }
    try { this.db.prepare("ALTER TABLE thread_runtime_metadata ADD COLUMN free_auto_compact_provider_id TEXT").run(); } catch {}
    try { this.db.prepare("ALTER TABLE thread_runtime_metadata ADD COLUMN free_auto_compact_group_id TEXT").run(); } catch {}
    try { this.db.prepare("ALTER TABLE thread_runtime_metadata ADD COLUMN compact_mode TEXT").run(); } catch {}
    try { this.db.prepare("ALTER TABLE thread_runtime_metadata ADD COLUMN jev_compress_threshold INTEGER NOT NULL DEFAULT 85").run(); } catch {}
    try {
      this.db.prepare("ALTER TABLE thread_runtime_metadata ADD COLUMN permission_schema_version INTEGER NOT NULL DEFAULT 0").run();
    } catch {
      // Column already exists.
    }
    try {
      this.db.prepare("ALTER TABLE thread_runtime_metadata ADD COLUMN agents_json TEXT").run();
    } catch {
      // Column already exists.
    }
    try {
      this.db.prepare("ALTER TABLE thread_runtime_metadata ADD COLUMN cwd TEXT").run();
    } catch {
      // Column already exists.
    }
    try {
      this.db.prepare("ALTER TABLE thread_runtime_metadata ADD COLUMN additional_roots_json TEXT").run();
    } catch {
      // Column already exists.
    }
    try {
      this.db.prepare("ALTER TABLE thread_runtime_metadata ADD COLUMN workspace_file_path TEXT").run();
    } catch {
      // Column already exists.
    }
    try {
      this.db.prepare("ALTER TABLE thread_runtime_metadata ADD COLUMN cli_backend TEXT").run();
    } catch {
      // Column already exists.
    }
    try { this.db.prepare("ALTER TABLE thread_runtime_metadata ADD COLUMN fast_mode_enabled INTEGER NOT NULL DEFAULT 0").run(); } catch {}
    try { this.db.prepare("ALTER TABLE thread_runtime_metadata ADD COLUMN plan_mode_enabled INTEGER NOT NULL DEFAULT 0").run(); } catch {}
    try { this.db.prepare("ALTER TABLE thread_runtime_metadata ADD COLUMN vm_enabled INTEGER NOT NULL DEFAULT 0").run(); } catch {}
    try { this.db.prepare("ALTER TABLE thread_runtime_metadata ADD COLUMN vm_policy_json TEXT").run(); } catch {}
    this.db.prepare(`
      UPDATE thread_runtime_metadata
      SET vm_policy_json = ?
      WHERE vm_enabled = 1 AND (vm_policy_json IS NULL OR vm_policy_json = '')
    `).run(JSON.stringify(createDefaultSaVmPolicyConfig()));
  }

  public get(ownerId: string, threadId: string): ThreadRuntimeMetadata | null {
    const row = this.db.prepare(`
      SELECT thread_id, provider_id, group_id, model, reasoning_effort,
             free_auto_compact_enabled, free_auto_compact_threshold, free_auto_compact_model, free_auto_compact_provider_id, free_auto_compact_group_id, compact_mode, jev_compress_threshold, permission,
             permission_schema_version, agents_json, cwd, additional_roots_json, workspace_file_path, cli_backend, fast_mode_enabled, plan_mode_enabled, vm_enabled, vm_policy_json, created_at, updated_at
      FROM thread_runtime_metadata
      WHERE owner_id = ? AND thread_id = ?
      LIMIT 1
    `).get(ownerId, threadId) as ThreadRuntimeMetadataRow | undefined;
    return row ? mapRow(row) : null;
  }

  /** Resolve legacy child-agent and server-request events without knowing the owner. */
  public getAny(threadId: string): ThreadRuntimeMetadata | null {
    const row = this.db.prepare(`
      SELECT thread_id, provider_id, group_id, model, reasoning_effort,
             free_auto_compact_enabled, free_auto_compact_threshold, free_auto_compact_model, free_auto_compact_provider_id, free_auto_compact_group_id, compact_mode, jev_compress_threshold, permission,
             permission_schema_version, agents_json, cwd, additional_roots_json, workspace_file_path, cli_backend, fast_mode_enabled, plan_mode_enabled, vm_enabled, vm_policy_json, created_at, updated_at
      FROM thread_runtime_metadata
      WHERE thread_id = ?
      ORDER BY updated_at DESC
      LIMIT 1
    `).get(threadId) as ThreadRuntimeMetadataRow | undefined;
    return row ? mapRow(row) : null;
  }

  public put(ownerId: string, input: ThreadRuntimeMetadataInput): ThreadRuntimeMetadata {
    const now = Date.now();
    const existing = this.get(ownerId, input.threadId);
    // Route fields merge with the stored row: an omitted or empty route must
    // never wipe the per-conversation relay/model. Only a non-empty value
    // replaces the stored one. (There is no UI for clearing a route to empty;
    // official backends use sentinel ids such as "agy-official".)
    const providerId = input.providerId || existing?.providerId || null;
    const groupId = input.groupId || existing?.groupId || null;
    const model = input.model || existing?.model || "";
    const reasoningEffort = input.reasoningEffort || existing?.reasoningEffort || "";
    const freeAutoCompactEnabled = input.freeAutoCompactEnabled ?? existing?.freeAutoCompactEnabled ?? false;
    const freeAutoCompactThreshold = normalizeFreeAutoCompactThreshold(
      input.freeAutoCompactThreshold ?? existing?.freeAutoCompactThreshold ?? 80
    );
    const freeAutoCompactModel = input.freeAutoCompactModel === undefined
      ? existing?.freeAutoCompactModel ?? null
      : normalizeFreeAutoCompactModel(input.freeAutoCompactModel);
    const freeAutoCompactProviderId = input.freeAutoCompactProviderId === undefined
      ? existing?.freeAutoCompactProviderId ?? null
      : normalizeFreeAutoCompactRoutePart(input.freeAutoCompactProviderId);
    const freeAutoCompactGroupId = input.freeAutoCompactGroupId === undefined
      ? existing?.freeAutoCompactGroupId ?? null
      : normalizeFreeAutoCompactRoutePart(input.freeAutoCompactGroupId);
    // compactMode is the mutually exclusive strategy radio. Explicit mode wins;
    // an explicit legacy boolean maps to cheap/off; otherwise keep existing mode
    // (legacy rows without a mode derive cheap/off from the legacy boolean).
    const compactMode = input.compactMode !== undefined
      ? normalizeCompactMode(input.compactMode)
      : input.freeAutoCompactEnabled !== undefined
        ? (input.freeAutoCompactEnabled ? "cheap" : "off")
        : existing?.compactMode ?? (freeAutoCompactEnabled ? "cheap" : "off");
    // Write-through keeps the legacy boolean in sync so old readers/gates
    // (resolveCompactionRelayRoute) keep working: only cheap enables it.
    const freeAutoCompactEnabledOut = input.compactMode !== undefined || input.freeAutoCompactEnabled !== undefined
      ? compactMode === "cheap"
      : freeAutoCompactEnabled;
    const jevCompressThreshold = normalizeJevCompressThreshold(
      input.jevCompressThreshold ?? existing?.jevCompressThreshold ?? 85
    );
    const cwd = input.cwd === undefined ? existing?.cwd ?? null : normalizeCwd(input.cwd);
    const additionalRoots = input.additionalRoots === undefined
      ? existing?.additionalRoots ?? []
      : normalizeAdditionalRoots(input.additionalRoots);
    const workspaceFilePath = input.workspaceFilePath === undefined
      ? existing?.workspaceFilePath ?? null
      : normalizeCwd(input.workspaceFilePath);
    const fastModeEnabled = input.fastModeEnabled ?? existing?.fastModeEnabled ?? false;
    const planModeEnabled = input.planModeEnabled ?? existing?.planModeEnabled ?? false;
    const vmEnabled = input.vmEnabled ?? existing?.vmEnabled ?? false;
    const vmPolicy = input.vmPolicy === undefined
      ? existing?.vmPolicy ?? (vmEnabled ? createDefaultSaVmPolicyConfig() : undefined)
      : normalizeVmPolicy(input.vmPolicy);
    this.db.prepare(`
      INSERT INTO thread_runtime_metadata (
        owner_id, thread_id, provider_id, group_id, model, reasoning_effort,
        free_auto_compact_enabled, free_auto_compact_threshold, free_auto_compact_model, free_auto_compact_provider_id, free_auto_compact_group_id, compact_mode, jev_compress_threshold, permission,
        permission_schema_version, agents_json, cwd, additional_roots_json, workspace_file_path, cli_backend, fast_mode_enabled, plan_mode_enabled, vm_enabled, vm_policy_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(owner_id, thread_id) DO UPDATE SET
        provider_id = excluded.provider_id,
        group_id = excluded.group_id,
        model = excluded.model,
        reasoning_effort = excluded.reasoning_effort,
        free_auto_compact_enabled = excluded.free_auto_compact_enabled,
        free_auto_compact_threshold = excluded.free_auto_compact_threshold,
        free_auto_compact_model = excluded.free_auto_compact_model,
        free_auto_compact_provider_id = excluded.free_auto_compact_provider_id,
        free_auto_compact_group_id = excluded.free_auto_compact_group_id,
        compact_mode = excluded.compact_mode,
        jev_compress_threshold = excluded.jev_compress_threshold,
        permission = excluded.permission,
        permission_schema_version = excluded.permission_schema_version,
        agents_json = excluded.agents_json,
        cwd = excluded.cwd,
        additional_roots_json = excluded.additional_roots_json,
        workspace_file_path = excluded.workspace_file_path,
        cli_backend = excluded.cli_backend,
        fast_mode_enabled = excluded.fast_mode_enabled,
        plan_mode_enabled = excluded.plan_mode_enabled,
        vm_enabled = excluded.vm_enabled,
        vm_policy_json = excluded.vm_policy_json,
        updated_at = excluded.updated_at
    `).run(
      ownerId,
      input.threadId,
      providerId,
      groupId,
      model,
      reasoningEffort,
      freeAutoCompactEnabledOut ? 1 : 0,
      freeAutoCompactThreshold,
      freeAutoCompactModel,
      freeAutoCompactProviderId,
      freeAutoCompactGroupId,
      compactMode,
      jevCompressThreshold,
      input.permission,
      JSON.stringify(input.agents ?? defaultAgentRuntimeOverride()),
      cwd,
      JSON.stringify(additionalRoots),
      workspaceFilePath,
      input.cliBackend ?? existing?.cliBackend ?? "codex",
      fastModeEnabled ? 1 : 0,
      planModeEnabled ? 1 : 0,
      vmEnabled ? 1 : 0,
      vmPolicy ? JSON.stringify(vmPolicy) : null,
      now,
      now
    );
    return this.get(ownerId, input.threadId)!;
  }

  public updateWorkspace(ownerId: string, input: ThreadWorkspaceMetadataInput): ThreadRuntimeMetadata | null {
    const existing = this.get(ownerId, input.threadId);
    if (!existing) return null;
    const cwd = input.cwd === undefined ? existing.cwd ?? null : normalizeCwd(input.cwd);
    const additionalRoots = input.additionalRoots === undefined
      ? existing.additionalRoots ?? []
      : normalizeAdditionalRoots(input.additionalRoots);
    const workspaceFilePath = input.workspaceFilePath === undefined
      ? existing.workspaceFilePath ?? null
      : normalizeCwd(input.workspaceFilePath);
    this.db.prepare(`
      UPDATE thread_runtime_metadata
      SET cwd = ?, additional_roots_json = ?, workspace_file_path = ?, updated_at = ?
      WHERE owner_id = ? AND thread_id = ?
    `).run(cwd, JSON.stringify(additionalRoots), workspaceFilePath, Date.now(), ownerId, input.threadId);
    return this.get(ownerId, input.threadId);
  }
}

function mapRow(row: ThreadRuntimeMetadataRow): ThreadRuntimeMetadata {
  const vmEnabled = row.vm_enabled === 1;
  const vmPolicy = parseVmPolicy(row.vm_policy_json) ?? (vmEnabled ? createDefaultSaVmPolicyConfig() : undefined);
  return {
    threadId: row.thread_id,
    providerId: row.provider_id,
    groupId: row.group_id,
    model: row.model,
    reasoningEffort: row.reasoning_effort,
    freeAutoCompactEnabled: row.free_auto_compact_enabled === 1,
    freeAutoCompactThreshold: normalizeFreeAutoCompactThreshold(row.free_auto_compact_threshold),
    freeAutoCompactModel: normalizeFreeAutoCompactModel(row.free_auto_compact_model),
    freeAutoCompactProviderId: normalizeFreeAutoCompactRoutePart(row.free_auto_compact_provider_id),
    freeAutoCompactGroupId: normalizeFreeAutoCompactRoutePart(row.free_auto_compact_group_id),
    compactMode: normalizeCompactMode(row.compact_mode ?? (row.free_auto_compact_enabled === 1 ? "cheap" : "off")),
    jevCompressThreshold: normalizeJevCompressThreshold(row.jev_compress_threshold),
    // The permission column existed briefly without provenance. Treat those rows
    // as legacy so opening an old conversation cannot inherit an accidental
    // workspaceAsk default. The first restore writes the effective permission
    // back using the current schema version.
    permission: row.permission_schema_version >= 1 ? permissionPresetId(row.permission) : undefined,
    agents: parsePersistedAgentRuntimeOverride(row.agents_json),
    cwd: normalizeCwd(row.cwd) ?? undefined,
    additionalRoots: parseAdditionalRoots(row.additional_roots_json),
    workspaceFilePath: normalizeCwd(row.workspace_file_path) ?? undefined,
    cliBackend: row.cli_backend === "claude" ? "claude" : row.cli_backend === "agy" ? "agy" : row.cli_backend === "auggie" ? "auggie" : row.cli_backend === "grok" ? "grok" : row.cli_backend === "pi" ? "pi" : row.cli_backend === "opencode" ? "opencode" : row.cli_backend === "opencode-v2" ? "opencode-v2" : row.cli_backend === "mini" ? "mini" : row.cli_backend === "muse" ? "muse" : "codex",
    fastModeEnabled: row.fast_mode_enabled === 1,
    planModeEnabled: row.plan_mode_enabled === 1,
    enhanceEnabled: hasEnhanceToolsEnabled(vmPolicy?.tools),
    vmEnabled,
    vmPolicy,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function normalizeFreeAutoCompactThreshold(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return 80;
  return Math.min(95, Math.max(50, Math.round(numeric)));
}

function normalizeCompactMode(value: unknown): CompactMode {
  return value === "cheap" || value === "jev-sub" || value === "jev-token" ? value : "off";
}

function normalizeJevCompressThreshold(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return 85;
  return Math.min(95, Math.max(50, Math.round(numeric)));
}

function normalizeFreeAutoCompactModel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 512 ? trimmed : null;
}

function normalizeFreeAutoCompactRoutePart(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 512 ? trimmed : null;
}

function normalizeCwd(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 4096) return null;
  const isWindowsDrivePath = /^[A-Za-z]:[\\/]/.test(trimmed);
  const isUncPath = /^(?:\\\\|\/\/)/.test(trimmed);
  if (!isWindowsDrivePath && !isUncPath) return trimmed.length > 1 ? trimmed.replace(/\/+$/, "") : trimmed;
  const normalized = trimmed.replace(/\\/g, "/").replace(/^([A-Z]):/i, (_, drive: string) => `${drive.toLowerCase()}:`);
  if (/^[a-z]:\/$/.test(normalized)) return normalized;
  return normalized.replace(/\/+$/, "");
}

function normalizeAdditionalRoots(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const roots: string[] = [];
  for (const entry of value) {
    const normalized = normalizeCwd(entry);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (roots.some((root) => root.toLowerCase() === key)) continue;
    roots.push(normalized);
    if (roots.length >= 128) break;
  }
  return roots;
}

function parseAdditionalRoots(value: string | null): string[] {
  if (!value) return [];
  try {
    return normalizeAdditionalRoots(JSON.parse(value));
  } catch {
    return [];
  }
}

function normalizeVmPolicy(value: unknown): SaVmPolicyConfig | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  const fs = input.fs && typeof input.fs === "object" && !Array.isArray(input.fs) ? input.fs as Record<string, unknown> : undefined;
  const http = input.http && typeof input.http === "object" && !Array.isArray(input.http) ? input.http as Record<string, unknown> : undefined;
  const env = input.env && typeof input.env === "object" && !Array.isArray(input.env) ? input.env as Record<string, unknown> : undefined;
  const process = input.process && typeof input.process === "object" && !Array.isArray(input.process) ? input.process as Record<string, unknown> : undefined;
  const paths = (value: unknown) => Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0 && entry.length <= 4096).slice(0, 128).map((entry) => entry.trim())
    : undefined;
  const policy: SaVmPolicyConfig = {
    ...(fs ? {
      fs: {
        ...(Array.isArray(fs.entries) ? {
          entries: fs.entries.slice(0, 128).flatMap((entry) => {
            if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
            const record = entry as Record<string, unknown>;
            if (typeof record.path !== "string" || !record.path.trim()) return [];
            if (record.access !== "read" && record.access !== "write" && record.access !== "deny") return [];
            return [{ path: record.path.trim().slice(0, 4096), access: record.access }];
          })
        } : {}),
        ...(paths(fs.read) ? { read: paths(fs.read) } : {}),
        ...(paths(fs.write) ? { write: paths(fs.write) } : {}),
        ...(paths(fs.transfer) ? { transfer: paths(fs.transfer) } : {}),
        ...(fs.delete === "deny" || fs.delete === "rename" || fs.delete === "move" ? { delete: fs.delete } : {}),
        ...(fs.backupDir === null || typeof fs.backupDir === "string" ? { backupDir: fs.backupDir === null ? null : fs.backupDir.trim().slice(0, 4096) } : {})
      }
    } : {}),
    ...(http ? {
      http: {
        ...(Array.isArray(http.allow) ? {
          allow: http.allow.slice(0, 128).flatMap((entry) => {
            if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
            const record = entry as Record<string, unknown>;
            if (typeof record.host !== "string" || !record.host.trim()) return [];
            return [{
              host: record.host.trim().toLowerCase().slice(0, 255),
              ...(paths(record.methods) ? { methods: paths(record.methods)!.map((method) => method.toUpperCase()).slice(0, 16) } : {}),
              ...(paths(record.paths) ? { paths: paths(record.paths)!.slice(0, 64) } : {})
            }];
          })
        } : {})
      }
    } : {}),
    ...(env ? { env: { ...(paths(env.allow) ? { allow: paths(env.allow)!.slice(0, 64) } : {}) } } : {}),
    ...(process ? {
      process: {
        ...(typeof process.spawn === "boolean" ? { spawn: process.spawn } : {}),
        ...(Array.isArray(process.exec) ? {
          exec: process.exec.slice(0, 64).flatMap((entry) => {
            if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
            const record = entry as Record<string, unknown>;
            if (typeof record.path !== "string" || !record.path.trim()) return [];
            return [{ path: record.path.trim().slice(0, 4096), ...(paths(record.args) ? { args: paths(record.args)!.slice(0, 64) } : {}) }];
          })
        } : {}),
        ...(Array.isArray(process.bunProfiles) ? { bunProfiles: paths(process.bunProfiles) as SaVmBunProfile[] } : {}),
        ...(typeof process.bun === "boolean"
          ? { bun: process.bun }
          : process.bun && typeof process.bun === "object" && !Array.isArray(process.bun)
            ? {
                bun: {
                  enabled: (process.bun as Record<string, unknown>).enabled !== false,
                  allowedSubcommands: Array.isArray((process.bun as Record<string, unknown>).allowedSubcommands)
                    ? ((process.bun as Record<string, unknown>).allowedSubcommands as unknown[]).filter(
                        (sc): sc is SaVmBunSubcommand => typeof sc === "string" && ALL_SA_VM_BUN_SUBCOMMANDS.includes(sc as SaVmBunSubcommand)
                      )
                    : undefined
                }
              }
            : {})
      }
    } : {}),
    ...(input.engine === "native" || input.engine === "vm" ? { engine: input.engine } : {}),
    ...(input.execution && typeof input.execution === "object" && !Array.isArray(input.execution) ? {
      execution: {
        ...(typeof (input.execution as Record<string, unknown>).javascript === "boolean" ? { javascript: (input.execution as Record<string, unknown>).javascript as boolean } : {}),
        ...(typeof (input.execution as Record<string, unknown>).python === "boolean" ? { python: (input.execution as Record<string, unknown>).python as boolean } : {})
      }
    } : {}),
    ...(input.tools && typeof input.tools === "object" && !Array.isArray(input.tools) ? {
      tools: {
        ...(typeof (input.tools as Record<string, unknown>).replaceRead === "boolean" ? { replaceRead: (input.tools as Record<string, unknown>).replaceRead as boolean } : {}),
        ...(typeof (input.tools as Record<string, unknown>).replaceWrite === "boolean" ? { replaceWrite: (input.tools as Record<string, unknown>).replaceWrite as boolean } : {}),
        ...(typeof (input.tools as Record<string, unknown>).replaceApplyPatch === "boolean" ? { replaceApplyPatch: (input.tools as Record<string, unknown>).replaceApplyPatch as boolean } : {}),
        ...(typeof (input.tools as Record<string, unknown>).replaceExec === "boolean" ? { replaceExec: (input.tools as Record<string, unknown>).replaceExec as boolean } : {}),
        ...(typeof (input.tools as Record<string, unknown>).readFiles === "boolean" ? { readFiles: (input.tools as Record<string, unknown>).readFiles as boolean } : {}),
        ...(typeof (input.tools as Record<string, unknown>).editFiles === "boolean" ? { editFiles: (input.tools as Record<string, unknown>).editFiles as boolean } : {}),
        ...(typeof (input.tools as Record<string, unknown>).applyPatch === "boolean" ? { applyPatch: (input.tools as Record<string, unknown>).applyPatch as boolean } : {}),
        ...(typeof (input.tools as Record<string, unknown>).fastSearch === "boolean" ? { fastSearch: (input.tools as Record<string, unknown>).fastSearch as boolean } : {}),
        ...(typeof (input.tools as Record<string, unknown>).clearToolHistory === "boolean" ? { clearToolHistory: (input.tools as Record<string, unknown>).clearToolHistory as boolean } : {}),
        ...(typeof (input.tools as Record<string, unknown>).findReferences === "boolean" ? { findReferences: (input.tools as Record<string, unknown>).findReferences as boolean } : {}),
        ...(typeof (input.tools as Record<string, unknown>).fileOutline === "boolean" ? { fileOutline: (input.tools as Record<string, unknown>).fileOutline as boolean } : {}),
        ...(typeof (input.tools as Record<string, unknown>).codeGraph === "boolean" ? { codeGraph: (input.tools as Record<string, unknown>).codeGraph as boolean } : {}),
        ...(typeof (input.tools as Record<string, unknown>).findDefinition === "boolean" ? { findDefinition: (input.tools as Record<string, unknown>).findDefinition as boolean } : {}),
        ...(typeof (input.tools as Record<string, unknown>).renameSymbol === "boolean" ? { renameSymbol: (input.tools as Record<string, unknown>).renameSymbol as boolean } : {}),
        ...(typeof (input.tools as Record<string, unknown>).moveWithImports === "boolean" ? { moveWithImports: (input.tools as Record<string, unknown>).moveWithImports as boolean } : {}),
        ...(typeof (input.tools as Record<string, unknown>).extractToFile === "boolean" ? { extractToFile: (input.tools as Record<string, unknown>).extractToFile as boolean } : {}),
        ...(typeof (input.tools as Record<string, unknown>).organizeImports === "boolean" ? { organizeImports: (input.tools as Record<string, unknown>).organizeImports as boolean } : {}),
        ...(typeof (input.tools as Record<string, unknown>).analyzeScope === "boolean" ? { analyzeScope: (input.tools as Record<string, unknown>).analyzeScope as boolean } : {}),
        ...(typeof (input.tools as Record<string, unknown>).addImport === "boolean" ? { addImport: (input.tools as Record<string, unknown>).addImport as boolean } : {}),
        ...(typeof (input.tools as Record<string, unknown>).getDiagnostics === "boolean" ? { getDiagnostics: (input.tools as Record<string, unknown>).getDiagnostics as boolean } : {})
      }
    } : {}),
    ...(input.accountability && typeof input.accountability === "object" && !Array.isArray(input.accountability) ? {
      accountability: {
        ...(typeof (input.accountability as Record<string, unknown>).enabled === "boolean" ? { enabled: (input.accountability as Record<string, unknown>).enabled as boolean } : {}),
        ...(typeof (input.accountability as Record<string, unknown>).ledgerPath === "string" && ((input.accountability as Record<string, unknown>).ledgerPath as string).trim() ? { ledgerPath: ((input.accountability as Record<string, unknown>).ledgerPath as string).trim().slice(0, 4096) } : {}),
        ...(typeof (input.accountability as Record<string, unknown>).autoPenalize === "boolean" ? { autoPenalize: (input.accountability as Record<string, unknown>).autoPenalize as boolean } : {}),
        ...(typeof (input.accountability as Record<string, unknown>).reputationThresholdRed === "number" && Number.isFinite((input.accountability as Record<string, unknown>).reputationThresholdRed) ? { reputationThresholdRed: (input.accountability as Record<string, unknown>).reputationThresholdRed as number } : {}),
        ...(typeof (input.accountability as Record<string, unknown>).reputationThresholdYellow === "number" && Number.isFinite((input.accountability as Record<string, unknown>).reputationThresholdYellow) ? { reputationThresholdYellow: (input.accountability as Record<string, unknown>).reputationThresholdYellow as number } : {}),
        ...(typeof (input.accountability as Record<string, unknown>).manualOverride === "boolean" ? { manualOverride: (input.accountability as Record<string, unknown>).manualOverride as boolean } : {})
      }
    } : {}),
    ...(input.contextSavings && typeof input.contextSavings === "object" && !Array.isArray(input.contextSavings) ? {
      contextSavings: {
        ...(typeof (input.contextSavings as Record<string, unknown>).locateBeforeRead === "boolean" ? { locateBeforeRead: (input.contextSavings as Record<string, unknown>).locateBeforeRead as boolean } : {}),
        ...(typeof (input.contextSavings as Record<string, unknown>).maxReadFileBytes === "number" ? { maxReadFileBytes: (input.contextSavings as Record<string, unknown>).maxReadFileBytes as number } : {}),
        ...(typeof (input.contextSavings as Record<string, unknown>).grepCircuitBreaker === "boolean" ? { grepCircuitBreaker: (input.contextSavings as Record<string, unknown>).grepCircuitBreaker as boolean } : {}),
        ...(typeof (input.contextSavings as Record<string, unknown>).grepMaxResults === "number" ? { grepMaxResults: (input.contextSavings as Record<string, unknown>).grepMaxResults as number } : {}),
        ...(typeof (input.contextSavings as Record<string, unknown>).grepMaxTokens === "number" ? { grepMaxTokens: (input.contextSavings as Record<string, unknown>).grepMaxTokens as number } : {}),
        ...(typeof (input.contextSavings as Record<string, unknown>).slimRunnerOutput === "boolean" ? { slimRunnerOutput: (input.contextSavings as Record<string, unknown>).slimRunnerOutput as boolean } : {}),
        ...(typeof (input.contextSavings as Record<string, unknown>).parallelBudget === "boolean" ? { parallelBudget: (input.contextSavings as Record<string, unknown>).parallelBudget as boolean } : {}),
        ...(typeof (input.contextSavings as Record<string, unknown>).parallelMaxTotalBytes === "number" ? { parallelMaxTotalBytes: (input.contextSavings as Record<string, unknown>).parallelMaxTotalBytes as number } : {}),
        ...(typeof (input.contextSavings as Record<string, unknown>).parallelMaxReadFiles === "number" ? { parallelMaxReadFiles: (input.contextSavings as Record<string, unknown>).parallelMaxReadFiles as number } : {}),
        ...(typeof (input.contextSavings as Record<string, unknown>).parallelDeduplication === "boolean" ? { parallelDeduplication: (input.contextSavings as Record<string, unknown>).parallelDeduplication as boolean } : {}),
        ...(typeof (input.contextSavings as Record<string, unknown>).tieredSkillInjection === "boolean" ? { tieredSkillInjection: (input.contextSavings as Record<string, unknown>).tieredSkillInjection as boolean } : {}),
        ...(typeof (input.contextSavings as Record<string, unknown>).foldWaterfallEvents === "boolean" ? { foldWaterfallEvents: (input.contextSavings as Record<string, unknown>).foldWaterfallEvents as boolean } : {}),
        ...(typeof (input.contextSavings as Record<string, unknown>).foldHistoryReadSummaries === "boolean" ? { foldHistoryReadSummaries: (input.contextSavings as Record<string, unknown>).foldHistoryReadSummaries as boolean } : {}),
        ...(typeof (input.contextSavings as Record<string, unknown>).historyReadFoldTurns === "number" ? { historyReadFoldTurns: (input.contextSavings as Record<string, unknown>).historyReadFoldTurns as number } : {})
      }
    } : {})
  };
  return Object.keys(policy).length > 0 ? policy : undefined;
}

function parseVmPolicy(value: string | null): SaVmPolicyConfig | undefined {
  if (!value) return undefined;
  try { return normalizeVmPolicy(JSON.parse(value)); } catch { return undefined; }
}

function defaultAgentRuntimeOverride(): AgentRuntimeOverride {
  return { mode: "inherit", childCount: null, model: "", reasoningEffort: "", roles: [] };
}

function parsePersistedAgentRuntimeOverride(value: string | null): AgentRuntimeOverride {
  if (!value) return defaultAgentRuntimeOverride();
  try {
    return parseAgentRuntimeOverride(JSON.parse(value));
  } catch {
    return defaultAgentRuntimeOverride();
  }
}

function permissionPresetId(value: unknown): PermissionPresetId | undefined {
  return value === "readonlyAsk" || value === "workspaceAsk" || value === "fullAsk" || value === "dangerBypass"
    ? value
    : undefined;
}

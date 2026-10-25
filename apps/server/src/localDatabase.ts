import { mkdirSync } from "node:fs";
import { chmod } from "node:fs/promises";
import { join } from "node:path";
import { openRuntimeDatabase, type RuntimeDatabase } from "./runtime/database.js";
import { codexUiDataDir } from "@cxu/sdk-backend";
export { codexUiDataDir };


export class LocalDatabase {
  public readonly dir = codexUiDataDir();
  public readonly file = join(this.dir, "codex-ui.sqlite3");
  private readonly db: RuntimeDatabase;

  public constructor() {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    this.db = openRuntimeDatabase(this.file);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec("PRAGMA busy_timeout = 5000");
    this.migrate();
    void chmod(this.file, 0o600).catch(() => undefined);
  }

  public get connection(): RuntimeDatabase {
    return this.db;
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS providers (
        id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS relay_groups (
        provider_id TEXT NOT NULL,
        group_id TEXT NOT NULL,
        name TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'text',
        status TEXT,
        group_ratio REAL NOT NULL DEFAULT 1,
        quota_usd REAL,
        used_quota_usd REAL,
        priority INTEGER,
        weight INTEGER,
        key_mode TEXT,
        response_protocol TEXT,
        response_protocol_mode TEXT,
        claude_code_headers_enabled INTEGER NOT NULL DEFAULT 0,
        claude_code_version TEXT,
        endpoint_path_override TEXT,
        auth_type TEXT,
        credential_mode TEXT,
        catalog_group_name TEXT,
        catalog_managed INTEGER,
        keys_json TEXT NOT NULL DEFAULT '[]',
        models_json TEXT NOT NULL DEFAULT '[]',
        model_capabilities_json TEXT NOT NULL DEFAULT '{}',
        supported_endpoint_types_json TEXT NOT NULL DEFAULT '[]',
        model_mapping_json TEXT NOT NULL DEFAULT '[]',
        status_code_mapping_json TEXT NOT NULL DEFAULT '[]',
        advanced_model_mapping_json TEXT NOT NULL DEFAULT '[]',
        tag TEXT,
        remark TEXT,
        auto_ban INTEGER,
        request_limit INTEGER,
        request_interval_seconds INTEGER,
        context_window INTEGER,
        command_blacklist_enabled INTEGER NOT NULL DEFAULT 1,
        command_blacklist_json TEXT NOT NULL DEFAULT '[]',
        network_allowlist_json TEXT NOT NULL DEFAULT '[]',
        enable_fallback INTEGER,
        fallback_channel_id TEXT,
        fallback_group_name TEXT,
        enable_tiered_context INTEGER,
        tiered_context_ratios_json TEXT NOT NULL DEFAULT '[]',
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (provider_id, group_id),
        FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_relay_groups_provider_sort
        ON relay_groups(provider_id, sort_order, priority);

      CREATE TABLE IF NOT EXISTS relay_catalogs (
        provider_id TEXT PRIMARY KEY,
        success INTEGER NOT NULL,
        imported_at INTEGER NOT NULL,
        source_hash TEXT NOT NULL,
        warnings_json TEXT NOT NULL DEFAULT '[]',
        FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS relay_catalog_groups (
        provider_id TEXT NOT NULL,
        group_name TEXT NOT NULL,
        usable_group TEXT NOT NULL,
        group_ratio REAL NOT NULL DEFAULT 1,
        response_protocol TEXT,
        response_protocol_mode TEXT,
        PRIMARY KEY (provider_id, group_name),
        FOREIGN KEY (provider_id) REFERENCES relay_catalogs(provider_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS relay_catalog_models (
        provider_id TEXT NOT NULL,
        model_name TEXT NOT NULL,
        icon TEXT,
        vendor_id INTEGER,
        quota_type INTEGER NOT NULL DEFAULT 0,
        model_ratio REAL,
        model_price REAL,
        completion_ratio REAL,
        cache_ratio REAL,
        create_cache_ratio REAL,
        owner_by TEXT,
        extensions_json TEXT NOT NULL DEFAULT '{}',
        PRIMARY KEY (provider_id, model_name),
        FOREIGN KEY (provider_id) REFERENCES relay_catalogs(provider_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS relay_model_enable_groups (
        provider_id TEXT NOT NULL,
        model_name TEXT NOT NULL,
        group_name TEXT NOT NULL,
        PRIMARY KEY (provider_id, model_name, group_name),
        FOREIGN KEY (provider_id, model_name) REFERENCES relay_catalog_models(provider_id, model_name) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS relay_model_supported_endpoint_types (
        provider_id TEXT NOT NULL,
        model_name TEXT NOT NULL,
        endpoint_type TEXT NOT NULL,
        PRIMARY KEY (provider_id, model_name, endpoint_type),
        FOREIGN KEY (provider_id, model_name) REFERENCES relay_catalog_models(provider_id, model_name) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS relay_supported_endpoints (
        provider_id TEXT NOT NULL,
        endpoint_type TEXT NOT NULL,
        path TEXT NOT NULL,
        method TEXT NOT NULL,
        canonical_endpoint_type TEXT NOT NULL,
        aliases_json TEXT NOT NULL DEFAULT '[]',
        extensions_json TEXT NOT NULL DEFAULT '{}',
        PRIMARY KEY (provider_id, endpoint_type),
        FOREIGN KEY (provider_id) REFERENCES relay_catalogs(provider_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS relay_vendors (
        provider_id TEXT NOT NULL,
        vendor_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        icon TEXT,
        extensions_json TEXT NOT NULL DEFAULT '{}',
        PRIMARY KEY (provider_id, vendor_id),
        FOREIGN KEY (provider_id) REFERENCES relay_catalogs(provider_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS relay_auto_groups (
        provider_id TEXT NOT NULL,
        group_name TEXT NOT NULL,
        PRIMARY KEY (provider_id, group_name),
        FOREIGN KEY (provider_id) REFERENCES relay_catalogs(provider_id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_relay_catalog_models_vendor
        ON relay_catalog_models(provider_id, vendor_id, quota_type);

      CREATE INDEX IF NOT EXISTS idx_relay_model_groups_group
        ON relay_model_enable_groups(provider_id, group_name, model_name);

      CREATE INDEX IF NOT EXISTS idx_relay_model_endpoints_type
        ON relay_model_supported_endpoint_types(provider_id, endpoint_type, model_name);

      CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        method TEXT NOT NULL,
        severity TEXT NOT NULL,
        payload TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS user_preferences (
        owner_id TEXT PRIMARY KEY,
        payload TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS thread_runtime_metadata (
        owner_id TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        provider_id TEXT,
        group_id TEXT,
        model TEXT NOT NULL DEFAULT '',
        reasoning_effort TEXT NOT NULL DEFAULT '',
        permission TEXT,
        permission_schema_version INTEGER NOT NULL DEFAULT 0,
        agents_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (owner_id, thread_id)
      );

      CREATE INDEX IF NOT EXISTS idx_thread_runtime_metadata_owner_updated
        ON thread_runtime_metadata(owner_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS image_history (
        owner_id TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        turn_id TEXT NOT NULL,
        request_id TEXT NOT NULL,
        status TEXT NOT NULL,
        items_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (owner_id, thread_id, request_id)
      );

      CREATE INDEX IF NOT EXISTS idx_image_history_thread
        ON image_history(owner_id, thread_id, created_at);
    `);
    const relayGroupColumns: Array<[string, string]> = [
      ["response_protocol", "TEXT"],
      ["response_protocol_mode", "TEXT"],
      ["claude_code_headers_enabled", "INTEGER NOT NULL DEFAULT 0"],
      ["claude_code_version", "TEXT"],
      ["endpoint_path_override", "TEXT"],
      ["auth_type", "TEXT"],
      ["credential_mode", "TEXT"],
      ["catalog_group_name", "TEXT"],
      ["catalog_managed", "INTEGER"],
      ["supported_endpoint_types_json", "TEXT NOT NULL DEFAULT '[]'"],
      ["model_capabilities_json", "TEXT NOT NULL DEFAULT '{}'"],
      ["image_json", "TEXT"],
      ["context_window", "INTEGER"],
      ["command_blacklist_enabled", "INTEGER NOT NULL DEFAULT 1"],
      ["command_blacklist_json", "TEXT NOT NULL DEFAULT '[]'"],
      ["network_allowlist_json", "TEXT NOT NULL DEFAULT '[]'"]
    ];
    for (const [column, type] of relayGroupColumns) {
      try {
        this.db.prepare(`ALTER TABLE relay_groups ADD COLUMN ${column} ${type}`).run();
      } catch {
        // Column already exists.
      }
    }
    try {
      this.db.prepare("ALTER TABLE thread_runtime_metadata ADD COLUMN permission TEXT").run();
    } catch {
      // Column already exists.
    }
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
  }
}

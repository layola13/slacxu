import type { RuntimeDatabase } from "./runtime/database.js";
import type { JsonValue } from "@codex-ui/shared";
import { LocalDatabase } from "./localDatabase.js";

const MAX_PREFERENCES_BYTES = 512 * 1024;

type PreferenceRecord = Record<string, JsonValue>;

export class UserPreferencesStore {
  private readonly db: RuntimeDatabase;

  public constructor(database: Pick<LocalDatabase, "connection"> = new LocalDatabase()) {
    this.db = database.connection;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS user_preferences (
        owner_id TEXT PRIMARY KEY,
        payload TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
  }

  public get(ownerId: string): PreferenceRecord {
    const row = this.db.prepare("SELECT payload FROM user_preferences WHERE owner_id = ? LIMIT 1").get(ownerId) as { payload?: string } | undefined;
    return parsePreferences(row?.payload);
  }

  public patch(ownerId: string, patch: PreferenceRecord): PreferenceRecord {
    const next = { ...this.get(ownerId), ...patch };
    const payload = JSON.stringify(next);
    if (Buffer.byteLength(payload, "utf8") > MAX_PREFERENCES_BYTES) {
      throw new Error(`Preferences exceed ${MAX_PREFERENCES_BYTES / 1024} KB`);
    }
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO user_preferences (owner_id, payload, created_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(owner_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at
    `).run(ownerId, payload, now, now);
    return next;
  }
}

function parsePreferences(payload: string | undefined): PreferenceRecord {
  if (!payload) {
    return {};
  }
  try {
    const parsed = JSON.parse(payload) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as PreferenceRecord : {};
  } catch {
    return {};
  }
}

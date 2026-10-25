export const STORAGE_PREFIX = "codex-ultra.";
export const LEGACY_STORAGE_PREFIX = "codex-react-ui.";

export function migrateLegacyBrowserStorage(storage: Storage = window.localStorage): void {
  try {
    const legacyEntries: Array<[string, string]> = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (!key?.startsWith(LEGACY_STORAGE_PREFIX)) continue;
      const value = storage.getItem(key);
      if (value != null) legacyEntries.push([key, value]);
    }
    for (const [legacyKey, value] of legacyEntries) {
      const nextKey = `${STORAGE_PREFIX}${legacyKey.slice(LEGACY_STORAGE_PREFIX.length)}`;
      if (storage.getItem(nextKey) == null) storage.setItem(nextKey, value);
    }
  } catch {
    // Storage can be unavailable in hardened browser contexts.
  }
}

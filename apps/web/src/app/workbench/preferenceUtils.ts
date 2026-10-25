import { DEFAULT_RUNTIME_SELECTION } from "../../app/runtime/useThreadRuntimeSelections";
import { HistoryDateRangeFilter, HistoryViewMode } from "../../history/HistorySidebar";
import { RightWorkspaceTab } from "../../components/RightWorkspacePanel";
import { WaterfallDisplayMode } from "../../waterfall/chatRows";
import { Locale, localeOptions } from "../../i18n";
import { ThemeId, ThemeMode, ThemePlugin, installedThemePluginDefaults, isThemeId } from "../../theme";
import { normalizeWorkspaceCwd, normalizeWorkspaceRoots } from "../../workspacePaths";
import { DEFAULT_SSH_WORKSPACE_COMMAND, DEFAULT_SSH_WORKSPACE_CWD, UI_STORAGE_KEYS } from "./appConstants";
import type { WorkspaceMode } from "./appConstants";
import { isSshWorkspaceCommand, normalizeSshWorkspaceCwd } from "./sshUtils";
import { PermissionPresetId } from "@codex-ui/shared";

export function parseNewChatPermission(value: string): PermissionPresetId | undefined {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (["read", "readonly", "read-only", "safe"].includes(normalized)) {
    return "readonlyAsk";
  }
  if (["workspace", "default", "ask"].includes(normalized)) {
    return "workspaceAsk";
  }
  if (["full", "full-access", "fullask"].includes(normalized)) {
    return "fullAsk";
  }
  if (["danger", "bypass", "full-auto", "danger-bypass"].includes(normalized)) {
    return "dangerBypass";
  }
  return undefined;
}

export function readHistoryDateRange(): HistoryDateRangeFilter {
  try {
    return parseHistoryDateRange(JSON.parse(localStorage.getItem(UI_STORAGE_KEYS.historyDateRange) ?? "{}")) ?? { from: "", to: "" };
  } catch {
    return { from: "", to: "" };
  }
}

export function parseHistoryDateRange(value: unknown): HistoryDateRangeFilter | null {
  const record = preferenceRecord(value);
  if (!record) return null;
  return {
    from: typeof record.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(record.from) ? record.from : "",
    to: typeof record.to === "string" && /^\d{4}-\d{2}-\d{2}$/.test(record.to) ? record.to : ""
  };
}

export function readStoredBoolean(key: string, fallback: boolean): boolean {
  const raw = localStorage.getItem(key);
  if (raw == null) {
    return fallback;
  }
  try {
    return Boolean(JSON.parse(raw));
  } catch {
    return fallback;
  }
}

export function readWaterfallDisplayMode(): WaterfallDisplayMode {
  const value = window.localStorage.getItem(UI_STORAGE_KEYS.waterfallDisplayMode);
  return value === "full" || value === "post-compaction" || value === "recent-tools" ? value : "recent-tools";
}

export function readStoredString(key: string, fallback: string): string {
  const raw = localStorage.getItem(key);
  return raw == null ? fallback : raw;
}

export function parseWorkspacePreference(value: unknown): { mode: WorkspaceMode; cwd: string; sshCommand: string; sshCwd: string; additionalRoots: string[] } | null {
  const record = preferenceRecord(value);
  if (!record) return null;
  const mode: WorkspaceMode = record.mode === "ssh" ? "ssh" : "local";
  const cwd = mode === "ssh" ? normalizeSshWorkspaceCwd(String(record.cwd ?? "")) : normalizeWorkspaceCwd(String(record.cwd ?? ""));
  const sshCommand = typeof record.sshCommand === "string" && isSshWorkspaceCommand(record.sshCommand)
    ? record.sshCommand.trim()
    : DEFAULT_SSH_WORKSPACE_COMMAND;
  const sshCwd = normalizeSshWorkspaceCwd(typeof record.sshCwd === "string" ? record.sshCwd : "") || DEFAULT_SSH_WORKSPACE_CWD;
  if (!cwd) return null;
  const additionalRoots = Array.isArray(record.additionalRoots) ? normalizeWorkspaceRoots(cwd, record.additionalRoots.filter((entry: unknown): entry is string => typeof entry === "string")) : [];
  return { mode, cwd, sshCommand, sshCwd, additionalRoots };
}

export function parsePanelLayoutPreference(value: unknown): Record<string, number> | null {
  const record = preferenceRecord(value);
  if (!record) return null;
  const entries = Object.entries(record).filter((entry: [string, unknown]): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1]));
  return entries.length > 0 ? Object.fromEntries(entries) : null;
}

export function historyViewModeValue(value: unknown): HistoryViewMode | null {
  return value === "auto" || value === "large" || value === "list" || value === "details" ? value : null;
}

export function readLegacyHistoryViewMode(): HistoryViewMode {
  return historyViewModeValue(localStorage.getItem("codex-ultra.history-view")) ?? "auto";
}

export function localeValue(value: unknown): Locale | null {
  return typeof value === "string" && localeOptions.some((option: (typeof localeOptions)[number]) => option.value === value) ? value as Locale : null;
}

export function rightWorkspaceTabValue(value: unknown): RightWorkspaceTab | null {
  return value === "sidechat" || value === "explorer" || value === "git" || value === "browser" || value === "terminal" ? value : null;
}

export function themeModeValue(value: unknown, customThemes: ThemePlugin[]): ThemeMode | null {
  if (value === "system") return "system";
  return typeof value === "string" && isThemeId(value, customThemes) ? value : null;
}

export function installedThemeIdsPreference(value: unknown, customThemes: ThemePlugin[]): ThemeId[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((entry: unknown): entry is ThemeId => typeof entry === "string" && isThemeId(entry, customThemes));
}

export function parseCustomThemePluginsPreference(value: unknown): ThemePlugin[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((entry: unknown): entry is ThemePlugin => {
    const plugin = preferenceRecord(entry);
    const preview = preferenceRecord(plugin?.preview);
    return Boolean(
      plugin &&
      typeof plugin.id === "string" &&
      typeof plugin.name === "string" &&
      typeof plugin.description === "string" &&
      plugin.source === "user-defined" &&
      preview &&
      typeof preview.primary === "string" &&
      typeof preview.secondary === "string" &&
      typeof preview.background === "string"
    );
  }) as ThemePlugin[];
}

export function preferenceRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function clearLegacyPreferenceStorage(): void {
  const currentKeys = [
    ...Object.values(UI_STORAGE_KEYS),
    "codex-ultra.theme-mode",
    "codex-ultra.custom-theme-plugins",
    "codex-ultra.locale",
    "codex-ultra.history-view"
  ];
  for (const key of [
    ...currentKeys,
    ...currentKeys.map((key: string) => key.replace(/^codex-ultra\./, "codex-react-ui."))
  ]) {
    localStorage.removeItem(key);
  }
  for (let index = localStorage.length - 1; index >= 0; index -= 1) {
    const key = localStorage.key(index);
    if (key?.startsWith("codex-ultra.providers-cache.") || key?.startsWith("codex-react-ui.providers-cache.")) {
      localStorage.removeItem(key);
    }
  }
}

export function permissionPresetValue(value: unknown): PermissionPresetId {
  return optionalPermissionPresetValue(value) ?? DEFAULT_RUNTIME_SELECTION.permission;
}

export function optionalPermissionPresetValue(value: unknown): PermissionPresetId | undefined {
  return value === "readonlyAsk" || value === "workspaceAsk" || value === "fullAsk" || value === "dangerBypass"
    ? value
    : undefined;
}

export function readInstalledThemes(): ThemeId[] {
  const defaults = installedThemePluginDefaults();
  const raw = localStorage.getItem(UI_STORAGE_KEYS.installedThemes);
  if (!raw) {
    return defaults;
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return defaults;
    }
    // Keep user-defined plugin ids even when they are not in the builtin catalog.
    const valid = parsed.filter((entry: unknown): entry is ThemeId => typeof entry === "string" && entry.length > 0);
    return [...defaults, ...valid.filter((entry: ThemeId) => !defaults.includes(entry))];
  } catch {
    return defaults;
  }
}

export function readPanelLayout(storageKey: string): Record<string, number> | undefined {
  const raw = localStorage.getItem(storageKey);
  if (!raw) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }
    const layout = Object.fromEntries(
      Object.entries(parsed).filter((entry: [string, unknown]): entry is [string, number] => typeof entry[0] === "string" && typeof entry[1] === "number")
    );
    return Object.keys(layout).length > 0 ? layout : undefined;
  } catch {
    return undefined;
  }
}

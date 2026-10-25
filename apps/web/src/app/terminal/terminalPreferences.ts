import { STORAGE_PREFIX } from "../../storageNamespace";

/**
 * VSCode-style terminal preferences, persisted per browser profile.
 * Shell profiles map to `terminal/create` argv overrides (server already
 * accepts `command: string[]`; default = server login shell).
 */

export type TerminalShellProfileId = "default" | "bash" | "sh" | "zsh" | "powershell" | "cmd";

export type TerminalShellProfile = {
  id: TerminalShellProfileId;
  label: string;
  /** argv override for terminal/create; null = server default login shell. */
  command: string[] | null;
};

export const TERMINAL_SHELL_PROFILES: TerminalShellProfile[] = [
  { id: "default", label: "Default login shell", command: null },
  { id: "bash", label: "bash", command: ["bash", "-l"] },
  { id: "sh", label: "sh", command: ["sh", "-l"] },
  { id: "zsh", label: "zsh", command: ["zsh", "-l"] },
  { id: "powershell", label: "PowerShell", command: ["powershell.exe", "-NoLogo", "-NoProfile"] },
  { id: "cmd", label: "Command Prompt", command: ["cmd.exe", "/K", "chcp 65001>nul"] }
];

export function resolveShellProfileCommand(id: TerminalShellProfileId): string[] | null {
  return TERMINAL_SHELL_PROFILES.find((profile) => profile.id === id)?.command ?? null;
}

export type TerminalPreferences = {
  fontSize: number;
  scrollback: number;
  shellProfile: TerminalShellProfileId;
};

export const TERMINAL_PREFS_DEFAULTS: TerminalPreferences = {
  fontSize: 12,
  scrollback: 5000,
  shellProfile: "default"
};

const PREFS_KEY = `${STORAGE_PREFIX}terminal.preferences`;
const NAMES_KEY = `${STORAGE_PREFIX}terminal.names`;

function safeStorage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function loadTerminalPreferences(storage?: Storage | null): TerminalPreferences {
  const store = storage ?? safeStorage();
  if (!store) return { ...TERMINAL_PREFS_DEFAULTS };
  try {
    const raw = store.getItem(PREFS_KEY);
    if (!raw) return { ...TERMINAL_PREFS_DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<TerminalPreferences>;
    const fontSize = typeof parsed.fontSize === "number" && parsed.fontSize >= 8 && parsed.fontSize <= 32
      ? Math.round(parsed.fontSize)
      : TERMINAL_PREFS_DEFAULTS.fontSize;
    const scrollback = typeof parsed.scrollback === "number" && parsed.scrollback >= 100 && parsed.scrollback <= 100000
      ? Math.round(parsed.scrollback)
      : TERMINAL_PREFS_DEFAULTS.scrollback;
    const shellProfile = TERMINAL_SHELL_PROFILES.some((profile) => profile.id === parsed.shellProfile)
      ? (parsed.shellProfile as TerminalShellProfileId)
      : TERMINAL_PREFS_DEFAULTS.shellProfile;
    return { fontSize, scrollback, shellProfile };
  } catch {
    return { ...TERMINAL_PREFS_DEFAULTS };
  }
}

export function saveTerminalPreferences(prefs: TerminalPreferences, storage?: Storage | null): void {
  const store = storage ?? safeStorage();
  if (!store) return;
  try {
    store.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Hardened contexts: preferences stay in memory only.
  }
}

export function loadTerminalNames(storage?: Storage | null): Record<string, string> {
  const store = storage ?? safeStorage();
  if (!store) return {};
  try {
    const raw = store.getItem(NAMES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).flatMap(([key, value]) =>
        typeof value === "string" && value.trim() ? [[key, value.trim().slice(0, 64)]] : []
      )
    );
  } catch {
    return {};
  }
}

export function saveTerminalName(terminalId: string, name: string, storage?: Storage | null): void {
  const store = storage ?? safeStorage();
  if (!store) return;
  try {
    const current = loadTerminalNames(store);
    if (!name.trim()) delete current[terminalId];
    else current[terminalId] = name.trim().slice(0, 64);
    store.setItem(NAMES_KEY, JSON.stringify(current));
  } catch {
    // Ignore persistence failures.
  }
}

export function dropTerminalName(terminalId: string, storage?: Storage | null): void {
  saveTerminalName(terminalId, "", storage);
}

/** Display label for a PTY tab: custom name wins, else shell + status. */
export function terminalTabLabel(
  terminal: { terminalId: string; cwd: string; status: string; exitCode?: number },
  index: number,
  total: number,
  names: Record<string, string>
): string {
  const custom = names[terminal.terminalId];
  if (custom) return terminal.status === "running" ? `${custom} · running` : `${custom} · exited`;
  const base = `${total - index}`;
  if (terminal.status !== "running") {
    return terminal.exitCode === undefined ? `${base} · exited` : `${base} · exit ${terminal.exitCode}`;
  }
  return `${base} · bash · running`;
}

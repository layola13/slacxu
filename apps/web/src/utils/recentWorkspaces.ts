import { createDefaultSaVmPolicyConfig, type SaVmPolicyConfig } from "@codex-ui/shared";

export interface RecentWorkspaceItem {
  path: string;
  mode: "local" | "ssh";
  lastUsed: number;
  sshCommand?: string;
}

const RECENT_WORKSPACES_STORAGE_KEY = "codex-recent-workspaces";
const WORKSPACE_VM_POLICY_PREFIX = "codex-workspace-vm-policy:";
const MAX_RECENT_WORKSPACES = 15;

export function normalizeWorkspacePathKey(rawPath: string): string {
  if (!rawPath) return "";
  let p = rawPath.trim().replace(/\\/g, "/");
  // Trim trailing slash except for root like "C:/" or "/"
  if (p.length > 3 && p.endsWith("/")) {
    p = p.slice(0, -1);
  }
  return p.toLowerCase();
}

export function loadRecentWorkspaces(): RecentWorkspaceItem[] {
  try {
    const raw = localStorage.getItem(RECENT_WORKSPACES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is RecentWorkspaceItem => Boolean(item && typeof item === "object" && typeof item.path === "string" && item.path.trim()))
      .map((item): RecentWorkspaceItem => ({
        path: item.path.trim(),
        mode: item.mode === "ssh" ? "ssh" : "local",
        lastUsed: typeof item.lastUsed === "number" ? item.lastUsed : Date.now(),
        sshCommand: typeof item.sshCommand === "string" ? item.sshCommand : undefined
      }))
      .sort((a, b) => b.lastUsed - a.lastUsed);
  } catch {
    return [];
  }
}

export function saveRecentWorkspaces(items: RecentWorkspaceItem[]): void {
  try {
    localStorage.setItem(RECENT_WORKSPACES_STORAGE_KEY, JSON.stringify(items.slice(0, MAX_RECENT_WORKSPACES)));
    window.dispatchEvent(new CustomEvent("codex-recent-workspaces-changed", { detail: items }));
  } catch {
    // Ignore storage quota errors
  }
}

export function recordRecentWorkspace(
  path: string,
  mode: "local" | "ssh" = "local",
  sshCommand?: string
): RecentWorkspaceItem[] {
  const trimmed = path.trim();
  if (!trimmed) return loadRecentWorkspaces();

  const current = loadRecentWorkspaces();
  const normalizedKey = normalizeWorkspacePathKey(trimmed);

  // Filter out existing occurrence with same key and mode
  const filtered = current.filter(
    (item) => normalizeWorkspacePathKey(item.path) !== normalizedKey || item.mode !== mode
  );

  const updated: RecentWorkspaceItem[] = [
    {
      path: trimmed,
      mode,
      lastUsed: Date.now(),
      sshCommand: mode === "ssh" ? sshCommand?.trim() : undefined
    },
    ...filtered
  ].slice(0, MAX_RECENT_WORKSPACES);

  saveRecentWorkspaces(updated);
  return updated;
}

export function removeRecentWorkspace(path: string, mode?: "local" | "ssh"): RecentWorkspaceItem[] {
  const current = loadRecentWorkspaces();
  const normalizedKey = normalizeWorkspacePathKey(path);
  const updated = current.filter((item) => {
    const matchesPath = normalizeWorkspacePathKey(item.path) === normalizedKey;
    if (mode) {
      return !(matchesPath && item.mode === mode);
    }
    return !matchesPath;
  });
  saveRecentWorkspaces(updated);
  return updated;
}

export function clearRecentWorkspaces(): void {
  try {
    localStorage.removeItem(RECENT_WORKSPACES_STORAGE_KEY);
    window.dispatchEvent(new CustomEvent("codex-recent-workspaces-changed", { detail: [] }));
  } catch {
    // ignore
  }
}

export function loadWorkspaceVmPolicy(
  workspacePath: string
): { vmEnabled: boolean; vmPolicy: SaVmPolicyConfig } | null {
  try {
    const key = normalizeWorkspacePathKey(workspacePath);
    if (!key) return null;
    const raw = localStorage.getItem(`${WORKSPACE_VM_POLICY_PREFIX}${key}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && typeof parsed.vmEnabled === "boolean") {
      return {
        vmEnabled: parsed.vmEnabled,
        vmPolicy: parsed.vmPolicy ?? createDefaultSaVmPolicyConfig()
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function saveWorkspaceVmPolicy(
  workspacePath: string,
  vmEnabled: boolean,
  vmPolicy: SaVmPolicyConfig
): void {
  try {
    const key = normalizeWorkspacePathKey(workspacePath);
    if (!key) return;
    localStorage.setItem(
      `${WORKSPACE_VM_POLICY_PREFIX}${key}`,
      JSON.stringify({ vmEnabled, vmPolicy })
    );
  } catch {
    // ignore
  }
}

export function createSaVmPolicyWithIdeTools(): SaVmPolicyConfig {
  const base = createDefaultSaVmPolicyConfig();
  base.tools = {
    ...base.tools,
    readFiles: true,
    fastSearch: true,
    editFiles: true,
    applyPatch: true,
    fileOutline: true,
    findDefinition: true,
    renameSymbol: true,
    extractToFile: true,
    moveWithImports: true,
    addImport: true,
    getDiagnostics: true,
    organizeImports: true,
    analyzeScope: true,
    findReferences: true,
    clearToolHistory: true
  };
  return base;
}

export function isWindowsWorkspacePath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value.trim());
}

export function normalizeWorkspaceCwd(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed === "~" || trimmed.startsWith("~/")) return trimmed;
  if (isWindowsWorkspacePath(trimmed)) {
    const normalized = trimmed.replaceAll("/", "\\");
    if (/^[A-Za-z]:\\$/.test(normalized)) return normalized;
    return normalized.replace(/\\+$/, "");
  }
  return trimmed.replace(/\/+$/, "") || "/";
}

export function normalizeWorkspaceRoots(cwd: string, roots: string[] = []): string[] {
  const primary = normalizeWorkspaceCwd(cwd);
  const seen = new Set<string>();
  if (primary) seen.add(primary.toLowerCase());
  const result: string[] = [];
  for (const value of roots) {
    const normalized = normalizeWorkspaceCwd(value);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

export function parentWorkspacePath(value: string): string | null {
  const normalized = normalizeWorkspaceCwd(value);
  if (!normalized || normalized === "/" || normalized === "~") return null;
  if (normalized.startsWith("~/")) {
    const slashIndex = normalized.lastIndexOf("/");
    return slashIndex <= 1 ? "~" : normalized.slice(0, slashIndex);
  }
  if (isWindowsWorkspacePath(normalized)) {
    if (/^[A-Za-z]:\\$/.test(normalized)) return null;
    const separatorIndex = normalized.lastIndexOf("\\");
    return separatorIndex <= 2 ? `${normalized.slice(0, 2)}\\` : normalized.slice(0, separatorIndex);
  }
  const slashIndex = normalized.lastIndexOf("/");
  return slashIndex <= 0 ? "/" : normalized.slice(0, slashIndex);
}

export function joinWorkspacePath(parentPath: string, name: string): string {
  const normalizedParent = normalizeWorkspaceCwd(parentPath);
  if (isWindowsWorkspacePath(normalizedParent)) {
    return `${normalizedParent.replace(/\\+$/, "")}\\${name.replace(/^[\\/]+/, "")}`;
  }
  return `${normalizedParent.replace(/\/+$/, "")}/${name.replace(/^\/+/, "")}`;
}

export function resolveTildeWorkspacePath(
  value: string,
  home: string | undefined,
  platform?: string
): string {
  const trimmed = value.trim();
  if (!trimmed || (trimmed !== "~" && !trimmed.startsWith("~/") && !trimmed.startsWith("~\\"))) return value;
  // Windows keeps the tilde form; the server expands it with its own home.
  // On Linux/macOS the local Codex app-server rejects "~" outright, so the
  // browser must send an absolute path like /home/xxx or /root.
  if (platform === "win32") return value;
  const absoluteHome = normalizeWorkspaceCwd(home ?? "");
  if (!absoluteHome || absoluteHome.startsWith("~")) return value;
  if (trimmed === "~") return absoluteHome;
  const rest = trimmed.slice(2);
  if (absoluteHome === "/") return `/${rest}`.replace(/\/+/g, "/");
  return `${absoluteHome.replace(/\/+$/, "")}/${rest}`;
}

export function resolveWorkspaceNewFolderPath(basePath: string, inputName: string): string {
  const name = inputName.trim();
  if (!name) return "";
  if (name === "~" || name.startsWith("~/") || name.startsWith("/") || isWindowsWorkspacePath(name)) {
    return normalizeWorkspaceCwd(name) || name;
  }
  return joinWorkspacePath(normalizeWorkspaceCwd(basePath) || "~/", name);
}

export function defaultLocalWorkspacePath(
  platform: string | undefined,
  home: string | undefined,
  cwd: string | undefined,
  roots: string[] = []
): string {
  if (platform !== "win32") {
    // Linux/macOS must use an absolute path like /home/xxx or /root.
    // "~" is never sent as thread/start cwd (AbsolutePathBuf rejects it).
    const candidate = normalizeWorkspaceCwd(home ?? cwd ?? roots[0] ?? "/");
    if (!candidate || candidate === "~" || candidate === "~/") return "/";
    if (candidate === "~/.opencode" || candidate.startsWith("~/")) {
      const absoluteHome = normalizeWorkspaceCwd(home ?? cwd ?? "");
      if (absoluteHome && !absoluteHome.startsWith("~") && absoluteHome.startsWith("/")) {
        return absoluteHome === "/" ? `/${candidate.slice(2)}`.replace(/\/+/g, "/") : `${absoluteHome.replace(/\/+$/, "")}/${candidate.slice(2)}`;
      }
      return "/";
    }
    return candidate || "/";
  }
  return normalizeWorkspaceCwd(home ?? cwd ?? roots[0] ?? "C:\\") || "C:\\";
}

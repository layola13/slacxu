import { existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import { posix, win32 } from "node:path";
import type { AuthUser } from "@codex-ui/shared";

export type LocalWorkspaceRoot = { path: string; label: string };

export type LocalWorkspaceInfo = {
  platform: NodeJS.Platform;
  home: string;
  cwd: string;
  roots: LocalWorkspaceRoot[];
};

export function localWorkspaceInfo(
  user: AuthUser | null,
  options: {
    platform?: NodeJS.Platform;
    home?: string;
    cwd?: string;
    driveExists?: (path: string) => boolean;
  } = {}
): LocalWorkspaceInfo {
  const hostPlatform = options.platform ?? platform();
  const pathApi = hostPlatform === "win32" ? win32 : posix;
  const home = pathApi.resolve(options.home ?? homedir());
  const cwd = pathApi.resolve(options.cwd ?? process.cwd());
  if (user && user.role !== "admin") {
    const memberRoot = pathApi.resolve(user.workspaceRoot);
    return {
      platform: hostPlatform,
      home: memberRoot,
      cwd: memberRoot,
      roots: [{ path: memberRoot, label: memberRoot }]
    };
  }

  if (hostPlatform !== "win32") {
    return { platform: hostPlatform, home, cwd, roots: [{ path: "/", label: "/" }] };
  }

  const driveExists = options.driveExists ?? existsSync;
  const candidates = new Set<string>();
  for (const source of [home, cwd]) {
    const root = pathApi.parse(source).root;
    if (/^[A-Za-z]:\\$/.test(root)) candidates.add(root.toUpperCase());
  }
  for (let code = "A".charCodeAt(0); code <= "Z".charCodeAt(0); code += 1) {
    const root = `${String.fromCharCode(code)}:\\`;
    if (driveExists(root)) candidates.add(root);
  }
  const roots = [...candidates]
    .sort((left, right) => left.localeCompare(right))
    .map((root) => ({ path: root, label: root.slice(0, 2) }));
  return { platform: hostPlatform, home, cwd, roots };
}

import { existsSync } from "node:fs";
import path from "node:path";
import { spawnCliSync, tryPluginHostServices } from "@cxu/sdk-backend";

/**
 * Find the external cline CLI binary. Cline is NOT embedded and NOT driven
 * over ACP (user decisions 2026-10-24): the bridge talks to the CLI's own
 * hub daemon (see clineHubClient.ts), and the hub is a mode of this binary.
 *
 * Resolution order:
 *  a) The user's preferred installation (host CLI selection service) when it exists.
 *  b) env.CLINE_BIN / env.CODEX_UI_CLINE_BIN.
 *  c) PATH lookup for a "cline" executable (with win32 extensions).
 */
export function findClineBin(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  const preferred = tryPluginHostServices()?.cli.getPreferredCliBinary("cline") ?? null;
  if (preferred && existsSync(preferred)) {
    return preferred;
  }

  const configured = env.CLINE_BIN || env.CODEX_UI_CLINE_BIN;
  if (configured && typeof configured === "string") {
    const resolved = resolveConfiguredClineBin(configured, platform, env);
    if (resolved) {
      return resolved;
    }
  }

  return resolveClineFromPath("cline", platform, env);
}

const versionCache = new Map<string, string | null>();

/** Probe the binary's version (`cline --version`), cached per path. */
export function probeClineVersion(binPath: string): string | null {
  const cached = versionCache.get(binPath);
  if (cached !== undefined) return cached;
  let version: string | null = null;
  try {
    const result = spawnCliSync(binPath, ["--version"], { encoding: "utf8", timeout: 10_000 });
    const output = `${result.stdout ?? ""} ${result.stderr ?? ""}`;
    const match = output.match(/(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/);
    if (match?.[1]) version = match[1];
  } catch {
    version = null;
  }
  versionCache.set(binPath, version);
  return version;
}

function resolveConfiguredClineBin(
  configured: string,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): string | undefined {
  const hasPathSeparator = configured.includes("/") || configured.includes("\\");
  if (!hasPathSeparator) {
    return resolveClineFromPath(configured, platform, env);
  }
  if (existsSync(configured)) {
    return configured;
  }
  if (platform === "win32" && path.extname(configured) === "") {
    for (const extension of clineWindowsExecutableExtensions(env)) {
      const candidate = `${configured}${extension}`;
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }
  return undefined;
}

function resolveClineFromPath(
  command: string,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): string | undefined {
  const pathValue = env.PATH ?? env.Path ?? env.path ?? "";
  const pathDirs = pathValue.split(path.delimiter).filter(Boolean);
  const commandExtension = path.extname(command);
  const extensions =
    platform === "win32" && commandExtension === ""
      ? clineWindowsExecutableExtensions(env)
      : [""];

  for (const dir of pathDirs) {
    for (const extension of extensions) {
      const candidate = path.join(dir, `${command}${extension}`);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }
  return undefined;
}

function clineWindowsExecutableExtensions(env: NodeJS.ProcessEnv): string[] {
  const configured = (env.PATHEXT ?? env.PathExt ?? ".COM;.EXE;.CMD;.BAT")
    .split(";")
    .map((extension) => extension.trim().toLowerCase())
    .filter(Boolean);
  const supported = configured.filter((extension) =>
    [".com", ".exe", ".cmd", ".bat", ".ps1"].includes(extension)
  );
  return [...new Set([...supported, ".exe", ".cmd", ".bat", ".com", ".ps1"])];
}

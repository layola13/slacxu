import { existsSync } from "node:fs";
import path from "node:path";
import { spawnCliSync, tryPluginHostServices } from "@cxu/sdk-backend";

/**
 * Find the external Command Code CLI binary. It is NOT embedded:
 * the bridge spawns this binary per turn in print mode
 * (`command-code -p ... --output-format json`).
 *
 * Resolution order:
 *  a) The user's preferred installation (host CLI selection service) when it exists.
 *  b) env.COMMAND_CODE_BIN / env.CODEX_UI_COMMAND_CODE_BIN.
 *  c) PATH lookup for a "command-code" executable (with win32 extensions).
 */
export function findCommandCodeBin(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  const preferred = tryPluginHostServices()?.cli.getPreferredCliBinary("command-code") ?? null;
  if (preferred && existsSync(preferred)) {
    return preferred;
  }

  const configured = env.COMMAND_CODE_BIN || env.CODEX_UI_COMMAND_CODE_BIN;
  if (configured && typeof configured === "string") {
    const resolved = resolveConfiguredCommandCodeBin(configured, platform, env);
    if (resolved) {
      return resolved;
    }
  }

  return resolveCommandCodeFromPath("command-code", platform, env);
}

const versionCache = new Map<string, string | null>();

/** Probe the binary's version (`command-code --version`), cached per path. */
export function probeCommandCodeVersion(binPath: string): string | null {
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

function resolveConfiguredCommandCodeBin(
  configured: string,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): string | undefined {
  const hasPathSeparator = configured.includes("/") || configured.includes("\\");
  if (!hasPathSeparator) {
    return resolveCommandCodeFromPath(configured, platform, env);
  }
  if (existsSync(configured)) {
    return configured;
  }
  if (platform === "win32" && path.extname(configured) === "") {
    for (const extension of commandCodeWindowsExecutableExtensions(env)) {
      const candidate = `${configured}${extension}`;
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }
  return undefined;
}

function resolveCommandCodeFromPath(
  command: string,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): string | undefined {
  const pathValue = env.PATH ?? env.Path ?? env.path ?? "";
  const pathDirs = pathValue.split(path.delimiter).filter(Boolean);
  const commandExtension = path.extname(command);
  const extensions =
    platform === "win32" && commandExtension === ""
      ? commandCodeWindowsExecutableExtensions(env)
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

function commandCodeWindowsExecutableExtensions(env: NodeJS.ProcessEnv): string[] {
  const configured = (env.PATHEXT ?? env.PathExt ?? ".COM;.EXE;.CMD;.BAT")
    .split(";")
    .map((extension) => extension.trim().toLowerCase())
    .filter(Boolean);
  const supported = configured.filter((extension) =>
    [".com", ".exe", ".cmd", ".bat", ".ps1"].includes(extension)
  );
  return [...new Set([...supported, ".exe", ".cmd", ".bat", ".com", ".ps1"])];
}

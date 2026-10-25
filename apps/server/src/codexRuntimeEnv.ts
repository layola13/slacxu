import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export function codexPlatformRuntimeEnv(
  platform: NodeJS.Platform,
  dataDir: string,
  env: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  if (platform !== "win32") return {};

  const configured = env.CODEX_UI_CODEX_TEMP_DIR?.trim();
  const tempDir = configured ? resolveUserPath(configured) : join(dataDir, "codex-tmp");
  mkdirSync(tempDir, { recursive: true, mode: 0o700 });
  return {
    TEMP: tempDir,
    TMP: tempDir,
    CODEX_SQLITE_HOME: env.CODEX_HOME?.trim()
      ? resolveUserPath(env.CODEX_HOME.trim())
      : join(homedir(), ".codex")
  };
}

function resolveUserPath(value: string): string {
  if (value === "~") return homedir();
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return join(homedir(), value.slice(2));
  }
  return resolve(value);
}

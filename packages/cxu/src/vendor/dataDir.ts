/** Host data directory resolution (R2: owned by the SDK).
 *
 * A deterministic function of (env, home): CODEX_UI_DATA_DIR wins,
 * "~" and "~/" expand against home, otherwise ~/.codex-ultra with a
 * one-time legacy ~/.codex-react-ui migration. No host state, so the
 * implementation lives in the SDK and the host re-exports it.
 */
import { existsSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export function codexUiDataDir(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  const configured = env.CODEX_UI_DATA_DIR?.trim();
  if (!configured) {
    const preferred = join(home, ".codex-ultra");
    const legacy = join(home, ".codex-react-ui");
    if (!existsSync(preferred) && existsSync(legacy)) {
      try {
        renameSync(legacy, preferred);
      } catch {
        // Preserve the existing profile when another process still has SQLite open.
        return legacy;
      }
    }
    return preferred;
  }
  if (configured === "~") {
    return home;
  }
  if (configured.startsWith("~/")) {
    return join(home, configured.slice(2));
  }
  return resolve(configured);
}

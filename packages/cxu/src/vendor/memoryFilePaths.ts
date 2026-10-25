/** Workspace/global memory file paths (R2: owned by the SDK).
 *
 * Pure path resolution: the data dir comes from CODEX_UI_DATA_DIR
 * or ~/.codex-ultra; workspace files are keyed by a hash of the
 * normalized workspace path. Extracted from the host's saVmTool,
 * which re-exports them.
 */
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";

export function resolveGlobalMemoryFilePath(): string {
  const baseDataDir = process.env.CODEX_UI_DATA_DIR?.trim() || join(homedir(), ".codex-ultra");
  return join(baseDataDir, "workspace-memory", "global-memory.json");
}

export function resolveWorkspaceMemoryFilePath(workspaceDir: string): string {
  const norm = resolve(workspaceDir).split(sep).join("/").toLowerCase();
  const hash = createHash("sha256").update(norm).digest("hex");
  const baseDataDir = process.env.CODEX_UI_DATA_DIR?.trim() || join(homedir(), ".codex-ultra");
  return join(baseDataDir, "workspace-memory", `${hash}.json`);
}

export type MemoryScope = "workspace" | "global";

/** Normalize the `scope` param for note actions: workspace (default) | global. Never throws. */
export function normalizeMemoryScope(raw: unknown): MemoryScope {
  const v = (typeof raw === "string" ? raw : "").trim().toLowerCase();
  return v === "global" || v === "user" || v === "all-projects" ? "global" : "workspace";
}

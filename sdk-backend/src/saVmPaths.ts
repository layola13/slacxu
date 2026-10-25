/** SA-VM MCP script/data path resolution (R2: owned by the SDK).
 *
 * Pure path probing (env + fs existence) with no host state: the
 * global data dir derives from codexUiDataDir, the project dir from
 * the workspace cwd, and the MCP script location from a candidate
 * list. The host's saVmBundle keeps the installer and re-exports
 * these helpers.
 */
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { codexUiDataDir } from "./dataDir.js";

export const SA_VM_MCP_SCRIPT_NAME = "sa-vm-mcp.mjs";

export function getSaVmGlobalDataDir(): string {
  return join(codexUiDataDir(), "sa-vm");
}

export function getSaVmProjectDataDir(cwd: string): string {
  const root = (cwd ?? "").trim() || process.cwd();
  return join(resolve(root), ".codex-ultra", "sa-vm");
}

export function resolveSaVmMcpSourceCandidates(sourceRoot?: string): string[] {
  const candidates: string[] = [];
  if (sourceRoot?.trim()) candidates.push(join(resolve(sourceRoot.trim()), SA_VM_MCP_SCRIPT_NAME));
  const fromEnv = process.env.SA_VM_MCP_SOURCE_PATH?.trim();
  if (fromEnv) candidates.push(fromEnv);
  candidates.push(join(process.cwd(), "scripts", SA_VM_MCP_SCRIPT_NAME));
  // 已安装的全局副本也可作为 project 拷贝的种子（新机器二次同步时）。
  candidates.push(join(getSaVmGlobalDataDir(), SA_VM_MCP_SCRIPT_NAME));
  // Linux/macOS only: standalone server runs as a bun --compile single-file
  // binary (no repo checkout); cxu seeds sa-vm-mcp.mjs next to the cached
  // binary (see packages/cxu/src/server-build.ts). import.meta paths are
  // unreliable inside compiled binaries, so anchor on the executable path.
  // Windows desktop ships desktop-resources/sa-vm instead; keep its order untouched.
  if (process.platform !== "win32") {
    try {
      const exeDir = dirname(process.execPath);
      if (exeDir) candidates.push(join(exeDir, SA_VM_MCP_SCRIPT_NAME));
    } catch {
      // ignore; fall through to existing candidates
    }
  }
  return candidates;
}

export function resolveSaVmMcpScriptPath(cwd?: string): string | null {
  const trimmed = (cwd ?? "").trim();
  if (trimmed) {
    const projectScript = join(getSaVmProjectDataDir(trimmed), SA_VM_MCP_SCRIPT_NAME);
    if (existsSync(projectScript)) return projectScript;
  }
  const globalScript = join(getSaVmGlobalDataDir(), SA_VM_MCP_SCRIPT_NAME);
  if (existsSync(globalScript)) return globalScript;
  return null;
}

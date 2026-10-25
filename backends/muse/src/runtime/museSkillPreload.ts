import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  applySkillToolNameMapping,
  MUSE_SA_VM_MCP_TOOL_NAME,
  workspaceSaVmSkillPath,
} from "@cxu/sdk-backend";

export interface MusePreloadedSkill {
  path: string;
  content: string;
}

/** Load before starting the CLI, rather than relying on the model to call read_skill. */
export async function loadMuseSaVmSkill(cwd: string, threadId?: string): Promise<MusePreloadedSkill> {
  // Shared copies are rewritten by other threads. A requested thread must
  // have its own policy snapshot; never silently substitute the shared one.
  const candidates = threadId?.trim()
    ? [workspaceSaVmSkillPath(cwd, threadId)]
    : [join(cwd, ".agents", "skills", "sa-vm", "SKILL.md")];
  for (const path of candidates) {
    let content: string;
    try {
      content = await readFile(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw new Error(`Muse sa-vm skill could not be loaded (${path}): ${String(error)}`);
    }
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
    if (!frontmatter || !/^name:\s*["']?sa-vm["']?\s*$/m.test(frontmatter[1]!)) {
      throw new Error(`Muse sa-vm skill is malformed: ${path}`);
    }
    if (Buffer.byteLength(content, "utf8") > 256 * 1024) {
      throw new Error(`Muse sa-vm skill exceeds the 256 KiB preload limit: ${path}`);
    }
    return { path, content: applySkillToolNameMapping(content, MUSE_SA_VM_MCP_TOOL_NAME) };
  }
  throw new Error(`Muse sa-vm skill is missing; refusing to start with unloaded tool instructions (${candidates.join(", ")})`);
}

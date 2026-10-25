import { checkSaVmDelete, checkSaVmPath, normalizeSaVmPolicy } from "../../../backends/vmtool-security/src/security/saVmPolicy.js";
import type { SaVmPolicyConfig } from "@codex-ui/shared";

type PatchOp =
  | { kind: "write"; path: string; contents: string }
  | { kind: "edit"; path: string; oldContents: string; newContents: string }
  | { kind: "delete"; path: string; backupPath?: string }
  | { kind: "rename"; from: string; to: string };

export type SaVmPatchOperation = PatchOp;

export type SaVmPatchResult =
  | { ok: true; operations: PatchOp[] }
  | { ok: false; reason: string; policyDenied?: boolean };

export function parseAndCheckSaVmPatch(patch: string, cwd: string, policyConfig: SaVmPolicyConfig | undefined, additionalRoots: string[] = []): SaVmPatchResult {
  if (typeof patch !== "string" || patch.length > 2 * 1024 * 1024) return { ok: false, reason: "patch is missing or exceeds 2 MiB" };
  const lines = patch.replace(/\r\n?/g, "\n").trim().split("\n");
  if (lines[0] !== "*** Begin Patch" || lines.at(-1) !== "*** End Patch") {
    // A raw unified diff (---/+++/@@) is the classic caller mistake: name the
    // envelope explicitly and point at edit_file, or models read "denied" as
    // admin-forbidden and abandon patching entirely.
    const looksUnified = lines.some((l) => l.startsWith("@@") || l.startsWith("diff --git") || l.startsWith("--- ") || l.startsWith("+++ "));
    return {
      ok: false,
      reason: looksUnified
        ? "patch must use the *** Begin Patch envelope (*** Update File: <file> with @@ hunks), not a raw unified diff; for single-file edits prefer edit_file {path,old_text,new_text}"
        : "invalid patch boundaries (must start with *** Begin Patch and end with *** End Patch)",
    };
  }
  const operations: PatchOp[] = [];
  let index = 1;
  while (index < lines.length - 1) {
    const line = lines[index]!;
    if (line.startsWith("*** Add File: ")) {
      const path = line.slice(14).trim(); index += 1; const content: string[] = [];
      // Bare "" lines are empty content lines (editors strip trailing space);
      // anything else without "+" ends the block.
      while (index < lines.length - 1 && (lines[index]!.startsWith("+") || lines[index] === "")) {
        content.push(lines[index]!.startsWith("+") ? lines[index]!.slice(1) : "");
        index += 1;
      }
      if (!path || content.length === 0) return { ok: false, reason: "add patch requires path and content" };
      operations.push({ kind: "write", path, contents: content.join("\n") + "\n" }); continue;
    }
    if (line.startsWith("*** Delete File: ")) {
      const path = line.slice(17).trim(); if (!path) return { ok: false, reason: "delete patch requires path" };
      operations.push({ kind: "delete", path }); index += 1; continue;
    }
    if (line.startsWith("*** Update File: ")) {
      const path = line.slice(17).trim(); if (!path) return { ok: false, reason: "update patch requires path" };
      index += 1; let move: string | undefined;
      if (lines[index]?.startsWith("*** Move to: ")) { move = lines[index]!.slice(13).trim(); if (!move) return { ok: false, reason: "move patch requires destination" }; index += 1; }
      const edits: Array<{ oldContents: string; newContents: string }> = [];
      let oldLines: string[] = []; let newLines: string[] = [];
      const finishEdit = () => { if (oldLines.length || newLines.length) edits.push({ oldContents: oldLines.join("\n"), newContents: newLines.join("\n") }); oldLines = []; newLines = []; };
      while (index < lines.length - 1 && (!lines[index]!.startsWith("*** ") || lines[index]!.trim() === "*** End of File")) {
        const hunk = lines[index++]!;
        if (hunk.startsWith("+")) newLines.push(hunk.slice(1));
        else if (hunk.startsWith("-")) oldLines.push(hunk.slice(1));
        else if (hunk.startsWith(" ")) { const value = hunk.slice(1); oldLines.push(value); newLines.push(value); }
        // Bare "" is an empty context line (trailing space stripped by editors).
        else if (hunk === "") { oldLines.push(""); newLines.push(""); }
        else if (hunk.startsWith("@@")) finishEdit();
        else if (hunk.trim() === "*** End of File") finishEdit();
        else return { ok: false, reason: `invalid update hunk near line ${index}` };
      }
      finishEdit();
      if (edits.length === 0 && !move) return { ok: false, reason: `empty update hunk for ${path}` };
      for (const edit of edits) operations.push({ kind: "edit", path, ...edit });
      if (move) operations.push({ kind: "rename", from: path, to: move });
      continue;
    }
    return { ok: false, reason: `unsupported patch directive: ${line}` };
  }
  if (operations.length === 0) return { ok: false, reason: "patch contains no file operations" };
  const policy = normalizeSaVmPolicy(policyConfig, cwd, additionalRoots);
  for (const operation of operations) {
    if (operation.kind === "write") { const decision = checkSaVmPath(policy, "write", operation.path, cwd); if (!decision.allowed) return { ok: false, reason: `write ${operation.path}: ${decision.reason}`, policyDenied: true }; }
    else if (operation.kind === "edit") { const read = checkSaVmPath(policy, "read", operation.path, cwd); if (!read.allowed) return { ok: false, reason: `read ${operation.path}: ${read.reason}`, policyDenied: true }; const write = checkSaVmPath(policy, "write", operation.path, cwd); if (!write.allowed) return { ok: false, reason: `write ${operation.path}: ${write.reason}`, policyDenied: true }; }
    else if (operation.kind === "delete") { const decision = checkSaVmDelete(policy, operation.path, cwd); if (!decision.allowed) return { ok: false, reason: `delete ${operation.path}: ${decision.reason}`, policyDenied: true }; if (policy.fs.delete !== "deny" && policy.fs.backupDir) { operation.backupPath = `${policy.fs.backupDir}/${operation.path.split("/").at(-1) ?? "deleted"}`; const backup = checkSaVmPath(policy, "write", operation.backupPath, cwd); if (!backup.allowed) return { ok: false, reason: `delete backup ${operation.backupPath}: ${backup.reason}`, policyDenied: true }; } }
    else { const from = checkSaVmPath(policy, "transfer", operation.from, cwd); if (!from.allowed) return { ok: false, reason: `rename ${operation.from}: ${from.reason}`, policyDenied: true }; const to = checkSaVmPath(policy, "write", operation.to, cwd); if (!to.allowed) return { ok: false, reason: `rename ${operation.to}: ${to.reason}`, policyDenied: true }; }
  }
  return { ok: true, operations };
}


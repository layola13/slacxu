import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { SaVmPolicyConfig } from "../shared-types.js";
import { analyzeFileCoupling, extractFileOutline, getSyntaxDiagnostics } from "./saVmTreeSitter.js";
import { checkSaVmPath, normalizeSaVmPolicy, pathWithin } from "./saVmPolicy.js";
import { parseAndCheckSaVmPatch } from "./saVmApplyPatch.js";

type SplitFileState = {
  baseExists: boolean;
  baseContent: string;
  baseHash: string | null;
  stagedContent: string;
  committedHash?: string;
};

type SplitManifest = {
  version: 1;
  id: string;
  cwd: string;
  source: string;
  sourceHash: string;
  createdAt: string;
  updatedAt: string;
  status: "planned" | "staged" | "committed" | "rolled_back";
  task: string;
  reviewedHash?: string;
  validatedHash?: string;
  files: Record<string, SplitFileState>;
  stages: Array<{ at: string; kind: "coarse" | "refine"; moduleName: string; paths: string[] }>;
};

type SplitInput = {
  action: string;
  path?: string;
  session_id?: string;
  task?: string;
  phase?: string;
  module_name?: string;
  ops?: Array<{ path: string; content?: string; patch?: string }>;
  confirm?: boolean;
  policy?: SaVmPolicyConfig;
  additionalRoots?: string[];
};

const hashContent = (content: string) => createHash("sha256").update(content).digest("hex");
const stagedDigest = (files: Record<string, SplitFileState>) => createHash("sha256").update(Object.entries(files).sort(([left], [right]) => left.localeCompare(right)).map(([path, state]) => `${path}\0${hashContent(state.stagedContent)}`).join("\n")).digest("hex");
const splitRoot = (cwd: string) => join(process.env.CODEX_HOME || join(homedir(), ".codex"), "sa-vm", "split-workflows", hashContent(resolve(cwd)).slice(0, 24));
const manifestPath = (cwd: string, id: string) => join(splitRoot(cwd), `${id}.json`);

function result(ok: boolean, stdout: string, stderr = "", exitCode = ok ? 0 : 2, kind = ok ? "success" : "sa_error", events: unknown[] = []) {
  return { ok, kind, exitCode, stdout, stderr, saVmEvents: events, saVmViolation: null, durationMs: 0 };
}

function safeRelativePath(rawPath: string, cwd: string): string {
  const value = rawPath.trim().replace(/\\/g, "/");
  if (!value || isAbsolute(value)) throw new Error(`split path must be workspace-relative: ${rawPath}`);
  const absolute = resolve(cwd, value);
  if (!pathWithin(resolve(cwd), absolute) || absolute === resolve(cwd)) throw new Error(`split path escapes workspace: ${rawPath}`);
  return relative(cwd, absolute).split(sep).join("/");
}

async function saveManifest(manifest: SplitManifest): Promise<void> {
  manifest.updatedAt = new Date().toISOString();
  const target = manifestPath(manifest.cwd, manifest.id);
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(manifest), "utf8");
  await rename(temporary, target);
}

async function loadManifest(cwd: string, id: string): Promise<SplitManifest> {
  if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error("session_id must be a workflow id returned by split_plan");
  const target = manifestPath(cwd, id);
  const manifest = JSON.parse(await readFile(target, "utf8")) as SplitManifest;
  if (manifest.version !== 1 || manifest.id !== id || resolve(manifest.cwd) !== resolve(cwd)) throw new Error("split workflow does not belong to this workspace");
  return manifest;
}

function checkAllowed(policy: SaVmPolicyConfig | undefined, cwd: string, operation: "read" | "write", path: string, roots?: string[]): void {
  const normalized = normalizeSaVmPolicy(policy, cwd, roots);
  const decision = checkSaVmPath(normalized, operation, path, cwd);
  if (!decision.allowed) throw new Error(`Policy violation for ${operation} ${path}: ${decision.reason}`);
}

async function ensureStageFile(manifest: SplitManifest, path: string, policy: SaVmPolicyConfig | undefined, roots?: string[]): Promise<SplitFileState> {
  const existingStage = manifest.files[path];
  if (existingStage) return existingStage;
  checkAllowed(policy, manifest.cwd, "write", path, roots);
  const absolute = resolve(manifest.cwd, path);
  const baseExists = existsSync(absolute);
  let baseContent = "";
  if (baseExists) {
    checkAllowed(policy, manifest.cwd, "read", path, roots);
    baseContent = await readFile(absolute, "utf8");
  }
  const state: SplitFileState = { baseExists, baseContent, baseHash: baseExists ? hashContent(baseContent) : null, stagedContent: baseContent };
  manifest.files[path] = state;
  return state;
}

function applyUniqueEdit(content: string, oldText: string, newText: string, path: string): string {
  const first = content.indexOf(oldText);
  if (first < 0) throw new Error(`split patch context not found in ${path}`);
  if (content.indexOf(oldText, first + Math.max(1, oldText.length)) >= 0) throw new Error(`split patch context is ambiguous in ${path}`);
  return content.slice(0, first) + newText + content.slice(first + oldText.length);
}

function renderStagedDiff(path: string, state: SplitFileState): string {
  if (state.baseContent === state.stagedContent) return `--- a/${path}\n+++ b/${path}\n(no content changes)`;
  const oldLines = state.baseContent.split(/\r?\n/);
  const newLines = state.stagedContent.split(/\r?\n/);
  let prefix = 0;
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < oldLines.length - prefix && suffix < newLines.length - prefix && oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]) suffix += 1;
  const oldChanged = oldLines.slice(prefix, oldLines.length - suffix);
  const newChanged = newLines.slice(prefix, newLines.length - suffix);
  const maxChangedLines = 240;
  const visible = (lines: string[]) => lines.length <= maxChangedLines
    ? lines
    : [...lines.slice(0, maxChangedLines / 2), `... ${lines.length - maxChangedLines} changed lines omitted ...`, ...lines.slice(-maxChangedLines / 2)];
  return [`--- a/${path}`, `+++ b/${path}`, `@@ -${prefix + 1},${oldChanged.length} +${prefix + 1},${newChanged.length} @@`, ...visible(oldChanged).map((line) => `-${line}`), ...visible(newChanged).map((line) => `+${line}`)].join("\n");
}

async function stageOps(manifest: SplitManifest, ops: SplitInput["ops"], policy: SaVmPolicyConfig | undefined, roots?: string[]): Promise<string[]> {
  if (!Array.isArray(ops) || ops.length === 0 || ops.length > 20) throw new Error("ops must contain 1 to 20 staged file operations");
  const touched = new Set<string>();
  for (const op of ops) {
    if (!op || typeof op.path !== "string") throw new Error("each split op requires a workspace-relative path");
    const path = safeRelativePath(op.path, manifest.cwd);
    if (typeof op.content === "string" && typeof op.patch !== "string") {
      const state = await ensureStageFile(manifest, path, policy, roots);
      state.stagedContent = op.content;
    } else if (typeof op.patch === "string" && typeof op.content !== "string") {
      const parsed = parseAndCheckSaVmPatch(op.patch, manifest.cwd, policy, roots);
      if (!parsed.ok) throw new Error(`invalid split patch: ${parsed.reason}`);
      for (const patchOp of parsed.operations) {
        if (patchOp.kind === "delete" || patchOp.kind === "rename") throw new Error("split staging currently accepts add/update patches only; delete/rename must be planned separately");
        const patchPath = safeRelativePath(patchOp.path, manifest.cwd);
        if (patchPath !== path) throw new Error(`split patch path ${patchPath} must match op.path ${path}`);
        const patchState = await ensureStageFile(manifest, patchPath, policy, roots);
        patchState.stagedContent = patchOp.kind === "write" ? patchOp.contents : applyUniqueEdit(patchState.stagedContent, patchOp.oldContents, patchOp.newContents, patchPath);
        touched.add(patchPath);
      }
    } else {
      throw new Error(`split op for ${path} must provide exactly one of content or patch`);
    }
    touched.add(path);
  }
  return [...touched].sort();
}

async function rollbackCommitted(manifest: SplitManifest): Promise<void> {
  const completed: string[] = [];
  try {
    for (const [path, state] of Object.entries(manifest.files)) {
      if (!state.committedHash) continue;
      const absolute = resolve(manifest.cwd, path);
      if (!existsSync(absolute) || hashContent(await readFile(absolute, "utf8")) !== state.committedHash) {
        throw new Error(`rollback blocked: ${path} changed after split commit`);
      }
      if (state.baseExists) await writeFile(absolute, state.baseContent, "utf8");
      else await rm(absolute, { force: true });
      completed.push(path);
    }
    manifest.status = "rolled_back";
    await saveManifest(manifest);
  } catch (error) {
    for (const path of completed.reverse()) {
      const state = manifest.files[path]!;
      const absolute = resolve(manifest.cwd, path);
      await mkdir(dirname(absolute), { recursive: true });
      await writeFile(absolute, state.stagedContent, "utf8");
    }
    throw error;
  }
}

export async function runSplitWorkflowAction(input: SplitInput, policy: SaVmPolicyConfig | undefined, cwd: string, startedAt: number) {
  const normalizedCwd = resolve(cwd);
  const normalizedPolicy = normalizeSaVmPolicy(policy, normalizedCwd, input.additionalRoots ?? []);
  if (normalizedPolicy.tools?.extractToFile !== true) {
    return { ...result(false, "", "split workflow requires extractToFile capability", 228, "capability_denied"), saVmViolation: { reason: "extractToFile disabled" }, durationMs: Date.now() - startedAt };
  }
  try {
    if (input.action === "split_plan") {
      const source = safeRelativePath(input.path ?? "", normalizedCwd);
      checkAllowed(policy, normalizedCwd, "read", source, input.additionalRoots);
      const content = await readFile(resolve(normalizedCwd, source), "utf8");
      const outline = await extractFileOutline(source, content, { detail: true });
      const coupling = analyzeFileCoupling(source, content, 30);
      const id = randomUUID();
      const manifest: SplitManifest = {
        version: 1, id, cwd: normalizedCwd, source, sourceHash: hashContent(content), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        status: "planned", task: input.task?.trim() ?? "", files: {}, stages: []
      };
      await saveManifest(manifest);
      const symbols = outline.symbols.slice(0, 160).map((symbol) => `${symbol.kind} ${symbol.name} [L${symbol.startLine}-${symbol.endLine}]`);
      return { ...result(true, `[split_plan] session_id=${id}\nSource: ${source} (${outline.totalLines} lines, ${content.length} chars)\nTask: ${manifest.task || "(none)"}\n\nAST outline (first ${symbols.length} symbols):\n${symbols.join("\n")}\n\nCoupling candidates:\n${coupling.summary}\n\nNext: group symbols into coarse modules, then call split_stage with patch ops; intermediate drafts stay off-worktree.`), durationMs: Date.now() - startedAt, saVmEvents: [{ timestamp: Date.now(), type: "split_plan_created", sessionId: id, source, symbolCount: outline.symbols.length }] };
    }

    const id = input.session_id?.trim() ?? "";
    const manifest = await loadManifest(normalizedCwd, id);
    if (input.action === "split_status") {
      const files = Object.entries(manifest.files).map(([path, state]) => `${path}: ${state.stagedContent.split(/\r?\n/).length} staged lines, ${state.baseExists ? "existing" : "new"}`);
      const stages = manifest.stages.map((stage, index) => `${index + 1}. ${stage.kind} ${stage.moduleName || "(unnamed)"}: ${stage.paths.join(", ")}`);
      return { ...result(true, `[split_status] session_id=${id}\nSource: ${manifest.source}\nTask: ${manifest.task || "(none)"}\nStatus: ${manifest.status}\nUpdated: ${manifest.updatedAt}\nStages:\n${stages.join("\n") || "(none)"}\nFiles:\n${files.join("\n") || "(none)"}\nDiff reviewed: ${manifest.reviewedHash === stagedDigest(manifest.files)}\nValidation current: ${manifest.validatedHash === stagedDigest(manifest.files)}`), durationMs: Date.now() - startedAt, saVmEvents: [{ timestamp: Date.now(), type: "split_status_read", sessionId: id }] };
    }
    if (input.action === "split_stage" || input.action === "split_refine") {
      if (manifest.status === "committed" || manifest.status === "rolled_back") throw new Error(`workflow is ${manifest.status}; create a new split_plan to continue`);
      if (manifest.status === "planned" && hashContent(await readFile(resolve(normalizedCwd, manifest.source), "utf8")) !== manifest.sourceHash) throw new Error("source changed since split_plan; refresh the plan before staging edits");
      const paths = await stageOps(manifest, input.ops, policy, input.additionalRoots);
      manifest.reviewedHash = undefined;
      manifest.validatedHash = undefined;
      const kind = input.action === "split_refine" || input.phase === "refine" ? "refine" : "coarse";
      manifest.stages.push({ at: new Date().toISOString(), kind, moduleName: input.module_name?.trim() ?? "", paths });
      manifest.status = "staged";
      await saveManifest(manifest);
      const summaries = paths.map((path) => `${path}: ${manifest.files[path]!.stagedContent.split(/\r?\n/).length} lines`);
      return { ...result(true, `[${input.action}] staged ${paths.length} path(s); worktree unchanged\nsession_id=${id}\nmodule=${input.module_name?.trim() || "(unnamed)"}\n${summaries.join("\n")}\nRepeat split_refine for nested modules, then split_repair phase=validate.`), durationMs: Date.now() - startedAt, saVmEvents: [{ timestamp: Date.now(), type: "split_stage_saved", sessionId: id, kind, paths }] };
    }

    if (input.action === "split_repair") {
      const phase = input.phase ?? "validate";
      if (phase === "stage") {
        if (manifest.status === "committed" || manifest.status === "rolled_back") throw new Error(`workflow is ${manifest.status}; create a new split_plan to continue`);
        const paths = await stageOps(manifest, input.ops, policy, input.additionalRoots);
        manifest.reviewedHash = undefined;
        manifest.validatedHash = undefined;
        manifest.status = "staged";
        await saveManifest(manifest);
        return { ...result(true, `[split_repair] staged ${paths.length} repair path(s); worktree unchanged\nsession_id=${id}\n${paths.join("\n")}\nNext: split_repair phase=validate.`), durationMs: Date.now() - startedAt, saVmEvents: [{ timestamp: Date.now(), type: "split_repairs_staged", sessionId: id, paths }] };
      }
      if (phase === "rollback") {
        if (manifest.status !== "committed") throw new Error("rollback requires a committed split workflow");
        await rollbackCommitted(manifest);
        return { ...result(true, `[split_repair] rolled back ${Object.keys(manifest.files).length} path(s); session_id=${id}`), durationMs: Date.now() - startedAt, saVmEvents: [{ timestamp: Date.now(), type: "split_rolled_back", sessionId: id }] };
      }
      if (manifest.status === "rolled_back") throw new Error("workflow has already been rolled back");
      const staged = Object.entries(manifest.files);
      if (staged.length === 0) throw new Error("workflow has no staged files");
      if (phase === "diff") {
        manifest.reviewedHash = stagedDigest(manifest.files);
        await saveManifest(manifest);
        const diff = staged.map(([path, state]) => renderStagedDiff(path, state)).join("\n\n");
        return { ...result(true, `[split_repair] review this staged diff before validation/commit; session_id=${id}\n${diff}`), durationMs: Date.now() - startedAt, saVmEvents: [{ timestamp: Date.now(), type: "split_diff_reviewed", sessionId: id, paths: staged.map(([path]) => path) }] };
      }
      const diagnostics: string[] = [];
      for (const [path, state] of staged) {
        const syntax = await getSyntaxDiagnostics(path, state.stagedContent);
        if (!syntax.clean) diagnostics.push(`${path}: ${syntax.errorsCount} syntax error(s), first ${syntax.errors[0]?.code ?? ""} ${syntax.errors[0]?.message ?? ""}`);
      }
      if (diagnostics.length) return { ...result(false, "", `[split_repair] staged syntax validation failed:\n- ${diagnostics.join("\n- ")}`), durationMs: Date.now() - startedAt };
      if (phase === "validate") {
        manifest.validatedHash = stagedDigest(manifest.files);
        await saveManifest(manifest);
        return { ...result(true, `[split_repair] staged syntax is clean for ${staged.length} path(s). This is not a project typecheck; run project diagnostics after commit.\nsession_id=${id}\nUse phase=commit with confirm=true to apply, or keep refining.`), durationMs: Date.now() - startedAt, saVmEvents: [{ timestamp: Date.now(), type: "split_stage_validated", sessionId: id, paths: staged.map(([path]) => path) }] };
      }
      if (phase !== "commit") throw new Error("phase must be validate, commit, or rollback");
      if (input.confirm !== true) throw new Error("commit requires confirm=true after reviewing staged diff");
      if (manifest.reviewedHash !== stagedDigest(manifest.files)) throw new Error("commit requires a fresh split_repair phase=diff after the last staged change");
      if (manifest.validatedHash !== stagedDigest(manifest.files)) throw new Error("commit requires a fresh split_repair phase=validate after the last staged change");
      for (const [path, state] of staged) {
        checkAllowed(policy, normalizedCwd, "write", path, input.additionalRoots);
        const absolute = resolve(normalizedCwd, path);
        const currentlyExists = existsSync(absolute);
        if (currentlyExists !== state.baseExists) throw new Error(`commit blocked: ${path} existence changed since staging`);
        if (currentlyExists && hashContent(await readFile(absolute, "utf8")) !== state.baseHash) throw new Error(`commit blocked: ${path} changed since staging`);
      }
      const written: string[] = [];
      try {
        for (const [path, state] of staged) {
          const absolute = resolve(normalizedCwd, path);
          await mkdir(dirname(absolute), { recursive: true });
          await writeFile(absolute, state.stagedContent, "utf8");
          state.committedHash = hashContent(state.stagedContent);
          written.push(path);
        }
        manifest.status = "committed";
        await saveManifest(manifest);
      } catch (error) {
        for (const path of written.reverse()) {
          const state = manifest.files[path]!;
          const absolute = resolve(normalizedCwd, path);
          if (state.baseExists) await writeFile(absolute, state.baseContent, "utf8");
          else await rm(absolute, { force: true });
        }
        throw error;
      }
      return { ...result(true, `[split_repair] committed ${written.length} path(s); checkpoint retained for rollback. Run project-level typecheck/tests now.\nsession_id=${id}`), durationMs: Date.now() - startedAt, saVmEvents: [{ timestamp: Date.now(), type: "split_committed", sessionId: id, paths: written }] };
    }
    return result(false, "", `unsupported split action: ${input.action}`, 1);
  } catch (error) {
    return { ...result(false, "", error instanceof Error ? error.message : String(error)), durationMs: Date.now() - startedAt };
  }
}

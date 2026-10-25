import { SaVmCapabilityDeniedError, SaVmInputError } from "@cxu/sdk-backend";
import type { NotePriorityLevel, SaVmActionType, SaVmFsCapability, SaVmNetCapability, SaVmRunInput, SaVmRunResult } from "@cxu/sdk-backend";
import { normalizeMemoryScope, resolveGlobalMemoryFilePath, resolveWorkspaceMemoryFilePath, type MemoryScope } from "@cxu/sdk-backend";
export { normalizeMemoryScope, resolveGlobalMemoryFilePath, resolveWorkspaceMemoryFilePath };
export type { MemoryScope };
export { SaVmCapabilityDeniedError, SaVmInputError };
export type { NotePriorityLevel, SaVmActionType, SaVmFsCapability, SaVmNetCapability, SaVmRunInput, SaVmRunResult };
import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, delimiter, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { SaVmBunSubcommand, SaVmContextSavingsConfig, SaVmPolicyConfig } from "@codex-ui/shared";

import { ALL_SA_VM_BUN_FILTER_SCRIPTS, ALL_SA_VM_BUN_PROFILES, ALL_SA_VM_BUN_SUBCOMMANDS, SA_VM_BUN_DENIED_SUBCOMMANDS, type SaVmBunProfile } from "@codex-ui/shared";
import { checkSaVmBunExecution, checkSaVmBunProfile, checkSaVmDelete, checkSaVmHttp, checkSaVmPath, normalizeSaVmPolicy, pathWithin, type NormalizedSaVmPolicy } from "../../../backends/vmtool-security/src/security/saVmPolicy.js";
import { parseAndCheckSaVmPatch } from "./saVmApplyPatch.js";
import { extractFileOutline, formatOutlineAsTree, renameSymbolInContent, findDefinitionInContent, getSyntaxDiagnostics, addImportToContent, organizeImportsInContent, analyzeBlockScope, generateTargetImportsForBlock, getSemanticDiagnosticsForContent, autoFixMissingImportsInContent, analyzeFileCoupling, buildExtractComponent, splitEnvironmentalErrors } from "./saVmTreeSitter.js";
import { nativeCodeGraph } from "./saVmCodeGraph.js";
import { runSplitWorkflowAction } from "./saVmSplitWorkflow.js";
import { normalizeSaVmParallelTasks } from "./saVmRequest.js";
import { nativeJevChoose, nativeJevChecklist, nativeJevEvaluate, nativeJevThinking, nativeJevRedteam, nativeJevRank, nativeJevScope, nativeJevDispatch, nativeJevConsistency, nativeJevDone, nativeJevDiagnose, nativeJevEdgeCases, nativeJevBlastRadius, nativeJevIntent, nativeJevNext, nativeJevProgress, nativeJevMemory } from "../../../backends/jev/src/jev/saVmJev.js";
import { runRegressionSuite, recordRegressionCase, type RegressionCase } from "./regressionRunner.js";
import {
  checkAccountabilityWriteGate,
  getReputationStatus,
  recordPenalty,
  submitRedemption,
  type PenaltyLevel,
} from "./saVmAccountabilityLedger.js";


export const SA_VM_BUN_PROFILES = ALL_SA_VM_BUN_PROFILES;
export type { SaVmBunProfile };


export function expandSaVmActionInput(input: SaVmRunInput): SaVmRunInput {
  if (!input || typeof input !== "object") return input;

  // `parallel` is frequently serialized as a JSON string by tool callers. Every
  // dispatch site below keys off Array.isArray(input.parallel); without an
  // eager coercion a string batch skips runParallelSaVmTool entirely and dies
  // in the script engine with the unrelated "source must be a string".
  let normalizedParallel: SaVmRunInput = input;
  if (input.parallel !== undefined && input.parallel !== null && !Array.isArray(input.parallel)) {
    const parsed = normalizeSaVmParallelTasks(input.parallel);
    if (!parsed.ok) throw new SaVmInputError(parsed.error);
    normalizedParallel = { ...input, parallel: parsed.tasks as SaVmRunInput[] };
  }
  input = normalizedParallel;

  const action = typeof input.action === "string" ? input.action.trim().toLowerCase() : "";
  // No-action sniffing must recognize WRITE intents, not just reads: without
  // this, {path,old_text,new_text} (edit intent) and {path,text} (write
  // intent) both degrade to read_file and the model "edits" by reading.
  const noActionRecord = input as Record<string, unknown>;
  const hasOldText = ["old_text", "oldText", "old_string", "oldString", "old"].some((k) => typeof noActionRecord[k] === "string");
  const hasBody = input.content !== undefined
    || ["contents", "text", "body", "data"].some((k) => noActionRecord[k] !== undefined);
  const hasPatch = typeof input.patch === "string" || typeof input.diff === "string";
  const hasPath = !input.source && typeof input.path === "string" && input.path.trim() ? true : false;
  const sniffedAction = hasPath
    ? (hasOldText ? "edit_file" : hasPatch ? "apply_patch" : hasBody ? "write_file" : "read_file")
    : "";
  const effectiveAction = action || sniffedAction;
  // Canonicalize: write the sniffed action back so every downstream consumer
  // (native dispatcher, parallel quota counting, dependency guard) sees the
  // true intent instead of an empty action.
  if (!action && sniffedAction) {
    input = { ...input, action: sniffedAction };
  }

  if (!effectiveAction) {
    if (Array.isArray(input.parallel)) {
      return {
        ...input,
        parallel: input.parallel.map((task) => expandSaVmActionInput(task as SaVmRunInput))
      };
    }
    return input;
  }

  // read_many files aliases + split session aliases: normalize here so the
  // native dispatcher, quota counting, and dependency guard see true intent.
  {
    const ea = (typeof (input as Record<string, unknown>).action === "string"
      ? String((input as Record<string, unknown>).action).trim().toLowerCase() : "");
    const rec = input as Record<string, unknown>;
    if (ea === "read_many" || ea === "read_files") {
      if (rec.files === undefined) {
        const cand = rec.paths ?? rec.filenames ?? rec.file_list ?? rec.fileList;
        if (Array.isArray(cand)) input = { ...input, files: cand };
        else if (typeof cand === "string" && cand.trim()) input = { ...input, files: [cand.trim()] };
        else if (typeof rec.path === "string" && String(rec.path).trim()) input = { ...input, files: [String(rec.path).trim()] };
        else if (typeof rec.file === "string" && String(rec.file).trim()) input = { ...input, files: [String(rec.file).trim()] };
      } else if (typeof rec.files === "string") {
        const s = String(rec.files).trim();
        if (!s) input = { ...input, files: [] };
        else if (s.startsWith("[")) {
          try { const p = JSON.parse(s); input = { ...input, files: Array.isArray(p) ? p : [s] }; }
          catch { input = { ...input, files: [s] }; }
        } else if (s.includes(",")) input = { ...input, files: s.split(",").map((x) => x.trim()).filter(Boolean) };
        else input = { ...input, files: [s] };
      }
    }
    if (ea === "split_stage" || ea === "split_refine" || ea === "split_repair" || ea === "split_status" || ea === "split_plan") {
      let next: SaVmRunInput = input;
      if (rec.session_id === undefined && rec.sessionId !== undefined) next = { ...next, session_id: rec.sessionId as string };
      if ((next as Record<string, unknown>).module_name === undefined && rec.moduleName !== undefined) next = { ...next, module_name: rec.moduleName as string };
      if ((next as Record<string, unknown>).ops === undefined && Array.isArray(rec.tasks)) next = { ...next, ops: rec.tasks as SaVmRunInput["ops"] };
      if ((next as Record<string, unknown>).path === undefined && typeof rec.file === "string") next = { ...next, path: rec.file as string };
      input = next;
    }
  }

  // Packaged file/search actions run natively in runSaVmTool (bun branch: no
  // SLA emit step). expandSaVmActionInput leaves them untouched so the native
  // dispatcher handles policy, backup, and token budgets directly.

  if (effectiveAction === "read_lines") {
    return input;
  }

  if (effectiveAction === "read_file_tail" || effectiveAction === "tail_file" || effectiveAction === "tail") {
    return input;
  }

  if (effectiveAction === "find" || effectiveAction === "find_files" || effectiveAction === "list_files") {
    return input;
  }

  if (effectiveAction === "write" || effectiveAction === "write_file") {
    return input;
  }

  if (effectiveAction === "edit" || effectiveAction === "edit_file") {
    return input;
  }

  if (
    effectiveAction === "run_bun"
    || ((effectiveAction === "bun" || effectiveAction === "exec_bun") && (typeof input.subcommand === "string" || Array.isArray(input.args) || typeof input.test_file === "string" || typeof input.filter === "string"))
  ) {
    let subcommand = typeof input.subcommand === "string" ? input.subcommand.trim().toLowerCase() : "";
    let args: string[] = Array.isArray(input.args)
      ? input.args.filter((item): item is string => typeof item === "string")
      : [];

    if (typeof input.filter === "string" && input.filter.trim()) {
      const targetScript = subcommand && subcommand !== "--filter" && subcommand !== "filter" ? subcommand : (args[0] ?? "typecheck");
      const remainingArgs = subcommand && subcommand !== "--filter" && subcommand !== "filter" ? args : args.slice(1);
      subcommand = "--filter";
      args = [input.filter.trim(), targetScript, ...remainingArgs];
    } else if (!subcommand && args.length > 0) {
      subcommand = args[0]!.toLowerCase();
      args = args.slice(1);
    }

    if (args.length === 0) {
      const candidate = typeof input.test_file === "string" && input.test_file.trim()
        ? input.test_file.trim()
        : (typeof input.path === "string" && input.path.trim() ? input.path.trim() : "");
      if (candidate) args.push(candidate);
    }

    return {
      ...input,
      action: "run_bun",
      subcommand,
      args
    };
  }

  if (
    effectiveAction === "run_js"
    || effectiveAction === "exec_js"
    || effectiveAction === "js"
    || effectiveAction === "javascript"
    || effectiveAction === "node"
    || effectiveAction === "bun"
    || effectiveAction === "run_node"
    || effectiveAction === "exec_node"
    || effectiveAction === "exec_bun"
    || effectiveAction === "eval_js"
  ) {
    const source = input.source || input.content || "";
    if (!source) throw new SaVmInputError(`action '${effectiveAction}' requires 'source' or 'content' code`);
    return {
      ...input,
      language: "js",
      source
    };
  }

  if (
    effectiveAction === "run_py"
    || effectiveAction === "run_python"
    || effectiveAction === "exec_py"
    || effectiveAction === "py"
    || effectiveAction === "python"
  ) {
    const source = input.source || input.content || "";
    if (!source) throw new SaVmInputError(`action '${effectiveAction}' requires 'source' or 'content' code`);
    return {
      ...input,
      language: "py",
      source
    };
  }

  if (
    effectiveAction === "run_project_check"
    || effectiveAction === "project_check"
    || effectiveAction === "run_bun_profile"
  ) {
    return {
      ...input,
      action: "run_project_check",
      source: input.source || "// run_project_check"
    };
  }

  if (
    effectiveAction === "run_host"
    || effectiveAction === "exec_host"
    || effectiveAction === "host"
  ) {
    return {
      ...input,
      action: "run_host"
    };
  }

  return input;
}


const MAX_SOURCE_BYTES = 512 * 1024;
const MAX_STDOUT_BYTES = 512 * 1024;
const MAX_STDERR_BYTES = 128 * 1024;
const DEFAULT_LIMITS = { fuel: 1_000_000, deadline_ms: 15_000, mem_cap_bytes: 128 * 1024 * 1024, max_call_depth: 50_000 };
const LIMIT_CEILINGS = { fuel: 100_000_000, deadline_ms: 600_000, mem_cap_bytes: 1_073_741_824, max_call_depth: 1_000_000 } as const;
const MAX_ACTIVE_SA_VM_PROCESSES = 2;
export function resolveTimeoutMs(
  input: { timeout_ms?: number; timeout?: number } | undefined,
  defaultMs = 15_000
): number {
  if (!input) return defaultMs;
  let val: number | undefined;
  if (typeof input.timeout_ms === "number" && Number.isFinite(input.timeout_ms) && input.timeout_ms > 0) {
    val = input.timeout_ms;
  } else if (typeof input.timeout === "number" && Number.isFinite(input.timeout) && input.timeout > 0) {
    val = input.timeout <= 300 ? input.timeout * 1000 : input.timeout;
  }
  if (val === undefined) return defaultMs;
  return Math.min(300_000, Math.max(50, Math.round(val)));
}

// ---------------------------------------------------------------------------
// .gitignore-aware exclusion
// ---------------------------------------------------------------------------

const ALWAYS_EXCLUDED_DIRS = new Set([
  "node_modules", ".git", "dist", ".turbo", ".vite", ".next", ".nuxt",
  "coverage", "build", "out", ".cache", "__pycache__", ".tox",
  "target", "release", ".codex", ".codex-ultra"
]);

interface GitIgnoreRule {
  negated: boolean;
  dirOnly: boolean;
  hasSlash: boolean;
  anchored: boolean;
  regex: RegExp;
}

function gitignoreGlobToRegex(glob: string): RegExp {
  let s = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\/\*\*\//g, "\u0001")
    .replace(/\*\*/g, "\u0000")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/\u0001/g, "(?:/|/.*/)")
    .replace(/\u0000/g, ".*");
  return new RegExp(`^${s}$`);
}

function parseGitIgnore(content: string): GitIgnoreRule[] {
  const rules: GitIgnoreRule[] = [];
  for (let line of content.split(/\r?\n/)) {
    line = line.trim();
    if (!line || line.startsWith("#")) continue;
    let negated = false;
    if (line.startsWith("!")) {
      negated = true;
      line = line.slice(1).trim();
      if (!line) continue;
    }
    let dirOnly = false;
    if (line.endsWith("/")) {
      dirOnly = true;
      line = line.slice(0, -1);
    }
    const hasSlash = line.includes("/");
    const anchored = line.startsWith("/");
    if (anchored) line = line.slice(1);
    rules.push({ negated, dirOnly, hasSlash, anchored, regex: gitignoreGlobToRegex(line) });
  }
  return rules;
}

const gitIgnoreCache = new Map<string, GitIgnoreRule[]>();

export function loadGitIgnoreRules(dir: string): GitIgnoreRule[] {
  const cached = gitIgnoreCache.get(dir);
  if (cached !== undefined) return cached;
  let rules: GitIgnoreRule[] = [];
  try {
    const content = readFileSync(join(dir, ".gitignore"), "utf8");
    rules = parseGitIgnore(content);
  } catch {
    // no .gitignore
  }
  gitIgnoreCache.set(dir, rules);
  return rules;
}

export function isGitIgnored(name: string, isDir: boolean, rules: GitIgnoreRule[], relativePath?: string): boolean {
  if (isDir && ALWAYS_EXCLUDED_DIRS.has(name)) return true;
  const rel = relativePath ? relativePath.replace(/\\/g, "/") : name;
  let ignored = false;
  for (const rule of rules) {
    if (rule.dirOnly && !isDir) continue;
    if (rule.hasSlash || rule.anchored) {
      if (rule.regex.test(rel)) {
        ignored = !rule.negated;
      }
    } else {
      if (rule.regex.test(name)) {
        ignored = !rule.negated;
      }
    }
  }
  return ignored;
}

// ---------------------------------------------------------------------------
// Large-repo guards shared by list_dir / find_files / grep_search / outline.
// ---------------------------------------------------------------------------

const DEFAULT_SEARCH_MAX_FILE_BYTES = 512 * 1024;
/** Default cap when grep targets one explicit file (not a tree walk). */
const DEFAULT_SINGLE_FILE_SEARCH_MAX_BYTES = 4 * 1024 * 1024;
const DEFAULT_OUTLINE_MAX_FILE_BYTES = 1024 * 1024;
const MAX_SEARCH_MAX_FILE_BYTES = 20 * 1024 * 1024;

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const num = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.min(max, Math.max(min, num));
}

// ---------------------------------------------------------------------------
// Unified pagination helper (MVP: grep/find/list_dir/refs/impl + diagnostics)
// Contract: page (1-based) + page_size -> { page, page_size, total,
// total_pages, returned, has_next, has_prev }. Legacy callers without
// page/page_size/offset keep byte-identical output (no envelope).
// When paginated, natives scan up to count_cap (exact_total) so total_pages
// is exact for normal result sets and honestly truncated beyond the cap.
// ---------------------------------------------------------------------------
export interface SaVmPaginationInput {
  page?: unknown;
  page_num?: unknown;
  pageNum?: unknown;
  p?: unknown;
  page_size?: unknown;
  pageSize?: unknown;
  per_page?: unknown;
  perPage?: unknown;
  offset?: unknown;
  exact_total?: unknown;
  exactTotal?: unknown;
  count_cap?: unknown;
  countCap?: unknown;
  max_total?: unknown;
}

export interface ResolvedPagination {
  page: number;
  page_size: number;
  offset: number;
  paginated: boolean;
  exactTotal: boolean;
  countCap: number;
}

export function resolvePagination(
  raw: SaVmPaginationInput & Record<string, unknown>,
  opts: { defaultSize: number; maxSize: number; legacyLimit?: unknown }
): ResolvedPagination {
  const hasPage = raw.page !== undefined || raw.page_num !== undefined || raw.pageNum !== undefined || raw.p !== undefined;
  const hasSize = raw.page_size !== undefined || raw.pageSize !== undefined || raw.per_page !== undefined || raw.perPage !== undefined;
  const hasOffset = typeof raw.offset === "number" && Number.isFinite(raw.offset as number) && (raw.offset as number) >= 0;
  const paginated = hasPage || hasSize || hasOffset;
  const legacyNum = typeof opts.legacyLimit === "number" && Number.isFinite(opts.legacyLimit as number) && (opts.legacyLimit as number) > 0
    ? Math.floor(opts.legacyLimit as number)
    : opts.defaultSize;
  const sizeRaw = raw.page_size ?? raw.pageSize ?? raw.per_page ?? raw.perPage;
  const pageSize = clampInt(sizeRaw !== undefined ? sizeRaw : legacyNum, opts.defaultSize, 1, opts.maxSize);
  const pageRaw = raw.page ?? raw.page_num ?? raw.pageNum ?? raw.p;
  const page = clampInt(pageRaw !== undefined ? pageRaw : 1, 1, 1, 100000);
  const offset = hasOffset ? Math.floor(raw.offset as number) : (page - 1) * pageSize;
  const exactTotal = raw.exact_total === true || raw.exactTotal === true || paginated;
  const capRaw = raw.count_cap ?? raw.countCap ?? raw.max_total;
  const countCap = clampInt(capRaw !== undefined ? capRaw : 2000, 2000, pageSize, 10000);
  return { page, page_size: pageSize, offset, paginated, exactTotal, countCap };
}

export function paginateItems<T>(items: T[], pg: ResolvedPagination): {
  paged: T[]; total: number; total_pages: number; returned: number; has_next: boolean; has_prev: boolean;
} {
  const total = items.length;
  const total_pages = total === 0 ? 0 : Math.ceil(total / pg.page_size);
  const paged = items.slice(pg.offset, pg.offset + pg.page_size);
  return {
    paged,
    total,
    total_pages,
    returned: paged.length,
    has_next: pg.offset + pg.page_size < total,
    has_prev: pg.offset > 0,
  };
}

function resolveMaxFileBytes(value: unknown, defaultBytes: number): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.min(MAX_SEARCH_MAX_FILE_BYTES, Math.max(1024, Math.floor(value)));
  }
  return defaultBytes;
}

function parseExcludeDirs(rawInput: SaVmRunInput): string[] {
  const record = rawInput as Record<string, unknown>;
  const raw = record.exclude_dirs ?? record.excludeDirs ?? record.exclude;
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(",") : [];
  return list
    .map((entry) => String(entry).trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, ""))
    .filter((entry) => entry.length > 0);
}

function isExcludedRelPath(relPath: string, excludeDirs: string[]): boolean {
  if (excludeDirs.length === 0) return false;
  const rel = relPath.replace(/\\/g, "/");
  const segments = rel.split("/");
  return excludeDirs.some((excluded) => {
    if (!excluded) return false;
    if (!excluded.includes("/")) return segments.includes(excluded);
    return rel === excluded || rel.startsWith(excluded + "/");
  });
}

function loadMergedGitIgnoreRules(cwd: string, targetDir: string): GitIgnoreRule[] {
  const base = loadGitIgnoreRules(cwd);
  const resolvedTarget = isAbsolute(targetDir) ? resolve(targetDir) : resolve(cwd, targetDir);
  if (resolve(cwd) === resolvedTarget) return base;
  const extra = loadGitIgnoreRules(resolvedTarget);
  if (extra.length === 0) return base;
  return [...base, ...extra];
}

function containsNulByte(text: string): boolean {
  const scanLen = Math.min(text.length, 4096);
  for (let i = 0; i < scanLen; i++) {
    if (text.charCodeAt(i) === 0) return true;
  }
  return false;
}

async function readSearchableText(
  fullPath: string,
  maxBytes: number
): Promise<{ text?: string; skipped?: "too_large" | "binary" }> {
  try {
    const fileStat = await stat(fullPath);
    if (fileStat.size > maxBytes) return { skipped: "too_large" };
  } catch {
    return {};
  }
  let text: string;
  try {
    text = await readFile(fullPath, "utf8");
  } catch {
    return {};
  }
  if (containsNulByte(text)) return { skipped: "binary" };
  return { text };
}

function hasGlobMagic(value: string): boolean {
  return /[*?[]/.test(value);
}

function resolveGlobRoot(pattern: string, cwd: string): string {
  const normalized = pattern.replace(/\\/g, "/");
  const segments = normalized.split("/");
  const firstMagic = segments.findIndex((segment) => hasGlobMagic(segment));
  if (firstMagic < 0) return resolve(cwd, pattern);
  const staticPrefix = segments.slice(0, firstMagic).join("/");
  if (isAbsolute(pattern)) {
    const root = staticPrefix || normalized.split("/").slice(0, 3).join("/");
    return resolve(root || cwd);
  }
  return resolve(cwd, staticPrefix || ".");
}

async function expandCandidateFileGlob(
  pattern: string,
  cwd: string,
  policy: NormalizedSaVmPolicy,
  startedAt: number,
  timeoutMs: number
): Promise<string[]> {
  const normalizedPattern = pattern.replace(/\\/g, "/");
  const absolutePattern = isAbsolute(pattern);
  const regex = gitignoreGlobToRegex(absolutePattern ? normalizedPattern : normalizedPattern.replace(/^\.\//, ""));
  const root = resolveGlobRoot(pattern, cwd);
  const rootDecision = checkSaVmPath(policy, "read", root, cwd);
  if (!rootDecision.allowed) return [];

  const rules = loadGitIgnoreRules(cwd);
  const results: string[] = [];
  const queue: string[] = [root];
  while (queue.length > 0 && results.length < 2000 && Date.now() - startedAt <= timeoutMs) {
    const current = queue.shift()!;
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (results.length >= 2000 || Date.now() - startedAt > timeoutMs) break;
      const fullPath = join(current, entry.name);
      const relativePath = relative(cwd, fullPath).replace(/\\/g, "/");
      if (isGitIgnored(entry.name, entry.isDirectory(), rules, relativePath)) continue;
      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }
      if (entry.isFile()) {
        const testTarget = absolutePattern ? fullPath.replace(/\\/g, "/") : relativePath;
        if (regex.test(testTarget)) {
          const decision = checkSaVmPath(policy, "read", fullPath, cwd);
          if (decision.allowed) results.push(fullPath);
        }
      }
    }
  }
  return results;
}


const MAX_WAITING_SA_VM_TASKS = 64;
const SA_VM_TEMP_PREFIX = "codex-ultra-sa-vm-";
const SA_VM_STALE_TEMP_MS = 60 * 60 * 1_000;

class AsyncSemaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  async acquire(): Promise<() => void> {
    if (this.active < MAX_ACTIVE_SA_VM_PROCESSES) {
      this.active += 1;
      return () => this.release();
    }
    if (this.waiters.length >= MAX_WAITING_SA_VM_TASKS) {
      throw new SaVmInputError("SA-VM is busy; wait for an active VM task to finish");
    }
    await new Promise<void>((resolveWaiter) => this.waiters.push(resolveWaiter));
    return () => this.release();
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next) next();
    else this.active = Math.max(0, this.active - 1);
  }
}

const saVmProcessSemaphore = new AsyncSemaphore();
let staleCleanupPromise: Promise<void> | null = null;
let staleCleanupAt = 0;

function cleanupStaleSaVmTempRoots(): Promise<void> {
  const now = Date.now();
  if (staleCleanupPromise && now - staleCleanupAt < 5 * 60 * 1_000) return staleCleanupPromise;
  staleCleanupAt = now;
  staleCleanupPromise = (async () => {
    const cutoff = Date.now() - SA_VM_STALE_TEMP_MS;
    let entries;
    try {
      entries = await readdir(tmpdir(), { withFileTypes: true });
    } catch {
      return;
    }
    await Promise.all(entries
      .filter((entry) => entry.isDirectory() && entry.name.startsWith(SA_VM_TEMP_PREFIX))
      .map(async (entry) => {
        const root = join(tmpdir(), entry.name);
        try {
          const details = await stat(root);
          if (details.mtimeMs < cutoff) await rm(root, { recursive: true, force: true });
        } catch {
          // Best-effort cleanup; the active invocation owns its own finally path.
        }
      }));
  })().finally(() => { staleCleanupPromise = null; });
  return staleCleanupPromise;
}

async function backupExistingFileBeforeWrite(
  resolvedPath: string,
  existingContent: string,
  policy: NormalizedSaVmPolicy,
  cwd: string
): Promise<void> {
  const backupDir = policy.fs.backupDir;
  if (!backupDir) return;
  const backupRoot = isAbsolute(backupDir) ? resolve(backupDir.replace(/\/\*\*$/, "")) : resolve(cwd, backupDir.replace(/\/\*\*$/, ""));
  const rel = relative(cwd, resolvedPath).replace(/^[\\/]+/, "");
  const backupPath = resolve(backupRoot, `${rel}.${Date.now()}.bak`);
  await mkdir(dirname(backupPath), { recursive: true });
  await writeFile(backupPath, existingContent, "utf8");
}

function estimateTokenCount(text: string): number {
  if (!text) return 0;
  let cjkCount = 0;
  let asciiCount = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0x4e00 && code <= 0x9fff) {
      cjkCount++;
    } else {
      asciiCount++;
    }
  }
  return Math.ceil(cjkCount * 0.8 + asciiCount / 3.5);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export interface NativeReadFileOptions {
  startLine?: number;
  endLine?: number;
  offset?: number;
  maxTokens?: number;
  remainingTokens?: number;
  maxBytes?: number;
  maxLines?: number;
  maxLineLength?: number;
  numbered?: boolean;
}

async function nativeReadFile(
  path: string,
  options: NativeReadFileOptions | number,
  policy: SaVmPolicyConfig | undefined,
  cwd: string,
  startedAt: number
): Promise<SaVmRunResult> {
  const opts: NativeReadFileOptions = typeof options === "number" ? { maxBytes: options } : (options ?? {});
  const resolved = isAbsolute(path) ? resolve(path) : resolve(cwd, path);
  const normalizedPolicy = normalizeSaVmPolicy(policy, cwd);
  const decision = checkSaVmPath(normalizedPolicy, "read", resolved, cwd);
  if (!decision.allowed) {
    return {
      ok: false,
      kind: "capability_denied",
      exitCode: 228,
      stdout: "",
      stderr: decision.reason,
      saVmEvents: [],
      saVmViolation: decision.reason ? { reason: decision.reason } : null,
      durationMs: Date.now() - startedAt
    };
  }

  try {
    const stats = await stat(resolved);
    if (stats.isDirectory()) {
      return {
        ok: false,
        kind: "sa_error",
        exitCode: 1,
        stdout: "",
        stderr: `EISDIR: illegal operation on a directory, read '${path}'. Use list_dir to browse it instead.`,
        saVmEvents: [],
        saVmViolation: null,
        durationMs: Date.now() - startedAt
      };
    }

    const fileSize = stats.size;
    if (fileSize === 0) {
      return {
        ok: true,
        kind: "success",
        exitCode: 0,
        stdout: `[File: ${path} is empty (0 bytes)]`,
        stderr: "",
        saVmEvents: [],
        saVmViolation: null,
        durationMs: Date.now() - startedAt
      };
    }

    // OPT-1: large-file gate (locateBeforeRead)
    // IMPORTANT: Targeted reading (read_lines with startLine/endLine, offset, or maxLines)
    // is specifically designed to read slices of files and must NEVER be blocked by locateBeforeRead!
    const isTargetedRead = typeof opts.startLine === "number" || typeof opts.endLine === "number" || typeof opts.offset === "number" || typeof opts.maxLines === "number";
    const savings = normalizedPolicy.contextSavings;
    if (savings?.locateBeforeRead === true && !isTargetedRead) {
      const maxBytes = savings.maxReadFileBytes ?? 50 * 1024;
      if (fileSize > maxBytes) {
        return {
          ok: false,
          kind: "capability_denied",
          exitCode: 228,
          stdout: "",
          stderr: `[OPT-1] read_file rejected: ${path} is ${formatBytes(fileSize)} which exceeds the ${formatBytes(maxBytes)} limit. Use read_lines with start_line/end_line for targeted reading, or find_references to locate symbols first.`,
          saVmEvents: [],
          saVmViolation: { rule: "contextSavings.locateBeforeRead", blocked: false },
          durationMs: Date.now() - startedAt
        };
      }
    }

    const buf = await readFile(resolved);
    // Binary check
    const checkLen = Math.min(buf.length, 4096);
    let isBinary = false;
    for (let i = 0; i < checkLen; i++) {
      if (buf[i] === 0) {
        isBinary = true;
        break;
      }
    }
    if (isBinary) {
      const imageHint = /\.(png|jpe?g|webp|gif|bmp|avif|svg|ico)$/i.test(path)
        ? ` If this is an image, inspect it with image_view instead of reading bytes.`
        : "";
      return {
        ok: true,
        kind: "success",
        exitCode: 0,
        stdout: `[Binary file detected: ${path} (${formatBytes(fileSize)}). Text viewing is disabled to prevent context corruption.]${imageHint}`,
        stderr: "",
        saVmEvents: [],
        saVmViolation: null,
        durationMs: Date.now() - startedAt
      };
    }

    const fullText = buf.toString("utf8");

    // Token budget resolution (aligned with Codex core design)
    // 1. Requested tokens or default:
    // Codex uses DEFAULT_MAX_OUTPUT_TOKENS = 10,000 as default execution budget.
    // For conversational file reading, default is 4,000 tokens (or explicit maxTokens).
    const requestedTokens = typeof opts.maxTokens === "number" && opts.maxTokens > 0
      ? opts.maxTokens
      : 4000;

    // 2. Remaining context tokens (剩下 tokens) dynamic clamping:
    // When remaining tokens is known from session/context window status:
    // Reserve safety headroom (default 3,000 tokens for system prompt, tool protocol framing, and model response).
    // The usable budget cannot exceed (remainingTokens - headroom).
    const remainingTokens = typeof opts.remainingTokens === "number" && opts.remainingTokens > 0
      ? opts.remainingTokens
      : undefined;

    let maxTokens = requestedTokens;
    if (remainingTokens !== undefined) {
      const reservedHeadroom = 3000;
      const safeRemainingBudget = Math.max(500, remainingTokens - reservedHeadroom);
      maxTokens = Math.min(requestedTokens, safeRemainingBudget);
    } else {
      // When remaining tokens is unknown, do not hardcode an arbitrary 8k cap!
      // Allow up to 32,000 tokens for explicit requests.
      maxTokens = Math.min(requestedTokens, 32000);
    }

    const tokenCapNotice = remainingTokens !== undefined
      ? ` (bounded by context tokens remaining: ${remainingTokens}, headroom reserved: 3000)`
      : "";

    const maxBytes = typeof opts.maxBytes === "number" && opts.maxBytes > 0
      ? opts.maxBytes
      : Math.min(maxTokens * 4, 131072);
    const maxLines = typeof opts.maxLines === "number" && opts.maxLines > 0
      ? Math.min(opts.maxLines, 1000)
      : 250;
    const maxLineLength = typeof opts.maxLineLength === "number" && opts.maxLineLength > 0
      ? Math.min(opts.maxLineLength, 4000)
      : 2000;
    const numbered = opts.numbered !== false;
    const offset = typeof opts.offset === "number" && opts.offset >= 0 ? Math.floor(opts.offset) : 0;

    const lines = fullText.split(/\r?\n/);
    const totalLines = lines.length;
    const totalChars = fullText.length;

    // Detect minified code or ultra-long lines (e.g. minified JS bundle in 1 line or few long lines)
    const isMinified = (totalLines <= 5 && totalChars > 2048) || lines.some(l => l.length > maxLineLength);

    // Case 1: If offset > 0, or (single-line minified file without explicit start_line/end_line)
    // Read character chunk directly
    if (offset > 0 || (isMinified && totalLines === 1 && opts.startLine === undefined && opts.endLine === undefined)) {
      const startOffset = Math.max(0, offset);
      const chunkTargetChars = Math.min(maxTokens * 3, maxBytes);
      const endOffset = Math.min(startOffset + chunkTargetChars, totalChars);
      const chunk = fullText.slice(startOffset, endOffset);
      const approxTokens = estimateTokenCount(chunk);
      const remainingChars = totalChars - endOffset;

      let out = `[File: ${path} | Size: ${formatBytes(fileSize)} | Total Chars: ${totalChars} | Minified single-line code]\n`;
      out += `[Notice: Output strictly bounded by max_tokens=${maxTokens}${tokenCapNotice} to prevent context overflow]\n`;
      out += `[Viewing characters ${startOffset} to ${endOffset} (${endOffset - startOffset} chars, approx ${approxTokens} tokens)]\n\n`;
      out += chunk;

      if (remainingChars > 0) {
        out += `\n\n[... Truncated: ${remainingChars} characters remaining. To view next chunk, call read_file with path: "${path}", offset: ${endOffset}, max_tokens: ${maxTokens}]`;
      }

      return {
        ok: true,
        kind: "success",
        exitCode: 0,
        stdout: out,
        stderr: "",
        saVmEvents: [],
        saVmViolation: null,
        durationMs: Date.now() - startedAt
      };
    }

    // Case 2: Multi-line files (or minified files read by line ranges)
    const startLine = typeof opts.startLine === "number" && opts.startLine > 0 ? Math.floor(opts.startLine) : 1;
    let endLine = typeof opts.endLine === "number" && opts.endLine >= startLine
      ? Math.floor(opts.endLine)
      : startLine + maxLines - 1;
    if (endLine > totalLines) {
      endLine = totalLines;
    }
    if (endLine - startLine + 1 > maxLines) {
      endLine = startLine + maxLines - 1;
    }

    const selectedLines = lines.slice(startLine - 1, endLine);
    const isLineSlice = startLine > 1 || endLine < totalLines;

    const padWidth = Math.max(String(endLine).length, 3);
    const formattedLines: string[] = [];
    let accumulatedTokens = 0;
    let accumulatedBytes = 0;
    let tokenCappedAtLine = -1;

    for (let i = 0; i < selectedLines.length; i++) {
      const lineNum = startLine + i;
      let line = selectedLines[i]!;
      const origLineLen = line.length;

      // Handle compressed/minified JS lines that are abnormally long
      if (origLineLen > maxLineLength) {
        line = line.slice(0, maxLineLength) +
          ` ... [Line ${lineNum} truncated: showing first ${maxLineLength} of ${origLineLen} chars (minified line). Use offset with read_file or grep_search to inspect specific tokens]`;
      }

      const lineStr = numbered
        ? `${String(lineNum).padStart(padWidth, " ")}: ${line}`
        : line;

      const lineTokens = estimateTokenCount(lineStr);
      const lineBytes = Buffer.byteLength(lineStr, "utf8") + 1;

      if ((accumulatedTokens + lineTokens > maxTokens || accumulatedBytes + lineBytes > maxBytes) && i > 0) {
        tokenCappedAtLine = lineNum - 1;
        break;
      }

      formattedLines.push(lineStr);
      accumulatedTokens += lineTokens;
      accumulatedBytes += lineBytes;
    }

    const actualEndLine = tokenCappedAtLine > 0 ? tokenCappedAtLine : endLine;
    const hasMore = actualEndLine < totalLines;

    let resultText = "";
    if (isLineSlice || hasMore || isMinified) {
      resultText += `[File: ${path} | Total Lines: ${totalLines} | Total Size: ${formatBytes(fileSize)}${isMinified ? " | Notice: Contains minified/long-line code" : ""}]\n`;
      resultText += `[Showing lines ${startLine} to ${actualEndLine} of ${totalLines} (approx ${accumulatedTokens} tokens)]\n\n`;
    }

    resultText += formattedLines.join("\n");

    if (hasMore) {
      const remainingLines = totalLines - actualEndLine;
      const nextStart = actualEndLine + 1;
      const nextEnd = Math.min(totalLines, nextStart + maxLines - 1);
      const reason = tokenCappedAtLine > 0
        ? `reached token budget of ${maxTokens} tokens${tokenCapNotice}`
        : "page limit reached";
      resultText += `\n\n[... ${remainingLines} more lines truncated (${reason}). Call read_file with path: "${path}", start_line: ${nextStart}, end_line: ${nextEnd}, max_tokens: ${maxTokens} to view next slice]`;
    }

    return {
      ok: true,
      kind: "success",
      exitCode: 0,
      stdout: resultText,
      stderr: "",
      saVmEvents: [],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  } catch (err: unknown) {
    const isEnoent = (err as { code?: string })?.code === "ENOENT" || String(err).includes("ENOENT");
    if (isEnoent) {
      return {
        ok: true,
        kind: "success",
        exitCode: 0,
        stdout: JSON.stringify({
          path: relative(cwd, resolved).replace(/\\/g, "/") || path,
          exists: false,
          lines: [],
          total_lines: 0
        }, null, 2),
        stderr: "",
        saVmEvents: [],
        saVmViolation: null,
        durationMs: Date.now() - startedAt
      };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      kind: "sa_error",
      exitCode: 1,
      stdout: "",
      stderr: msg,
      saVmEvents: [],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  }
}

async function nativeReadLines(
  path: string,
  startLine: number,
  endLine: number,
  optionsOrMaxBytes: { maxTokens?: number; maxBytes?: number; maxLineLength?: number; numbered?: boolean } | number | undefined,
  policy: SaVmPolicyConfig | undefined,
  cwd: string,
  startedAt: number
): Promise<SaVmRunResult> {
  const extraOpts = typeof optionsOrMaxBytes === "number"
    ? { maxBytes: optionsOrMaxBytes }
    : (optionsOrMaxBytes ?? {});
  return await nativeReadFile(path, {
    startLine,
    endLine,
    ...extraOpts
  }, policy, cwd, startedAt);
}

async function nativeReadFileTail(
  path: string,
  options: {
    lines?: number;
    maxTokens?: number;
    remainingTokens?: number;
    maxBytes?: number;
    maxLineLength?: number;
    numbered?: boolean;
  } | undefined,
  policy: SaVmPolicyConfig | undefined,
  cwd: string,
  startedAt: number
): Promise<SaVmRunResult> {
  const resolved = isAbsolute(path) ? resolve(path) : resolve(cwd, path);
  const normalizedPolicy = normalizeSaVmPolicy(policy, cwd);
  const decision = checkSaVmPath(normalizedPolicy, "read", resolved, cwd);
  if (!decision.allowed) {
    return {
      ok: false,
      kind: "capability_denied",
      exitCode: 228,
      stdout: "",
      stderr: decision.reason,
      saVmEvents: [],
      saVmViolation: decision.reason ? { reason: decision.reason } : null,
      durationMs: Date.now() - startedAt
    };
  }

  try {
    const stats = await stat(resolved);
    if (stats.isDirectory()) {
      return {
        ok: false,
        kind: "sa_error",
        exitCode: 1,
        stdout: "",
        stderr: `EISDIR: illegal operation on a directory, read '${path}'. Use list_dir to browse it instead.`,
        saVmEvents: [],
        saVmViolation: null,
        durationMs: Date.now() - startedAt
      };
    }

    const fileSize = stats.size;
    if (fileSize === 0) {
      return {
        ok: true,
        kind: "success",
        exitCode: 0,
        stdout: `[File: ${path} is empty (0 bytes)]`,
        stderr: "",
        saVmEvents: [],
        saVmViolation: null,
        durationMs: Date.now() - startedAt
      };
    }

    const requestedTokens = typeof options?.maxTokens === "number" && options.maxTokens > 0
      ? options.maxTokens
      : 4000;
    const remainingTokens = typeof options?.remainingTokens === "number" && options.remainingTokens > 0
      ? options.remainingTokens
      : undefined;

    let maxTokens = requestedTokens;
    if (remainingTokens !== undefined) {
      const reservedHeadroom = 3000;
      const safeRemainingBudget = Math.max(500, remainingTokens - reservedHeadroom);
      maxTokens = Math.min(requestedTokens, safeRemainingBudget);
    } else {
      maxTokens = Math.min(requestedTokens, 32000);
    }

    const maxBytes = typeof options?.maxBytes === "number" && options.maxBytes > 0
      ? options.maxBytes
      : Math.min(maxTokens * 4, 131072);
    const maxLineLength = typeof options?.maxLineLength === "number" && options.maxLineLength > 0
      ? Math.min(options.maxLineLength, 4000)
      : 2000;
    const targetLinesCount = typeof options?.lines === "number" && options.lines > 0
      ? Math.min(Math.floor(options.lines), 1000)
      : 100;
    const numbered = options?.numbered !== false;

    const handle = await open(resolved, "r");
    let tailBuffer: Buffer;
    let reachedStartOfFile = false;

    try {
      const readChunkSize = 64 * 1024;
      let totalBytesRead = 0;
      const bufferChunks: Buffer[] = [];
      let newlinesFound = 0;
      let currentPosition = fileSize;

      while (currentPosition > 0 && totalBytesRead < maxBytes && newlinesFound < targetLinesCount + 1) {
        const bytesToRead = Math.min(readChunkSize, currentPosition, maxBytes - totalBytesRead);
        const readOffset = currentPosition - bytesToRead;
        const chunk = Buffer.alloc(bytesToRead);
        const { bytesRead } = await handle.read(chunk, 0, bytesToRead, readOffset);
        if (bytesRead === 0) break;

        const slice = chunk.subarray(0, bytesRead);
        bufferChunks.unshift(slice);
        totalBytesRead += bytesRead;
        currentPosition = readOffset;

        for (let i = 0; i < slice.length; i++) {
          if (slice[i] === 0x0A) {
            newlinesFound++;
          }
        }

        if (readOffset === 0) {
          reachedStartOfFile = true;
          break;
        }
      }

      tailBuffer = Buffer.concat(bufferChunks);
    } finally {
      await handle.close();
    }

    const checkLen = Math.min(tailBuffer.length, 4096);
    for (let i = 0; i < checkLen; i++) {
      if (tailBuffer[i] === 0) {
        return {
          ok: true,
          kind: "success",
          exitCode: 0,
          stdout: `[Binary file detected: ${path} (${formatBytes(fileSize)}). Text viewing is disabled to prevent context corruption.]`,
          stderr: "",
          saVmEvents: [],
          saVmViolation: null,
          durationMs: Date.now() - startedAt
        };
      }
    }

    const text = tailBuffer.toString("utf8");
    const allLines = text.split(/\r?\n/);

    if (!reachedStartOfFile && allLines.length > 1) {
      allLines.shift();
    }
    if (allLines.length > 0 && allLines[allLines.length - 1] === "") {
      allLines.pop();
    }

    const selectedLines = allLines.slice(-targetLinesCount);
    const linesToKeep: string[] = [];
    let accumulatedTokens = 0;
    let accumulatedBytes = 0;
    let tokenCapped = false;

    for (let i = selectedLines.length - 1; i >= 0; i--) {
      let line = selectedLines[i]!;
      if (line.length > maxLineLength) {
        line = line.slice(0, maxLineLength) + ` ... [Line truncated: showing first ${maxLineLength} chars]`;
      }
      const lineTokens = estimateTokenCount(line);
      const lineBytes = Buffer.byteLength(line, "utf8") + 1;

      if (accumulatedTokens + lineTokens > maxTokens || accumulatedBytes + lineBytes > maxBytes) {
        tokenCapped = true;
        break;
      }
      linesToKeep.unshift(line);
      accumulatedTokens += lineTokens;
      accumulatedBytes += lineBytes;
    }

    const padWidth = Math.max(String(linesToKeep.length).length, 3);
    const formattedLines: string[] = [];
    for (let i = 0; i < linesToKeep.length; i++) {
      const line = linesToKeep[i]!;
      const displayLineNum = reachedStartOfFile
        ? (allLines.length - linesToKeep.length + 1 + i)
        : `-${linesToKeep.length - i}`;
      const lineStr = numbered
        ? `${String(displayLineNum).padStart(padWidth, " ")}: ${line}`
        : line;
      formattedLines.push(lineStr);
    }

    let header = `[File: ${path} | Size: ${formatBytes(fileSize)} | Mode: Tail reading]\n`;
    if (reachedStartOfFile) {
      header += `[Showing lines ${allLines.length - linesToKeep.length + 1} to ${allLines.length} of ${allLines.length} (last ${linesToKeep.length} lines, approx ${accumulatedTokens} tokens)]\n\n`;
    } else {
      header += `[Showing trailing ${linesToKeep.length} lines from end of file (approx ${accumulatedTokens} tokens)]\n`;
      header += `[Tip: Use read_lines with specific line ranges for earlier sections]\n\n`;
    }

    let resultText = header + formattedLines.join("\n");
    if (tokenCapped) {
      resultText = `[Notice: Output truncated by max_tokens=${maxTokens}]\n` + resultText;
    }

    return {
      ok: true,
      kind: "success",
      exitCode: 0,
      stdout: resultText,
      stderr: "",
      saVmEvents: [],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  } catch (err: unknown) {
    const isEnoent = (err as { code?: string })?.code === "ENOENT" || String(err).includes("ENOENT");
    if (isEnoent) {
      return {
        ok: true,
        kind: "success",
        exitCode: 0,
        stdout: JSON.stringify({
          path: relative(cwd, resolved).replace(/\\/g, "/") || path,
          exists: false,
          lines: [],
          total_lines: 0
        }, null, 2),
        stderr: "",
        saVmEvents: [],
        saVmViolation: null,
        durationMs: Date.now() - startedAt
      };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      kind: "sa_error",
      exitCode: 1,
      stdout: "",
      stderr: `read_file_tail failed: ${msg}`,
      saVmEvents: [],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  }
}

export function compileSearchMatcher(
  query: string,
  isRegex?: boolean,
  caseSensitive?: boolean
): (content: string) => boolean {
  if (!query) return () => false;
  const hasRegexToken = query.includes("|") || /\\b|\.\*|\.\+|\^|\$|\[.*\]|\(.*\)/.test(query);
  const useRegex = isRegex === true || (isRegex !== false && hasRegexToken);
  if (useRegex) {
    try {
      const flags = caseSensitive ? "m" : "im";
      const rx = new RegExp(query, flags);
      return (content: string) => rx.test(content);
    } catch {
      // invalid regex pattern; gracefully fall back to literal
    }
  }
  if (caseSensitive) {
    return (content: string) => content.includes(query);
  }
  const lower = query.toLowerCase();
  return (content: string) => content.toLowerCase().includes(lower);
}

export function matchesFilePattern(
  fileName: string,
  relPath: string,
  pattern: string,
  pathPattern?: string,
  isRegex?: boolean
): boolean {
  if (pathPattern && pathPattern.trim()) {
    const pathMatcher = compileSearchMatcher(pathPattern.trim(), isRegex);
    if (!pathMatcher(relPath) && !pathMatcher(fileName)) return false;
  }
  if (!pattern || pattern === "*") return true;
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  try {
    const re = new RegExp(`^${escaped}$`, "i");
    if (re.test(fileName) || re.test(relPath)) return true;
  } catch {
    // fallback
  }
  const cleanPat = pattern.replace(/\*/g, "");
  return fileName.includes(cleanPat) || relPath.includes(cleanPat);
}

async function nativeFindFiles(
  dir: string,
  pattern: string,
  maxEntries: number,
  maxDepth: number,
  policy: SaVmPolicyConfig | undefined,
  cwd: string,
  startedAt: number,
  timeoutOpts?: { timeout_ms?: number; timeout?: number },
  extraOpts?: { path_pattern?: string; is_regex?: boolean; regex?: boolean; page?: unknown; page_num?: unknown; pageNum?: unknown; p?: unknown; page_size?: unknown; pageSize?: unknown; per_page?: unknown; perPage?: unknown; offset?: unknown; count_cap?: unknown; countCap?: unknown; max_total?: unknown; exact_total?: unknown; exactTotal?: unknown }
): Promise<SaVmRunResult> {
  const resolvedDir = isAbsolute(dir) ? resolve(dir) : resolve(cwd, dir);
  const normalizedPolicy = normalizeSaVmPolicy(policy, cwd);
  const decision = checkSaVmPath(normalizedPolicy, "read", resolvedDir, cwd);
  if (!decision.allowed) {
    return {
      ok: false,
      kind: "capability_denied",
      exitCode: 228,
      stdout: "",
      stderr: decision.reason,
      saVmEvents: [],
      saVmViolation: decision.reason ? { reason: decision.reason } : null,
      durationMs: Date.now() - startedAt
    };
  }

  const results: string[] = [];
  const limit = maxEntries > 0 ? maxEntries : 100;
  const depthLimit = maxDepth > 0 ? maxDepth : 5;
  const timeoutMs = resolveTimeoutMs(timeoutOpts, 15_000);
  let isTimedOut = false;
  const giRules = loadMergedGitIgnoreRules(cwd, dir);
  const effectiveIsRegex = extraOpts?.is_regex ?? extraOpts?.regex;
  const pg = resolvePagination(extraOpts ?? {}, { defaultSize: limit, maxSize: 500, legacyLimit: limit });
  const scanCap = pg.paginated ? pg.countCap : limit;
  let truncatedByCap = false;

  async function walk(currentDir: string, currentDepth: number): Promise<void> {
    if (currentDepth > depthLimit || results.length >= scanCap || isTimedOut) return;
    if (Date.now() - startedAt > timeoutMs) {
      isTimedOut = true;
      return;
    }
    let entries;
    try {
      entries = await readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (results.length >= scanCap || isTimedOut) {
        if (results.length >= scanCap) truncatedByCap = true;
        break;
      }
      if (Date.now() - startedAt > timeoutMs) {
        isTimedOut = true;
        break;
      }
      if (isGitIgnored(entry.name, entry.isDirectory(), giRules, relative(cwd, join(currentDir, entry.name)).replace(/\\/g, "/"))) continue;

      const fullPath = join(currentDir, entry.name);
      const relPath = relative(resolvedDir, fullPath).replace(/\\/g, "/");
      const displayPath = dir === "." || dir === "" ? relPath : join(dir, relPath).replace(/\\/g, "/");

      if (entry.isDirectory()) {
        await walk(fullPath, currentDepth + 1);
      } else if (matchesFilePattern(entry.name, relPath, pattern, extraOpts?.path_pattern, effectiveIsRegex)) {
        const fileDecision = checkSaVmPath(normalizedPolicy, "read", fullPath, cwd);
        if (fileDecision.allowed) {
          results.push(displayPath);
        }
      }
    }
  }

  try {
    await walk(resolvedDir, 1);
    if (isTimedOut && results.length === 0) {
      return {
        ok: false,
        kind: "timeout",
        exitCode: 124,
        stdout: "[]",
        stderr: `find_files timed out after ${timeoutMs}ms`,
        saVmEvents: [],
        saVmViolation: null,
        durationMs: Date.now() - startedAt
      };
    }
    if (pg.paginated) {
      results.sort((a, b) => a.localeCompare(b));
      const s = paginateItems(results, pg);
      const truncated = isTimedOut || truncatedByCap || results.length >= scanCap;
      return {
        ok: true,
        kind: "success",
        exitCode: 0,
        stdout: JSON.stringify({
          dir,
          pattern,
          page: pg.page,
          page_size: pg.page_size,
          total: results.length,
          total_pages: s.total_pages,
          returned: s.returned,
          has_next: truncated ? true : s.has_next,
          has_prev: s.has_prev,
          truncated,
          timed_out: isTimedOut ? true : undefined,
          files: s.paged,
        }, null, 2),
        stderr: [
          isTimedOut ? `[timeout] find_files reached timeout limit of ${timeoutMs}ms; returning ${results.length} files` : "",
          truncatedByCap ? `[find_files] results capped at count_cap=${scanCap}; narrow pattern/dir or raise count_cap for exact total_pages` : "",
        ].filter(Boolean).join(" "),
        saVmEvents: [],
        saVmViolation: null,
        durationMs: Date.now() - startedAt
      };
    }
    const legacy = pg.paginated ? results.slice(pg.offset, pg.offset + pg.page_size) : results.slice(0, limit);
    return {
      ok: true,
      kind: "success",
      exitCode: 0,
      stdout: legacy.join("\n"),
      stderr: isTimedOut ? `[timeout] find_files reached timeout limit of ${timeoutMs}ms; returning ${results.length} files` : "",
      saVmEvents: [],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      kind: "sa_error",
      exitCode: 1,
      stdout: "",
      stderr: msg,
      saVmEvents: [],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  }
}

async function nativeWriteFile(
  path: string,
  content: string,
  policy: SaVmPolicyConfig | undefined,
  cwd: string,
  startedAt: number,
  options?: { replaceAll?: boolean; manualOverride?: boolean }
): Promise<SaVmRunResult> {
  const resolved = isAbsolute(path) ? resolve(path) : resolve(cwd, path);
  const normalizedPolicy = normalizeSaVmPolicy(policy, cwd);
  const decision = checkSaVmPath(normalizedPolicy, "write", resolved, cwd);
  if (!decision.allowed) {
    return {
      ok: false,
      kind: "capability_denied",
      exitCode: 228,
      stdout: "",
      stderr: decision.reason,
      saVmEvents: [],
      saVmViolation: decision.reason ? { reason: decision.reason } : null,
      durationMs: Date.now() - startedAt
    };
  }

  // Accountability & autonomous JEV supervision gate
  const gate = await checkAccountabilityWriteGate({
    targetFile: resolved,
    proposedChanges: content,
    cwd,
    policy,
    customLedgerPath: policy?.accountability?.ledgerPath,
    manualOverride: options?.manualOverride,
  });
  if (!gate.allowed) {
    return {
      ok: false,
      kind: gate.kind ?? "capability_denied",
      exitCode: 228,
      stdout: "",
      stderr: gate.reason ?? "Accountability gate rejection",
      saVmEvents: [{ event: "violation", kind: "accountability_gate", reason: gate.reason }],
      saVmViolation: gate.reason ? { reason: gate.reason } : null,
      durationMs: Date.now() - startedAt
    };
  }

  try {
    try {
      const existing = await readFile(resolved, "utf8");
      await backupExistingFileBeforeWrite(resolved, existing, normalizedPolicy, cwd);
    } catch {
      // file doesn't exist yet
    }
    await mkdir(dirname(resolved), { recursive: true });
    await writeFile(resolved, content, "utf8");
    let stdout = `Successfully wrote ${Buffer.byteLength(content, "utf8")} bytes to ${path}`;
    if (gate.notice) {
      stdout += `\n\n${gate.notice}`;
    }
    if (gate.antibodyNotice) {
      stdout += `\n\n${gate.antibodyNotice}`;
    }
    return {
      ok: true,
      kind: "success",
      exitCode: 0,
      stdout,
      stderr: "",
      saVmEvents: [],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      kind: "sa_error",
      exitCode: 1,
      stdout: "",
      stderr: msg,
      saVmEvents: [],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  }
}

async function nativeEditFile(
  path: string,
  oldText: string,
  newText: string,
  policy: SaVmPolicyConfig | undefined,
  cwd: string,
  startedAt: number,
  options?: { replaceAll?: boolean; manualOverride?: boolean }
): Promise<SaVmRunResult> {
  const resolved = isAbsolute(path) ? resolve(path) : resolve(cwd, path);
  const normalizedPolicy = normalizeSaVmPolicy(policy, cwd);
  const decision = checkSaVmPath(normalizedPolicy, "write", resolved, cwd);
  if (!decision.allowed) {
    return {
      ok: false,
      kind: "capability_denied",
      exitCode: 228,
      stdout: "",
      stderr: decision.reason,
      saVmEvents: [],
      saVmViolation: decision.reason ? { reason: decision.reason } : null,
      durationMs: Date.now() - startedAt
    };
  }

  // Accountability & autonomous JEV supervision gate
  const gate = await checkAccountabilityWriteGate({
    targetFile: resolved,
    proposedChanges: `<<<<<<< OLD\n${oldText}\n=======\n${newText}\n>>>>>>> NEW`,
    cwd,
    policy,
    customLedgerPath: policy?.accountability?.ledgerPath,
    manualOverride: options?.manualOverride,
  });
  if (!gate.allowed) {
    return {
      ok: false,
      kind: gate.kind ?? "capability_denied",
      exitCode: 228,
      stdout: "",
      stderr: gate.reason ?? "Accountability gate rejection",
      saVmEvents: [{ event: "violation", kind: "accountability_gate", reason: gate.reason }],
      saVmViolation: gate.reason ? { reason: gate.reason } : null,
      durationMs: Date.now() - startedAt
    };
  }
  try {
    const content = await readFile(resolved, "utf8");
    if (!oldText) {
      return {
        ok: false,
        kind: "sa_error",
        exitCode: 1,
        stdout: "",
        stderr: `edit_file needs non-empty old_text for ${path}. Example: {"action":"edit_file","path":"${path}","old_text":"<exact unique snippet>","new_text":"<replacement>"}`,
        saVmEvents: [],
        saVmViolation: null,
        durationMs: Date.now() - startedAt
      };
    }

    // Try exact match first (fastest path)
    let matchContent = content;
    let matchOldText = oldText;
    let matchNewText = newText;
    let lineEndingNormalized = false;

    if (!matchContent.includes(matchOldText)) {
      // CRLF tolerance: if old_text has \n but file has \r\n (or vice versa),
      // normalize both to LF for matching. This is the #1 cause of multi-line
      // edit_file failures on Windows CRLF files.
      const contentLF = content.replace(/\r\n/g, "\n");
      const oldTextLF = oldText.replace(/\r\n/g, "\n");
      if (contentLF.includes(oldTextLF)) {
        matchContent = contentLF;
        matchOldText = oldTextLF;
        matchNewText = newText.replace(/\r\n/g, "\n");
        lineEndingNormalized = true;
      }
    }

    if (!matchContent.includes(matchOldText)) {
      return {
        ok: false,
        kind: "sa_error",
        exitCode: 1,
        stdout: "",
        stderr: `old_text not found in file: ${path}`,
        saVmEvents: [],
        saVmViolation: null,
        durationMs: Date.now() - startedAt
      };
    }
    const firstIdx = matchContent.indexOf(matchOldText);
    const lastIdx = matchContent.lastIndexOf(matchOldText);
    const replaceAll = options?.replaceAll === true;
    if (firstIdx !== lastIdx && !replaceAll) {
      return {
        ok: false,
        kind: "sa_error",
        exitCode: 1,
        stdout: "",
        stderr: `old_text occurs multiple times in file: ${path}. Please specify more unique context or set replaceAll=true.`,
        saVmEvents: [],
        saVmViolation: null,
        durationMs: Date.now() - startedAt
      };
    }
    await backupExistingFileBeforeWrite(resolved, content, normalizedPolicy, cwd);

    let newContent: string;
    let replacedCount = 1;
    if (lineEndingNormalized) {
      // Reconstruct with LF, then restore the file's original line ending style
      const lfResult = replaceAll
        ? matchContent.split(matchOldText).join(matchNewText)
        : matchContent.slice(0, firstIdx) + matchNewText + matchContent.slice(firstIdx + matchOldText.length);
      if (replaceAll) {
        replacedCount = matchContent.split(matchOldText).length - 1;
      }
      // If file originally had CRLF, restore CRLF
      const hasCRLF = content.includes("\r\n");
      newContent = hasCRLF ? lfResult.replace(/\n/g, "\r\n") : lfResult;
    } else if (replaceAll) {
      replacedCount = content.split(oldText).length - 1;
      newContent = content.split(oldText).join(newText);
    } else {
      newContent = content.slice(0, firstIdx) + newText + content.slice(firstIdx + oldText.length);
    }

    await writeFile(resolved, newContent, "utf8");
    let stdout = `Successfully edited ${path}${lineEndingNormalized ? " (CRLF/LF normalized)" : ""}${replaceAll ? ` (${replacedCount} occurrence(s) replaced)` : ""}`;
    if (gate.antibodyNotice) {
      stdout += `\n\n${gate.antibodyNotice}`;
    } else if (gate.notice) {
      stdout += `\n\n${gate.notice}`;
    }
    return {
      ok: true,
      kind: "success",
      exitCode: 0,
      stdout,
      stderr: "",
      saVmEvents: [],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      kind: "sa_error",
      exitCode: 1,
      stdout: "",
      stderr: msg,
      saVmEvents: [],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  }
}

export async function nativeDeleteFile(
  filePath: string,
  policy: SaVmPolicyConfig | undefined,
  cwd: string,
  startedAt: number
): Promise<SaVmRunResult> {
  const normalizedPolicy = normalizeSaVmPolicy(policy, cwd);
  const resolved = isAbsolute(filePath) ? resolve(filePath) : resolve(cwd, filePath);
  const decision = checkSaVmDelete(normalizedPolicy, filePath, cwd);
  if (!decision.allowed) {
    return {
      ok: false,
      kind: "capability_denied",
      exitCode: 228,
      stdout: "",
      stderr: decision.reason,
      saVmEvents: [],
      saVmViolation: decision.reason ? { reason: decision.reason } : null,
      durationMs: Date.now() - startedAt
    };
  }
  try {
    try {
      const existing = await readFile(resolved, "utf8");
      await backupExistingFileBeforeWrite(resolved, existing, normalizedPolicy, cwd);
    } catch {
      // file may not exist yet or be empty
    }
    await rm(resolved, { force: true });
    return {
      ok: true,
      kind: "success",
      exitCode: 0,
      stdout: `File deleted successfully (backed up): ${filePath}`,
      stderr: "",
      saVmEvents: [],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      kind: "sa_error",
      exitCode: 1,
      stdout: "",
      stderr: msg,
      saVmEvents: [],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  }
}

export async function nativeSafeDelete(
  rawPath: string | undefined,
  options: {
    path?: string;
    file?: string;
    target?: string;
    check_references?: boolean;
    force?: boolean;
    max_results?: number;
    timeout_ms?: number;
    timeout?: number;
  },
  policy: SaVmPolicyConfig | undefined,
  cwd: string,
  startedAt: number
): Promise<SaVmRunResult> {
  const filePath = (rawPath ?? options.path ?? options.file ?? options.target ?? "").trim();
  if (!filePath) {
    return {
      ok: false,
      kind: "sa_error",
      exitCode: 1,
      stdout: "",
      stderr: "path parameter is required for safe_delete",
      saVmEvents: [],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  }

  const normalizedPolicy = normalizeSaVmPolicy(policy, cwd);
  const resolved = isAbsolute(filePath) ? resolve(filePath) : resolve(cwd, filePath);
  const relPath = relative(cwd, resolved).replace(/\\/g, "/");

  if (!existsSync(resolved)) {
    return {
      ok: false,
      kind: "sa_error",
      exitCode: 1,
      stdout: "",
      stderr: `file not found: ${filePath}`,
      saVmEvents: [],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  }

  const decision = checkSaVmDelete(normalizedPolicy, filePath, cwd);
  if (!decision.allowed) {
    return {
      ok: false,
      kind: "capability_denied",
      exitCode: 228,
      stdout: "",
      stderr: decision.reason,
      saVmEvents: [],
      saVmViolation: decision.reason ? { reason: decision.reason } : null,
      durationMs: Date.now() - startedAt
    };
  }

  const checkReferences = options.check_references !== false;
  const force = options.force === true;

  if (checkReferences && !force) {
    let content = "";
    try {
      content = await readFile(resolved, "utf8");
    } catch {
      // unreadable or directory
    }

    // Extract main symbols of the file
    const symbolsToCheck: string[] = [];

    // 1. Exported symbols
    const exportNamedMatches = content.matchAll(/export\s+(?:default\s+)?(?:class|function|interface|type|enum|struct|trait|const|let|var)\s+([A-Za-z0-9_$]+)/g);
    for (const m of exportNamedMatches) {
      if (m[1] && !symbolsToCheck.includes(m[1])) {
        symbolsToCheck.push(m[1]);
      }
    }
    const exportBraceMatches = content.matchAll(/export\s*\{\s*([^}]+)\s*\}/g);
    for (const m of exportBraceMatches) {
      if (m[1]) {
        const parts = m[1].split(",");
        for (const p of parts) {
          const sym = p.trim().split(/\s+as\s+/)[0]?.trim();
          if (sym && !symbolsToCheck.includes(sym)) {
            symbolsToCheck.push(sym);
          }
        }
      }
    }

    // 2. Top-level definitions if no export found
    if (symbolsToCheck.length === 0) {
      const topDefMatches = content.matchAll(/(?:class|interface|function|type|struct|trait)\s+([A-Za-z0-9_$]+)/g);
      for (const m of topDefMatches) {
        if (m[1] && !symbolsToCheck.includes(m[1])) {
          symbolsToCheck.push(m[1]);
        }
      }
    }

    // 3. File basename (e.g. "service" for "service.ts")
    const ext = extname(resolved);
    const base = basename(resolved, ext);
    if (base && !symbolsToCheck.includes(base)) {
      symbolsToCheck.push(base);
    }

    // Run reference search on symbols (capped at 50 results)
    const maxResults = typeof options.max_results === "number" && options.max_results > 0 ? options.max_results : 50;
    const timeoutMs = resolveTimeoutMs(options, 15_000);
    const externalRefs: Array<{ file: string; line: number; type: string; snippet?: string }> = [];
    const seenLocations = new Set<string>();

    for (const sym of symbolsToCheck) {
      if (externalRefs.length >= maxResults) break;
      if (Date.now() - startedAt > timeoutMs) break;

      const refResult = await nativeFindReferences(sym, {
        max_results: maxResults,
        detail: true,
        timeout_ms: timeoutMs
      }, policy, cwd, startedAt);

      if (refResult.ok) {
        try {
          const parsed = JSON.parse(refResult.stdout);
          const files = parsed.files || {};
          for (const [f, entries] of Object.entries(files)) {
            const normF = (f as string).replace(/\\/g, "/");
            if (normF === relPath || resolve(cwd, normF) === resolved) continue;

            for (const entry of (entries as string[])) {
              const parts = entry.split(":");
              const lineNum = parseInt(parts[0]?.replace(/^L/, "") || "1", 10);
              const type = parts[1] || "e2";
              const snippet = parts.slice(2).join(":");
              const locKey = `${normF}:${lineNum}`;
              if (!seenLocations.has(locKey)) {
                seenLocations.add(locKey);
                externalRefs.push({
                  file: normF,
                  line: lineNum,
                  type,
                  snippet: snippet || undefined
                });
                if (externalRefs.length >= maxResults) break;
              }
            }
            if (externalRefs.length >= maxResults) break;
          }
        } catch {
          // ignore parse error
        }
      }
    }

    if (externalRefs.length > 0) {
      const uniqueFiles = Array.from(new Set(externalRefs.map((r) => r.file)));
      const rejectionData = {
        ok: false,
        blocked: true,
        action: "safe_delete",
        path: relPath,
        references_count: externalRefs.length,
        references: externalRefs,
        suggestion: `File is referenced by other files. To delete, remove or update references in [${uniqueFiles.slice(0, 5).join(", ")}${uniqueFiles.length > 5 ? "..." : ""}], or call safe_delete with force: true to delete anyway.`
      };

      return {
        ok: false,
        kind: "capability_denied",
        exitCode: 1,
        stdout: JSON.stringify(rejectionData, null, 2),
        stderr: `safe_delete blocked: '${relPath}' is referenced by ${externalRefs.length} location(s) in [${uniqueFiles.slice(0, 5).join(", ")}${uniqueFiles.length > 5 ? "..." : ""}]. Remove references before deleting, or pass force: true to bypass.`,
        saVmEvents: [
          {
            timestamp: Date.now(),
            type: "safe_delete_blocked",
            path: relPath,
            references_count: externalRefs.length,
            referencing_files: uniqueFiles
          }
        ],
        saVmViolation: null,
        durationMs: Date.now() - startedAt
      };
    }
  }

  // Phase 2: Unreferenced or force === true -> proceed with nativeDeleteFile
  return await nativeDeleteFile(filePath, policy, cwd, startedAt);
}

export async function nativeMoveFile(
  fromPath: string,
  toPath: string,
  policy: SaVmPolicyConfig | undefined,
  cwd: string,
  startedAt: number
): Promise<SaVmRunResult> {
  const normalizedPolicy = normalizeSaVmPolicy(policy, cwd);
  const resolvedFrom = isAbsolute(fromPath) ? resolve(fromPath) : resolve(cwd, fromPath);
  const resolvedTo = isAbsolute(toPath) ? resolve(toPath) : resolve(cwd, toPath);
  const fromDecision = checkSaVmPath(normalizedPolicy, "transfer", fromPath, cwd);
  if (!fromDecision.allowed) {
    return {
      ok: false,
      kind: "capability_denied",
      exitCode: 228,
      stdout: "",
      stderr: `transfer ${fromPath}: ${fromDecision.reason}`,
      saVmEvents: [],
      saVmViolation: fromDecision.reason ? { reason: fromDecision.reason } : null,
      durationMs: Date.now() - startedAt
    };
  }
  const toDecision = checkSaVmPath(normalizedPolicy, "write", toPath, cwd);
  if (!toDecision.allowed) {
    return {
      ok: false,
      kind: "capability_denied",
      exitCode: 228,
      stdout: "",
      stderr: `write ${toPath}: ${toDecision.reason}`,
      saVmEvents: [],
      saVmViolation: toDecision.reason ? { reason: toDecision.reason } : null,
      durationMs: Date.now() - startedAt
    };
  }
  try {
    await mkdir(dirname(resolvedTo), { recursive: true });
    await rename(resolvedFrom, resolvedTo);
    return {
      ok: true,
      kind: "success",
      exitCode: 0,
      stdout: `File moved from ${fromPath} to ${toPath} successfully`,
      stderr: "",
      saVmEvents: [],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      kind: "sa_error",
      exitCode: 1,
      stdout: "",
      stderr: msg,
      saVmEvents: [],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  }
}

export async function nativeEnsureDir(
  dirPath: string,
  policy: SaVmPolicyConfig | undefined,
  cwd: string,
  startedAt: number
): Promise<SaVmRunResult> {
  const normalizedPolicy = normalizeSaVmPolicy(policy, cwd);
  const resolved = isAbsolute(dirPath) ? resolve(dirPath) : resolve(cwd, dirPath);
  const decision = checkSaVmPath(normalizedPolicy, "write", dirPath, cwd);
  if (!decision.allowed) {
    return {
      ok: false,
      kind: "capability_denied",
      exitCode: 228,
      stdout: "",
      stderr: `${decision.reason} (path: '${dirPath}'). Workspace root is '${cwd}'.`,
      saVmEvents: [],
      saVmViolation: decision.reason ? { reason: decision.reason } : null,
      durationMs: Date.now() - startedAt
    };
  }
  try {
    await mkdir(resolved, { recursive: true });
    return {
      ok: true,
      kind: "success",
      exitCode: 0,
      stdout: JSON.stringify({
        dir: relative(cwd, resolved).replace(/\\/g, "/") || ".",
        created: true,
        path: resolved
      }, null, 2),
      stderr: "",
      saVmEvents: [],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      kind: "sa_error",
      exitCode: 1,
      stdout: "",
      stderr: msg,
      saVmEvents: [],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  }
}

export async function nativeListDir(
  dirPath = ".",
  maxEntries = 200,
  policy: SaVmPolicyConfig | undefined,
  cwd: string,
  startedAt: number,
  timeoutOpts?: { timeout_ms?: number; timeout?: number },
  extraOpts?: { depth?: number; max_depth?: number; recursive?: boolean; type?: "all" | "file" | "directory" | string; pattern?: string; path_pattern?: string; is_regex?: boolean; regex?: boolean; exclude_dirs?: string[]; respect_gitignore?: boolean; page?: unknown; page_num?: unknown; pageNum?: unknown; p?: unknown; page_size?: unknown; pageSize?: unknown; per_page?: unknown; perPage?: unknown; offset?: unknown; count_cap?: unknown; countCap?: unknown; max_total?: unknown; exact_total?: unknown; exactTotal?: unknown }
): Promise<SaVmRunResult> {
  const timeoutMs = resolveTimeoutMs(timeoutOpts, 10_000);
  if (Date.now() - startedAt > timeoutMs) {
    return {
      ok: false,
      kind: "timeout",
      exitCode: 124,
      stdout: "[]",
      stderr: `list_dir timed out after ${timeoutMs}ms`,
      saVmEvents: [],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  }
  const normalizedPolicy = normalizeSaVmPolicy(policy, cwd);
  const resolved = isAbsolute(dirPath) ? resolve(dirPath) : resolve(cwd, dirPath);
  const decision = checkSaVmPath(normalizedPolicy, "read", dirPath, cwd);
  if (!decision.allowed) {
    return {
      ok: false,
      kind: "capability_denied",
      exitCode: 228,
      stdout: "",
      stderr: `${decision.reason} (path: '${dirPath}'). Workspace root is '${cwd}'. To access external paths (e.g. shared SDKs or tools), configure additionalRoots in VM policy or pass additionalRoots.`,
      saVmEvents: [],
      saVmViolation: decision.reason ? { reason: decision.reason } : null,
      durationMs: Date.now() - startedAt
    };
  }
  try {
    const items: Array<{ name: string; isDirectory: boolean; isFile: boolean; path: string }> = [];
    const limit = maxEntries > 0 ? maxEntries : 200;
    const pg = resolvePagination(extraOpts ?? {}, { defaultSize: limit, maxSize: 500, legacyLimit: limit });
    const scanCap = pg.paginated ? pg.countCap : limit;
    const targetDepth = Math.max(1, extraOpts?.max_depth ?? extraOpts?.depth ?? (extraOpts?.recursive ? 5 : 1));
    const filterType = extraOpts?.type?.toLowerCase();
    const respectGitignore = extraOpts?.respect_gitignore !== false;
    const giRules = respectGitignore ? loadMergedGitIgnoreRules(cwd, dirPath) : [];
    const excludeDirs = extraOpts?.exclude_dirs ?? [];
    const filePattern = typeof extraOpts?.pattern === "string" && extraOpts.pattern ? extraOpts.pattern : "*";
    const listPathPattern = extraOpts?.path_pattern;
    const listIsRegex = extraOpts?.is_regex ?? extraOpts?.regex;
    let skippedFiltered = 0;

    async function walk(currentDir: string, currentRelative: string, currentDepth: number) {
      if (items.length >= scanCap || currentDepth > targetDepth) return;
      const rawEntries = await readdir(currentDir, { withFileTypes: true });
      const entries = rawEntries.sort((a, b) => a.name.localeCompare(b.name));
      for (const ent of entries) {
        if (items.length >= scanCap) break;
        const relPath = currentRelative ? `${currentRelative}/${ent.name}` : ent.name;
        const isDir = ent.isDirectory();
        const isF = ent.isFile();
        const relToCwd = relative(cwd, join(currentDir, ent.name)).replace(/\\/g, "/") || ent.name;
        if (respectGitignore && isGitIgnored(ent.name, isDir, giRules, relToCwd)) {
          skippedFiltered += 1;
          continue;
        }
        if (isExcludedRelPath(relToCwd, excludeDirs)) {
          skippedFiltered += 1;
          continue;
        }
        if (filterType === "directory" || filterType === "dir") {
          if (!isDir) continue;
        } else if (filterType === "file") {
          if (!isF) continue;
        }
        if (isF && !matchesFilePattern(ent.name, relToCwd, filePattern, listPathPattern, listIsRegex)) continue;
        if (isDir && listPathPattern && listPathPattern.trim()) {
          const dirMatcher = compileSearchMatcher(listPathPattern.trim(), listIsRegex);
          if (!dirMatcher(relToCwd) && !dirMatcher(ent.name)) continue;
        }
        items.push({
          name: ent.name,
          path: relPath,
          isDirectory: isDir,
          isFile: isF
        });
        if (isDir && currentDepth < targetDepth) {
          const subDir = join(currentDir, ent.name);
          const subDecision = checkSaVmPath(normalizedPolicy, "read", subDir, cwd);
          if (subDecision.allowed) {
            await walk(subDir, relPath, currentDepth + 1);
          }
        }
      }
    }

    await walk(resolved, "", 1);

    if (pg.paginated) {
      items.sort((a, b) => a.path.localeCompare(b.path));
      const s = paginateItems(items, pg);
      const truncated = items.length >= scanCap;
      return {
        ok: true,
        kind: "success",
        exitCode: 0,
        stdout: JSON.stringify({
          dir: dirPath,
          page: pg.page,
          page_size: pg.page_size,
          total: items.length,
          total_pages: s.total_pages,
          returned: s.returned,
          has_next: truncated ? true : s.has_next,
          has_prev: s.has_prev,
          truncated,
          entries: s.paged,
        }, null, 2),
        stderr: [
          skippedFiltered > 0 ? `[list_dir] skipped ${skippedFiltered} ignored/excluded entries (gitignore/exclude_dirs).` : "",
          truncated ? `[list_dir] results capped at count_cap=${scanCap}; narrow dir/pattern or raise count_cap` : "",
        ].filter(Boolean).join(" "),
        saVmEvents: [],
        saVmViolation: null,
        durationMs: Date.now() - startedAt
      };
    }
    return {
      ok: true,
      kind: "success",
      exitCode: 0,
      stdout: JSON.stringify(items.slice(0, limit), null, 2),
      stderr: skippedFiltered > 0 ? `[list_dir] skipped ${skippedFiltered} ignored/excluded entries (gitignore/exclude_dirs).` : "",
      saVmEvents: [],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  } catch (err: unknown) {
    const isEnoent = (err as { code?: string })?.code === "ENOENT" || String(err).includes("ENOENT");
    if (isEnoent) {
      return {
        ok: true,
        kind: "success",
        exitCode: 0,
        stdout: JSON.stringify({
          dir: relative(cwd, resolved).replace(/\\/g, "/") || dirPath,
          exists: false,
          entries: []
        }, null, 2),
        stderr: "",
        saVmEvents: [],
        saVmViolation: null,
        durationMs: Date.now() - startedAt
      };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      kind: "sa_error",
      exitCode: 1,
      stdout: "",
      stderr: msg,
      saVmEvents: [],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  }
}

// OPT-2: grep circuit breaker helper
function applyGrepCircuitBreaker(
  rawMatches: Array<{ file: string; line?: number; content?: string }>,
  savings: SaVmContextSavingsConfig | undefined,
  timeoutNote: string,
  startedAt: number
): SaVmRunResult {
  let matches = rawMatches;
  let truncatedNote = "";
  if (savings?.grepCircuitBreaker === true) {
    const maxResults = savings.grepMaxResults ?? 50;
    const maxTokens = savings.grepMaxTokens ?? 3000;
    if (matches.length > maxResults) {
      truncatedNote = `\n[OPT-2] Results truncated: ${matches.length - maxResults} matches omitted (grepMaxResults=${maxResults}). Refine your query or search pattern.`;
      matches = matches.slice(0, maxResults);
    }
    // Estimate tokens; strip content if over budget
    const fullJson = JSON.stringify(matches);
    const estTokens = estimateTokenCount(fullJson);
    if (estTokens > maxTokens) {
      // Strip content field to shrink output
      matches = matches.map(({ file, line }) => ({ file, ...(line !== undefined ? { line } : {}) }));
      truncatedNote += `\n[OPT-2] Match content stripped: output exceeded ${maxTokens} token budget. File paths and line numbers preserved.`;
    }
  }
  const stderr = [timeoutNote, truncatedNote].filter(Boolean).join("");
  return {
    ok: true,
    kind: "success",
    exitCode: 0,
    stdout: JSON.stringify(matches, null, 2),
    stderr,
    saVmEvents: [],
    saVmViolation: null,
    durationMs: Date.now() - startedAt
  };
}

export async function nativeGrepSearch(
  query: string,
  searchDir = ".",
  pattern = "*",
  maxMatches = 50,
  policy: SaVmPolicyConfig | undefined,
  cwd: string,
  startedAt: number,
  timeoutOpts?: { timeout_ms?: number; timeout?: number },
  extraOpts?: { is_regex?: boolean; regex?: boolean; case_sensitive?: boolean; path_pattern?: string; max_file_bytes?: number; maxFileBytes?: number; max_bytes?: number; exclude_dirs?: string[]; respect_gitignore?: boolean; page?: unknown; page_num?: unknown; pageNum?: unknown; p?: unknown; page_size?: unknown; pageSize?: unknown; per_page?: unknown; perPage?: unknown; offset?: unknown; count_cap?: unknown; countCap?: unknown; max_total?: unknown; exact_total?: unknown; exactTotal?: unknown }
): Promise<SaVmRunResult> {
  const _grepPg = resolvePagination((extraOpts ?? {}) as Record<string, unknown>, { defaultSize: maxMatches > 0 ? maxMatches : 50, maxSize: 500, legacyLimit: maxMatches });
  const _grepCap = _grepPg.paginated ? _grepPg.countCap : (maxMatches > 0 ? maxMatches : 50);
  if (_grepPg.paginated) maxMatches = _grepCap;
  const normalizedPolicy = normalizeSaVmPolicy(policy, cwd);
  const resolvedDir = isAbsolute(searchDir) ? resolve(searchDir) : resolve(cwd, searchDir);
  const decision = checkSaVmPath(normalizedPolicy, "read", searchDir, cwd);
  if (!decision.allowed) {
    return {
      ok: false,
      kind: "capability_denied",
      exitCode: 228,
      stdout: "",
      stderr: decision.reason,
      saVmEvents: [],
      saVmViolation: decision.reason ? { reason: decision.reason } : null,
      durationMs: Date.now() - startedAt
    };
  }
  if (!query || typeof query !== "string") {
    return {
      ok: false,
      kind: "sa_error",
      exitCode: 1,
      stdout: "",
      stderr: "query parameter is required for grep_search",
      saVmEvents: [],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  }
  try {
    const matches: Array<{ file: string; line: number; content: string }> = [];
    const limit = _grepPg.paginated ? _grepCap + 1 : (maxMatches > 0 ? maxMatches : 50);
    const paginatedResult = (items: typeof matches, truncated = false, note = "", timedOut = false): SaVmRunResult => {
      const s = paginateItems(items, _grepPg);
      return {
        ok: true,
        kind: "success",
        exitCode: 0,
        stdout: JSON.stringify({
          query, dir: searchDir, pattern,
          page: _grepPg.page, page_size: _grepPg.page_size,
          total: s.total, total_pages: s.total_pages,
          returned: s.returned, has_next: truncated ? true : s.has_next, has_prev: s.has_prev,
          truncated, timed_out: timedOut ? true : undefined,
          matches: s.paged,
        }, null, 2),
        stderr: [note, truncated && !timedOut ? `[grep_search] results capped at count_cap=${_grepCap}` : ""].filter(Boolean).join(" "),
        saVmEvents: [],
        saVmViolation: null,
        durationMs: Date.now() - startedAt
      };
    };
    const timeoutMs = resolveTimeoutMs(timeoutOpts, 15_000);
    let isTimedOut = false;
    const effectiveIsRegex = extraOpts?.is_regex ?? extraOpts?.regex;
    const matcher = compileSearchMatcher(query, effectiveIsRegex, extraOpts?.case_sensitive);
    const maxBytes = resolveMaxFileBytes(
      extraOpts?.max_file_bytes ?? extraOpts?.maxFileBytes ?? extraOpts?.max_bytes,
      DEFAULT_SEARCH_MAX_FILE_BYTES
    );
    const respectGitignore = extraOpts?.respect_gitignore !== false;
    const excludeDirs = extraOpts?.exclude_dirs ?? [];

    // If target is a single file, grep directly
    const targetStat = await stat(resolvedDir).catch(() => null);
    if (targetStat?.isFile()) {
      const singleRel = relative(cwd, resolvedDir).replace(/\\/g, "/");
      // An explicitly targeted single file is an intentional search, not a
      // bundle stumbled on during a tree walk: allow a larger default cap so
      // big source files (e.g. 500KB+ bridges) stay greppable.
      const explicitMax = extraOpts?.max_file_bytes ?? extraOpts?.maxFileBytes ?? extraOpts?.max_bytes;
      const singleMaxBytes = explicitMax === undefined ? Math.max(maxBytes, DEFAULT_SINGLE_FILE_SEARCH_MAX_BYTES) : maxBytes;
      const { text: singleText, skipped: singleSkipped } = await readSearchableText(resolvedDir, singleMaxBytes);
      if (singleSkipped === "too_large") {
        const note = `[grep_search] skipped '${singleRel}': file exceeds max_file_bytes=${singleMaxBytes}. Use read_lines slices or raise max_file_bytes.`;
        return _grepPg.paginated ? paginatedResult(matches, false, note) : applyGrepCircuitBreaker(matches, normalizedPolicy.contextSavings, note, startedAt);
      }
      if (singleSkipped === "binary") {
        const note = `[grep_search] skipped '${singleRel}': binary file (NUL byte detected).`;
        return _grepPg.paginated ? paginatedResult(matches, false, note) : applyGrepCircuitBreaker(matches, normalizedPolicy.contextSavings, note, startedAt);
      }
      try {
        const text = singleText ?? "";
        if (matcher(text)) {
          const lines = text.split(/\r?\n/);
          for (let i = 0; i < lines.length; i++) {
            if (matches.length >= limit) break;
            if (matcher(lines[i]!)) {
              matches.push({
                file: relative(cwd, resolvedDir).replace(/\\/g, "/"),
                line: i + 1,
                content: lines[i]!.trim()
              });
            }
          }
        }
      } catch {
        // unreadable
      }
      if (_grepPg.paginated) {
        const truncated = matches.length > _grepCap;
        return paginatedResult(matches.slice(0, _grepCap), truncated);
      }
      return applyGrepCircuitBreaker(matches, normalizedPolicy.contextSavings, "", startedAt);
    }

    const giRules = respectGitignore ? loadMergedGitIgnoreRules(cwd, searchDir) : [];
    let skippedFiltered = 0;
    let skippedLarge = 0;
    let skippedBinary = 0;

    async function walk(dir: string, depth = 0): Promise<void> {
      if (depth > 6 || matches.length >= limit || isTimedOut) return;
      if (Date.now() - startedAt > timeoutMs) {
        isTimedOut = true;
        return;
      }
      let entries;
      try {
        entries = (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
      } catch {
        return;
      }
      for (const ent of entries) {
        if (matches.length >= limit || isTimedOut) break;
        if (Date.now() - startedAt > timeoutMs) {
          isTimedOut = true;
          break;
        }
        const full = join(dir, ent.name);
        const relToCwd = relative(cwd, full).replace(/\\/g, "/");
        if (respectGitignore && isGitIgnored(ent.name, ent.isDirectory(), giRules, relToCwd)) {
          skippedFiltered += 1;
          continue;
        }
        if (ent.isDirectory() && isExcludedRelPath(relToCwd, excludeDirs)) {
          skippedFiltered += 1;
          continue;
        }
        if (ent.isDirectory()) {
          await walk(full, depth + 1);
        } else if (ent.isFile()) {
          const relPath = relative(cwd, full).replace(/\\/g, "/");
          if (!matchesFilePattern(ent.name, relPath, pattern, extraOpts?.path_pattern, effectiveIsRegex)) continue;
          const { text, skipped } = await readSearchableText(full, maxBytes);
          if (skipped === "too_large") {
            skippedLarge += 1;
            continue;
          }
          if (skipped === "binary") {
            skippedBinary += 1;
            continue;
          }
          if (text === undefined) continue;
          try {
            if (matcher(text)) {
              const lines = text.split(/\r?\n/);
              for (let i = 0; i < lines.length; i++) {
                if (matches.length >= limit || isTimedOut) break;
                if (Date.now() - startedAt > timeoutMs) {
                  isTimedOut = true;
                  break;
                }
                if (matcher(lines[i]!)) {
                  matches.push({
                    file: relPath,
                    line: i + 1,
                    content: lines[i]!.trim()
                  });
                }
              }
            }
          } catch {
            // ignore binary/unreadable
          }
        }
      }
    }

    await walk(resolvedDir, 0);

    if (isTimedOut && matches.length === 0) {
      if (_grepPg.paginated) {
        return {
          ...paginatedResult([], true, `grep_search timed out after ${timeoutMs}ms`, true),
          ok: false,
          kind: "timeout",
          exitCode: 124
        };
      }
      return {
        ok: false,
        kind: "timeout",
        exitCode: 124,
        stdout: "[]",
        stderr: `grep_search timed out after ${timeoutMs}ms`,
        saVmEvents: [],
        saVmViolation: null,
        durationMs: Date.now() - startedAt
      };
    }

    const grepTimeoutNote = isTimedOut ? `[timeout] grep_search reached timeout limit of ${timeoutMs}ms; returning ${matches.length} matches` : "";
    const grepSkippedParts: string[] = [];
    if (skippedFiltered > 0) grepSkippedParts.push(`skipped ${skippedFiltered} ignored/excluded paths`);
    if (skippedLarge > 0) grepSkippedParts.push(`skipped ${skippedLarge} files exceeding max_file_bytes=${maxBytes}`);
    if (skippedBinary > 0) grepSkippedParts.push(`skipped ${skippedBinary} binary files`);
    const grepSkippedNote = grepSkippedParts.length > 0 ? `[grep_search] ${grepSkippedParts.join("; ")}.` : "";
    if (_grepPg.paginated) {
      matches.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
      const truncated = isTimedOut || matches.length > _grepCap;
      return paginatedResult(
        matches.slice(0, _grepCap),
        truncated,
        [grepTimeoutNote, grepSkippedNote].filter(Boolean).join(" "),
        isTimedOut
      );
    }
    return applyGrepCircuitBreaker(matches, normalizedPolicy.contextSavings, [grepTimeoutNote, grepSkippedNote].filter(Boolean).join(" "), startedAt);

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      kind: "sa_error",
      exitCode: 1,
      stdout: "",
      stderr: msg,
      saVmEvents: [],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  }
}

export async function nativeGrepSearchAsync(
  query: string | string[],
  searchDir = ".",
  pattern = "*",
  maxMatches = 50,
  concurrency = 16,
  policy: SaVmPolicyConfig | undefined,
  cwd: string,
  startedAt: number,
  timeoutOpts?: { timeout_ms?: number; timeout?: number },
  extraOpts?: { is_regex?: boolean; regex?: boolean; case_sensitive?: boolean; path_pattern?: string; max_file_bytes?: number; maxFileBytes?: number; max_bytes?: number; exclude_dirs?: string[]; respect_gitignore?: boolean; page?: unknown; page_num?: unknown; pageNum?: unknown; p?: unknown; page_size?: unknown; pageSize?: unknown; per_page?: unknown; perPage?: unknown; offset?: unknown; count_cap?: unknown; countCap?: unknown; max_total?: unknown; exact_total?: unknown; exactTotal?: unknown }
): Promise<SaVmRunResult> {
  const _grepAPg = resolvePagination((extraOpts ?? {}) as Record<string, unknown>, { defaultSize: maxMatches > 0 ? maxMatches : 50, maxSize: 500, legacyLimit: maxMatches });
  const _grepACap = _grepAPg.paginated ? _grepAPg.countCap : (maxMatches > 0 ? maxMatches : 50);
  if (_grepAPg.paginated) maxMatches = _grepACap;
  const normalizedPolicy = normalizeSaVmPolicy(policy, cwd);
  const resolvedDir = isAbsolute(searchDir) ? resolve(searchDir) : resolve(cwd, searchDir);
  const decision = checkSaVmPath(normalizedPolicy, "read", searchDir, cwd);
  if (!decision.allowed) {
    return {
      ok: false,
      kind: "capability_denied",
      exitCode: 228,
      stdout: "",
      stderr: decision.reason,
      saVmEvents: [],
      saVmViolation: decision.reason ? { reason: decision.reason } : null,
      durationMs: Date.now() - startedAt
    };
  }
  const queryList = (Array.isArray(query) ? query : [query])
    .map((q) => typeof q === "string" ? q.trim() : "")
    .filter(Boolean);

  if (queryList.length === 0) {
    return {
      ok: false,
      kind: "sa_error",
      exitCode: 1,
      stdout: "",
      stderr: "query or queries parameter is required for grep_search_async",
      saVmEvents: [],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  }
  try {
    const matches: Array<{ file: string; line: number; content: string; matchedQuery?: string }> = [];
    const limit = _grepAPg.paginated ? _grepACap + 1 : (maxMatches > 0 ? maxMatches : 50);
    const poolSize = _grepAPg.paginated ? 1 : Math.max(1, Math.min(64, concurrency || 16));
    const paginatedResult = (items: typeof matches, truncated: boolean, timedOut: boolean, note: string): SaVmRunResult => {
      const s = paginateItems(items, _grepAPg);
      return {
        ok: true,
        kind: "success",
        exitCode: 0,
        stdout: JSON.stringify({
          queries: queryList, dir: searchDir, pattern,
          page: _grepAPg.page, page_size: _grepAPg.page_size,
          total: s.total, total_pages: s.total_pages,
          returned: s.returned, has_next: truncated ? true : s.has_next, has_prev: s.has_prev,
          truncated, timed_out: timedOut ? true : undefined,
          matches: s.paged,
        }, null, 2),
        stderr: [note, truncated && !timedOut ? `[grep_search_async] results capped at count_cap=${_grepACap}` : ""].filter(Boolean).join(" "),
        saVmEvents: [],
        saVmViolation: null,
        durationMs: Date.now() - startedAt
      };
    };
    const timeoutMs = resolveTimeoutMs(timeoutOpts, 15_000);
    let isTerminated = false;
    let isTimedOut = false;
    const effectiveIsRegex = extraOpts?.is_regex ?? extraOpts?.regex;
    const matchers = queryList.map((q) => ({
      query: q,
      matcher: compileSearchMatcher(q, effectiveIsRegex, extraOpts?.case_sensitive)
    }));

    const fileQueue: string[] = [];
    const asyncExplicitMax = extraOpts?.max_file_bytes ?? extraOpts?.maxFileBytes ?? extraOpts?.max_bytes;
    const targetStat = await stat(resolvedDir).catch(() => null);
    // Explicit single-file target: larger default cap (see grep_search).
    const asyncMaxBytes = resolveMaxFileBytes(
      asyncExplicitMax,
      targetStat?.isFile() ? DEFAULT_SINGLE_FILE_SEARCH_MAX_BYTES : DEFAULT_SEARCH_MAX_FILE_BYTES
    );
    const asyncRespectGitignore = extraOpts?.respect_gitignore !== false;
    const asyncExcludeDirs = extraOpts?.exclude_dirs ?? [];
    let asyncSkippedFiltered = 0;
    let asyncSkippedLarge = 0;
    let asyncSkippedBinary = 0;
    if (targetStat?.isFile()) {
      fileQueue.push(resolvedDir);
    } else {
      const giRules = asyncRespectGitignore ? loadMergedGitIgnoreRules(cwd, searchDir) : [];

      async function scanDir(dir: string, depth = 0): Promise<void> {
        if (depth > 6 || isTimedOut) return;
        if (Date.now() - startedAt > timeoutMs) {
          isTimedOut = true;
          return;
        }
        try {
          const entries = (await readdir(dir, { withFileTypes: true }).catch(() => [])).sort((a, b) => a.name.localeCompare(b.name));
          const subDirs: Promise<void>[] = [];
          for (const ent of entries) {
            const full = join(dir, ent.name);
            const relToCwd = relative(cwd, full).replace(/\\/g, "/");
            if (asyncRespectGitignore && isGitIgnored(ent.name, ent.isDirectory(), giRules, relToCwd)) {
              asyncSkippedFiltered += 1;
              continue;
            }
            if (ent.isDirectory() && isExcludedRelPath(relToCwd, asyncExcludeDirs)) {
              asyncSkippedFiltered += 1;
              continue;
            }
            if (ent.isDirectory()) {
              if (depth < 6) subDirs.push(scanDir(full, depth + 1));
            } else if (ent.isFile()) {
              const relPath = relative(cwd, full).replace(/\\/g, "/");
              if (matchesFilePattern(ent.name, relPath, pattern, extraOpts?.path_pattern, effectiveIsRegex)) {
                fileQueue.push(full);
              }
            }
          }
          if (subDirs.length > 0) {
            await Promise.all(subDirs);
          }
        } catch {
          // ignore unreadable
        }
      }

      await scanDir(resolvedDir, 0);
    }

    if (_grepAPg.paginated) fileQueue.sort((a, b) => a.localeCompare(b));

    let nextIndex = 0;
    async function worker(): Promise<void> {
      while (!isTerminated && matches.length < limit) {
        if (Date.now() - startedAt > timeoutMs) {
          isTerminated = true;
          isTimedOut = true;
          break;
        }
        const idx = nextIndex++;
        if (idx >= fileQueue.length) break;
        const file = fileQueue[idx]!;

        const { text: fileText, skipped: fileSkipped } = await readSearchableText(file, asyncMaxBytes);
        if (fileSkipped === "too_large") {
          asyncSkippedLarge += 1;
          continue;
        }
        if (fileSkipped === "binary") {
          asyncSkippedBinary += 1;
          continue;
        }
        if (fileText === undefined) continue;
        try {
          const text = fileText;
          if (isTerminated || matches.length >= limit) break;
          const hasMatch = matchers.some((m) => m.matcher(text));
          if (hasMatch) {
            const lines = text.split(/\r?\n/);
            for (let i = 0; i < lines.length; i++) {
              if (matches.length >= limit) {
                isTerminated = true;
                break;
              }
              if (Date.now() - startedAt > timeoutMs) {
                isTerminated = true;
                isTimedOut = true;
                break;
              }
              const lineContent = lines[i]!;
              for (const m of matchers) {
                if (m.matcher(lineContent)) {
                  matches.push({
                    file: relative(cwd, file).replace(/\\/g, "/"),
                    line: i + 1,
                    content: lineContent.trim(),
                    ...(queryList.length > 1 ? { matchedQuery: m.query } : {})
                  });
                  if (matches.length >= limit) {
                    isTerminated = true;
                    break;
                  }
                }
              }
            }
          }
        } catch {
          // ignore binary or unreadable files
        }
      }
    }

    const workerCount = Math.min(poolSize, Math.max(1, fileQueue.length));
    const workerPromises = Array.from({ length: workerCount }, () => worker());
    await Promise.all(workerPromises);

    if (isTimedOut && matches.length === 0) {
      if (_grepAPg.paginated) {
        return {
          ...paginatedResult([], true, true, `grep_search_async timed out after ${timeoutMs}ms`),
          ok: false,
          kind: "timeout",
          exitCode: 124
        };
      }
      return {
        ok: false,
        kind: "timeout",
        exitCode: 124,
        stdout: "[]",
        stderr: `grep_search_async timed out after ${timeoutMs}ms`,
        saVmEvents: [],
        saVmViolation: null,
        durationMs: Date.now() - startedAt
      };
    }

    const asyncTimeoutNote = isTimedOut ? `[timeout] grep_search_async reached timeout limit of ${timeoutMs}ms; returning ${matches.length} matches` : "";
    const asyncSkippedParts: string[] = [];
    if (asyncSkippedFiltered > 0) asyncSkippedParts.push(`skipped ${asyncSkippedFiltered} ignored/excluded paths`);
    if (asyncSkippedLarge > 0) asyncSkippedParts.push(`skipped ${asyncSkippedLarge} files exceeding max_file_bytes=${asyncMaxBytes}`);
    if (asyncSkippedBinary > 0) asyncSkippedParts.push(`skipped ${asyncSkippedBinary} binary files`);
    const asyncSkippedNote = asyncSkippedParts.length > 0 ? `[grep_search_async] ${asyncSkippedParts.join("; ")}.` : "";
    if (_grepAPg.paginated) {
      matches.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
      const truncated = isTimedOut || matches.length > _grepACap;
      return paginatedResult(
        matches.slice(0, _grepACap),
        truncated,
        isTimedOut,
        [asyncTimeoutNote, asyncSkippedNote].filter(Boolean).join(" ")
      );
    }
    return applyGrepCircuitBreaker(matches, normalizedPolicy.contextSavings, [asyncTimeoutNote, asyncSkippedNote].filter(Boolean).join(" "), startedAt);

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      kind: "sa_error",
      exitCode: 1,
      stdout: "",
      stderr: msg,
      saVmEvents: [],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  }
}

export async function nativeFindReferences(
  rawSymbol: string | undefined,
  options: {
    detail?: boolean;
    candidate_files?: string[];
    files?: string[];
    max_results?: number;
    limit?: number;
    max_tokens?: number;
    dir?: string;
    pattern?: string;
    exclude_comments?: boolean;
    include_declarations?: boolean;
    timeout_ms?: number;
    timeout?: number;
    page?: unknown; page_num?: unknown; pageNum?: unknown; p?: unknown;
    page_size?: unknown; pageSize?: unknown; per_page?: unknown; perPage?: unknown;
    offset?: unknown; count_cap?: unknown; countCap?: unknown; max_total?: unknown;
    exact_total?: unknown; exactTotal?: unknown;
  },
  policy: SaVmPolicyConfig | undefined,
  cwd: string,
  startedAt: number
): Promise<SaVmRunResult> {
  const symbol = (rawSymbol ?? "").trim();
  if (!symbol) {
    return {
      ok: false,
      kind: "sa_error",
      exitCode: 1,
      stdout: "",
      stderr: "symbol parameter is required for find_references",
      saVmEvents: [],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  }

  const normalized = normalizeSaVmPolicy(policy, cwd);
  if (normalized.tools?.findReferences !== true) {
    return {
      ok: false,
      kind: "capability_denied",
      exitCode: 228,
      stdout: "",
      stderr: "action 'find_references' is disabled in current VM policy; enable findReferences in VM settings to use symbol reference search",
      saVmEvents: [],
      saVmViolation: { reason: "findReferences disabled" },
      durationMs: Date.now() - startedAt
    };
  }

  const detail = options.detail === true;
  const _refPg = resolvePagination(options as Record<string, unknown>, {
    defaultSize: typeof options.max_results === "number" && options.max_results > 0 ? options.max_results : typeof options.limit === "number" && options.limit > 0 ? options.limit : 50,
    maxSize: 500,
    legacyLimit: typeof options.max_results === "number" && options.max_results > 0 ? options.max_results : options.limit,
  });
  const maxResults = _refPg.paginated ? _refPg.countCap : (typeof options.max_results === "number" && options.max_results > 0
    ? options.max_results
    : typeof options.limit === "number" && options.limit > 0
      ? options.limit
      : 50);
  const maxTokens = typeof options.max_tokens === "number" && options.max_tokens > 0
    ? options.max_tokens
    : 3000;
  const excludeComments = options.exclude_comments !== false;
  const includeDeclarations = options.include_declarations !== false;
  const timeoutMs = resolveTimeoutMs(options, 15_000);
  let isTimedOut = false;

  const escapedSymbol = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const wordRegex = new RegExp(`\\b${escapedSymbol}\\b`);
  const defRegex = new RegExp(`(?:export\\s+)?(?:default\\s+)?(?:async\\s+)?(?:function|class|interface|type|enum|struct|trait|fn|def)\\s+${escapedSymbol}\\b|(?:const|let|var)\\s+${escapedSymbol}\\s*[:=]`);
  const impRegex = new RegExp(`(?:import\\s+.*?\\b${escapedSymbol}\\b|from\\s+.*?import\\s+.*?\\b${escapedSymbol}\\b|require\\(.*\\b${escapedSymbol}\\b|use\\s+.*?::${escapedSymbol}\\b)`);

  const fileGroups: Record<string, string[]> = {};
  let totalFound = 0;
  let returnedCount = 0;
  let estimatedTokens = 100; // base overhead for JSON structure

  try {
    const rawCandidates = options.candidate_files ?? options.files;
    let targetFiles: string[] = [];

    if (Array.isArray(rawCandidates) && rawCandidates.length > 0) {
      // 1. Explicit candidate exploration
      for (const item of rawCandidates) {
        if (typeof item !== "string" || !item.trim()) continue;
        if (hasGlobMagic(item)) {
          const expanded = await expandCandidateFileGlob(item, cwd, normalized, startedAt, timeoutMs);
          for (const candidate of expanded) {
            if (!targetFiles.includes(candidate)) targetFiles.push(candidate);
          }
          continue;
        }
        const candidatePath = isAbsolute(item) ? item : resolve(cwd, item);
        const check = checkSaVmPath(normalized, "read", candidatePath, cwd);
        if (!check.allowed) continue;
        if (existsSync(candidatePath)) {
          const st = await stat(candidatePath).catch(() => null);
          if (st && st.isFile()) {
            targetFiles.push(candidatePath);
          }
        }
      }
    } else {
      // 2. Directory exploration
      const baseDir = (typeof options.dir === "string" && options.dir.trim()) ? resolve(cwd, options.dir.trim()) : resolve(cwd);
      const checkDir = checkSaVmPath(normalized, "read", baseDir, cwd);
      if (!checkDir.allowed) {
        return {
          ok: false,
          kind: "capability_denied",
          exitCode: 228,
          stdout: "",
          stderr: `access denied to search directory: ${checkDir.reason}`,
          saVmEvents: [],
          saVmViolation: { reason: checkDir.reason },
          durationMs: Date.now() - startedAt
        };
      }

      const giRules = loadGitIgnoreRules(baseDir);
      const queue: string[] = [baseDir];

      while (queue.length > 0 && targetFiles.length < 2000) {
        if (Date.now() - startedAt > timeoutMs) {
          isTimedOut = true;
          break;
        }
        const current = queue.shift()!;
        try {
          const entries = await readdir(current, { withFileTypes: true });
          for (const ent of entries) {
            if (ent.isDirectory()) {
              if (!isGitIgnored(ent.name, true, giRules)) {
                queue.push(join(current, ent.name));
              }
            } else if (ent.isFile()) {
              if (isGitIgnored(ent.name, false, giRules)) continue;
              const lower = ent.name.toLowerCase();
              if (
                lower.endsWith(".ts") || lower.endsWith(".tsx") || lower.endsWith(".js") || lower.endsWith(".jsx") ||
                lower.endsWith(".mjs") || lower.endsWith(".cjs") || lower.endsWith(".rs") || lower.endsWith(".py") ||
                lower.endsWith(".go") || lower.endsWith(".zig") || lower.endsWith(".java") || lower.endsWith(".c") ||
                lower.endsWith(".cpp") || lower.endsWith(".h") || lower.endsWith(".vue") || lower.endsWith(".svelte") ||
                lower.endsWith(".json") || lower.endsWith(".toml")
              ) {
                targetFiles.push(join(current, ent.name));
              }
            }
          }
        } catch {
          // ignore unreadable dirs
        }
      }
    }

    // 3. Scan collected files
    for (const filePath of targetFiles) {
      if (Date.now() - startedAt > timeoutMs) {
        isTimedOut = true;
        break;
      }
      try {
        const content = await readFile(filePath, "utf8");
        if (!wordRegex.test(content)) continue;

        const lines = content.split(/\r?\n/);
        const relPath = relative(cwd, filePath).replace(/\\/g, "/");

        for (let i = 0; i < lines.length; i++) {
          if (Date.now() - startedAt > timeoutMs) {
            isTimedOut = true;
            break;
          }
          const line = lines[i]!;
          if (!wordRegex.test(line)) continue;

          const trimmed = line.trim();
          if (excludeComments) {
            if (
              trimmed.startsWith("//") || trimmed.startsWith("#") ||
              trimmed.startsWith("/*") || trimmed.startsWith("*") ||
              trimmed.startsWith("<!--") || trimmed.startsWith(";")
            ) {
              continue;
            }
          }

          let typeCode = "e2"; // default: usage / call
          if (defRegex.test(trimmed)) {
            typeCode = "e0"; // definition / declaration
          } else if (impRegex.test(trimmed)) {
            typeCode = "e1"; // import
          }

          if (typeCode === "e0" && !includeDeclarations) continue;

          totalFound++;

          // Check limits
          if (returnedCount < maxResults && estimatedTokens < maxTokens) {
            if (!fileGroups[relPath]) fileGroups[relPath] = [];
            const entry = detail
              ? `L${i + 1}:${typeCode}:${trimmed.slice(0, 200)}`
              : `L${i + 1}:${typeCode}`;
            fileGroups[relPath]!.push(entry);
            returnedCount++;
            estimatedTokens += Math.ceil(entry.length / 3.5) + 3;
          }
        }
      } catch {
        // ignore unreadable files
      }
    }

    if (isTimedOut && totalFound === 0) {
      return {
        ok: false,
        kind: "timeout",
        exitCode: 124,
        stdout: JSON.stringify({
          symbol,
          total: 0,
          returned: 0,
          truncated: true,
          timed_out: true,
          timeout_ms: timeoutMs,
          types: { e0: "def", e1: "imp", e2: "use" },
          files: {}
        }, null, 2),
        stderr: `find_references timed out after ${timeoutMs}ms (scanned ${targetFiles.length} files without matches)`,
        saVmEvents: [],
        saVmViolation: null,
        durationMs: Date.now() - startedAt
      };
    }

    let outFiles: Record<string, string[]> = fileGroups;
    let outReturned = returnedCount;
    let outPage: number | undefined;
    let outPageSize: number | undefined;
    let outTotalPages: number | undefined;
    let outHasNext: boolean | undefined;
    let outHasPrev: boolean | undefined;
    if (_refPg.paginated) {
      const flat: Array<{ file: string; entry: string }> = [];
      for (const [f, arr] of Object.entries(fileGroups).sort(([a], [b]) => a.localeCompare(b))) {
        for (const e of arr) flat.push({ file: f, entry: e });
      }
      const s = paginateItems(flat, _refPg);
      outFiles = {};
      for (const r of s.paged) {
        if (!outFiles[r.file]) outFiles[r.file] = [];
        outFiles[r.file]!.push(r.entry);
      }
      outReturned = s.returned;
      outPage = _refPg.page;
      outPageSize = _refPg.page_size;
      outTotalPages = s.total_pages;
      outHasNext = (totalFound >= _refPg.countCap || isTimedOut) ? true : s.has_next;
      outHasPrev = s.has_prev;
    }
    const output = {
      symbol,
      total: totalFound,
      returned: outReturned,
      truncated: totalFound > outReturned || isTimedOut,
      timed_out: isTimedOut ? true : undefined,
      timeout_ms: isTimedOut ? timeoutMs : undefined,
      page: outPage,
      page_size: outPageSize,
      total_pages: outTotalPages,
      has_next: outHasNext,
      has_prev: outHasPrev,
      types: { e0: "def", e1: "imp", e2: "use" },
      files: outFiles
    };

    return {
      ok: true,
      kind: "success",
      exitCode: 0,
      stdout: JSON.stringify(output, null, 2),
      stderr: isTimedOut ? `[timeout] find_references reached timeout limit of ${timeoutMs}ms; returning ${totalFound} partial matches` : "",
      saVmEvents: [
        {
          timestamp: Date.now(),
          type: "references_found",
          symbol,
          total: totalFound,
          returned: returnedCount
        }
      ],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      kind: "sa_error",
      exitCode: 1,
      stdout: "",
      stderr: msg,
      saVmEvents: [],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  }
}

export async function nativeFindImplementations(
  rawSymbol: string | undefined,
  options: {
    symbol?: string;
    target?: string;
    name?: string;
    query?: string;
    content?: string;
    dir?: string;
    pattern?: string;
    candidate_files?: string[];
    files?: string[];
    include_body?: boolean;
    detail?: boolean;
    max_results?: number;
    limit?: number;
    max_tokens?: number;
    timeout_ms?: number;
    timeout?: number;
    page?: unknown; page_num?: unknown; pageNum?: unknown; p?: unknown;
    page_size?: unknown; pageSize?: unknown; per_page?: unknown; perPage?: unknown;
    offset?: unknown; count_cap?: unknown; countCap?: unknown; max_total?: unknown;
    exact_total?: unknown; exactTotal?: unknown;
  },
  policy: SaVmPolicyConfig | undefined,
  cwd: string,
  startedAt: number
): Promise<SaVmRunResult> {
  const _implPg = resolvePagination(options as Record<string, unknown>, {
    defaultSize: typeof options.max_results === "number" && options.max_results > 0 ? options.max_results : typeof options.limit === "number" && options.limit > 0 ? options.limit : 50,
    maxSize: 500,
    legacyLimit: typeof options.max_results === "number" && options.max_results > 0 ? options.max_results : options.limit,
  });
  const symbol = (rawSymbol ?? options.symbol ?? options.target ?? options.name ?? options.query ?? options.content ?? "").trim();
  if (!symbol) {
    return {
      ok: false,
      kind: "sa_error",
      exitCode: 1,
      stdout: "",
      stderr: "symbol parameter is required for find_implementations",
      saVmEvents: [],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  }

  const normalized = normalizeSaVmPolicy(policy, cwd);
  if (normalized.tools?.findReferences !== true) {
    return {
      ok: false,
      kind: "capability_denied",
      exitCode: 228,
      stdout: "",
      stderr: "action 'find_implementations' is disabled in current VM policy; enable findReferences in VM settings",
      saVmEvents: [],
      saVmViolation: { reason: "findReferences disabled" },
      durationMs: Date.now() - startedAt
    };
  }

  const detail = options.detail === true;
  const includeBody = options.include_body === true;
  const maxResults = _implPg.paginated ? _implPg.countCap : (typeof options.max_results === "number" && options.max_results > 0
    ? options.max_results
    : typeof options.limit === "number" && options.limit > 0
      ? options.limit
      : 50);
  const maxTokens = typeof options.max_tokens === "number" && options.max_tokens > 0
    ? options.max_tokens
    : 3000;
  const timeoutMs = resolveTimeoutMs(options, 15_000);
  let isTimedOut = false;

  const esc = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const wordRegex = new RegExp(`\\b${esc}\\b`);

  const implRegexes = [
    // 1. Class or interface implements / extends
    new RegExp(`\\bclass\\s+[A-Za-z0-9_$]+(?:<[^>]*>)?(?:\\s+extends\\s+[^{]+)?\\s+implements\\s+[^{]*\\b${esc}\\b`),
    new RegExp(`\\bimplements\\s+[^{]*\\b${esc}\\b`),
    new RegExp(`\\bclass\\s+[A-Za-z0-9_$]+(?:<[^>]*>)?\\s+extends\\s+[^{]*\\b${esc}\\b`),
    new RegExp(`\\binterface\\s+[A-Za-z0-9_$]+(?:<[^>]*>)?\\s+extends\\s+[^{]*\\b${esc}\\b`),
    new RegExp(`\\bimpl(?:<[^>]*>)?\\s+${esc}(?:<[^>]*>)?\\s+for\\s+`),
    new RegExp(`\\bclass\\s+[A-Za-z0-9_]+\\s*\\([^)]*\\b${esc}\\b[^)]*\\):`),
    // 2. Object literal satisfying interface / as / satisfies
    new RegExp(`(?:const|let|var)\\s+[A-Za-z0-9_$]+\\s*:\\s*(?:[A-Za-z0-9_$]+<[^>]*>|\\b${esc}\\b)\\s*=\\s*\\{`),
    new RegExp(`:\\s*\\b${esc}\\b\\s*=\\s*\\{`),
    new RegExp(`\\b(?:as|satisfies)\\s+${esc}\\b`),
    // 3. Function returning or assigned to interface
    new RegExp(`(?:const|let|var)\\s+[A-Za-z0-9_$]+\\s*:\\s*\\b${esc}\\b\\s*=\\s*(?:async\\s*)?(?:\\(|function)`),
    new RegExp(`\\bfunction\\s+[A-Za-z0-9_$]+(?:<[^>]*>)?\\s*\\([^)]*\\)\\s*:\\s*\\b${esc}\\b`),
    new RegExp(`\\)\\s*:\\s*\\b${esc}\\b\\s*=>`)
  ];

  let targetFiles: string[] = [];
  const rawCandidates = options.candidate_files ?? options.files;

  try {
    if (Array.isArray(rawCandidates) && rawCandidates.length > 0) {
      for (const item of rawCandidates) {
        if (typeof item !== "string" || !item.trim()) continue;
        if (hasGlobMagic(item)) {
          const expanded = await expandCandidateFileGlob(item, cwd, normalized, startedAt, timeoutMs);
          for (const candidate of expanded) {
            if (!targetFiles.includes(candidate)) targetFiles.push(candidate);
          }
          continue;
        }
        const candidatePath = isAbsolute(item) ? item : resolve(cwd, item);
        const check = checkSaVmPath(normalized, "read", candidatePath, cwd);
        if (!check.allowed) continue;
        if (existsSync(candidatePath)) {
          const st = await stat(candidatePath).catch(() => null);
          if (st && st.isFile()) {
            targetFiles.push(candidatePath);
          }
        }
      }
    } else {
      const baseDir = (typeof options.dir === "string" && options.dir.trim()) ? resolve(cwd, options.dir.trim()) : resolve(cwd);
      const checkDir = checkSaVmPath(normalized, "read", baseDir, cwd);
      if (!checkDir.allowed) {
        return {
          ok: false,
          kind: "capability_denied",
          exitCode: 228,
          stdout: "",
          stderr: `access denied to search directory: ${checkDir.reason}`,
          saVmEvents: [],
          saVmViolation: { reason: checkDir.reason },
          durationMs: Date.now() - startedAt
        };
      }

      const defaultExtRegex = /\.(?:tsx?|jsx?|mts|cts|mjs|cjs|zig|rs|py|go|vue|svelte)$/i;
      let patternRegex: RegExp | null = null;
      if (options.pattern?.trim()) {
        const escaped = options.pattern.trim()
          .replace(/\\/g, "/")
          .replace(/[.+^${}()|[\]\\]/g, "\\$&")
          .replace(/\*\*/g, ".*")
          .replace(/\*/g, "[^/]*");
        patternRegex = new RegExp(`^${escaped}$`, "i");
      }

      const giRules = loadGitIgnoreRules(baseDir);
      const queue: string[] = [baseDir];

      while (queue.length > 0 && targetFiles.length < 2000) {
        if (Date.now() - startedAt > timeoutMs) {
          isTimedOut = true;
          break;
        }
        const current = queue.shift()!;
        try {
          const entries = await readdir(current, { withFileTypes: true });
          for (const ent of entries) {
            if (ent.isDirectory()) {
              if (!isGitIgnored(ent.name, true, giRules)) {
                queue.push(join(current, ent.name));
              }
            } else if (ent.isFile()) {
              if (isGitIgnored(ent.name, false, giRules)) continue;
              const fullFilePath = join(current, ent.name);
              const rel = relative(cwd, fullFilePath).replace(/\\/g, "/");
              const matches = patternRegex ? (patternRegex.test(rel) || patternRegex.test(ent.name)) : defaultExtRegex.test(ent.name);
              if (matches) {
                targetFiles.push(fullFilePath);
              }
            }
          }
        } catch {
          // ignore unreadable dirs
        }
      }
    }

    const fileGroups: Record<string, string[]> = {};
    const compactImplementations: string[] = [];
    const detailedImplementations: Array<{
      file: string;
      line: number;
      type: "e3";
      signature: string;
      body?: string;
    }> = [];

    const seenKeys = new Set<string>();
    let totalFound = 0;
    let returnedCount = 0;
    let estimatedTokens = 100;

    for (const filePath of targetFiles) {
      if (Date.now() - startedAt > timeoutMs) {
        isTimedOut = true;
        break;
      }
      const checkFile = checkSaVmPath(normalized, "read", filePath, cwd);
      if (!checkFile.allowed) continue;

      try {
        const content = await readFile(filePath, "utf8");
        if (!wordRegex.test(content)) continue;

        const lines = content.split(/\r?\n/);
        const relPath = relative(cwd, filePath).replace(/\\/g, "/");

        let inBlockComment = false;
        for (let i = 0; i < lines.length; i++) {
          if (Date.now() - startedAt > timeoutMs) {
            isTimedOut = true;
            break;
          }
          const line = lines[i]!;
          const trimmed = line.trim();

          if (inBlockComment) {
            if (trimmed.includes("*/")) {
              inBlockComment = false;
            }
            continue;
          }
          if (trimmed.startsWith("/*")) {
            if (!trimmed.includes("*/")) {
              inBlockComment = true;
            }
            continue;
          }

          if (
            trimmed.startsWith("//") || trimmed.startsWith("#") ||
            trimmed.startsWith("*") || trimmed.startsWith("<!--") || trimmed.startsWith(";")
          ) {
            continue;
          }

          if (!wordRegex.test(line)) continue;

          const matchesImpl = implRegexes.some((r) => r.test(trimmed));
          if (!matchesImpl) continue;

          const dedupKey = `${relPath}:${i + 1}`;
          if (seenKeys.has(dedupKey)) continue;
          seenKeys.add(dedupKey);

          totalFound++;

          if (returnedCount < maxResults && estimatedTokens < maxTokens) {
            if (!fileGroups[relPath]) fileGroups[relPath] = [];

            if (detail || includeBody) {
              const signature = trimmed.slice(0, 200);
              let bodySnippet: string | undefined;
              if (includeBody) {
                const bodyLines = lines.slice(i, Math.min(lines.length, i + 10));
                bodySnippet = bodyLines.join("\n");
              }
              detailedImplementations.push({
                file: relPath,
                line: i + 1,
                type: "e3",
                signature,
                body: bodySnippet
              });
              fileGroups[relPath]!.push(`L${i + 1}:e3:${signature}`);
              estimatedTokens += Math.ceil((signature.length + (bodySnippet?.length ?? 0)) / 3.5) + 10;
            } else {
              const compactEntry = `${relPath}:L${i + 1}:e3`;
              compactImplementations.push(compactEntry);
              fileGroups[relPath]!.push(`L${i + 1}:e3`);
              estimatedTokens += Math.ceil(compactEntry.length / 3.5) + 2;
            }
            returnedCount++;
          }
        }
      } catch {
        // skip unreadable
      }
    }

    let implFiles: Record<string, string[]> = fileGroups;
    let implList: Array<string | { file: string; line: number; type: "e3"; signature: string; body?: string }> = (detail || includeBody) ? detailedImplementations : compactImplementations;
    let implReturned = returnedCount;
    let implPage: number | undefined;
    let implPageSize: number | undefined;
    let implTotalPages: number | undefined;
    let implHasNext: boolean | undefined;
    let implHasPrev: boolean | undefined;
    if (_implPg.paginated) {
      const flat: Array<{ file: string; entry: string; idx: number }> = [];
      for (const [f, arr] of Object.entries(fileGroups).sort(([a], [b]) => a.localeCompare(b))) {
        for (const e of arr) flat.push({ file: f, entry: e, idx: flat.length });
      }
      const s = paginateItems(flat, _implPg);
      implFiles = {};
      for (const r of s.paged) {
        if (!implFiles[r.file]) implFiles[r.file] = [];
        implFiles[r.file]!.push(r.entry);
      }
      const listSrc: typeof implList = (detail || includeBody) ? [...detailedImplementations].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line) : [...compactImplementations].sort();
      const ls = paginateItems(listSrc, _implPg);
      implList = ls.paged;
      implReturned = s.returned;
      implPage = _implPg.page;
      implPageSize = _implPg.page_size;
      implTotalPages = s.total_pages;
      implHasNext = (totalFound >= _implPg.countCap || isTimedOut) ? true : s.has_next;
      implHasPrev = s.has_prev;
    }
    const output = {
      symbol,
      total: totalFound,
      returned: implReturned,
      truncated: totalFound > implReturned || isTimedOut,
      timed_out: isTimedOut ? true : undefined,
      timeout_ms: isTimedOut ? timeoutMs : undefined,
      page: implPage,
      page_size: implPageSize,
      total_pages: implTotalPages,
      has_next: implHasNext,
      has_prev: implHasPrev,
      types: { e3: "impl" },
      files: implFiles,
      implementations: implList
    };

    return {
      ok: true,
      kind: "success",
      exitCode: 0,
      stdout: JSON.stringify(output, null, 2),
      stderr: isTimedOut ? `[timeout] find_implementations reached timeout limit of ${timeoutMs}ms; scanned ${targetFiles.length} files` : "",
      saVmEvents: [
        {
          timestamp: Date.now(),
          type: "find_implementations_completed",
          symbol,
          total: totalFound,
          returned: returnedCount,
          durationMs: Date.now() - startedAt
        }
      ],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      kind: "sa_error",
      exitCode: 1,
      stdout: "",
      stderr: msg,
      saVmEvents: [],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  }
}

const moduleBoundaryCache = new Map<string, string | null>();

function detectModuleBoundary(filePath: string, rootDir: string): string | null {
  let currentDir = dirname(resolve(filePath));
  const root = resolve(rootDir);
  const boundaryFiles = ["package.json", "Cargo.toml", "go.mod", "build.zig", "pyproject.toml"];
  while (currentDir.length >= root.length) {
    const cached = moduleBoundaryCache.get(currentDir);
    if (cached !== undefined) return cached;
    for (const bf of boundaryFiles) {
      const candidate = join(currentDir, bf);
      if (existsSync(candidate)) {
        let modName = relative(root, currentDir).split(sep).join("/") || ".";
        try {
          if (bf === "package.json") {
            const raw = readFileSync(candidate, "utf8");
            const parsed = JSON.parse(raw);
            if (typeof parsed?.name === "string" && parsed.name) {
              modName = parsed.name;
            }
          } else if (bf === "go.mod") {
            const rawText = readFileSync(candidate, "utf8");
            const lines = rawText.split(String.fromCharCode(10));
            for (const line of lines) {
              const trimmed = line.trim();
              if (trimmed.startsWith("module ")) {
                modName = trimmed.slice(7).trim();
                break;
              }
            }
          } else if (bf === "Cargo.toml") {
            const rawText = readFileSync(candidate, "utf8");
            const lines = rawText.split(String.fromCharCode(10));
            for (const line of lines) {
              const trimmed = line.trim();
              if (trimmed.startsWith("name")) {
                const parts = trimmed.split("=");
                if (parts[0]?.trim() === "name") {
                  modName = parts[1]?.replace(/"/g, "").trim() || modName;
                  break;
                }
              }
            }
          }
        } catch {
          // ignore
        }
        moduleBoundaryCache.set(currentDir, modName);
        return modName;
      }
    }
    const parent = dirname(currentDir);
    if (parent === currentDir) break;
    currentDir = parent;
  }
  return null;
}

export async function collectWorkspaceSourceFiles(
  baseDir: string,
  maxFiles = 2000,
  timeoutMs = 15000,
  startedAt = Date.now()
): Promise<string[]> {
  const targetFiles: string[] = [];
  const giRules = loadGitIgnoreRules(baseDir);

  const bunGlobal = (globalThis as unknown as {
    Bun?: {
      Glob?: new (pattern: string) => {
        scan: (options: { cwd: string; onlyFiles: boolean }) => AsyncIterable<string>;
      };
    };
  }).Bun;

  if (typeof bunGlobal?.Glob === "function") {
    try {
      const g = new bunGlobal.Glob("**/*.{ts,tsx,js,jsx,mjs,cjs,rs,py,go,zig,java,c,cpp,h,vue,svelte,json,toml}");
      const badDirCache = new Set<string>();
      const goodDirCache = new Set<string>();
      for await (const p of g.scan({ cwd: baseDir, onlyFiles: true })) {
        if (Date.now() - startedAt > timeoutMs || targetFiles.length >= maxFiles) break;
        const norm = p.split(sep).join("/");
        const lastSlash = norm.lastIndexOf("/");
        if (lastSlash !== -1) {
          const dir = norm.slice(0, lastSlash);
          if (badDirCache.has(dir)) continue;
          let skip = false;
          let cur = "";
          for (const part of dir.split("/")) {
            cur = cur ? cur + "/" + part : part;
            if (badDirCache.has(cur)) {
              skip = true;
              break;
            }
            if (!goodDirCache.has(cur)) {
              if (ALWAYS_EXCLUDED_DIRS.has(part) || isGitIgnored(part, true, giRules, cur)) {
                badDirCache.add(cur);
                skip = true;
                break;
              }
              goodDirCache.add(cur);
            }
          }
          if (skip) {
            badDirCache.add(dir);
            continue;
          }
        }
        const fileName = lastSlash === -1 ? norm : norm.slice(lastSlash + 1);
        if (isGitIgnored(fileName, false, giRules, norm)) continue;
        targetFiles.push(join(baseDir, p));
      }
      return targetFiles;
    } catch {
      // fallback to readdir queue below
    }
  }

  const queue: string[] = [baseDir];

  while (queue.length > 0 && targetFiles.length < maxFiles) {
    if (Date.now() - startedAt > timeoutMs) break;
    const current = queue.shift()!;
    try {
      const entries = await readdir(current, { withFileTypes: true });
      for (const ent of entries) {
        if (ent.isDirectory()) {
          if (!isGitIgnored(ent.name, true, giRules)) {
            queue.push(join(current, ent.name));
          }
        } else if (ent.isFile()) {
          if (isGitIgnored(ent.name, false, giRules)) continue;
          const lower = ent.name.toLowerCase();
          if (
            lower.endsWith(".ts") || lower.endsWith(".tsx") || lower.endsWith(".js") || lower.endsWith(".jsx") ||
            lower.endsWith(".mjs") || lower.endsWith(".cjs") || lower.endsWith(".rs") || lower.endsWith(".py") ||
            lower.endsWith(".go") || lower.endsWith(".zig") || lower.endsWith(".java") || lower.endsWith(".c") ||
            lower.endsWith(".cpp") || lower.endsWith(".h") || lower.endsWith(".vue") || lower.endsWith(".svelte") ||
            lower.endsWith(".json") || lower.endsWith(".toml")
          ) {
            targetFiles.push(join(current, ent.name));
          }
        }
      }
    } catch {
      // ignore unreadable dirs
    }
  }
  return targetFiles;
}

// Bun.Worker prefilter pool: split files across N workers (default 4,
// SA_VM_FIND_WORKERS overrides, capped 1-8). Each worker runs disk I/O +
// substring prefilter off the main thread and returns matching paths.
// Main thread keeps precise parsing. Any failure -> throw so callers
// fall back to the sequential loop. Workers always terminated.
export async function prefilterFilesInWorkers(
  files: string[],
  symbol: string,
  timeoutMs = 8000
): Promise<string[]> {
  const WorkerCtor = (globalThis as unknown as { Worker?: typeof Worker }).Worker;
  if (typeof WorkerCtor === "undefined" || files.length === 0 || !symbol) {
    throw new Error("workers unavailable");
  }
  const count = Math.max(1, Math.min(8, Math.trunc(Number(process.env.SA_VM_FIND_WORKERS ?? 4) || 4)));
  const shards: string[][] = Array.from({ length: Math.min(count, files.length) }, () => []);
  files.forEach((f, i) => { shards[i % shards.length]!.push(f); });
  const workers: Worker[] = [];
  try {
    const results = await Promise.all(shards.map((shard, i) => new Promise<string[]>((resolve, reject) => {
      let worker: Worker;
      try {
        worker = new WorkerCtor(new URL("./saVmFindWorker.ts", import.meta.url), { name: `sa-find-${i}` });
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      workers.push(worker);
      const timer = setTimeout(() => {
        try { worker.terminate(); } catch {}
        reject(new Error("find worker timeout"));
      }, timeoutMs);
      worker.onmessage = (event: { data: unknown }) => {
        clearTimeout(timer);
        const data = event.data as { ok?: boolean; matches?: string[]; error?: string };
        if (data && data.ok && Array.isArray(data.matches)) resolve(data.matches as string[]);
        else reject(new Error(typeof data?.error === "string" ? data.error : "find worker failed"));
      };
      worker.onerror = (event: unknown) => {
        clearTimeout(timer);
        reject(event instanceof Error ? event : new Error("find worker error"));
      };
      worker.postMessage({ files: shard, symbol });
    })));
    return results.flat();
  } finally {
    for (const w of workers) { try { w.terminate(); } catch {} }
  }
}

export async function nativeFileOutline(
  rawPath: string,
  options: {
    detail?: boolean;
    max_tokens?: number;
    max_file_bytes?: number;
  },
  policy: SaVmPolicyConfig | undefined,
  cwd: string,
  startedAt: number
): Promise<SaVmRunResult> {
  const targetPath = (rawPath ?? "").trim();
  if (!targetPath) {
    return {
      ok: false,
      kind: "sa_error",
      exitCode: 1,
      stdout: "",
      stderr: "path parameter is required for file_outline",
      saVmEvents: [],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  }

  const normalized = normalizeSaVmPolicy(policy, cwd);
  if (normalized.tools?.fileOutline !== true) {
    return {
      ok: false,
      kind: "capability_denied",
      exitCode: 228,
      stdout: "",
      stderr: "action 'file_outline' is disabled in current VM policy; enable fileOutline in VM settings to use structural outline extraction",
      saVmEvents: [],
      saVmViolation: { reason: "fileOutline disabled" },
      durationMs: Date.now() - startedAt
    };
  }

  const check = checkSaVmPath(normalized, "read", targetPath, cwd);
  if (!check.allowed) {
    return {
      ok: false,
      kind: "capability_denied",
      exitCode: 228,
      stdout: "",
      stderr: `Policy violation: ${check.reason || "read not allowed"}`,
      saVmEvents: [],
      saVmViolation: { reason: check.reason },
      durationMs: Date.now() - startedAt
    };
  }

  const fullPath = resolve(cwd, targetPath);
  if (!existsSync(fullPath)) {
    return {
      ok: false,
      kind: "sa_error",
      exitCode: 1,
      stdout: "",
      stderr: `File not found: ${targetPath}`,
      saVmEvents: [],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  }

  try {
    const outlineMaxBytes = resolveMaxFileBytes(options.max_file_bytes, DEFAULT_OUTLINE_MAX_FILE_BYTES);
    const outlineMaxTokens = typeof options.max_tokens === "number" && options.max_tokens > 0
      ? Math.min(options.max_tokens, 32000)
      : 4000;
    const { text: outlineContent, skipped: outlineSkipped } = await readSearchableText(fullPath, outlineMaxBytes);
    if (outlineSkipped === "binary") {
      return {
        ok: true,
        kind: "success",
        exitCode: 0,
        stdout: `[Binary file detected: ${targetPath}. Structural outline is unavailable for binary files.]`,
        stderr: "",
        saVmEvents: [],
        saVmViolation: null,
        durationMs: Date.now() - startedAt
      };
    }
    if (outlineSkipped === "too_large" || outlineContent === undefined) {
      return {
        ok: false,
        kind: "sa_error",
        exitCode: 1,
        stdout: "",
        stderr: `[file_outline] '${targetPath}' exceeds max_file_bytes=${outlineMaxBytes}. Use read_lines with start_line/end_line slices, or raise max_file_bytes.`,
        saVmEvents: [],
        saVmViolation: null,
        durationMs: Date.now() - startedAt
      };
    }
    const content = outlineContent;
    const relPath = relative(cwd, fullPath).replace(/\\/g, "/");
    const outline = await extractFileOutline(relPath, content, { detail: options.detail });

    let formatted = outline.formatted;
    let outlineTruncated = false;
    if (estimateTokenCount(formatted) > outlineMaxTokens) {
      const outlineLines = formatted.split("\n");
      const keptLines: string[] = outlineLines[0] ? [outlineLines[0]!] : [];
      let keptTokens = estimateTokenCount(keptLines[0] ?? "");
      for (let i = 1; i < outlineLines.length; i++) {
        const lineCost = estimateTokenCount(outlineLines[i]!);
        if (keptTokens + lineCost > outlineMaxTokens) break;
        keptLines.push(outlineLines[i]!);
        keptTokens += lineCost;
      }
      const droppedLines = outlineLines.length - keptLines.length;
      formatted = keptLines.join("\n")
        + `\n[... truncated: ${droppedLines} more outline lines exceed max_tokens=${outlineMaxTokens}. Call file_outline with detail:false, or read_lines for the symbol range you need.]`;
      outlineTruncated = true;
    }

    return {
      ok: true,
      kind: "success",
      exitCode: 0,
      stdout: formatted,
      stderr: outlineTruncated ? "[file_outline] output truncated to the max_tokens budget; the symbol list is partial." : "",
      saVmEvents: [
        {
          timestamp: Date.now(),
          type: "file_outline",
          path: relPath,
          symbols: outline.symbols.length
        }
      ],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      kind: "sa_error",
      exitCode: 1,
      stdout: "",
      stderr: msg,
      saVmEvents: [],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  }
}

export async function nativeWorkspaceOutline(
  rawDir: string,
  options: {
    pattern?: string;
    path_pattern?: string;
    is_regex?: boolean;
    regex?: boolean;
    max_files?: number;
    max_symbols_per_file?: number;
    max_tokens?: number;
    max_file_bytes?: number;
    exclude_dirs?: string[];
    detail?: boolean;
    timeout_ms?: number;
    timeout?: number;
    page?: unknown; page_num?: unknown; pageNum?: unknown; p?: unknown;
    page_size?: unknown; pageSize?: unknown; per_page?: unknown; perPage?: unknown;
    offset?: unknown; count_cap?: unknown; countCap?: unknown; max_total?: unknown;
    exact_total?: unknown; exactTotal?: unknown;
  },
  policy: SaVmPolicyConfig | undefined,
  cwd: string,
  startedAt: number
): Promise<SaVmRunResult> {
  const dir = (rawDir ?? ".").trim() || ".";
  const normalized = normalizeSaVmPolicy(policy, cwd);
  if (normalized.tools?.fileOutline !== true) {
    return {
      ok: false,
      kind: "capability_denied",
      exitCode: 228,
      stdout: "",
      stderr: "action 'workspace_outline' is disabled in current VM policy; enable fileOutline in VM settings to use structural outline extraction",
      saVmEvents: [],
      saVmViolation: { reason: "fileOutline disabled" },
      durationMs: Date.now() - startedAt
    };
  }
  const decision = checkSaVmPath(normalized, "read", dir, cwd);
  if (!decision.allowed) {
    return {
      ok: false,
      kind: "capability_denied",
      exitCode: 228,
      stdout: "",
      stderr: `Policy violation: ${decision.reason || "read not allowed"}`,
      saVmEvents: [],
      saVmViolation: { reason: decision.reason },
      durationMs: Date.now() - startedAt
    };
  }
  const resolved = isAbsolute(dir) ? resolve(dir) : resolve(cwd, dir);
  const timeoutMs = resolveTimeoutMs(options, 30_000);
  const maxFiles = clampInt(options.max_files, 20, 1, 100);
  const _woPg = resolvePagination(options as Record<string, unknown>, { defaultSize: maxFiles, maxSize: 100, legacyLimit: options.max_files });
  const _woCap = _woPg.paginated ? _woPg.countCap : maxFiles;
  const maxSymbolsPerFile = clampInt(options.max_symbols_per_file, 50, 1, 500);
  const maxTokens = typeof options.max_tokens === "number" && options.max_tokens > 0
    ? Math.min(options.max_tokens, 32000)
    : 6000;
  const maxBytes = resolveMaxFileBytes(options.max_file_bytes, DEFAULT_OUTLINE_MAX_FILE_BYTES);
  const filePattern = typeof options.pattern === "string" && options.pattern ? options.pattern : "*";
  const pathPattern = options.path_pattern;
  const effectiveIsRegex = options.is_regex ?? options.regex;
  const excludeDirs = options.exclude_dirs ?? [];
  const detail = options.detail === true;
  const giRules = loadMergedGitIgnoreRules(cwd, dir);

  const candidates: string[] = [];
  let skippedFiltered = 0;
  let skippedLarge = 0;
  let skippedBinary = 0;
  let isTimedOut = false;

  async function walk(current: string, depth: number): Promise<void> {
    if (depth > 6 || candidates.length >= _woCap || isTimedOut) return;
    if (Date.now() - startedAt > timeoutMs) {
      isTimedOut = true;
      return;
    }
    let entries;
    try {
      entries = (await readdir(current, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      return;
    }
    for (const ent of entries) {
      if (candidates.length >= _woCap || isTimedOut) break;
      if (Date.now() - startedAt > timeoutMs) {
        isTimedOut = true;
        break;
      }
      const full = join(current, ent.name);
      const relToCwd = relative(cwd, full).replace(/\\/g, "/");
      if (isGitIgnored(ent.name, ent.isDirectory(), giRules, relToCwd)) {
        skippedFiltered += 1;
        continue;
      }
      if (isExcludedRelPath(relToCwd, excludeDirs)) {
        skippedFiltered += 1;
        continue;
      }
      if (ent.isDirectory()) {
        await walk(full, depth + 1);
      } else if (ent.isFile()) {
        if (!matchesFilePattern(ent.name, relToCwd, filePattern, pathPattern, effectiveIsRegex)) continue;
        candidates.push(full);
      }
    }
  }

  await walk(resolved, 0);
  candidates.sort((a, b) => a.localeCompare(b));
  let outlineTargets = candidates;
  let woPage: number | undefined;
  let woPageSize: number | undefined;
  let woTotalPages: number | undefined;
  let woHasNext: boolean | undefined;
  let woHasPrev: boolean | undefined;
  let woTotal = candidates.length;
  if (_woPg.paginated) {
    const s = paginateItems(candidates, _woPg);
    outlineTargets = s.paged;
    woPage = _woPg.page;
    woPageSize = _woPg.page_size;
    woTotalPages = s.total_pages;
    woHasNext = (candidates.length >= _woCap || isTimedOut) ? true : s.has_next;
    woHasPrev = s.has_prev;
  }

  const blocks: string[] = [];
  let usedTokens = 0;
  let outlinedCount = 0;
  let filesTruncated = 0;
  for (const full of outlineTargets) {
    if (Date.now() - startedAt > timeoutMs) {
      isTimedOut = true;
      break;
    }
    const relToCwd = relative(cwd, full).replace(/\\/g, "/");
    const { text, skipped } = await readSearchableText(full, maxBytes);
    if (skipped === "too_large") {
      skippedLarge += 1;
      continue;
    }
    if (skipped === "binary") {
      skippedBinary += 1;
      continue;
    }
    if (text === undefined) continue;
    let block: string;
    try {
      const result = await extractFileOutline(relToCwd, text, { detail });
      const totalLines = text.split(/\r?\n/).length;
      block = formatOutlineAsTree(relToCwd, totalLines, result.symbols.slice(0, maxSymbolsPerFile));
    } catch {
      continue;
    }
    const cost = estimateTokenCount(block);
    if (usedTokens + cost > maxTokens && blocks.length > 0) {
      filesTruncated += 1;
      continue;
    }
    blocks.push(block);
    usedTokens += cost;
    outlinedCount += 1;
  }

  const header = _woPg.paginated
    ? `[workspace_outline] ${dir} (page ${woPage}/${woTotalPages ?? 0}, ${outlinedCount}/${outlineTargets.length} outlined, total ${woTotal} files)`
    : `[workspace_outline] ${dir} (${outlinedCount}/${candidates.length} files outlined)`;
  const notes: string[] = [];
  if (skippedFiltered > 0) notes.push(`skipped ${skippedFiltered} ignored/excluded paths`);
  if (skippedLarge > 0) notes.push(`skipped ${skippedLarge} files exceeding max_file_bytes=${maxBytes}`);
  if (skippedBinary > 0) notes.push(`skipped ${skippedBinary} binary files`);
  if (filesTruncated > 0) notes.push(`${filesTruncated} files omitted over max_tokens=${maxTokens}; narrow dir/pattern or raise max_tokens`);
  if (isTimedOut) notes.push(`timeout after ${timeoutMs}ms; showing partial results`);
  if (_woPg.paginated && candidates.length >= _woCap) notes.push(`results capped at count_cap=${_woCap}; narrow dir/pattern or raise count_cap`);
  const noteLine = notes.length > 0 ? `\n[${notes.join("; ")}]` : "";
  const pageMeta = _woPg.paginated
    ? `\n[page ${woPage} of ${woTotalPages} | page_size ${woPageSize} | total ${woTotal} | has_next ${woHasNext} | has_prev ${woHasPrev}]`
    : "";
  return {
    ok: true,
    kind: "success",
    exitCode: 0,
    stdout: `${header}${pageMeta}${noteLine}\n\n${blocks.join("\n\n")}`,
    stderr: "",
    saVmEvents: [
      {
        timestamp: Date.now(),
        type: "workspace_outline",
        dir,
        files: outlinedCount,
        page: woPage,
        page_size: woPageSize,
        total: _woPg.paginated ? woTotal : undefined,
        total_pages: woTotalPages
      }
    ],
    saVmViolation: null,
    durationMs: Date.now() - startedAt
  };
}

function collectFileImports(filePath: string, content: string): string[] {
  const imports = new Set<string>();
  const push = (value: string | undefined | null) => {
    if (!value) return;
    const text = value.trim().replace(/^['"]+|['"]+$/g, "");
    if (text && text.length < 256) imports.add(text);
  };
  const ext = (filePath.split(".").pop() ?? "").toLowerCase();
  const isTsJs = ["ts", "tsx", "js", "jsx", "mjs", "cjs", "mts", "cts"].includes(ext);
  const isPy = ext === "py";
  const isGo = ext === "go";
  const isRust = ext === "rs";
  const isZig = ext === "zig";
  if (!isTsJs && !isPy && !isGo && !isRust && !isZig) return [];
  let inGoImportBlock = false;
  for (const raw of content.split(/\r?\n/).slice(0, 400)) {
    const line = raw.trim();
    if (!line) continue;
    if (isTsJs) {
      if (line.startsWith("//") || line.startsWith("*")) continue;
      let match = line.match(/^(?:import\s+(?:[^'"]*?\s+from\s+)?|export\s+.*?\s+from\s+)['"]([^'"]+)['"]/);
      if (match) { push(match[1] ?? ""); continue; }
      match = line.match(/(?:import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/);
      if (match) push(match[1] ?? "");
    } else if (isPy) {
      if (line.startsWith("#")) continue;
      let match = line.match(/^from\s+([a-zA-Z0-9_.]+)\s+import\s+/);
      if (match) { push(match[1]); continue; }
      match = line.match(/^import\s+(.+)$/);
      if (match) for (const part of (match[1] ?? "").split(",")) {
        const aliasSplit = (part.trim().split(/\s+as\s+/)[0] ?? "").trim();
        if (aliasSplit) push(aliasSplit);
      }
    } else if (isGo) {
      if (/^import\s*\($/.test(line)) { inGoImportBlock = true; continue; }
      if (inGoImportBlock && line === ")") { inGoImportBlock = false; continue; }
      const match = line.match(/^"?([a-zA-Z0-9_./~+-]+)"?$/);
      if (inGoImportBlock && match) { push(match[1] ?? ""); continue; }
      const single = line.match(/^import\s+(?:[a-zA-Z0-9_]*\s+)?"([^"]+)"/);
      if (single) push(single[1] ?? "");
    } else if (isRust) {
      let match = line.match(/^use\s+([^;]+);/);
      if (match) { push(((match[1] ?? "").split("::{")[0] ?? "").split(" as ")[0]?.trim() ?? ""); continue; }
      match = line.match(/^mod\s+([a-zA-Z0-9_]+)\s*;/);
      if (match) push(match[1] ?? "");
    } else if (isZig) {
      const match = line.match(/@import\s*\(\s*"([^"]+)"\s*\)/);
      if (match) push(match[1] ?? "");
    }
    if (imports.size >= 20) break;
  }
  return [...imports].slice(0, 20);
}

interface RepoMapCacheEntry {
  mtimeMs: number;
  size: number;
  symbols: Array<{ name: string; kind: string; line: number }>;
  language: string | null;
  depends_on: string[];
  module: string | null;
}

const repoMapCache = new Map<string, RepoMapCacheEntry>();

export async function nativeRepoMap(
  rawDir: string,
  options: {
    pattern?: string;
    path_pattern?: string;
    is_regex?: boolean;
    regex?: boolean;
    max_files?: number;
    max_symbols_per_file?: number;
    max_tokens?: number;
    max_file_bytes?: number;
    exclude_dirs?: string[];
    include_used_by?: boolean;
    timeout_ms?: number;
    timeout?: number;
    page?: unknown; page_num?: unknown; pageNum?: unknown; p?: unknown;
    page_size?: unknown; pageSize?: unknown; per_page?: unknown; perPage?: unknown;
    offset?: unknown; count_cap?: unknown; countCap?: unknown; max_total?: unknown;
    exact_total?: unknown; exactTotal?: unknown;
  },
  policy: SaVmPolicyConfig | undefined,
  cwd: string,
  startedAt: number
): Promise<SaVmRunResult> {
  const dir = (rawDir ?? ".").trim() || ".";
  const normalized = normalizeSaVmPolicy(policy, cwd);
  if (normalized.tools?.fileOutline !== true) {
    return {
      ok: false,
      kind: "capability_denied",
      exitCode: 228,
      stdout: "",
      stderr: "action 'repo_map' is disabled in current VM policy; enable fileOutline in VM settings to use repo mapping",
      saVmEvents: [],
      saVmViolation: { reason: "fileOutline disabled" },
      durationMs: Date.now() - startedAt
    };
  }
  const decision = checkSaVmPath(normalized, "read", dir, cwd);
  if (!decision.allowed) {
    return {
      ok: false,
      kind: "capability_denied",
      exitCode: 228,
      stdout: "",
      stderr: `Policy violation: ${decision.reason || "read not allowed"}`,
      saVmEvents: [],
      saVmViolation: { reason: decision.reason },
      durationMs: Date.now() - startedAt
    };
  }
  const resolved = isAbsolute(dir) ? resolve(dir) : resolve(cwd, dir);
  const timeoutMs = resolveTimeoutMs(options, 30_000);
  const maxFiles = clampInt(options.max_files, 200, 1, 500);
  const _rmPg = resolvePagination(options as Record<string, unknown>, { defaultSize: maxFiles, maxSize: 500, legacyLimit: options.max_files });
  const _rmCap = _rmPg.paginated ? _rmPg.countCap : maxFiles;
  const maxSymbolsPerFile = clampInt(options.max_symbols_per_file, 30, 1, 200);
  const maxTokens = typeof options.max_tokens === "number" && options.max_tokens > 0
    ? Math.min(Math.floor(options.max_tokens), 32000)
    : 8000;
  const maxBytes = resolveMaxFileBytes(options.max_file_bytes, DEFAULT_OUTLINE_MAX_FILE_BYTES);
  const startedFiles = await collectWorkspaceSourceFiles(resolved, _rmCap, timeoutMs, startedAt);
  type RepoSymbol = { name: string; kind: string; line: number };
  type RepoEntry = { file: string; module?: string | null; language: string | null; symbols: RepoSymbol[]; depends_on: string[] };
  const entries: RepoEntry[] = [];
  const contents = new Map<string, string>();
  let isTimedOut = false;

  const concurrency = Math.min(16, Math.max(1, startedFiles.length));
  let fileIndex = 0;

  async function repoWorker(): Promise<void> {
    while (fileIndex < startedFiles.length) {
      if (Date.now() - startedAt > timeoutMs) {
        isTimedOut = true;
        break;
      }
      const currentIdx = fileIndex++;
      const full = startedFiles[currentIdx];
      if (!full) break;
      const relToCwd = relative(cwd, full).split(sep).join("/");

      let fileStat;
      try {
        fileStat = await stat(full);
      } catch {
        continue;
      }

      const cached = repoMapCache.get(full);
      if (
        cached &&
        cached.mtimeMs === fileStat.mtimeMs &&
        cached.size === fileStat.size
      ) {
        entries.push({
          file: relToCwd,
          module: cached.module,
          language: cached.language,
          symbols: cached.symbols.slice(0, maxSymbolsPerFile),
          depends_on: cached.depends_on
        });
        continue;
      }

      const { text: fileText, skipped } = await readSearchableText(full, maxBytes);
      if (skipped || fileText === undefined) continue;
      if (options.include_used_by === true) {
        contents.set(relToCwd, fileText);
      }

      let symbols: RepoSymbol[] = [];
      let language: string | null = null;
      try {
        const outline = await extractFileOutline(relToCwd, fileText, {});
        language = outline.language;
        for (const symbol of outline.symbols.slice(0, maxSymbolsPerFile)) {
          symbols.push({ name: symbol.name, kind: symbol.kind, line: symbol.startLine });
          for (const child of (symbol.children ?? []).slice(0, 10)) {
            symbols.push({ name: `${symbol.name}.${child.name}`, kind: child.kind, line: child.startLine });
          }
        }
      } catch {
        symbols = [];
      }

      const dependsOn = collectFileImports(relToCwd, fileText);
      const modBoundary = detectModuleBoundary(full, cwd);

      repoMapCache.set(full, {
        mtimeMs: fileStat.mtimeMs,
        size: fileStat.size,
        symbols,
        language,
        depends_on: dependsOn,
        module: modBoundary
      });

      entries.push({
        file: relToCwd,
        module: modBoundary,
        language,
        symbols: symbols.slice(0, maxSymbolsPerFile),
        depends_on: dependsOn
      });
    }
  }

  if (startedFiles.length > 0) {
    await Promise.all(Array.from({ length: concurrency }, () => repoWorker()));
  }

  let usedBy: Record<string, string[]> | undefined;
  if (options.include_used_by === true) {
    usedBy = {};
    const candidates = entries.flatMap((entry) => entry.symbols.map((symbol) => ({ ...symbol, file: entry.file }))).slice(0, 80);
    for (const candidate of candidates) {
      if (Date.now() - startedAt > timeoutMs) { isTimedOut = true; break; }
      if (!/^[A-Za-z_$][A-Za-z0-9_$.]*$/.test(candidate.name) || candidate.name.length < 3) continue;
      const shortName = candidate.name.split(".").pop() ?? candidate.name;
      if (shortName.length < 3) continue;
      let pattern: RegExp;
      try {
        pattern = new RegExp(`\\b${shortName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
      } catch {
        continue;
      }
      const users: string[] = [];
      for (const [file, text] of contents) {
        if (file === candidate.file) continue;
        if (users.length >= 10) break;
        try {
          if (pattern.test(text)) users.push(file);
        } catch {
          break;
        }
      }
      if (users.length > 0) usedBy[`${candidate.file}#${candidate.name}`] = users;
    }
  }
  entries.sort((a, b) => a.file.localeCompare(b.file));
  let rmEntries: typeof entries = entries;
  let rmPage: number | undefined;
  let rmPageSize: number | undefined;
  let rmTotalPages: number | undefined;
  let rmHasNext: boolean | undefined;
  let rmHasPrev: boolean | undefined;
  if (_rmPg.paginated) {
    const s = paginateItems(entries, _rmPg);
    rmEntries = s.paged;
    rmPage = _rmPg.page;
    rmPageSize = _rmPg.page_size;
    rmTotalPages = s.total_pages;
    rmHasNext = (entries.length >= _rmCap || isTimedOut) ? true : s.has_next;
    rmHasPrev = s.has_prev;
  }
  const totalSymbols = rmEntries.reduce((sum, entry) => sum + entry.symbols.length, 0);
  const payload: Record<string, unknown> = {
    action: "repo_map",
    dir,
    files: entries.length,
    symbols: entries.reduce((sum, entry) => sum + entry.symbols.length, 0),
    timed_out: isTimedOut,
    page: rmPage,
    page_size: rmPageSize,
    total: _rmPg.paginated ? entries.length : undefined,
    total_pages: rmTotalPages,
    has_next: rmHasNext,
    has_prev: rmHasPrev,
    returned: _rmPg.paginated ? rmEntries.length : undefined,
    entries: rmEntries
  };
  if (usedBy) payload.used_by = usedBy;
  let stdout = JSON.stringify(payload);
  let truncated = false;
  if (estimateTokenCount(stdout) > maxTokens && entries.length > 0) {
    delete payload.used_by;
    stdout = JSON.stringify(payload);
    while (estimateTokenCount(stdout) > maxTokens && (payload.entries as RepoEntry[]).length > 1) {
      (payload.entries as RepoEntry[]).pop();
      payload.files = (payload.entries as RepoEntry[]).length;
      payload.symbols = (payload.entries as RepoEntry[]).reduce((sum, entry) => sum + entry.symbols.length, 0);
      payload.truncated = true;
      stdout = JSON.stringify(payload);
      truncated = true;
    }
    if (estimateTokenCount(stdout) > maxTokens) {
      payload.entries = [];
      payload.files = 0;
      payload.symbols = 0;
      payload.truncated = true;
      stdout = JSON.stringify(payload);
      truncated = true;
    }
  }
  return {
    ok: true,
    kind: "success",
    exitCode: 0,
    stdout,
    stderr: truncated ? `[repo_map] output truncated to max_tokens=${maxTokens}; narrow dir/pattern or raise max_tokens.` : (isTimedOut ? `[repo_map] timeout after ${timeoutMs}ms; showing partial results.` : ""),
    saVmEvents: [
      {
        timestamp: Date.now(),
        type: "repo_map",
        dir,
        files: entries.length,
        symbols: totalSymbols
      }
    ],
    saVmViolation: null,
    durationMs: Date.now() - startedAt
  };
}

export async function nativeVerifyLoop(
  rawTarget: string,
  options: {
    files?: string[];
    pattern?: string;
    max_files?: number;
    max_errors?: number;
    max_tokens?: number;
    timeout_ms?: number;
    timeout?: number;
    page?: unknown; page_num?: unknown; pageNum?: unknown; p?: unknown;
    page_size?: unknown; pageSize?: unknown; per_page?: unknown; perPage?: unknown;
    offset?: unknown; count_cap?: unknown; countCap?: unknown; max_total?: unknown;
    exact_total?: unknown; exactTotal?: unknown;
  },
  policy: SaVmPolicyConfig | undefined,
  cwd: string,
  startedAt: number
): Promise<SaVmRunResult> {
  const normalized = normalizeSaVmPolicy(policy, cwd);
  if (normalized.tools?.getDiagnostics !== true) {
    return {
      ok: false,
      kind: "capability_denied",
      exitCode: 228,
      stdout: "",
      stderr: "action 'verify_loop' is disabled in current VM policy; enable getDiagnostics in VM settings to use verification",
      saVmEvents: [],
      saVmViolation: { reason: "getDiagnostics disabled" },
      durationMs: Date.now() - startedAt
    };
  }
  const timeoutMs = resolveTimeoutMs(options, 30_000);
  const maxFiles = clampInt(options.max_files, 50, 1, 200);
  const _vlPg = resolvePagination(options as Record<string, unknown>, { defaultSize: clampInt(options.max_errors, 20, 1, 100), maxSize: 200, legacyLimit: options.max_errors });
  const maxErrors = _vlPg.paginated ? _vlPg.countCap : clampInt(options.max_errors, 20, 1, 100);
  const maxTokens = typeof options.max_tokens === "number" && options.max_tokens > 0
    ? Math.min(Math.floor(options.max_tokens), 32000)
    : 4000;
  const explicitFiles = Array.isArray(options.files)
    ? options.files.filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim()))
    : [];
  let targetFiles: string[] = [];
  if (explicitFiles.length > 0) {
    for (const entry of explicitFiles.slice(0, maxFiles)) {
      const full = resolve(cwd, entry.trim());
      try {
        const info = await stat(full);
        if (info.isFile()) targetFiles.push(full);
      } catch {
        continue;
      }
    }
  } else {
    const dir = (rawTarget ?? ".").trim() || ".";
    const readCheck = checkSaVmPath(normalized, "read", dir, cwd);
    if (!readCheck.allowed) {
      return {
        ok: false,
        kind: "capability_denied",
        exitCode: 228,
        stdout: "",
        stderr: `Policy violation: ${readCheck.reason || "read not allowed"}`,
        saVmEvents: [],
        saVmViolation: { reason: readCheck.reason },
        durationMs: Date.now() - startedAt
      };
    }
    targetFiles = await collectWorkspaceSourceFiles(resolve(cwd, dir), maxFiles, timeoutMs, startedAt);
  }
  type VerifyError = { file: string; line: number; column: number; message: string; code?: string };
  const errors: VerifyError[] = [];
  let filesChecked = 0;
  let isTimedOut = false;
  for (const full of targetFiles) {
    if (Date.now() - startedAt > timeoutMs) { isTimedOut = true; break; }
    if (errors.length >= maxErrors) break;
    const relToCwd = relative(cwd, full).replace(/\\/g, "/");
    let content: string;
    try {
      content = await readFile(full, "utf8");
    } catch {
      continue;
    }
    filesChecked += 1;
    try {
      const diagnostics = await getSyntaxDiagnostics(relToCwd, content);
      for (const diagnostic of diagnostics.errors.slice(0, maxErrors - errors.length)) {
        errors.push({
          file: relToCwd,
          line: diagnostic.line,
          column: diagnostic.column,
          message: diagnostic.message,
          ...(diagnostic.code !== undefined && diagnostic.code !== null && String(diagnostic.code).trim()
            ? { code: String(diagnostic.code) }
            : {})
        });
      }
    } catch {
      continue;
    }
  }
  errors.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  let vlErrors: typeof errors = errors.slice(0, maxErrors);
  let vlPage: number | undefined;
  let vlPageSize: number | undefined;
  let vlTotalPages: number | undefined;
  let vlHasNext: boolean | undefined;
  let vlHasPrev: boolean | undefined;
  if (_vlPg.paginated) {
    const s = paginateItems(errors, _vlPg);
    vlErrors = s.paged;
    vlPage = _vlPg.page;
    vlPageSize = _vlPg.page_size;
    vlTotalPages = s.total_pages;
    vlHasNext = (errors.length >= _vlPg.countCap || isTimedOut) ? true : s.has_next;
    vlHasPrev = s.has_prev;
  }
  const payload = {
    action: "verify_loop",
    typecheck: errors.length === 0 ? "pass" : "fail",
    checks: ["syntax"],
    files_checked: filesChecked,
    error_count: errors.length,
    total: _vlPg.paginated ? errors.length : undefined,
    total_pages: vlTotalPages,
    page: vlPage,
    page_size: vlPageSize,
    has_next: vlHasNext,
    has_prev: vlHasPrev,
    errors: vlErrors,
    timed_out: isTimedOut
  };
  let stdout = JSON.stringify(payload);
  if (estimateTokenCount(stdout) > maxTokens) {
    payload.errors = payload.errors.slice(0, Math.max(0, Math.floor(maxErrors / 2)));
    stdout = JSON.stringify(payload);
  }
  return {
    ok: true,
    kind: "success",
    exitCode: 0,
    stdout,
    stderr: isTimedOut ? `[verify_loop] timeout after ${timeoutMs}ms; showing partial results.` : "",
    saVmEvents: [
      {
        timestamp: Date.now(),
        type: "verify_loop",
        files: filesChecked,
        errors: errors.length
      }
    ],
    saVmViolation: null,
    durationMs: Date.now() - startedAt
  };
}

export async function nativeReplayCase(
  rawInput: Record<string, unknown>,
  cwd: string,
  startedAt: number
): Promise<SaVmRunResult> {
  const component = typeof rawInput.component === "string" ? rawInput.component
    : typeof rawInput.target === "string" ? rawInput.target
    : typeof rawInput.file === "string" ? rawInput.file
    : undefined;
  const id = typeof rawInput.id === "string" ? rawInput.id
    : typeof rawInput.case_id === "string" ? rawInput.case_id
    : typeof rawInput.case === "string" ? rawInput.case
    : undefined;
  const tag = typeof rawInput.tag === "string" ? rawInput.tag
    : Array.isArray(rawInput.tags) ? rawInput.tags as string[]
    : undefined;

  const report = await runRegressionSuite({ component, id, tag }, cwd);
  const durationMs = Date.now() - startedAt;

  if (report.regressedCases > 0) {
    return {
      ok: false,
      kind: "sa_error",
      exitCode: 1,
      stdout: JSON.stringify(report, null, 2),
      stderr: `🚨 REGRESSION DETECTED: ${report.regressedCases} historical bug(s) have regressed!\n${report.summary}`,
      saVmEvents: [{ event: "violation", kind: "historical_regression", reason: report.summary }],
      saVmViolation: { reason: `Historical regression detected: ${report.regressedCases} case(s) failed` },
      durationMs,
    };
  }

  return {
    ok: report.ok,
    kind: report.ok ? "success" : "sa_error",
    exitCode: report.ok ? 0 : 1,
    stdout: JSON.stringify(report, null, 2),
    stderr: report.ok ? "" : report.summary,
    saVmEvents: [],
    saVmViolation: null,
    durationMs,
  };
}

export async function nativeRecordCase(
  rawInput: Record<string, unknown>,
  cwd: string,
  startedAt: number
): Promise<SaVmRunResult> {
  const caseDef: Partial<RegressionCase> = {
    id: typeof rawInput.id === "string" ? rawInput.id
      : typeof rawInput.case_id === "string" ? rawInput.case_id : undefined,
    title: typeof rawInput.title === "string" ? rawInput.title : undefined,
    component: typeof rawInput.component === "string" ? rawInput.component
      : typeof rawInput.target === "string" ? rawInput.target : undefined,
    tags: Array.isArray(rawInput.tags) ? rawInput.tags as string[] : undefined,
    category: typeof rawInput.category === "string" ? rawInput.category as any : undefined,
    description: typeof rawInput.description === "string" ? rawInput.description : undefined,
    input: typeof rawInput.input === "object" && rawInput.input ? rawInput.input as Record<string, unknown> : undefined,
    simulation: typeof rawInput.simulation === "object" && rawInput.simulation ? rawInput.simulation as any : undefined,
    negativeMatcher: (typeof rawInput.negativeMatcher === "object" && rawInput.negativeMatcher ? rawInput.negativeMatcher
      : typeof rawInput.negative_matcher === "object" && rawInput.negative_matcher ? rawInput.negative_matcher : undefined) as any,
    positiveInvariants: (typeof rawInput.positiveInvariants === "object" && rawInput.positiveInvariants ? rawInput.positiveInvariants
      : typeof rawInput.positive_invariants === "object" && rawInput.positive_invariants ? rawInput.positive_invariants : undefined) as any,
    runner: typeof rawInput.runner === "string" ? rawInput.runner : undefined,
  };

  const recorded = recordRegressionCase(caseDef, cwd);
  const durationMs = Date.now() - startedAt;

  if (!recorded.ok) {
    return {
      ok: false,
      kind: "sa_error",
      exitCode: 1,
      stdout: "",
      stderr: `Failed to record regression case: ${recorded.error}`,
      saVmEvents: [],
      saVmViolation: null,
      durationMs,
    };
  }

  return {
    ok: true,
    kind: "success",
    exitCode: 0,
    stdout: JSON.stringify({
      action: "record_case",
      path: recorded.path,
      case: recorded.case,
      message: `Regression case recorded successfully: ${recorded.case.id}`
    }, null, 2),
    stderr: "",
    saVmEvents: [],
    saVmViolation: null,
    durationMs,
  };
}


const NOTE_LEVEL_WEIGHT: Record<NotePriorityLevel, number> = {
  low: 1,
  normal: 2,
  important: 3,
  critical: 4
};

function normalizeNoteLevel(raw: unknown): NotePriorityLevel {
  if (typeof raw !== "string") return "normal";
  const trimmed = raw.trim().toLowerCase();
  if (trimmed === "critical" || trimmed === "非常重要" || trimmed === "urgent" || trimmed === "highest") return "critical";
  if (trimmed === "important" || trimmed === "重要" || trimmed === "high") return "important";
  if (trimmed === "low" || trimmed === "低级" || trimmed === "minor") return "low";
  return "normal";
}

export type WorkspaceNoteItem = {
  key: string;
  content: string;
  level: NotePriorityLevel;
  updated_at: number;
};

export type WorkspaceNotesDocument = {
  workspace: string;
  updated_at: number;
  notes: WorkspaceNoteItem[];
};


function resolveMemoryFile(cwd: string, scope: MemoryScope): { file: string; workspaceLabel: string } {
  if (scope === "global") {
    return { file: resolveGlobalMemoryFilePath(), workspaceLabel: "global" };
  }
  return { file: resolveWorkspaceMemoryFilePath(cwd), workspaceLabel: resolve(cwd).split(sep).join("/") };
}

async function loadWorkspaceNotes(filePath: string, workspaceDir: string): Promise<WorkspaceNotesDocument> {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.notes)) {
      parsed.notes = parsed.notes.map((n: any) => ({
        key: String(n.key ?? ""),
        content: String(n.content ?? ""),
        level: normalizeNoteLevel(n.level),
        updated_at: typeof n.updated_at === "number" ? n.updated_at : Date.now()
      }));
      return parsed;
    }
  } catch {
    // missing or corrupted
  }
  return {
    workspace: resolve(workspaceDir).split(sep).join("/"),
    updated_at: Date.now(),
    notes: []
  };
}

async function atomicSaveWorkspaceNotes(filePath: string, doc: WorkspaceNotesDocument): Promise<void> {
  const dir = dirname(filePath);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const tmpFile = join(dir, `${basename(filePath)}.${randomUUID()}.tmp`);
  await writeFile(tmpFile, JSON.stringify(doc, null, 2), "utf8");
  await rename(tmpFile, filePath);
}

export async function nativeSaveNote(
  keyInput: string | undefined,
  contentInput: string | undefined,
  levelInput: string | undefined,
  policy: SaVmPolicyConfig | undefined,
  cwd: string,
  startedAt: number,
  scopeInput?: unknown,
  effectiveAction: string = "save_note"
): Promise<SaVmRunResult> {
  // VM sandbox off (policy === undefined) = fully open: memory notes are
  // workspace-local JSON, low-risk, and explicitly requested to stay usable
  // without enhancement toggles. Only a mounted policy may gate them.
  const isMemory = effectiveAction.includes("memory");
  const returnAction = effectiveAction === "save_note" || effectiveAction === "add_note"
    ? effectiveAction
    : (effectiveAction || "add_memory");
  const itemNoun = isMemory ? "memory" : "note";

  const normalized = normalizeSaVmPolicy(policy, cwd);
  const vmSandboxOff = policy === undefined;
  const allowWrite = vmSandboxOff || normalized.tools?.editFiles === true || normalized.tools?.replaceWrite === true;
  if (!allowWrite) {
    return {
      ok: false,
      kind: "capability_denied",
      exitCode: 228,
      stdout: "",
      stderr: `action '${returnAction}' is disabled in current VM policy; enable editFiles or replaceWrite in VM settings to save ${itemNoun}s`,
      saVmEvents: [],
      saVmViolation: { reason: "editFiles disabled" },
      durationMs: Date.now() - startedAt
    };
  }

  const key = (keyInput ?? "").trim();
  const rawContent = (contentInput ?? "").trim();
  if (!key) {
    return {
      ok: false,
      kind: "sa_error",
      exitCode: 1,
      stdout: "",
      stderr: `parameter 'key' is required for action '${returnAction}'`,
      saVmEvents: [],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  }
  if (!rawContent) {
    return {
      ok: false,
      kind: "sa_error",
      exitCode: 1,
      stdout: "",
      stderr: `parameter 'content' (or 'memory') is required for action '${returnAction}'`,
      saVmEvents: [],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  }

  const MAX_NOTE_CHARS = 1000;
  const MAX_NOTES_PER_PROJECT = 100;
  const content = rawContent.length > MAX_NOTE_CHARS ? rawContent.slice(0, MAX_NOTE_CHARS) : rawContent;
  const wasTruncated = rawContent.length > MAX_NOTE_CHARS;

  const scope = normalizeMemoryScope(scopeInput);
  const { file: memoryFile, workspaceLabel } = resolveMemoryFile(cwd, scope);
  const doc = await loadWorkspaceNotes(memoryFile, workspaceLabel);

  const level = normalizeNoteLevel(levelInput);
  const now = Date.now();
  const existingIdx = doc.notes.findIndex((n) => n.key === key);
  if (existingIdx >= 0) {
    doc.notes[existingIdx] = { key, content, level, updated_at: now };
  } else {
    if (doc.notes.length >= MAX_NOTES_PER_PROJECT) {
      // Evict lowest priority first, then oldest
      doc.notes.sort((a, b) => {
        const weightA = NOTE_LEVEL_WEIGHT[a.level] ?? 2;
        const weightB = NOTE_LEVEL_WEIGHT[b.level] ?? 2;
        if (weightA !== weightB) return weightA - weightB;
        return a.updated_at - b.updated_at;
      });
      doc.notes.shift();
    }
    doc.notes.push({ key, content, level, updated_at: now });
  }
  doc.updated_at = now;

  await atomicSaveWorkspaceNotes(memoryFile, doc);

  const payload = {
    action: returnAction,
    key,
    level,
    truncated: wasTruncated,
    total_notes: doc.notes.length,
    total_memories: doc.notes.length,
    message: `Saved ${itemNoun} for key '${key}' [${level}] in workspace memory.`
  };

  return {
    ok: true,
    kind: "success",
    exitCode: 0,
    stdout: JSON.stringify(payload, null, 2),
    stderr: wasTruncated ? `[${returnAction}] content truncated to ${MAX_NOTE_CHARS} characters.` : "",
    saVmEvents: [
      {
        timestamp: now,
        type: isMemory ? "memory_saved" : "note_saved",
        key,
        total_notes: doc.notes.length,
        total_memories: doc.notes.length
      }
    ],
    saVmViolation: null,
    durationMs: Date.now() - startedAt
  };
}

export async function nativeReadNotes(
  keyInput: string | undefined,
  maxTokensInput: number | undefined,
  remainingTokensInput: number | undefined,
  policy: SaVmPolicyConfig | undefined,
  cwd: string,
  startedAt: number,
  pgInput?: { page?: unknown; page_num?: unknown; pageNum?: unknown; p?: unknown; page_size?: unknown; pageSize?: unknown; per_page?: unknown; perPage?: unknown; offset?: unknown },
  scopeInput?: unknown,
  effectiveAction: string = "read_notes"
): Promise<SaVmRunResult> {
  const isMemory = effectiveAction.includes("memory");
  const returnAction = effectiveAction === "read_notes" || effectiveAction === "read_note" || effectiveAction === "list_notes" || effectiveAction === "search_notes" || effectiveAction === "search_note"
    ? effectiveAction
    : (effectiveAction || "read_memory");
  const itemNoun = isMemory ? "memory" : "note";

  // VM sandbox off (policy === undefined) = fully open for memory reads.
  const normalized = normalizeSaVmPolicy(policy, cwd);
  const vmSandboxOff = policy === undefined;
  const allowRead = vmSandboxOff || normalized.tools?.readFiles === true || normalized.tools?.replaceRead === true;
  if (!allowRead) {
    return {
      ok: false,
      kind: "capability_denied",
      exitCode: 228,
      stdout: "",
      stderr: `action '${returnAction}' is disabled in current VM policy; enable readFiles or replaceRead in VM settings to read ${itemNoun}s`,
      saVmEvents: [],
      saVmViolation: { reason: "readFiles disabled" },
      durationMs: Date.now() - startedAt
    };
  }

  const scope = normalizeMemoryScope(scopeInput);
  const { file: memoryFile, workspaceLabel } = resolveMemoryFile(cwd, scope);
  const doc = await loadWorkspaceNotes(memoryFile, workspaceLabel);

  const queryKey = (keyInput ?? "").trim();
  if (queryKey) {
    const found = doc.notes.find((n) => n.key === queryKey);
    if (found) {
      return {
        ok: true,
        kind: "success",
        exitCode: 0,
        stdout: JSON.stringify({
          action: returnAction,
          key: queryKey,
          found: true,
          note: found,
          memory: found
        }, null, 2),
        stderr: "",
        saVmEvents: [],
        saVmViolation: null,
        durationMs: Date.now() - startedAt
      };
    }
    // Exact miss → fuzzy substring fallback (key/content contains, case-insensitive).
    // This gives `search_note`-style behavior without a new tool: partial key recall still hits.
    const needle = queryKey.toLowerCase();
    const matches = doc.notes.filter((n) =>
      n.key.toLowerCase().includes(needle) || n.content.toLowerCase().includes(needle));
    return {
      ok: true,
      kind: "success",
      exitCode: 0,
      stdout: JSON.stringify({
        action: returnAction,
        key: queryKey,
        found: matches.length > 0,
        note: null,
        memory: null,
        matches,
        match_count: matches.length,
        hint: matches.length === 0 ? `No ${itemNoun} matches; try ${returnAction} without key to list all.` : undefined
      }, null, 2),
      stderr: "",
      saVmEvents: [],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  }

  let budget = typeof maxTokensInput === "number" && maxTokensInput > 0
    ? Math.min(Math.floor(maxTokensInput), 8000)
    : 2000;
  if (typeof remainingTokensInput === "number" && remainingTokensInput > 0) {
    const safeLimit = Math.max(200, Math.floor(remainingTokensInput - 1000));
    budget = Math.min(budget, safeLimit);
  }
  const maxTokens = budget;

  // Sort notes: highest priority first ("非常重要" -> "重要" -> "普通" -> "低级"), then newest first
  const sortedNotes = [...doc.notes].sort((a, b) => {
    const weightA = NOTE_LEVEL_WEIGHT[a.level] ?? 2;
    const weightB = NOTE_LEVEL_WEIGHT[b.level] ?? 2;
    if (weightA !== weightB) return weightB - weightA;
    return b.updated_at - a.updated_at;
  });
  const _ntPg = resolvePagination((pgInput ?? {}) as Record<string, unknown>, { defaultSize: sortedNotes.length, maxSize: 30, legacyLimit: sortedNotes.length });
  let notes = [...sortedNotes];
  let ntPage: number | undefined;
  let ntPageSize: number | undefined;
  let ntTotalPages: number | undefined;
  let ntHasNext: boolean | undefined;
  let ntHasPrev: boolean | undefined;
  if (_ntPg.paginated) {
    const s = paginateItems(sortedNotes, _ntPg);
    notes = [...s.paged];
    ntPage = _ntPg.page;
    ntPageSize = _ntPg.page_size;
    ntTotalPages = s.total_pages;
    ntHasNext = s.has_next;
    ntHasPrev = s.has_prev;
  }
  let payload: Record<string, unknown> = {
    action: returnAction,
    workspace: doc.workspace,
    total_notes: sortedNotes.length,
    total_memories: sortedNotes.length,
    total: sortedNotes.length,
    page: ntPage,
    page_size: ntPageSize,
    total_pages: ntTotalPages,
    has_next: ntHasNext,
    has_prev: ntHasPrev,
    returned: _ntPg.paginated ? notes.length : undefined,
    notes,
    memories: notes
  };

  let stdout = JSON.stringify(payload, null, 2);
  let truncated = false;
  if (estimateTokenCount(stdout) > maxTokens && notes.length > 0) {
    while (estimateTokenCount(stdout) > maxTokens && notes.length > 1) {
      notes.pop();
      payload.notes = notes;
      payload.memories = notes;
      payload.returned = notes.length;
      payload.truncated = true;
      stdout = JSON.stringify(payload, null, 2);
      truncated = true;
    }
  }

  return {
    ok: true,
    kind: "success",
    exitCode: 0,
    stdout,
    stderr: truncated ? `[${returnAction}] output truncated to max_tokens=${maxTokens}.` : "",
    saVmEvents: [],
    saVmViolation: null,
    durationMs: Date.now() - startedAt
  };
}

export async function nativeDeleteNote(
  keyInput: string | undefined,
  all: boolean | undefined,
  policy: SaVmPolicyConfig | undefined,
  cwd: string,
  startedAt: number,
  scopeInput?: unknown,
  effectiveAction: string = "delete_note"
): Promise<SaVmRunResult> {
  const isMemory = effectiveAction.includes("memory");
  const returnAction = effectiveAction === "delete_note" || effectiveAction === "remove_note" || effectiveAction === "clear_notes"
    ? effectiveAction
    : (effectiveAction || "delete_memory");
  const itemNoun = isMemory ? "memories" : "notes";
  const singleNoun = isMemory ? "Memory" : "Note";

  // VM sandbox off (policy === undefined) = fully open for memory deletes.
  const normalized = normalizeSaVmPolicy(policy, cwd);
  const vmSandboxOff = policy === undefined;
  const allowWrite = vmSandboxOff || normalized.tools?.editFiles === true || normalized.tools?.replaceWrite === true;
  if (!allowWrite) {
    return {
      ok: false,
      kind: "capability_denied",
      exitCode: 228,
      stdout: "",
      stderr: `action '${returnAction}' is disabled in current VM policy; enable editFiles or replaceWrite in VM settings to delete ${itemNoun}`,
      saVmEvents: [],
      saVmViolation: { reason: "editFiles disabled" },
      durationMs: Date.now() - startedAt
    };
  }

  const scope = normalizeMemoryScope(scopeInput);
  const { file: memoryFile, workspaceLabel } = resolveMemoryFile(cwd, scope);
  const doc = await loadWorkspaceNotes(memoryFile, workspaceLabel);

  if (all === true) {
    doc.notes = [];
    doc.updated_at = Date.now();
    await atomicSaveWorkspaceNotes(memoryFile, doc);
    return {
      ok: true,
      kind: "success",
      exitCode: 0,
      stdout: JSON.stringify({
        action: returnAction,
        cleared_all: true,
        remaining_notes: 0,
        remaining_memories: 0,
        message: `Cleared all ${itemNoun} for current workspace.`
      }, null, 2),
      stderr: "",
      saVmEvents: [{ timestamp: Date.now(), type: isMemory ? "memories_cleared" : "notes_cleared" }],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  }

  const key = (keyInput ?? "").trim();
  if (!key) {
    return {
      ok: false,
      kind: "sa_error",
      exitCode: 1,
      stdout: "",
      stderr: `parameter 'key' or 'all: true' is required for action '${returnAction}'`,
      saVmEvents: [],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  }

  const initialCount = doc.notes.length;
  doc.notes = doc.notes.filter((n) => n.key !== key);
  const deleted = doc.notes.length < initialCount;
  if (deleted) {
    doc.updated_at = Date.now();
    await atomicSaveWorkspaceNotes(memoryFile, doc);
  }

  return {
    ok: true,
    kind: "success",
    exitCode: 0,
    stdout: JSON.stringify({
      action: returnAction,
      key,
      deleted,
      remaining_notes: doc.notes.length,
      remaining_memories: doc.notes.length,
      message: deleted ? `${singleNoun} '${key}' deleted.` : `${singleNoun} '${key}' not found.`
    }, null, 2),
    stderr: "",
    saVmEvents: deleted ? [{ timestamp: Date.now(), type: isMemory ? "memory_deleted" : "note_deleted", key }] : [],
    saVmViolation: null,
    durationMs: Date.now() - startedAt
  };
}

export const nativeAddMemory = nativeSaveNote;
export const nativeSaveMemory = nativeSaveNote;
export const nativeEditMemory = nativeSaveNote;
export const nativeReadMemory = nativeReadNotes;
export const nativeDeleteMemory = nativeDeleteNote;

export async function nativeReadMany(
  files: string[],
  options: {
    start_line?: number;
    end_line?: number;
    max_tokens_per_file?: number;
    max_tokens?: number;
  },
  policy: SaVmPolicyConfig | undefined,
  cwd: string,
  startedAt: number
): Promise<SaVmRunResult> {
  const list = files.map((file) => String(file).trim()).filter(Boolean).slice(0, 10);
  if (list.length === 0) {
    return {
      ok: false,
      kind: "sa_error",
      exitCode: 1,
      stdout: "",
      stderr: "files parameter is required for read_many (array of file paths, max 10). Use {\"action\":\"read_many\",\"files\":[\"src/a.ts\",\"src/b.ts\"]} with one shared start_line/end_line; for different slices use {\"action\":\"parallel\",\"parallel\":[...]}.",
      saVmEvents: [],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  }
  const perFile = clampInt(options.max_tokens_per_file, 2000, 200, 8000);
  const totalBudget = typeof options.max_tokens === "number" && options.max_tokens > 0
    ? Math.min(options.max_tokens, 32000)
    : 8000;
  const results: Array<{ path: string; ok: boolean; text?: string; error?: string }> = [];
  let usedTokens = 0;
  for (const file of list) {
    const remaining = totalBudget - usedTokens;
    if (remaining < 200) {
      results.push({ path: file, ok: false, error: "total max_tokens budget exhausted" });
      continue;
    }
    const res = await nativeReadFile(file, {
      startLine: options.start_line,
      endLine: options.end_line,
      maxTokens: Math.min(perFile, remaining),
      numbered: true
    }, policy, cwd, startedAt);
    if (res.ok) {
      results.push({ path: file, ok: true, text: res.stdout });
      usedTokens += estimateTokenCount(res.stdout);
    } else {
      results.push({ path: file, ok: false, error: res.stderr || "read failed" });
    }
  }
  return {
    ok: true,
    kind: "success",
    exitCode: 0,
    stdout: JSON.stringify(results, null, 2),
    stderr: "",
    saVmEvents: [],
    saVmViolation: null,
    durationMs: Date.now() - startedAt
  };
}

export async function nativeRenameSymbol(
  rawSymbol: string,
  rawNewName: string,
  options: {
    path?: string;
    dir?: string;
    candidate_files?: string[];
    files?: string[];
    dry_run?: boolean;
    detail?: boolean;
    timeout_ms?: number;
    timeout?: number;
  },
  policy: SaVmPolicyConfig | undefined,
  cwd: string,
  startedAt: number
): Promise<SaVmRunResult> {
  const symbol = (rawSymbol ?? "").trim();
  const newName = (rawNewName ?? "").trim();

  if (!symbol) {
    return {
      ok: false,
      kind: "sa_error",
      exitCode: 1,
      stdout: "",
      stderr: "symbol (or old_name) parameter is required for rename_symbol",
      saVmEvents: [],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  }

  if (!newName) {
    return {
      ok: false,
      kind: "sa_error",
      exitCode: 1,
      stdout: "",
      stderr: "new_name parameter is required for rename_symbol",
      saVmEvents: [],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  }

  if (symbol === newName) {
    return {
      ok: true,
      kind: "success",
      exitCode: 0,
      stdout: `[rename_symbol] old name '${symbol}' and new name '${newName}' are identical; no changes applied.`,
      stderr: "",
      saVmEvents: [],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  }

  const normalized = normalizeSaVmPolicy(policy, cwd);
  if (normalized.tools?.renameSymbol !== true) {
    return {
      ok: false,
      kind: "capability_denied",
      exitCode: 228,
      stdout: "",
      stderr: "action 'rename_symbol' is disabled in current VM policy; enable renameSymbol in VM settings to use safe symbol renaming",
      saVmEvents: [],
      saVmViolation: { reason: "renameSymbol disabled" },
      durationMs: Date.now() - startedAt
    };
  }

  const isDryRun = options.dry_run === true;
  const timeoutMs = typeof options.timeout_ms === "number" && options.timeout_ms > 0
    ? options.timeout_ms
    : typeof options.timeout === "number" && options.timeout > 0
      ? options.timeout
      : 15000;

  // Collect target files
  const candidateList = options.candidate_files ?? options.files;
  const targetFiles: string[] = [];

  if (Array.isArray(candidateList) && candidateList.length > 0) {
    for (const pat of candidateList) {
      if (typeof pat !== "string" || !pat.trim()) continue;
      const full = resolve(cwd, pat.trim());
      if (existsSync(full)) {
        targetFiles.push(full);
      }
    }
  } else if (typeof options.path === "string" && options.path.trim()) {
    const full = resolve(cwd, options.path.trim());
    if (existsSync(full)) {
      try {
        const s = await stat(full);
        if (s.isFile()) {
          targetFiles.push(full);
        } else if (s.isDirectory()) {
          const collected = await collectWorkspaceSourceFiles(full, 2000, timeoutMs, startedAt);
          targetFiles.push(...collected);
        }
      } catch {
        // ignore unreadable
      }
    }
  } else {
    const searchRoot = resolve(cwd, options.dir && options.dir.trim() ? options.dir.trim() : ".");
    const collected = await collectWorkspaceSourceFiles(searchRoot, 2000, timeoutMs, startedAt);
    targetFiles.push(...collected);
  }

  // Scan and rename in each file
  let totalEdits = 0;
  const changedFiles: Array<{ path: string; edits: number; previewLines: string[] }> = [];

  for (const filePath of targetFiles) {
    if (Date.now() - startedAt > timeoutMs) break;

    const writeCheck = checkSaVmPath(normalized, "write", filePath, cwd);
    if (!writeCheck.allowed) continue;

    try {
      const content = await readFile(filePath, "utf8");
      if (!content.includes(symbol)) continue;

      const relPath = relative(cwd, filePath).replace(/\\/g, "/");
      const { newContent, edits } = await renameSymbolInContent(relPath, content, symbol, newName);

      if (edits.length > 0) {
        totalEdits += edits.length;
        if (!isDryRun) {
          await writeFile(filePath, newContent, "utf8");
        }
        changedFiles.push({
          path: relPath,
          edits: edits.length,
          previewLines: edits.slice(0, 5).map(e => `L${e.line}: ${e.preview}`)
        });
      }
    } catch {
      // skip unreadable/binary
    }
  }

  const mode = isDryRun ? "DRY-RUN (preview only, no files modified)" : "APPLIED";
  const outputLines: string[] = [
    `[rename_symbol] ${mode}: Renamed '${symbol}' -> '${newName}' across ${changedFiles.length} file(s) with ${totalEdits} edit(s) total.`
  ];

  for (const f of changedFiles) {
    outputLines.push(`- ${f.path}: ${f.edits} edit(s)`);
    if (options.detail !== false) {
      for (const pl of f.previewLines) {
        outputLines.push(`    ${pl}`);
      }
      if (f.edits > 5) {
        outputLines.push(`    ... (${f.edits - 5} more edit(s))`);
      }
    }
  }

  return {
    ok: true,
    kind: "success",
    exitCode: 0,
    stdout: outputLines.join("\n"),
    stderr: "",
    saVmEvents: [
      {
        timestamp: Date.now(),
        type: "symbol_renamed",
        symbol,
        newName,
        files: changedFiles.length,
        edits: totalEdits,
        dryRun: isDryRun
      }
    ],
    saVmViolation: null,
    durationMs: Date.now() - startedAt
  };
}

export async function nativeMoveFileWithImports(
  rawFrom: string,
  rawTo: string,
  options: {
    dry_run?: boolean;
  },
  policy: SaVmPolicyConfig | undefined,
  cwd: string,
  startedAt: number
): Promise<SaVmRunResult> {
  const from = (rawFrom ?? "").trim().replace(/\\/g, "/");
  const to = (rawTo ?? "").trim().replace(/\\/g, "/");

  if (!from || !to) {
    return {
      ok: false,
      kind: "sa_error",
      exitCode: 1,
      stdout: "",
      stderr: "from and to parameters are required for move_file_with_imports",
      saVmEvents: [],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  }

  const normalized = normalizeSaVmPolicy(policy, cwd);
  if (normalized.tools?.moveWithImports !== true) {
    return {
      ok: false,
      kind: "capability_denied",
      exitCode: 228,
      stdout: "",
      stderr: "action 'move_file_with_imports' is disabled in current VM policy; enable moveWithImports in VM settings",
      saVmEvents: [],
      saVmViolation: { reason: "moveWithImports disabled" },
      durationMs: Date.now() - startedAt
    };
  }

  const checkFrom = checkSaVmPath(normalized, "write", from, cwd);
  if (!checkFrom.allowed) {
    return {
      ok: false,
      kind: "capability_denied",
      exitCode: 228,
      stdout: "",
      stderr: `Policy violation on source: ${checkFrom.reason || "write not allowed"}`,
      saVmEvents: [],
      saVmViolation: { reason: checkFrom.reason },
      durationMs: Date.now() - startedAt
    };
  }

  const checkTo = checkSaVmPath(normalized, "write", to, cwd);
  if (!checkTo.allowed) {
    return {
      ok: false,
      kind: "capability_denied",
      exitCode: 228,
      stdout: "",
      stderr: `Policy violation on destination: ${checkTo.reason || "write not allowed"}`,
      saVmEvents: [],
      saVmViolation: { reason: checkTo.reason },
      durationMs: Date.now() - startedAt
    };
  }

  const fullFrom = resolve(cwd, from);
  const fullTo = resolve(cwd, to);

  if (!existsSync(fullFrom)) {
    return {
      ok: false,
      kind: "sa_error",
      exitCode: 1,
      stdout: "",
      stderr: `Source file does not exist: ${from}`,
      saVmEvents: [],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  }

  const isDryRun = options.dry_run === true;
  const relFrom = relative(cwd, fullFrom).replace(/\\/g, "/");
  const relTo = relative(cwd, fullTo).replace(/\\/g, "/");

  const targetFiles = await collectWorkspaceSourceFiles(cwd, 2000, 15000, startedAt);
  const updatedFiles: Array<{ path: string; oldImport: string; newImport: string }> = [];

  const stripExt = (p: string) => p.replace(/\.(?:[cm]?[jt]sx?)$/, "");

  for (const f of targetFiles) {
    if (resolve(f) === resolve(fullFrom)) continue;
    try {
      const content = await readFile(f, "utf8");
      const fDir = dirname(f);
      const oldRelImport = relative(fDir, fullFrom).replace(/\\/g, "/");
      const normalizedOld = stripExt(oldRelImport.startsWith(".") ? oldRelImport : `./${oldRelImport}`);

      const newRelImport = relative(fDir, fullTo).replace(/\\/g, "/");
      const normalizedNew = stripExt(newRelImport.startsWith(".") ? newRelImport : `./${newRelImport}`);

      if (content.includes(normalizedOld)) {
        const importRegex = new RegExp(`(['"])${normalizedOld.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\1`, "g");
        if (importRegex.test(content)) {
          const newContent = content.replace(importRegex, `$1${normalizedNew}$1`);
          if (!isDryRun) {
            await writeFile(f, newContent, "utf8");
          }
          updatedFiles.push({
            path: relative(cwd, f).replace(/\\/g, "/"),
            oldImport: normalizedOld,
            newImport: normalizedNew
          });
        }
      }
    } catch {
      // skip
    }
  }

  const oldDir = dirname(fullFrom);
  const newDir = dirname(fullTo);
  let selfAdjusted = false;

  if (oldDir !== newDir) {
    try {
      const content = await readFile(fullFrom, "utf8");
      const relImportRegex = /(from\s+['"]|import\s*\(['"])(\.[^'"]+)(['"])/g;
      const newSelfContent = content.replace(relImportRegex, (_match, p1, p2, p3) => {
        const resolvedTarget = resolve(oldDir, p2);
        const adjustedRel = relative(newDir, resolvedTarget).replace(/\\/g, "/");
        const normalizedAdjusted = adjustedRel.startsWith(".") ? adjustedRel : `./${adjustedRel}`;
        selfAdjusted = true;
        return `${p1}${normalizedAdjusted}${p3}`;
      });

      if (!isDryRun) {
        await writeFile(fullFrom, newSelfContent, "utf8");
      }
    } catch {
      // skip
    }
  }

  if (!isDryRun) {
    await mkdir(dirname(fullTo), { recursive: true });
    await rename(fullFrom, fullTo);
  }

  const mode = isDryRun ? "DRY-RUN (preview only)" : "APPLIED";
  const outputLines = [
    `[move_file_with_imports] ${mode}: Moved '${relFrom}' -> '${relTo}'.`,
    `Updated imports in ${updatedFiles.length} dependent file(s):`
  ];
  for (const u of updatedFiles) {
    outputLines.push(`- ${u.path}: '${u.oldImport}' -> '${u.newImport}'`);
  }
  if (selfAdjusted) {
    outputLines.push(`- Adjusted internal relative imports within '${relTo}' for new location.`);
  }

  return {
    ok: true,
    kind: "success",
    exitCode: 0,
    stdout: outputLines.join("\n"),
    stderr: "",
    saVmEvents: [
      {
        timestamp: Date.now(),
        type: "file_moved_with_imports",
        from: relFrom,
        to: relTo,
        updatedDependents: updatedFiles.length,
        dryRun: isDryRun
      }
    ],
    saVmViolation: null,
    durationMs: Date.now() - startedAt
  };
}

export async function nativeFindDefinition(
  rawSymbol: string,
  rawPath: string | undefined,
  options: {
    include_body?: boolean;
    max_lines?: number;
  },
  policy: SaVmPolicyConfig | undefined,
  cwd: string,
  startedAt: number
): Promise<SaVmRunResult> {
  const symbol = (rawSymbol ?? "").trim();
  if (!symbol) {
    return {
      ok: false,
      kind: "sa_error",
      exitCode: 1,
      stdout: "",
      stderr: "symbol parameter is required for find_definition",
      saVmEvents: [],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  }

  const normalized = normalizeSaVmPolicy(policy, cwd);
  if (normalized.tools?.findDefinition !== true) {
    return {
      ok: false,
      kind: "capability_denied",
      exitCode: 228,
      stdout: "",
      stderr: "action 'find_definition' is disabled in current VM policy; enable findDefinition in VM settings",
      saVmEvents: [],
      saVmViolation: { reason: "findDefinition disabled" },
      durationMs: Date.now() - startedAt
    };
  }

  const includeBody = options.include_body !== false;
  const maxBodyLines = typeof options.max_lines === "number" && options.max_lines > 0 ? options.max_lines : 40;
  const targetPath = typeof rawPath === "string" && rawPath.trim() ? rawPath.trim().replace(/\\/g, "/") : undefined;

  // 1. If path is provided, try in that file first
  if (targetPath) {
    const checkTarget = checkSaVmPath(normalized, "read", targetPath, cwd);
    if (!checkTarget.allowed) {
      return {
        ok: false,
        kind: "capability_denied",
        exitCode: 228,
        stdout: "",
        stderr: `Policy violation on path: ${checkTarget.reason || "read not allowed"}`,
        saVmEvents: [],
        saVmViolation: { reason: checkTarget.reason },
        durationMs: Date.now() - startedAt
      };
    }

    const fullPath = resolve(cwd, targetPath);
    if (existsSync(fullPath)) {
      try {
        const content = await readFile(fullPath, "utf8");
        const match = await findDefinitionInContent(targetPath, content, symbol, { includeBody, maxBodyLines });
        if (match) {
          const out = [
            `[find_definition] Found definition for '${symbol}':`,
            `- File: ${match.filePath}`,
            `- Range: [L${match.startLine}-L${match.endLine}] (${match.endLine - match.startLine + 1} lines)`,
            `- Kind: ${match.kind}`,
            `- Signature: ${match.signature}`
          ];
          if (match.bodySnippet) {
            out.push(`- Implementation:`, match.bodySnippet);
          }
          return {
            ok: true,
            kind: "success",
            exitCode: 0,
            stdout: out.join("\n"),
            stderr: "",
            saVmEvents: [{ timestamp: Date.now(), type: "definition_found", symbol, filePath: match.filePath }],
            saVmViolation: null,
            durationMs: Date.now() - startedAt
          };
        }

        // If not declared here, check if symbol is imported from another module in this file
        const importRegex = /(?:import\s+(?:type\s+)?(?:\{[^}]*?\b(\w+)\b[^}]*?\}|(\w+))\s+from\s+['"]([^'"]+)['"])/g;
        let impMatch: RegExpExecArray | null = null;
        while ((impMatch = importRegex.exec(content)) !== null) {
          const importedSym = impMatch[1] || impMatch[2];
          const modPath = impMatch[3];
          if (importedSym === symbol && modPath) {
            const targetDir = dirname(fullPath);
            const candidates = [
              resolve(targetDir, modPath),
              resolve(targetDir, `${modPath}.ts`),
              resolve(targetDir, `${modPath}.tsx`),
              resolve(targetDir, `${modPath}.js`),
              resolve(targetDir, `${modPath}.jsx`),
              resolve(targetDir, `${modPath}/index.ts`),
              resolve(targetDir, `${modPath}/index.tsx`),
              resolve(targetDir, `${modPath}/index.js`)
            ];
            for (const cand of candidates) {
              if (existsSync(cand)) {
                const relCand = relative(cwd, cand).replace(/\\/g, "/");
                const checkCand = checkSaVmPath(normalized, "read", relCand, cwd);
                if (checkCand.allowed) {
                  const candContent = await readFile(cand, "utf8");
                  const candMatch = await findDefinitionInContent(relCand, candContent, symbol, { includeBody, maxBodyLines });
                  if (candMatch) {
                    const out = [
                      `[find_definition] Found definition for '${symbol}' (imported from '${modPath}'):`,
                      `- File: ${candMatch.filePath}`,
                      `- Range: [L${candMatch.startLine}-L${candMatch.endLine}] (${candMatch.endLine - candMatch.startLine + 1} lines)`,
                      `- Kind: ${candMatch.kind}`,
                      `- Signature: ${candMatch.signature}`
                    ];
                    if (candMatch.bodySnippet) {
                      out.push(`- Implementation:`, candMatch.bodySnippet);
                    }
                    return {
                      ok: true,
                      kind: "success",
                      exitCode: 0,
                      stdout: out.join("\n"),
                      stderr: "",
                      saVmEvents: [{ timestamp: Date.now(), type: "definition_found", symbol, filePath: candMatch.filePath }],
                      saVmViolation: null,
                      durationMs: Date.now() - startedAt
                    };
                  }
                }
              }
            }
          }
        }
      } catch {
        // fall through to search workspace
      }
    }
  }

  // 2. Search workspace source files: Bun.Worker prefilter pool (disk I/O +
  // substring match off the main thread), then precise tree-sitter parse
  // on candidates only, preserving workspace order + early exit.
  // SA_VM_FIND_NO_WORKER=true forces the legacy sequential loop.
  const targetFiles = await collectWorkspaceSourceFiles(cwd, 1000, 10000, startedAt);
  const orderIndex = new Map<string, number>(targetFiles.map((f, i) => [f, i]));
  let prefiltered: string[] | null = null;
  if (targetFiles.length > 1 && process.env.SA_VM_FIND_NO_WORKER !== "true") {
    try {
      prefiltered = await prefilterFilesInWorkers(targetFiles, symbol, 8000);
      prefiltered.sort((a, b) => (orderIndex.get(a) ?? 0) - (orderIndex.get(b) ?? 0));
    } catch {
      prefiltered = null;
    }
  }
  const scanList = prefiltered ?? targetFiles;
  for (const f of scanList) {
    try {
      const content = await readFile(f, "utf8");
      if (!content.includes(symbol)) continue;
      const relPath = relative(cwd, f).replace(/\\/g, "/");
      const match = await findDefinitionInContent(relPath, content, symbol, { includeBody, maxBodyLines });
      if (match) {
        const out = [
          `[find_definition] Found definition for '${symbol}':`,
          `- File: ${match.filePath}`,
          `- Range: [L${match.startLine}-L${match.endLine}] (${match.endLine - match.startLine + 1} lines)`,
          `- Kind: ${match.kind}`,
          `- Signature: ${match.signature}`
        ];
        if (match.bodySnippet) {
          out.push(`- Implementation:`, match.bodySnippet);
        }
        return {
          ok: true,
          kind: "success",
          exitCode: 0,
          stdout: out.join("\n"),
          stderr: "",
          saVmEvents: [{ timestamp: Date.now(), type: "definition_found", symbol, filePath: match.filePath }],
          saVmViolation: null,
          durationMs: Date.now() - startedAt
        };
      }
    } catch {
      // skip
    }
  }

  return {
    ok: true,
    kind: "success",
    exitCode: 0,
    stdout: `[find_definition] No definition found for symbol '${symbol}'.`,
    stderr: "",
    saVmEvents: [],
    saVmViolation: null,
    durationMs: Date.now() - startedAt
  };
}

export async function nativeExtractToFile(
  rawSource: string,
  rawTarget: string,
  startLine: number | undefined,
  endLine: number | undefined,
  options: {
    symbols?: string[] | string;
    component_name?: string;
    dry_run?: boolean;
    raw?: boolean;
    mode?: string;
    keep_source?: boolean;
  },
  policy: SaVmPolicyConfig | undefined,
  cwd: string,
  startedAt: number
): Promise<SaVmRunResult> {
  const source = (rawSource ?? "").trim().replace(/\\/g, "/");
  const target = (rawTarget ?? "").trim().replace(/\\/g, "/");

  if (!source || !target) {
    return {
      ok: false,
      kind: "sa_error",
      exitCode: 1,
      stdout: "",
      stderr: "source and target parameters are required for extract_to_file",
      saVmEvents: [],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  }

  const normalized = normalizeSaVmPolicy(policy, cwd);
  if (normalized.tools?.extractToFile !== true) {
    return {
      ok: false,
      kind: "capability_denied",
      exitCode: 228,
      stdout: "",
      stderr: "action 'extract_to_file' is disabled in current VM policy; enable extractToFile in VM settings",
      saVmEvents: [],
      saVmViolation: { reason: "extractToFile disabled" },
      durationMs: Date.now() - startedAt
    };
  }

  const checkSource = checkSaVmPath(normalized, "write", source, cwd);
  if (!checkSource.allowed) {
    return {
      ok: false,
      kind: "capability_denied",
      exitCode: 228,
      stdout: "",
      stderr: `Policy violation on source: ${checkSource.reason || "write not allowed"}`,
      saVmEvents: [],
      saVmViolation: { reason: checkSource.reason },
      durationMs: Date.now() - startedAt
    };
  }

  const checkTarget = checkSaVmPath(normalized, "write", target, cwd);
  if (!checkTarget.allowed) {
    return {
      ok: false,
      kind: "capability_denied",
      exitCode: 228,
      stdout: "",
      stderr: `Policy violation on target: ${checkTarget.reason || "write not allowed"}`,
      saVmEvents: [],
      saVmViolation: { reason: checkTarget.reason },
      durationMs: Date.now() - startedAt
    };
  }

  const fullSource = resolve(cwd, source);
  const fullTarget = resolve(cwd, target);

  if (!existsSync(fullSource)) {
    return {
      ok: false,
      kind: "sa_error",
      exitCode: 1,
      stdout: "",
      stderr: `Source file does not exist: ${source}`,
      saVmEvents: [],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  }

  const sourceContent = await readFile(fullSource, "utf8");
  const lines = sourceContent.split(/\r?\n/);
  const totalLines = lines.length;

  const sLine = typeof startLine === "number" ? Math.max(1, startLine) : 1;
  const eLine = typeof endLine === "number" ? Math.min(totalLines, endLine) : totalLines;

  if (sLine > eLine || sLine > totalLines) {
    return {
      ok: false,
      kind: "sa_error",
      exitCode: 1,
      stdout: "",
      stderr: `Invalid line range [L${sLine}-L${eLine}] for file with ${totalLines} lines`,
      saVmEvents: [],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  }

  const extractedLines = lines.slice(sLine - 1, eLine);

  const rawMode = options.raw === true || options.mode === "raw";
  let symbolsList: string[] = [];
  if (rawMode) {
    // verbatim move: no export guessing, no export rewriting, no source import
    // injection. The caller owns component wrapping and call-site wiring.
  } else if (Array.isArray(options.symbols)) {
    symbolsList = [...new Set(options.symbols.map(s => s.trim()).filter(Boolean))];
  } else if (typeof options.symbols === "string" && options.symbols.trim()) {
    symbolsList = [...new Set(options.symbols.split(",").map(s => s.trim()).filter(Boolean))];
  } else {
    // 导出判定（修误判）：只取块内顶层缩进的声明。逐行正则会把 handler 深处的
    // 块内局部变量（如 const target/next）误当导出，导致源文件注入不存在的
    // import 而编译失败。规则：最小缩进声明 + 块外仍有引用才导出。
    // 作用域感知：跟踪相对大括号深度，仅深度为 0 的声明才有资格成为导出；
    // 纯 JSX/回调嵌套块（如 .map 回调内的 const active）深度恒 >0，直接零导出。
    const declRegex = /^(\s*)(?:export\s+)?(?:const|let|var|function|class|interface|type|enum)\s+([a-zA-Z0-9_$]+)/;
    const found: Array<{ name: string; indent: number; depth: number }> = [];
    let depth = 0;
    for (const el of extractedLines) {
      const m = declRegex.exec(el);
      if (m && m[2]) found.push({ name: m[2], indent: (m[1] ?? "").replace(/\t/g, "  ").length, depth });
      const opens = (el.match(/\{/g) ?? []).length;
      const closes = (el.match(/\}/g) ?? []).length;
      depth = Math.max(0, depth + opens - closes);
    }
    const topLevel = found.filter(f => f.depth === 0);
    if (topLevel.length > 0) {
      const topIndent = Math.min(...topLevel.map(f => f.indent));
      const srcEol = sourceContent.includes("\r\n") ? "\r\n" : "\n";
      const sourceWithoutBlock = [...lines.slice(0, sLine - 1), ...lines.slice(eLine)].join(srcEol);
      const seen = new Set<string>();
      for (const f of topLevel) {
        if (f.indent !== topIndent || seen.has(f.name)) continue;
        seen.add(f.name);
        // 块外仍引用该名 → 真导出；块内自产自销 → 不导出
        if (new RegExp(`\\b${f.name}\\b`).test(sourceWithoutBlock)) symbolsList.push(f.name);
      }
      // 回退：仅当候选处于块顶层深度时保留首个，避免空导出无法接入；
      // 嵌套块（无顶层声明）保持零导出，不再误伤回调内局部变量。
      if (symbolsList.length === 0) {
        const first = topLevel.find(f => f.indent === topIndent);
        if (first) symbolsList.push(first.name);
      }
    }
    if (symbolsList.length === 0 && options.component_name) {
      symbolsList.push(options.component_name.trim());
    }
  }

  const processedTargetLines = extractedLines.map(line => {
    let modified = line;
    for (const sym of symbolsList) {
      const declPattern = new RegExp(`^(\\s*)(const|let|var|function|class|interface|type|enum)\\s+(${sym}\\b)`);
      if (declPattern.test(modified)) {
        modified = modified.replace(declPattern, "$1export $2 $3");
      }
    }
    return modified;
  });

  let targetImports = "";
  try {
    targetImports = generateTargetImportsForBlock(fullSource, fullTarget, sourceContent, sLine, eLine);
  } catch {
    // ignore if not ts/js or parsing fails
  }

  const sourceDir = dirname(fullSource);
  const relTarget = relative(sourceDir, fullTarget).replace(/\\/g, "/");
  const relTargetNoExt = relTarget.replace(/\.(?:[cm]?[jt]sx?)$/, "");
  const normalizedRel = relTargetNoExt.startsWith(".") ? relTargetNoExt : `./${relTargetNoExt}`;
  const importStatement = symbolsList.length > 0
    ? `import { ${symbolsList.join(", ")} } from "${normalizedRel}";`
    : `import "${normalizedRel}";`;

  const eol = sourceContent.includes("\r\n") ? "\r\n" : "\n";
  // FIX(P0): never splice import at cut location (breaks function/JSX bodies).
  // Remove block first, then insert import at file top via addImportToContent.
  const sourceWithoutBlock = [...lines.slice(0, sLine - 1), ...lines.slice(eLine)].join(eol);
  // raw 模式：只搬运不接线，不向源文件注入 import（调用方自行装配调用点）。
  const newSourceContent = rawMode
    ? sourceWithoutBlock
    : (() => {
        const importApplied = addImportToContent(source, sourceWithoutBlock, { statement: importStatement });
        return importApplied.applied ? importApplied.newContent : `${importStatement}${eol}${sourceWithoutBlock}`;
      })();
  const targetBody = processedTargetLines.join(eol) + eol;
  const targetContent = targetImports.trim()
    ? `${targetImports.trim()}${eol}${eol}${targetBody}`
    : targetBody;

  const isDryRun = options.dry_run === true;
  // 高耦合门禁：captured 过多说明不是叶子块，整体搬迁会产生巨型 Props。
  // dry_run 只警告（预览用途）；真实落盘且 captured > 50 时直接拦截。
  // raw 模式除外：按契约只做原文搬运、调用方自行接线，仅告警不断链。
  let couplingNote = "";
  try {
    const scopeCheck = analyzeBlockScope(source, sourceContent, sLine, eLine, options.component_name ?? "ExtractedComponent");
    const capturedCount = scopeCheck.capturedVariables.length;
    if (capturedCount > 20) {
      couplingNote = `- Coupling warning: ${capturedCount} captured outer variable(s) exceed threshold 20; this block is not a leaf — prefer batch-1 leaf dialogs per docs/app-tsx-ast-splitting-runbook.md.`;
      if (!isDryRun && !rawMode && capturedCount > 50) {
        return {
          ok: false,
          kind: "sa_error",
          exitCode: 2,
          stdout: "",
          stderr: `extract_to_file blocked: ${capturedCount} captured outer variables exceed limit 50. Extract a smaller leaf block instead.`,
          saVmEvents: [],
          saVmViolation: null,
          durationMs: Date.now() - startedAt
        };
      }
    }
  } catch { /* scope gate is best-effort; never fail extraction on it */ }
  // keep_source=true turns the default move into a copy: target is written,
  // source is left untouched and no import is injected (same as dry_run's
  // preview output, but the target IS written). Lets batch splits copy N
  // leaf blocks first, verify, then delete sources afterwards.
  const keepSource = options.keep_source === true;
  if (!isDryRun) {
    await mkdir(dirname(fullTarget), { recursive: true });
    await writeFile(fullTarget, targetContent, "utf8");
    if (!keepSource) await writeFile(fullSource, newSourceContent, "utf8");
  }

  const mode = isDryRun ? "DRY-RUN (preview only)" : keepSource ? "APPLIED [copy: source kept]" : "APPLIED";
  const outputLines = [
    `[extract_to_file] ${mode}${rawMode ? " [raw: verbatim move, no export/import wiring]" : ""}: Extracted lines ${sLine}-${eLine} from '${source}' -> '${target}'.`,
    `- Exported symbols: ${symbolsList.join(", ") || "(none)"}`
  ];
  if (keepSource && !isDryRun) {
    outputLines.push(`- Source kept unchanged (copy mode, no import injected).`);
  }
  if (!rawMode && !keepSource) {
    outputLines.push(`- Injected in source: ${importStatement}`);
  }
  // Move proof (default keep_source=false): verify the block actually left the
  // source exactly once. Occurrence M->N on the in-memory contents (no re-read);
  // duplicated code elsewhere shows N>=1 with a WARNING instead of silence.
  if (!isDryRun && !keepSource) {
    const newSourceLineCount = newSourceContent.split(eol).length;
    const blockText = extractedLines.join(eol);
    if (blockText.length > 0 && blockText.length <= 100_000) {
      const before = sourceContent.split(blockText).length - 1;
      const after = newSourceContent.split(blockText).length - 1;
      let proof = `- Source verified: extracted block occurrence ${before} -> ${after} (removed once), source now ${newSourceLineCount} lines (was ${totalLines}).`;
      if (after >= before) proof += ` WARNING: block text still present — duplicated code elsewhere or removal failed, inspect source.`;
      outputLines.push(proof);
    } else {
      outputLines.push(`- Source updated: now ${newSourceLineCount} lines (was ${totalLines}); block too large for verbatim occurrence check, verify with get_diagnostics.`);
    }
  }
  if (couplingNote) outputLines.push(couplingNote);
  if (targetImports.trim()) {
    outputLines.push(`- Injected in target imports:\n${targetImports}`);
  }

  return {
    ok: true,
    kind: "success",
    exitCode: 0,
    stdout: outputLines.join("\n"),
    stderr: "",
    saVmEvents: [
      {
        timestamp: Date.now(),
        type: "code_extracted_to_file",
        source,
        target,
        startLine: sLine,
        endLine: eLine,
        symbols: symbolsList,
        dryRun: isDryRun,
        keepSource
      }
    ],
    saVmViolation: null,
    durationMs: Date.now() - startedAt
  };
}

export async function nativeAddImport(
  rawPath: string,
  options: {
    statement?: string;
    symbol?: string;
    module?: string;
    is_type?: boolean;
    dry_run?: boolean;
  },
  policy: SaVmPolicyConfig | undefined,
  cwd: string,
  startedAt: number
): Promise<SaVmRunResult> {
  const filePath = (rawPath ?? "").trim().replace(/\\/g, "/");
  if (!filePath) {
    return {
      ok: false,
      kind: "sa_error",
      exitCode: 1,
      stdout: "",
      stderr: "path parameter is required for add_import",
      saVmEvents: [],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  }

  const normalized = normalizeSaVmPolicy(policy, cwd);
  if (normalized.tools?.addImport !== true) {
    return {
      ok: false,
      kind: "capability_denied",
      exitCode: 228,
      stdout: "",
      stderr: "action 'add_import' is disabled in current VM policy; enable addImport in VM settings",
      saVmEvents: [],
      saVmViolation: { reason: "addImport disabled" },
      durationMs: Date.now() - startedAt
    };
  }

  const checkTarget = checkSaVmPath(normalized, "write", filePath, cwd);
  if (!checkTarget.allowed) {
    return {
      ok: false,
      kind: "capability_denied",
      exitCode: 228,
      stdout: "",
      stderr: `Policy violation: ${checkTarget.reason || "write not allowed"}`,
      saVmEvents: [],
      saVmViolation: { reason: checkTarget.reason },
      durationMs: Date.now() - startedAt
    };
  }

  const fullPath = resolve(cwd, filePath);
  if (!existsSync(fullPath)) {
    return {
      ok: false,
      kind: "sa_error",
      exitCode: 1,
      stdout: "",
      stderr: `File does not exist: ${filePath}`,
      saVmEvents: [],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  }

  const content = await readFile(fullPath, "utf8");
  const res = addImportToContent(filePath, content, {
    statement: options.statement,
    symbol: options.symbol,
    module: options.module,
    isType: options.is_type
  });

  const isDryRun = options.dry_run === true;
  if (res.applied && !isDryRun) {
    await writeFile(fullPath, res.newContent, "utf8");
  }

  const mode = isDryRun ? "DRY-RUN (preview only)" : "APPLIED";
  return {
    ok: true,
    kind: "success",
    exitCode: 0,
    stdout: `[add_import] ${mode}: ${res.message}`,
    stderr: "",
    saVmEvents: [
      {
        timestamp: Date.now(),
        type: "import_added",
        filePath,
        applied: res.applied,
        dryRun: isDryRun
      }
    ],
    saVmViolation: null,
    durationMs: Date.now() - startedAt
  };
}

export async function nativeGetDiagnostics(
  rawPath: string,
  policy: SaVmPolicyConfig | undefined,
  cwd: string,
  startedAt: number
): Promise<SaVmRunResult> {
  const filePath = (rawPath ?? "").trim().replace(/\\/g, "/");
  if (!filePath) {
    return {
      ok: false,
      kind: "sa_error",
      exitCode: 1,
      stdout: "",
      stderr: "path parameter is required for get_diagnostics",
      saVmEvents: [],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  }

  const normalized = normalizeSaVmPolicy(policy, cwd);
  if (normalized.tools?.getDiagnostics !== true) {
    return {
      ok: false,
      kind: "capability_denied",
      exitCode: 228,
      stdout: "",
      stderr: "action 'get_diagnostics' is disabled in current VM policy; enable getDiagnostics in VM settings",
      saVmEvents: [],
      saVmViolation: { reason: "getDiagnostics disabled" },
      durationMs: Date.now() - startedAt
    };
  }

  const checkTarget = checkSaVmPath(normalized, "read", filePath, cwd);
  if (!checkTarget.allowed) {
    return {
      ok: false,
      kind: "capability_denied",
      exitCode: 228,
      stdout: "",
      stderr: `Policy violation: ${checkTarget.reason || "read not allowed"}`,
      saVmEvents: [],
      saVmViolation: { reason: checkTarget.reason },
      durationMs: Date.now() - startedAt
    };
  }

  const fullPath = resolve(cwd, filePath);
  if (!existsSync(fullPath)) {
    return {
      ok: false,
      kind: "sa_error",
      exitCode: 1,
      stdout: "",
      stderr: `File does not exist: ${filePath}`,
      saVmEvents: [],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  }

  const content = await readFile(fullPath, "utf8");
  const diags = await getSyntaxDiagnostics(filePath, content);
  // Semantic upgrade (best-effort, TS/JS only): append LanguageService errors so
  // missing imports / type errors are visible instead of false-clean.
  // Perf guard: skip the LS pass on huge files (>250KB, e.g. 16k-line App.tsx)
  // where a full type-check takes minutes; syntax gate still applies.
  try {
    if (/\.(tsx?|jsx?|mjs|cjs)$/.test(filePath) && content.length <= 250_000) {
      const sem = getSemanticDiagnosticsForContent(filePath, content, cwd);
      if (sem.length > 0) {
        const merged = [...diags.errors, ...sem.map(s => ({ line: s.line, column: s.column, message: s.message, preview: s.preview, code: s.code }))].slice(0, 80);
        const fmt = merged.map(e => `  L${e.line}:C${e.column} [${(e as any).code ?? "TS"}] ${(e as any).message}${(e as any).preview ? ` :: ${(e as any).preview}` : ""}`).join("\n");
        return {
          ok: true, kind: "success", exitCode: 1,
          stdout: `[diagnostics] ✗ ${filePath}: ${merged.length} issue(s) (syntax ${diags.errorsCount} + semantic ${sem.length})\n${fmt}`,
          stderr: "",
          saVmEvents: [{ timestamp: Date.now(), type: "diagnostics_checked", filePath, clean: false, errorsCount: merged.length }],
          saVmViolation: null, durationMs: Date.now() - startedAt
        };
      }
    }
  } catch { /* keep syntax-only fallback */ }

  return {
    ok: true,
    kind: "success",
    exitCode: diags.clean ? 0 : 1,
    stdout: diags.formatted,
    stderr: "",
    saVmEvents: [
      {
        timestamp: Date.now(),
        type: "diagnostics_checked",
        filePath,
        clean: diags.clean,
        errorsCount: diags.errorsCount
      }
    ],
    saVmViolation: null,
    durationMs: Date.now() - startedAt
  };
}

export async function nativeWorkspaceDiagnostics(
  rawDir: string | undefined,
  options: {
    pattern?: string;
    max_files?: number;
    max_errors?: number;
    max_tokens?: number;
    detail?: boolean;
    timeout_ms?: number;
    timeout?: number;
    page?: unknown; page_num?: unknown; pageNum?: unknown; p?: unknown;
    page_size?: unknown; pageSize?: unknown; per_page?: unknown; perPage?: unknown;
    offset?: unknown; count_cap?: unknown; countCap?: unknown; max_total?: unknown;
    exact_total?: unknown; exactTotal?: unknown;
  },
  policy: SaVmPolicyConfig | undefined,
  cwd: string,
  startedAt: number
): Promise<SaVmRunResult> {
  const normalized = normalizeSaVmPolicy(policy, cwd);
  if (normalized.tools?.getDiagnostics !== true) {
    return {
      ok: false,
      kind: "capability_denied",
      exitCode: 228,
      stdout: "",
      stderr: "action 'workspace_diagnostics' is disabled in current VM policy; enable getDiagnostics in VM settings",
      saVmEvents: [],
      saVmViolation: { reason: "getDiagnostics disabled" },
      durationMs: Date.now() - startedAt
    };
  }

  const relDir = (rawDir ?? ".").trim().replace(/\\/g, "/");
  const targetDir = isAbsolute(relDir) ? resolve(relDir) : resolve(cwd, relDir);
  const checkDir = checkSaVmPath(normalized, "read", targetDir, cwd);
  if (!checkDir.allowed) {
    return {
      ok: false,
      kind: "capability_denied",
      exitCode: 228,
      stdout: "",
      stderr: `Policy violation: ${checkDir.reason || "read not allowed"}`,
      saVmEvents: [],
      saVmViolation: { reason: checkDir.reason },
      durationMs: Date.now() - startedAt
    };
  }

  const detail = options.detail === true;
  if (!existsSync(targetDir)) {
    return {
      ok: true,
      kind: "success",
      exitCode: 0,
      stdout: JSON.stringify({
        dir: relDir,
        exists: false,
        clean: true,
        total_files_scanned: 0,
        total_errors: 0,
        diagnostics: detail ? {} : []
      }, null, 2),
      stderr: "",
      saVmEvents: [],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  }

  const maxFiles = typeof options.max_files === "number" && options.max_files > 0 ? options.max_files : 100;
  const _wdPg = resolvePagination(options as Record<string, unknown>, { defaultSize: typeof options.max_errors === "number" && options.max_errors > 0 ? options.max_errors : 50, maxSize: 500, legacyLimit: options.max_errors });
  const maxErrors = _wdPg.paginated ? _wdPg.countCap : (typeof options.max_errors === "number" && options.max_errors > 0 ? options.max_errors : 50);
  const maxTokens = typeof options.max_tokens === "number" && options.max_tokens > 0 ? options.max_tokens : 4000;
  const timeoutMs = resolveTimeoutMs(options, 15_000);

  const defaultExtRegex = /\.(?:tsx?|jsx?|mts|cts|mjs|cjs|zig|rs|py|go|vue|svelte|json)$/i;
  const userPattern = options.pattern?.trim();
  let patternRegex: RegExp | null = null;
  if (userPattern) {
    const escaped = userPattern
      .replace(/\\/g, "/")
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*\*/g, ".*")
      .replace(/\*/g, "[^/]*");
    patternRegex = new RegExp(`^${escaped}$`, "i");
  }

  let isTimedOut = false;
  let truncated = false;
  let truncatedReason: string | undefined;

  const candidateFiles: string[] = [];

  try {
    const targetStat = await stat(targetDir);
    if (targetStat.isFile()) {
      candidateFiles.push(targetDir);
    } else {
      const giRules = loadGitIgnoreRules(targetDir);
      const queue: string[] = [targetDir];

      while (queue.length > 0 && candidateFiles.length < maxFiles) {
        if (Date.now() - startedAt > timeoutMs) {
          isTimedOut = true;
          truncated = true;
          truncatedReason = "timeout";
          break;
        }
        const current = queue.shift()!;
        try {
          const entries = await readdir(current, { withFileTypes: true });
          for (const ent of entries) {
            if (Date.now() - startedAt > timeoutMs) {
              isTimedOut = true;
              truncated = true;
              truncatedReason = "timeout";
              break;
            }
            if (ent.isDirectory()) {
              if (!isGitIgnored(ent.name, true, giRules)) {
                queue.push(join(current, ent.name));
              }
            } else if (ent.isFile()) {
              if (isGitIgnored(ent.name, false, giRules)) continue;
              const fullFilePath = join(current, ent.name);
              const rel = relative(cwd, fullFilePath).replace(/\\/g, "/");
              const matches = patternRegex ? (patternRegex.test(rel) || patternRegex.test(ent.name)) : defaultExtRegex.test(ent.name);
              if (matches) {
                candidateFiles.push(fullFilePath);
                if (candidateFiles.length >= maxFiles) {
                  truncated = true;
                  truncatedReason = "max_files";
                  break;
                }
              }
            }
          }
        } catch {
          // ignore unreadable dirs
        }
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      kind: "sa_error",
      exitCode: 1,
      stdout: "",
      stderr: `Failed to inspect directory: ${msg}`,
      saVmEvents: [],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  }

  let totalErrors = 0;
  let remainingErrors = 0;
  let estimatedTokens = 100;
  let scannedCount = 0;
  const compactDiagnostics: string[] = [];
  const detailedDiagnostics: Record<string, Array<{ line: number; col: number; code?: string | number; msg?: string; preview?: string }>> = {};

  for (const filePath of candidateFiles) {
    if (Date.now() - startedAt > timeoutMs) {
      isTimedOut = true;
      truncated = true;
      truncatedReason = "timeout";
      break;
    }
    const checkFile = checkSaVmPath(normalized, "read", filePath, cwd);
    if (!checkFile.allowed) continue;

    scannedCount++;
    const relPath = relative(cwd, filePath).replace(/\\/g, "/");

    try {
      const content = await readFile(filePath, "utf8");
      const diags = await getSyntaxDiagnostics(relPath, content);
      if (!diags.clean && diags.errors.length > 0) {
        for (const err of diags.errors) {
          totalErrors++;
          if (totalErrors > maxErrors) {
            remainingErrors++;
            truncated = true;
            if (!truncatedReason) truncatedReason = "max_errors";
            continue;
          }
          if (estimatedTokens >= maxTokens) {
            // max_tokens breaker: omit msg/preview, retain line/col position
            truncated = true;
            if (!truncatedReason) truncatedReason = "max_tokens";
            if (detail) {
              if (!detailedDiagnostics[relPath]) detailedDiagnostics[relPath] = [];
              detailedDiagnostics[relPath]!.push({
                line: err.line,
                col: err.column,
                code: err.code ?? "syntax"
              });
              estimatedTokens += 8;
            } else {
              const line = `${relPath}:L${err.line}:C${err.column}:${err.code ?? "syntax"}`;
              compactDiagnostics.push(line);
              estimatedTokens += Math.ceil(line.length / 3.5) + 2;
            }
            continue;
          }

          const errCode = err.code ?? "syntax";
          if (detail) {
            if (!detailedDiagnostics[relPath]) detailedDiagnostics[relPath] = [];
            detailedDiagnostics[relPath]!.push({
              line: err.line,
              col: err.column,
              code: errCode,
              msg: err.message,
              preview: err.preview
            });
            estimatedTokens += Math.ceil((err.message.length + (err.preview?.length ?? 0)) / 3.5) + 12;
          } else {
            const line = `${relPath}:L${err.line}:C${err.column}:${errCode}`;
            compactDiagnostics.push(line);
            estimatedTokens += Math.ceil(line.length / 3.5) + 2;
          }
        }
      }
    } catch {
      // skip unreadable
    }
  }

  const clean = totalErrors === 0;
  let wdDiagnostics: unknown = detail ? detailedDiagnostics : compactDiagnostics;
  let wdReturned = totalErrors - remainingErrors;
  let wdPage: number | undefined;
  let wdPageSize: number | undefined;
  let wdTotalPages: number | undefined;
  let wdHasNext: boolean | undefined;
  let wdHasPrev: boolean | undefined;
  if (_wdPg.paginated) {
    if (detail) {
      const flat: Array<{ file: string; entry: { line: number; col: number; code?: string | number; msg?: string; preview?: string } }> = [];
      for (const [f, arr] of Object.entries(detailedDiagnostics).sort(([a], [b]) => a.localeCompare(b))) {
        for (const e of arr) flat.push({ file: f, entry: e });
      }
      const s = paginateItems(flat, _wdPg);
      const grouped: Record<string, Array<{ line: number; col: number; code?: string | number; msg?: string; preview?: string }>> = {};
      for (const r of s.paged) {
        if (!grouped[r.file]) grouped[r.file] = [];
        grouped[r.file]!.push(r.entry);
      }
      wdDiagnostics = grouped;
      wdReturned = s.returned;
      wdPage = _wdPg.page;
      wdPageSize = _wdPg.page_size;
      wdTotalPages = s.total_pages;
      wdHasNext = (totalErrors >= _wdPg.countCap || isTimedOut) ? true : s.has_next;
      wdHasPrev = s.has_prev;
    } else {
      const sorted = [...compactDiagnostics].sort();
      const s = paginateItems(sorted, _wdPg);
      wdDiagnostics = s.paged;
      wdReturned = s.returned;
      wdPage = _wdPg.page;
      wdPageSize = _wdPg.page_size;
      wdTotalPages = s.total_pages;
      wdHasNext = (totalErrors >= _wdPg.countCap || isTimedOut) ? true : s.has_next;
      wdHasPrev = s.has_prev;
    }
  }
  const output = {
    dir: relDir,
    clean,
    total_files_scanned: scannedCount,
    total_errors: totalErrors,
    returned_errors: wdReturned,
    remaining_errors: remainingErrors > 0 ? remainingErrors : undefined,
    truncated: truncated || isTimedOut,
    truncated_reason: truncatedReason,
    timed_out: isTimedOut ? true : undefined,
    timeout_ms: isTimedOut ? timeoutMs : undefined,
    page: wdPage,
    page_size: wdPageSize,
    total_pages: wdTotalPages,
    has_next: wdHasNext,
    has_prev: wdHasPrev,
    diagnostics: wdDiagnostics
  };

  return {
    ok: true,
    kind: "success",
    exitCode: clean ? 0 : 1,
    stdout: JSON.stringify(output, null, 2),
    stderr: isTimedOut ? `[timeout] workspace_diagnostics reached timeout limit of ${timeoutMs}ms; scanned ${scannedCount} files` : "",
    saVmEvents: [
      {
        timestamp: Date.now(),
        type: "workspace_diagnostics_checked",
        dir: relDir,
        clean,
        totalFilesScanned: scannedCount,
        totalErrors
      }
    ],
    saVmViolation: null,
    durationMs: Date.now() - startedAt
  };
}

export async function nativeOrganizeImports(
  rawPath: string,
  options: {
    sort?: boolean;
    remove_unused?: boolean;
    merge_duplicates?: boolean;
    dry_run?: boolean;
  },
  policy: SaVmPolicyConfig | undefined,
  cwd: string,
  startedAt: number
): Promise<SaVmRunResult> {
  const filePath = (rawPath ?? "").trim().replace(/\\/g, "/");
  if (!filePath) {
    return {
      ok: false,
      kind: "sa_error",
      exitCode: 1,
      stdout: "",
      stderr: "path parameter is required for organize_imports",
      saVmEvents: [],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  }

  const normalized = normalizeSaVmPolicy(policy, cwd);
  if (normalized.tools?.organizeImports !== true) {
    return {
      ok: false,
      kind: "capability_denied",
      exitCode: 228,
      stdout: "",
      stderr: "action 'organize_imports' is disabled in current VM policy; enable organizeImports in VM settings",
      saVmEvents: [],
      saVmViolation: { reason: "organizeImports disabled" },
      durationMs: Date.now() - startedAt
    };
  }

  const checkTarget = checkSaVmPath(normalized, "write", filePath, cwd);
  if (!checkTarget.allowed) {
    return {
      ok: false,
      kind: "capability_denied",
      exitCode: 228,
      stdout: "",
      stderr: `Policy violation: ${checkTarget.reason || "write not allowed"}`,
      saVmEvents: [],
      saVmViolation: { reason: checkTarget.reason },
      durationMs: Date.now() - startedAt
    };
  }

  const fullPath = resolve(cwd, filePath);
  if (!existsSync(fullPath)) {
    return {
      ok: false,
      kind: "sa_error",
      exitCode: 1,
      stdout: "",
      stderr: `File does not exist: ${filePath}`,
      saVmEvents: [],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  }

  const content = await readFile(fullPath, "utf8");
  const res = organizeImportsInContent(filePath, content, {
    sort: options.sort !== false,
    removeUnused: options.remove_unused !== false,
    mergeDuplicates: options.merge_duplicates !== false
  });

  const isDryRun = options.dry_run === true;
  if (res.changed && !isDryRun) {
    await writeFile(fullPath, res.newContent, "utf8");
  }

  const mode = isDryRun ? "DRY-RUN (preview only)" : "APPLIED";
  return {
    ok: true,
    kind: "success",
    exitCode: 0,
    stdout: `[organize_imports] ${mode}: ${res.summary}`,
    stderr: "",
    saVmEvents: [
      {
        timestamp: Date.now(),
        type: "imports_organized",
        filePath,
        changed: res.changed,
        removedCount: res.removedUnusedCount,
        mergedCount: res.mergedCount,
        dryRun: isDryRun
      }
    ],
    saVmViolation: null,
    durationMs: Date.now() - startedAt
  };
}

export async function nativeAnalyzeScope(
  rawPath: string,
  startLine: number | undefined,
  endLine: number | undefined,
  options: {
    component_name?: string;
  },
  policy: SaVmPolicyConfig | undefined,
  cwd: string,
  startedAt: number
): Promise<SaVmRunResult> {
  const filePath = (rawPath ?? "").trim().replace(/\\/g, "/");
  if (!filePath) {
    return {
      ok: false,
      kind: "sa_error",
      exitCode: 1,
      stdout: "",
      stderr: "path parameter is required for analyze_scope",
      saVmEvents: [],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  }

  const normalized = normalizeSaVmPolicy(policy, cwd);
  if (normalized.tools?.analyzeScope !== true) {
    return {
      ok: false,
      kind: "capability_denied",
      exitCode: 228,
      stdout: "",
      stderr: "action 'analyze_scope' is disabled in current VM policy; enable analyzeScope in VM settings",
      saVmEvents: [],
      saVmViolation: { reason: "analyzeScope disabled" },
      durationMs: Date.now() - startedAt
    };
  }

  const checkTarget = checkSaVmPath(normalized, "read", filePath, cwd);
  if (!checkTarget.allowed) {
    return {
      ok: false,
      kind: "capability_denied",
      exitCode: 228,
      stdout: "",
      stderr: `Policy violation: ${checkTarget.reason || "read not allowed"}`,
      saVmEvents: [],
      saVmViolation: { reason: checkTarget.reason },
      durationMs: Date.now() - startedAt
    };
  }

  const fullPath = resolve(cwd, filePath);
  if (!existsSync(fullPath)) {
    return {
      ok: false,
      kind: "sa_error",
      exitCode: 1,
      stdout: "",
      stderr: `File does not exist: ${filePath}`,
      saVmEvents: [],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  }

  const content = await readFile(fullPath, "utf8");
  const lines = content.split(/\r?\n/);
  const totalLines = lines.length;

  const sLine = typeof startLine === "number" ? Math.max(1, startLine) : 1;
  const eLine = typeof endLine === "number" ? Math.min(totalLines, endLine) : totalLines;

  if (sLine > eLine || sLine > totalLines) {
    return {
      ok: false,
      kind: "sa_error",
      exitCode: 1,
      stdout: "",
      stderr: `Invalid line range [L${sLine}-L${eLine}] for file with ${totalLines} lines`,
      saVmEvents: [],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  }

  const analysis = analyzeBlockScope(filePath, content, sLine, eLine, {
    componentName: options.component_name
  });

  return {
    ok: true,
    kind: "success",
    exitCode: 0,
    stdout: analysis.summary,
    stderr: "",
    saVmEvents: [
      {
        timestamp: Date.now(),
        type: "scope_analyzed",
        filePath,
        startLine: sLine,
        endLine: eLine,
        capturedCount: analysis.capturedVariables.length
      }
    ],
    saVmViolation: null,
    durationMs: Date.now() - startedAt
  };
}

export async function nativeExtractComponent(
  rawSource: string, rawTarget: string, startLine: number | undefined, endLine: number | undefined,
  options: { component_name?: string; hook_name?: string; dry_run?: boolean; keep_source?: boolean },
  policy: SaVmPolicyConfig | undefined, cwd: string, startedAt: number
): Promise<SaVmRunResult> {
  const source = (rawSource ?? "").trim().replace(/\\/g, "/");
  const target = (rawTarget ?? "").trim().replace(/\\/g, "/");
  const compName = (options.component_name ?? options.hook_name ?? "ExtractedComponent").trim() || "ExtractedComponent";
  if (!source || !target) {
    return { ok: false, kind: "sa_error", exitCode: 1, stdout: "", stderr: "source and target parameters are required for extract_component", saVmEvents: [], saVmViolation: null, durationMs: Date.now() - startedAt };
  }
  const normalized = normalizeSaVmPolicy(policy, cwd);
  if (normalized.tools?.extractToFile !== true) {
    return { ok: false, kind: "capability_denied", exitCode: 228, stdout: "", stderr: "action 'extract_component' is disabled; enable extractToFile", saVmEvents: [], saVmViolation: { reason: "extractToFile disabled" }, durationMs: Date.now() - startedAt };
  }
  for (const p of [source, target]) {
    const chk = checkSaVmPath(normalized, "write", p, cwd);
    if (!chk.allowed) return { ok: false, kind: "capability_denied", exitCode: 228, stdout: "", stderr: `Policy violation: ${chk.reason}`, saVmEvents: [], saVmViolation: { reason: chk.reason }, durationMs: Date.now() - startedAt };
  }
  const fullSource = resolve(cwd, source);
  const fullTarget = resolve(cwd, target);
  if (!existsSync(fullSource)) return { ok: false, kind: "sa_error", exitCode: 1, stdout: "", stderr: `Source file does not exist: ${source}`, saVmEvents: [], saVmViolation: null, durationMs: Date.now() - startedAt };
  const sourceContent = await readFile(fullSource, "utf8");
  const totalLines = sourceContent.split(/\r?\n/).length;
  const sLine = typeof startLine === "number" ? Math.max(1, startLine) : 1;
  const eLine = typeof endLine === "number" ? Math.min(totalLines, endLine) : totalLines;
  if (sLine > eLine) return { ok: false, kind: "sa_error", exitCode: 1, stdout: "", stderr: `Invalid range L${sLine}-L${eLine}`, saVmEvents: [], saVmViolation: null, durationMs: Date.now() - startedAt };
  const eol = sourceContent.includes("\r\n") ? "\r\n" : "\n";
  let built: ReturnType<typeof buildExtractComponent>;
  try {
    built = buildExtractComponent(source, sourceContent, sLine, eLine, compName, target);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, kind: "sa_error", exitCode: 2, stdout: "", stderr: msg, saVmEvents: [], saVmViolation: null, durationMs: Date.now() - startedAt };
  }
  // Source: remove block then top-insert import (never in-body)
  const lines = sourceContent.split(/\r?\n/);
  const without = [...lines.slice(0, sLine - 1), built.callSnippet, ...lines.slice(eLine)].join(eol);
  const withImport = addImportToContent(source, without, { statement: built.importStatement });
  const newSource = withImport.applied ? withImport.newContent : `${built.importStatement}${eol}${without}`;
  // Target: semantic gate first, auto-fix only on TS2304, then semantic gate.
  // The new target is always small: gate it semantically even for huge sources.
  // The huge source edit itself is one call line + one top import (syntax-gated).
  let finalTarget = built.targetContent;
  // Perf guard: single-file LanguageService over >250KB (e.g. 16k-line App.tsx)
  // takes minutes; skip auto-fix + semantic gate there (syntax gate still applies).
  const hugeSource = sourceContent.length > 250_000;
  const semFilter = (d: { code?: string }) => d.code !== undefined && !/^TS6133/.test(d.code ?? "");
  const isEnvModuleResolution = (c?: string) => c === "TS2307" || c === "TS2792" || c === "TS2688";
  const isBlocking = (d: { code?: string }) => !!d.code && /TS23|TS10|TS11|TS27|TS25/.test(d.code) && !isEnvModuleResolution(d.code);
  // Gate the small target FIRST: only pay for auto-fix when the gate actually
  // reports missing names (TS2304). In the common clean case this skips an
  // entire wasted LanguageService pass (~2s).
  let semTgt = getSemanticDiagnosticsForContent(target, finalTarget, cwd).filter(semFilter);
  if (semTgt.some(d => d.code === "TS2304")) {
    try {
      const fixed = autoFixMissingImportsInContent(target, finalTarget, cwd);
      if (fixed.applied) {
        finalTarget = fixed.newContent;
        semTgt = getSemanticDiagnosticsForContent(target, finalTarget, cwd).filter(semFilter);
      }
    } catch { /* best-effort */ }
  }
  const semSrc = hugeSource ? [] : getSemanticDiagnosticsForContent(source, newSource, cwd).filter(semFilter);
  // 语法门禁：语义 LS 看不见 TS1xxx 语法错误（如 return( 包语句块），必须先查句法。
  const synTgt = await getSyntaxDiagnostics(target, finalTarget);
  if (synTgt.errors.length > 0) {
    const first = synTgt.errors[0]!;
    return { ok: false, kind: "sa_error", exitCode: 2, stdout: "", stderr: `extract_component blocked: target has ${synTgt.errors.length} syntax error(s). First: L${first.line} ${first.code ?? ""} ${first.message}`.trim(), saVmEvents: [], saVmViolation: null, durationMs: Date.now() - startedAt };
  }
  const blocking = [...semSrc, ...semTgt].filter(isBlocking);
  // 差分门禁：单文件 LS 看不到工程级类型增强/环境全局量 → 隔离噪音误报。
  // 源文件能提供而目标缺失的 = 真漏带，拦截；源文件也没有的 = 环境噪音，警告放行。
  const { hard, warnings } = splitEnvironmentalErrors(source, sourceContent, blocking);
  const warnNote = warnings.length > 0
    ? `\n- Env warnings (excused, verify with project typecheck): ${warnings.map(w => `L${w.line} ${w.code} ${w.message}`).join(" | ")}`
    : "";
  const isDryRun = options.dry_run === true;
  // keep_source=true turns the default move into a copy: target is written,
  // source is left untouched (call snippet + import NOT applied). Gates still
  // run so coupling warnings surface before the batch lands.
  const keepSource = options.keep_source === true;
  if (hard.length > 0) {
    return { ok: false, kind: "sa_error", exitCode: 2, stdout: "", stderr: `extract_component blocked: ${hard.length} semantic error(s)${warnings.length > 0 ? ` (+${warnings.length} env warning(s) excused)` : ""}. Source: ${semSrc.length}, Target: ${semTgt.length}. First: L${hard[0]!.line} ${hard[0]!.code} ${hard[0]!.message}`, saVmEvents: [], saVmViolation: null, durationMs: Date.now() - startedAt };
  }
  if (!isDryRun) {
    await mkdir(dirname(fullTarget), { recursive: true });
    await writeFile(fullTarget, finalTarget, "utf8");
    if (!keepSource) await writeFile(fullSource, newSource, "utf8");
  }
  const appliedLabel = isDryRun ? "DRY-RUN" : keepSource ? "APPLIED [copy: source kept]" : "APPLIED";
  const keepNote = keepSource && !isDryRun ? "\n- Source kept unchanged (copy mode, call snippet + import NOT applied)." : "";
  // Move proof (default keep_source=false): the block is replaced by the call
  // snippet, so prove the call landed and the source shrank accordingly.
  let moveProof = "";
  if (!isDryRun && !keepSource) {
    const newSourceLineCount = newSource.split(eol).length;
    const callPresent = newSource.includes(built.callSnippet);
    moveProof = `\n- Source verified: call \`${built.callSnippet.trim().slice(0, 120)}\` ${callPresent ? "present" : "MISSING"} in source, source now ${newSourceLineCount} lines.`;
    if (!callPresent) moveProof += ` WARNING: call snippet not found — inspect source.`;
  }
  return { ok: true, kind: "success", exitCode: 0, stdout: `[extract_component] ${appliedLabel}${hugeSource ? " (syntax+target-semantic gate: source >250KB)" : ""}: ${source}:L${sLine}-L${eLine} -> ${target} as ${compName}\n- Props: ${built.propsInterface}\n- Call: ${built.callSnippet}\n- Import: ${built.importStatement}${warnNote}${keepNote}${moveProof}`, stderr: "", saVmEvents: [{ timestamp: Date.now(), type: "component_extracted", source, target, startLine: sLine, endLine: eLine, dryRun: isDryRun, keepSource }], saVmViolation: null, durationMs: Date.now() - startedAt };
}

export async function nativeAutoFixMissingImports(
  rawPath: string, options: { dry_run?: boolean },
  policy: SaVmPolicyConfig | undefined, cwd: string, startedAt: number
): Promise<SaVmRunResult> {
  const filePath = (rawPath ?? "").trim().replace(/\\/g, "/");
  if (!filePath) return { ok: false, kind: "sa_error", exitCode: 1, stdout: "", stderr: "path required for auto_fix_missing_imports", saVmEvents: [], saVmViolation: null, durationMs: Date.now() - startedAt };
  const normalized = normalizeSaVmPolicy(policy, cwd);
  if (normalized.tools?.organizeImports !== true && normalized.tools?.getDiagnostics !== true) {
    return { ok: false, kind: "capability_denied", exitCode: 228, stdout: "", stderr: "enable organizeImports or getDiagnostics for auto_fix_missing_imports", saVmEvents: [], saVmViolation: { reason: "auto-fix disabled" }, durationMs: Date.now() - startedAt };
  }
  const chk = checkSaVmPath(normalized, "write", filePath, cwd);
  if (!chk.allowed) return { ok: false, kind: "capability_denied", exitCode: 228, stdout: "", stderr: `Policy violation: ${chk.reason}`, saVmEvents: [], saVmViolation: { reason: chk.reason }, durationMs: Date.now() - startedAt };
  const full = resolve(cwd, filePath);
  if (!existsSync(full)) return { ok: false, kind: "sa_error", exitCode: 1, stdout: "", stderr: `File does not exist: ${filePath}`, saVmEvents: [], saVmViolation: null, durationMs: Date.now() - startedAt };
  const content = await readFile(full, "utf8");
  const res = autoFixMissingImportsInContent(filePath, content, cwd);
  if (res.applied && options.dry_run !== true) await writeFile(full, res.newContent, "utf8");
  return { ok: true, kind: "success", exitCode: 0, stdout: `[auto_fix_missing_imports] ${options.dry_run === true ? "DRY-RUN" : "APPLIED"}: ${res.summary} in ${filePath}`, stderr: "", saVmEvents: [{ timestamp: Date.now(), type: "imports_autofixed", filePath, fixedCount: res.fixedCount, dryRun: options.dry_run === true }], saVmViolation: null, durationMs: Date.now() - startedAt };
}

export async function nativeAnalyzeCoupling(
  rawPath: string, options: { top_n?: number },
  policy: SaVmPolicyConfig | undefined, cwd: string, startedAt: number
): Promise<SaVmRunResult> {
  const filePath = (rawPath ?? "").trim().replace(/\\/g, "/");
  if (!filePath) return { ok: false, kind: "sa_error", exitCode: 1, stdout: "", stderr: "path required for analyze_coupling", saVmEvents: [], saVmViolation: null, durationMs: Date.now() - startedAt };
  const normalized = normalizeSaVmPolicy(policy, cwd);
  if (normalized.tools?.analyzeScope !== true) return { ok: false, kind: "capability_denied", exitCode: 228, stdout: "", stderr: "enable analyzeScope for analyze_coupling", saVmEvents: [], saVmViolation: { reason: "analyzeScope disabled" }, durationMs: Date.now() - startedAt };
  const chk = checkSaVmPath(normalized, "read", filePath, cwd);
  if (!chk.allowed) return { ok: false, kind: "capability_denied", exitCode: 228, stdout: "", stderr: `Policy violation: ${chk.reason}`, saVmEvents: [], saVmViolation: { reason: chk.reason }, durationMs: Date.now() - startedAt };
  const full = resolve(cwd, filePath);
  if (!existsSync(full)) return { ok: false, kind: "sa_error", exitCode: 1, stdout: "", stderr: `File does not exist: ${filePath}`, saVmEvents: [], saVmViolation: null, durationMs: Date.now() - startedAt };
  const content = await readFile(full, "utf8");
  const topN = typeof options.top_n === "number" ? Math.max(1, Math.min(30, options.top_n)) : 12;
  const res = analyzeFileCoupling(filePath, content, topN);
  return { ok: true, kind: "success", exitCode: 0, stdout: res.summary, stderr: "", saVmEvents: [{ timestamp: Date.now(), type: "coupling_analyzed", filePath, count: res.candidates.length }], saVmViolation: null, durationMs: Date.now() - startedAt };
}

export async function nativeAtomicRefactor(
  ops: Array<{ path: string; content?: string; patch?: string }>,
  options: { dry_run?: boolean },
  policy: SaVmPolicyConfig | undefined, cwd: string, startedAt: number
): Promise<SaVmRunResult> {
  const normalized = normalizeSaVmPolicy(policy, cwd);
  if (normalized.tools?.editFiles !== true && normalized.tools?.applyPatch !== true && normalized.tools?.extractToFile !== true) {
    return { ok: false, kind: "capability_denied", exitCode: 228, stdout: "", stderr: "atomic_refactor needs editFiles/applyPatch/extractToFile", saVmEvents: [], saVmViolation: { reason: "atomic disabled" }, durationMs: Date.now() - startedAt };
  }
  // In-memory gate: syntax + semantic must be clean for TS/JS targets
  const problems: string[] = [];
  for (const op of ops ?? []) {
    const p = (op.path ?? "").trim();
    if (!p || typeof op.content !== "string") continue;
    if (!/\.(tsx?|jsx?|mjs|cjs)$/.test(p)) continue;
    try {
      const syn = await getSyntaxDiagnostics(p, op.content);
      if (!syn.clean) problems.push(`${p}: ${syn.errorsCount} syntax error(s): ${syn.errors[0]?.message ?? ""}`);
      const sem = getSemanticDiagnosticsForContent(p, op.content, cwd).filter(d => d.code && /TS23|TS10|TS11|TS27|TS25/.test(d.code) && d.code !== "TS2307" && d.code !== "TS2792" && d.code !== "TS2688");
      if (sem.length > 0) problems.push(`${p}: ${sem.length} semantic error(s): L${sem[0]!.line} ${sem[0]!.code} ${sem[0]!.message}`);
    } catch (e: any) {
      problems.push(`${p}: gate failed ${e?.message ?? e}`);
    }
  }
  if (problems.length > 0) {
    return { ok: false, kind: "sa_error", exitCode: 2, stdout: "", stderr: `atomic_refactor blocked (0-write):\n- ${problems.join("\n- ")}`, saVmEvents: [], saVmViolation: null, durationMs: Date.now() - startedAt };
  }
  if (options.dry_run === true) {
    return { ok: true, kind: "success", exitCode: 0, stdout: `[atomic_refactor] DRY-RUN: ${(ops ?? []).length} file(s) passed gates, 0 writes`, stderr: "", saVmEvents: [], saVmViolation: null, durationMs: Date.now() - startedAt };
  }
  for (const op of ops ?? []) {
    const p = (op.path ?? "").trim();
    if (!p || typeof op.content !== "string") continue;
    const chk = checkSaVmPath(normalized, "write", p, cwd);
    if (!chk.allowed) return { ok: false, kind: "capability_denied", exitCode: 228, stdout: "", stderr: `Policy violation: ${chk.reason}`, saVmEvents: [], saVmViolation: { reason: chk.reason }, durationMs: Date.now() - startedAt };
    const full = resolve(cwd, p);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, op.content, "utf8");
  }
  return { ok: true, kind: "success", exitCode: 0, stdout: `[atomic_refactor] APPLIED: ${(ops ?? []).length} file(s)`, stderr: "", saVmEvents: [{ timestamp: Date.now(), type: "atomic_refactor", count: (ops ?? []).length }], saVmViolation: null, durationMs: Date.now() - startedAt };
}

export async function nativeApplyPatch(
  patchText: string,
  policy: SaVmPolicyConfig | undefined,
  cwd: string,
  additionalRoots: string[] = [],
  startedAt: number
): Promise<SaVmRunResult> {
  const checked = parseAndCheckSaVmPatch(patchText, cwd, policy, additionalRoots);
  if (!checked.ok) {
    // Format errors are the CALLER's mistake (sa_error); only genuine policy
    // denials are capability_denied. Labeling a malformed patch as "denied"
    // makes models believe patching is admin-forbidden and give up editing.
    const denied = (checked as { policyDenied?: boolean }).policyDenied === true;
    return {
      ok: false,
      kind: denied ? "capability_denied" : "sa_error",
      exitCode: denied ? 228 : 1,
      stdout: "",
      stderr: denied ? `apply_patch denied: ${checked.reason}` : `apply_patch error: ${checked.reason}`,
      saVmEvents: [],
      saVmViolation: denied ? { reason: checked.reason } : null,
      durationMs: Date.now() - startedAt
    };
  }

  try {
    let appliedCount = 0;
    for (const op of checked.operations) {
      if (op.kind === "write") {
        const res = await nativeWriteFile(op.path, op.contents, policy, cwd, startedAt);
        if (!res.ok) return res;
        appliedCount++;
      } else if (op.kind === "edit") {
        const res = await nativeEditFile(op.path, op.oldContents, op.newContents, policy, cwd, startedAt);
        if (!res.ok) return res;
        appliedCount++;
      } else if (op.kind === "delete") {
        const res = await nativeDeleteFile(op.path, policy, cwd, startedAt);
        if (!res.ok) return res;
        appliedCount++;
      } else if (op.kind === "rename") {
        const res = await nativeMoveFile(op.from, op.to, policy, cwd, startedAt);
        if (!res.ok) return res;
        appliedCount++;
      }
    }
    return {
      ok: true,
      kind: "success",
      exitCode: 0,
      stdout: `Successfully applied ${appliedCount} patch operations.`,
      stderr: "",
      saVmEvents: [],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      kind: "sa_error",
      exitCode: 1,
      stdout: "",
      stderr: msg,
      saVmEvents: [],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  }
}

export async function nativeCopyFile(
  fromPath: string,
  toPath: string,
  policy: SaVmPolicyConfig | undefined,
  cwd: string,
  startedAt: number
): Promise<SaVmRunResult> {
  const normalizedPolicy = normalizeSaVmPolicy(policy, cwd);
  const resolvedFrom = isAbsolute(fromPath) ? resolve(fromPath) : resolve(cwd, fromPath);
  const resolvedTo = isAbsolute(toPath) ? resolve(toPath) : resolve(cwd, toPath);
  const fromDecision = checkSaVmPath(normalizedPolicy, "read", fromPath, cwd);
  if (!fromDecision.allowed) {
    return {
      ok: false,
      kind: "capability_denied",
      exitCode: 228,
      stdout: "",
      stderr: `read ${fromPath}: ${fromDecision.reason}`,
      saVmEvents: [],
      saVmViolation: fromDecision.reason ? { reason: fromDecision.reason } : null,
      durationMs: Date.now() - startedAt
    };
  }
  const toDecision = checkSaVmPath(normalizedPolicy, "write", toPath, cwd);
  if (!toDecision.allowed) {
    return {
      ok: false,
      kind: "capability_denied",
      exitCode: 228,
      stdout: "",
      stderr: `write ${toPath}: ${toDecision.reason}`,
      saVmEvents: [],
      saVmViolation: toDecision.reason ? { reason: toDecision.reason } : null,
      durationMs: Date.now() - startedAt
    };
  }
  try {
    await mkdir(dirname(resolvedTo), { recursive: true });
    await copyFile(resolvedFrom, resolvedTo);
    return {
      ok: true,
      kind: "success",
      exitCode: 0,
      stdout: `File copied from ${fromPath} to ${toPath} successfully`,
      stderr: "",
      saVmEvents: [],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      kind: "sa_error",
      exitCode: 1,
      stdout: "",
      stderr: msg,
      saVmEvents: [],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  }
}

async function countFileLines(resolvedPath: string, size: number): Promise<{ totalLines: number; isBinary: boolean } | null> {
  if (size === 0) return { totalLines: 0, isBinary: false };
  if (size > 50 * 1024 * 1024) return null;
  try {
    const handle = await open(resolvedPath, "r");
    try {
      const buffer = Buffer.alloc(Math.min(size, 64 * 1024));
      let totalLines = 0;
      let isBinary = false;
      let firstChunk = true;
      let lastByte = -1;
      let bytesRead = 0;
      let pos = 0;

      while ((bytesRead = (await handle.read(buffer, 0, buffer.length, pos)).bytesRead) > 0) {
        if (firstChunk) {
          firstChunk = false;
          const checkLen = Math.min(bytesRead, 1024);
          for (let i = 0; i < checkLen; i++) {
            if (buffer[i] === 0) {
              isBinary = true;
              break;
            }
          }
          if (isBinary) break;
        }

        for (let i = 0; i < bytesRead; i++) {
          if (buffer[i] === 0x0A) totalLines++;
        }
        lastByte = buffer[bytesRead - 1]!;
        pos += bytesRead;
      }

      if (isBinary) return { totalLines: 0, isBinary: true };
      if (lastByte !== 0x0A && size > 0) totalLines++;
      return { totalLines, isBinary: false };
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
}

export async function nativeFileInfo(
  filePath: string,
  policy: SaVmPolicyConfig | undefined,
  cwd: string,
  startedAt: number
): Promise<SaVmRunResult> {
  const normalizedPolicy = normalizeSaVmPolicy(policy, cwd);
  const resolved = isAbsolute(filePath) ? resolve(filePath) : resolve(cwd, filePath);
  const decision = checkSaVmPath(normalizedPolicy, "read", filePath, cwd);
  if (!decision.allowed) {
    return {
      ok: false,
      kind: "capability_denied",
      exitCode: 228,
      stdout: "",
      stderr: decision.reason,
      saVmEvents: [],
      saVmViolation: decision.reason ? { reason: decision.reason } : null,
      durationMs: Date.now() - startedAt
    };
  }
  try {
    const s = await stat(resolved);
    let lineCountInfo: { totalLines: number; isBinary: boolean } | null = null;
    if (s.isFile()) {
      lineCountInfo = await countFileLines(resolved, s.size);
    }
    const info: Record<string, unknown> = {
      path: relative(cwd, resolved).replace(/\\/g, "/"),
      exists: true,
      size: s.size,
      isFile: s.isFile(),
      isDirectory: s.isDirectory(),
      mtime: s.mtime.toISOString(),
      ctime: s.ctime.toISOString()
    };
    if (lineCountInfo && !lineCountInfo.isBinary) {
      info.total_lines = lineCountInfo.totalLines;
      info.line_count = lineCountInfo.totalLines;
    }
    return {
      ok: true,
      kind: "success",
      exitCode: 0,
      stdout: JSON.stringify(info, null, 2),
      stderr: "",
      saVmEvents: [],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  } catch (err: unknown) {
    const isEnoent = (err as { code?: string })?.code === "ENOENT" || String(err).includes("ENOENT");
    if (isEnoent) {
      return {
        ok: true,
        kind: "success",
        exitCode: 0,
        stdout: JSON.stringify({
          path: relative(cwd, resolved).replace(/\\/g, "/"),
          exists: false,
          isFile: false,
          isDirectory: false
        }, null, 2),
        stderr: "",
        saVmEvents: [],
        saVmViolation: null,
        durationMs: Date.now() - startedAt
      };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      kind: "sa_error",
      exitCode: 1,
      stdout: "",
      stderr: msg,
      saVmEvents: [],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  }
}

export async function nativeCountLines(
  filePath: string,
  policy: SaVmPolicyConfig | undefined,
  cwd: string,
  startedAt: number
): Promise<SaVmRunResult> {
  const normalizedPolicy = normalizeSaVmPolicy(policy, cwd);
  const resolved = isAbsolute(filePath) ? resolve(filePath) : resolve(cwd, filePath);
  const decision = checkSaVmPath(normalizedPolicy, "read", filePath, cwd);
  if (!decision.allowed) {
    return {
      ok: false,
      kind: "capability_denied",
      exitCode: 228,
      stdout: "",
      stderr: decision.reason,
      saVmEvents: [],
      saVmViolation: decision.reason ? { reason: decision.reason } : null,
      durationMs: Date.now() - startedAt
    };
  }
  try {
    const s = await stat(resolved);
    if (!s.isFile()) {
      return {
        ok: false,
        kind: "sa_error",
        exitCode: 1,
        stdout: "",
        stderr: `'${filePath}' is not a file`,
        saVmEvents: [],
        saVmViolation: null,
        durationMs: Date.now() - startedAt
      };
    }
    const lineCountInfo = await countFileLines(resolved, s.size);
    if (lineCountInfo?.isBinary) {
      return {
        ok: true,
        kind: "success",
        exitCode: 0,
        stdout: `[Binary file detected: ${filePath} (${formatBytes(s.size)}). Line counting skipped.]`,
        stderr: "",
        saVmEvents: [],
        saVmViolation: null,
        durationMs: Date.now() - startedAt
      };
    }
    const totalLines = lineCountInfo?.totalLines ?? 0;
    const relPath = relative(cwd, resolved).replace(/\\/g, "/");
    const formatted = `[File: ${relPath} | Total Lines: ${totalLines} | Size: ${formatBytes(s.size)}]`;
    return {
      ok: true,
      kind: "success",
      exitCode: 0,
      stdout: formatted,
      stderr: "",
      saVmEvents: [{ timestamp: Date.now(), type: "count_lines", path: relPath, totalLines }],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      kind: "sa_error",
      exitCode: 1,
      stdout: "",
      stderr: msg,
      saVmEvents: [],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  }
}

// ---------------------------------------------------------------------------
// git_status / git_diff read-only native actions (no shell, argv allowlist)
// ---------------------------------------------------------------------------

function resolveGitMaxBytes(
  input: { max_bytes?: number; max_tokens?: number; max_token?: number; maxtoken?: number; remaining_tokens?: number; tokens_remaining?: number; tokens_left?: number },
  defaultBytes: number
): number {
  if (typeof input.max_bytes === "number" && Number.isFinite(input.max_bytes) && input.max_bytes > 0) {
    return Math.min(512 * 1024, Math.max(512, Math.floor(input.max_bytes)));
  }
  const mt = typeof input.max_tokens === "number" && input.max_tokens > 0
    ? input.max_tokens
    : (typeof input.max_token === "number" && input.max_token > 0 ? input.max_token : (typeof input.maxtoken === "number" && input.maxtoken > 0 ? input.maxtoken : undefined));
  const rt = typeof input.remaining_tokens === "number" && input.remaining_tokens > 0
    ? input.remaining_tokens
    : (typeof input.tokens_remaining === "number" && input.tokens_remaining > 0 ? input.tokens_remaining : (typeof input.tokens_left === "number" && input.tokens_left > 0 ? input.tokens_left : undefined));
  let budget = mt !== undefined ? mt * 4 : defaultBytes;
  if (rt !== undefined) budget = Math.min(budget, Math.max(512, (rt - 3000) * 4));
  if (!Number.isFinite(budget) || budget <= 0) budget = defaultBytes;
  return Math.min(512 * 1024, Math.max(512, Math.floor(budget)));
}

function findGitRepoRoot(startAbs: string, workspaceRoot: string): string | null {
  let cur = startAbs;
  try {
    if (statSync(cur).isFile()) cur = dirname(cur);
  } catch { /* start may not exist; walk up from the given path */ }
  const bound = workspaceRoot.replace(/\\/g, "/").toLowerCase();
  for (let i = 0; i < 64; i++) {
    try {
      if (existsSync(join(cur, ".git"))) return cur;
    } catch { /* ignore fs races */ }
    const normCur = cur.replace(/\\/g, "/").toLowerCase();
    const parent = dirname(cur);
    if (parent === cur) return null;
    const normParent = parent.replace(/\\/g, "/").toLowerCase();
    const curInside = normCur === bound || normCur.startsWith(bound + "/");
    const parentInside = normParent === bound || normParent.startsWith(bound + "/");
    if (curInside && !parentInside) return null;
    if (normCur === bound) return null;
    cur = parent;
  }
  return null;
}

type GitSpawnResult = {
  status: number | null;
  stdout: string;
  stderr: string;
  unavailable: boolean;
  timedOut: boolean;
};

function execGitSync(repoRoot: string, argv: string[], timeoutMs: number): GitSpawnResult {
  try {
    const r = spawnSync("git", argv, { cwd: repoRoot, encoding: "utf8", timeout: timeoutMs, shell: false, windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
    const code = (r.error as NodeJS.ErrnoException | undefined)?.code;
    const errMsg = r.error instanceof Error ? r.error.message : (r.error ? String(r.error) : "");
    if (r.error && (code === "ENOENT" || errMsg.includes("ENOENT"))) {
      return { status: null, stdout: "", stderr: "git binary not found; install git to use git_status/git_diff/git_log", unavailable: true, timedOut: false };
    }
    if (r.error && (code === "ETIMEDOUT" || /timed out/i.test(errMsg))) {
      return { status: null, stdout: "", stderr: `git command timed out after ${timeoutMs}ms`, unavailable: false, timedOut: true };
    }
    // 32MB maxBuffer should hold normal history/diff output. If it still
    // overflows (ENOBUFS), keep the partial stdout so callers can truncate
    // via max_bytes instead of failing with exitCode 1.
    if (r.error && (code === "ENOBUFS" || /maxBuffer/i.test(errMsg))) {
      return {
        status: 0,
        stdout: typeof r.stdout === "string" ? r.stdout : String(r.stdout ?? ""),
        stderr: "warning: git output exceeded 32MB buffer; output truncated to buffer size",
        unavailable: false,
        timedOut: false
      };
    }
    return {
      status: r.status,
      stdout: typeof r.stdout === "string" ? r.stdout : String(r.stdout ?? ""),
      stderr: typeof r.stderr === "string" ? r.stderr : String(r.stderr ?? ""),
      unavailable: false,
      timedOut: false
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/ENOENT/.test(msg)) {
      return { status: null, stdout: "", stderr: "git binary not found; install git to use git_status/git_diff", unavailable: true, timedOut: false };
    }
    return { status: null, stdout: "", stderr: msg, unavailable: false, timedOut: false };
  }
}

type GitPorcelainEntry = { path: string; x: string; y: string; orig?: string };

function parseGitBranchHeader(header: string): { branch: string; upstream: string | null; ahead: number; behind: number } {
  const m = /^(.+?)\.\.\.(.+?)(?:\s+\[([^\]]*)\])?$/.exec(header);
  if (m) {
    const branch = (m[1] ?? "").trim() || header;
    const upstream = (m[2] ?? "").trim() || null;
    const flags = m[3] ?? "";
    const am = /ahead (\d+)/.exec(flags);
    const bm = /behind (\d+)/.exec(flags);
    return { branch, upstream, ahead: am ? Number(am[1]) : 0, behind: bm ? Number(bm[1]) : 0 };
  }
  const nm = /^No commits yet on (.+)$/.exec(header);
  if (nm) return { branch: (nm[1] ?? "").trim() || header, upstream: null, ahead: 0, behind: 0 };
  return { branch: header, upstream: null, ahead: 0, behind: 0 };
}

function stripGitQuotes(p: string): string {
  const t = p.trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
    return t.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  return t;
}

export async function nativeGitStatus(
  startPath: string,
  opts: { short?: boolean; untracked?: string; max_entries?: number; max_bytes?: number; max_tokens?: number; max_token?: number; maxtoken?: number; remaining_tokens?: number; tokens_remaining?: number; tokens_left?: number; timeout_ms?: number; timeout?: number },
  policy: SaVmPolicyConfig | undefined,
  cwd: string,
  startedAt: number
): Promise<SaVmRunResult> {
  const normalizedPolicy = normalizeSaVmPolicy(policy, cwd);
  const start = startPath && startPath.trim() ? startPath.trim() : cwd;
  const decision = checkSaVmPath(normalizedPolicy, "read", start, cwd);
  if (!decision.allowed) {
    return {
      ok: false,
      kind: "capability_denied",
      exitCode: 228,
      stdout: "",
      stderr: decision.reason,
      saVmEvents: [],
      saVmViolation: decision.reason ? { reason: decision.reason } : null,
      durationMs: Date.now() - startedAt
    };
  }
  const startAbs = isAbsolute(start) ? resolve(start) : resolve(cwd, start);
  const repoRoot = findGitRepoRoot(startAbs, resolve(cwd));
  if (!repoRoot) {
    return {
      ok: false,
      kind: "sa_error",
      exitCode: 1,
      stdout: "",
      stderr: `not a git repository within workspace roots: ${start}`,
      saVmEvents: [],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  }
  const short = opts.short !== false;
  let mode = typeof opts.untracked === "string" ? opts.untracked.trim().toLowerCase() : "normal";
  if (mode !== "no" && mode !== "all") mode = "normal";
  const maxEntries = typeof opts.max_entries === "number" && opts.max_entries > 0
    ? Math.min(2000, Math.floor(opts.max_entries))
    : 200;
  const maxBytes = resolveGitMaxBytes(opts, 32 * 1024);
  const timeoutMs = resolveTimeoutMs(opts, 15_000);
  const argv = short
    ? ["status", "--porcelain=v1", "-b", `--untracked-files=${mode}`]
    : ["status", `--untracked-files=${mode}`];
  const r = execGitSync(repoRoot, argv, timeoutMs);
  if (r.unavailable) {
    return { ok: false, kind: "unavailable", exitCode: 1, stdout: "", stderr: r.stderr, saVmEvents: [], saVmViolation: null, durationMs: Date.now() - startedAt };
  }
  if (r.timedOut) {
    return { ok: false, kind: "timeout", exitCode: 124, stdout: "", stderr: r.stderr, saVmEvents: [], saVmViolation: null, durationMs: Date.now() - startedAt };
  }
  if (r.status !== 0) {
    return { ok: false, kind: "sa_error", exitCode: r.status ?? 1, stdout: "", stderr: r.stderr || "git status failed", saVmEvents: [], saVmViolation: null, durationMs: Date.now() - startedAt };
  }
  if (!short) {
    let text = r.stdout;
    let truncated = false;
    if (text.length > maxBytes) {
      text = text.slice(0, maxBytes);
      truncated = true;
    }
    return {
      ok: true,
      kind: "success",
      exitCode: 0,
      stdout: JSON.stringify({ status: "ok", action: "git_status", repo: repoRoot, text, truncated }, null, 2),
      stderr: "",
      saVmEvents: [],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  }
  let branch = "";
  let upstream: string | null = null;
  let ahead = 0;
  let behind = 0;
  const staged: GitPorcelainEntry[] = [];
  const unstaged: GitPorcelainEntry[] = [];
  const untracked: Array<{ path: string }> = [];
  for (const line of r.stdout.split(/\r?\n/)) {
    if (!line) continue;
    if (line.startsWith("## ")) {
      const h = parseGitBranchHeader(line.slice(3));
      branch = h.branch;
      upstream = h.upstream;
      ahead = h.ahead;
      behind = h.behind;
      continue;
    }
    if (line.length < 4) continue;
    const x = line[0]!;
    const y = line[1]!;
    const rest = line.slice(3);
    if (x === "?" && y === "?") {
      untracked.push({ path: stripGitQuotes(rest) });
      continue;
    }
    if (x === "!" && y === "!") continue;
    let p = rest;
    let orig: string | undefined;
    const arrow = rest.indexOf(" -> ");
    if (arrow >= 0) {
      orig = stripGitQuotes(rest.slice(0, arrow));
      p = stripGitQuotes(rest.slice(arrow + 4));
    } else {
      p = stripGitQuotes(rest);
    }
    if (x !== " " && x !== "?" && x !== "!") {
      const entry: GitPorcelainEntry = { path: p, x, y };
      if (orig) entry.orig = orig;
      staged.push(entry);
    }
    if (y !== " " && y !== "?" && y !== "!") {
      const entry: GitPorcelainEntry = { path: p, x, y };
      if (orig) entry.orig = orig;
      unstaged.push(entry);
    }
  }
  let truncated = false;
  const totalCount = () => staged.length + unstaged.length + untracked.length;
  const trimToBudget = () => {
    while (totalCount() > maxEntries) {
      if (untracked.length) untracked.pop();
      else if (unstaged.length) unstaged.pop();
      else if (staged.length) staged.pop();
      else break;
      truncated = true;
    }
  };
  trimToBudget();
  const build = () => JSON.stringify({
    status: "ok",
    action: "git_status",
    repo: repoRoot,
    branch,
    upstream,
    ahead,
    behind,
    staged,
    unstaged,
    untracked,
    counts: { staged: staged.length, unstaged: unstaged.length, untracked: untracked.length },
    truncated
  }, null, 2);
  let out = build();
  while (out.length > maxBytes && totalCount() > 0) {
    if (untracked.length) untracked.pop();
    else if (unstaged.length) unstaged.pop();
    else if (staged.length) staged.pop();
    else break;
    truncated = true;
    out = build();
  }
  return {
    ok: true,
    kind: "success",
    exitCode: 0,
    stdout: out,
    stderr: "",
    saVmEvents: [],
    saVmViolation: null,
    durationMs: Date.now() - startedAt
  };
}

function isSafeGitRevision(rev: string): boolean {
  const t = rev.trim();
  if (!t || t.length > 128) return false;
  if (t.startsWith("-")) return false;
  if (/[\s;|&$`'"\\!(){}\[\]*?<>]/.test(t)) return false;
  return /^[A-Za-z0-9_./~^:+-]+(\.\.\.?[A-Za-z0-9_./~^:+-]+)?$/.test(t);
}

export async function nativeGitDiff(
  startPath: string,
  opts: { pathspec?: string; staged?: boolean; stat_only?: boolean; context?: number; max_files?: number; max_bytes?: number; max_tokens?: number; max_token?: number; maxtoken?: number; remaining_tokens?: number; tokens_remaining?: number; tokens_left?: number; timeout_ms?: number; timeout?: number; target?: string; revision?: string; range?: string },
  policy: SaVmPolicyConfig | undefined,
  cwd: string,
  startedAt: number
): Promise<SaVmRunResult> {
  const normalizedPolicy = normalizeSaVmPolicy(policy, cwd);
  const start = startPath && startPath.trim() ? startPath.trim() : cwd;
  const decision = checkSaVmPath(normalizedPolicy, "read", start, cwd);
  if (!decision.allowed) {
    return {
      ok: false,
      kind: "capability_denied",
      exitCode: 228,
      stdout: "",
      stderr: decision.reason,
      saVmEvents: [],
      saVmViolation: decision.reason ? { reason: decision.reason } : null,
      durationMs: Date.now() - startedAt
    };
  }
  const startAbs = isAbsolute(start) ? resolve(start) : resolve(cwd, start);
  const repoRoot = findGitRepoRoot(startAbs, resolve(cwd));
  if (!repoRoot) {
    return {
      ok: false,
      kind: "sa_error",
      exitCode: 1,
      stdout: "",
      stderr: `not a git repository within workspace roots: ${start}`,
      saVmEvents: [],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  }
  const staged = opts.staged === true;
  const statOnly = opts.stat_only === true;
  let context = typeof opts.context === "number" && Number.isFinite(opts.context) ? Math.floor(opts.context) : 3;
  context = Math.min(10, Math.max(0, context));
  const maxFiles = typeof opts.max_files === "number" && opts.max_files > 0 ? Math.floor(opts.max_files) : 50;
  const maxBytes = resolveGitMaxBytes(opts, 64 * 1024);
  const timeoutMs = resolveTimeoutMs(opts, 15_000);
  let pathspecRel: string | null = null;
  if (typeof opts.pathspec === "string" && opts.pathspec.trim()) {
    const ps = opts.pathspec.trim();
    const psDecision = checkSaVmPath(normalizedPolicy, "read", ps, cwd);
    if (!psDecision.allowed) {
      return {
        ok: false,
        kind: "capability_denied",
        exitCode: 228,
        stdout: "",
        stderr: psDecision.reason,
        saVmEvents: [],
        saVmViolation: psDecision.reason ? { reason: psDecision.reason } : null,
        durationMs: Date.now() - startedAt
      };
    }
    const psAbs = isAbsolute(ps) ? resolve(ps) : resolve(cwd, ps);
    let rel = relative(repoRoot, psAbs).replace(/\\/g, "/");
    if (rel === "") rel = ".";
    if (rel === ".." || rel.startsWith("../")) {
      return {
        ok: false,
        kind: "sa_error",
        exitCode: 1,
        stdout: "",
        stderr: `pathspec '${ps}' is outside the git repository root`,
        saVmEvents: [],
        saVmViolation: null,
        durationMs: Date.now() - startedAt
      };
    }
    pathspecRel = rel;
  }
  const rawRev = (typeof opts.target === "string" && opts.target.trim())
    || (typeof opts.revision === "string" && opts.revision.trim())
    || (typeof opts.range === "string" && opts.range.trim())
    || "";
  let revisionArgs: string[] = [];
  if (rawRev) {
    if (!isSafeGitRevision(rawRev)) {
      return {
        ok: false,
        kind: "sa_error",
        exitCode: 1,
        stdout: "",
        stderr: `unsafe git revision '${rawRev}'; use a commit SHA, HEAD, HEAD~N, branch name, or A..B range`,
        saVmEvents: [],
        saVmViolation: null,
        durationMs: Date.now() - startedAt
      };
    }
    revisionArgs = rawRev.includes("..") ? rawRev.split("..").filter(Boolean) : [rawRev];
    // Re-join range with '..' or '...' preserved: split above loses dots, so
    // fall back to the raw validated string as a single argv element model.
    // git accepts "A..B" as one arg; keep it atomic to avoid ambiguity.
    revisionArgs = [rawRev];
  }
  const effectiveStaged = staged && revisionArgs.length === 0;
  const withBase = (extra: string[]): string[] => [
    "diff",
    "--no-color",
    "--no-ext-diff",
    ...(effectiveStaged ? ["--cached"] : []),
    ...extra,
    ...revisionArgs,
    ...(pathspecRel ? ["--", pathspecRel] : [])
  ];
  const numstat = execGitSync(repoRoot, withBase(["--numstat"]), timeoutMs);
  if (numstat.unavailable) {
    return { ok: false, kind: "unavailable", exitCode: 1, stdout: "", stderr: numstat.stderr, saVmEvents: [], saVmViolation: null, durationMs: Date.now() - startedAt };
  }
  if (numstat.timedOut) {
    return { ok: false, kind: "timeout", exitCode: 124, stdout: "", stderr: numstat.stderr, saVmEvents: [], saVmViolation: null, durationMs: Date.now() - startedAt };
  }
  if (numstat.status !== 0) {
    return { ok: false, kind: "sa_error", exitCode: numstat.status ?? 1, stdout: "", stderr: numstat.stderr || "git diff --numstat failed", saVmEvents: [], saVmViolation: null, durationMs: Date.now() - startedAt };
  }
  const files: string[] = [];
  let insertions = 0;
  let deletions = 0;
  for (const line of numstat.stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    if (parts.length < 3) continue;
    const a = parts[0] ?? "";
    const d = parts[1] ?? "";
    const p = parts.slice(2).join("\t");
    if (!p) continue;
    files.push(p);
    if (a !== "-" && d !== "-") {
      const an = Number(a);
      const dn = Number(d);
      if (Number.isFinite(an) && an > 0) insertions += Math.floor(an);
      if (Number.isFinite(dn) && dn > 0) deletions += Math.floor(dn);
    }
  }
  const degraded = files.length > maxFiles;
  if (statOnly || degraded) {
    const stat = execGitSync(repoRoot, withBase(["--stat"]), timeoutMs);
    if (stat.unavailable) {
      return { ok: false, kind: "unavailable", exitCode: 1, stdout: "", stderr: stat.stderr, saVmEvents: [], saVmViolation: null, durationMs: Date.now() - startedAt };
    }
    if (stat.timedOut) {
      return { ok: false, kind: "timeout", exitCode: 124, stdout: "", stderr: stat.stderr, saVmEvents: [], saVmViolation: null, durationMs: Date.now() - startedAt };
    }
    if (stat.status !== 0) {
      return { ok: false, kind: "sa_error", exitCode: stat.status ?? 1, stdout: "", stderr: stat.stderr || "git diff --stat failed", saVmEvents: [], saVmViolation: null, durationMs: Date.now() - startedAt };
    }
    let statText = stat.stdout;
    let truncated = degraded;
    if (statText.length > maxBytes) {
      statText = statText.slice(0, maxBytes);
      truncated = true;
    }
    return {
      ok: true,
      kind: "success",
      exitCode: 0,
      stdout: JSON.stringify({
        status: "ok",
        action: "git_diff",
        repo: repoRoot,
        staged: effectiveStaged,
        revision: rawRev || undefined,
        stat_only: statOnly,
        files: degraded ? files.slice(0, maxFiles) : files,
        insertions,
        deletions,
        diff: "",
        stat: statText,
        truncated
      }, null, 2),
      stderr: "",
      saVmEvents: [],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  }
  const full = execGitSync(repoRoot, withBase([`-U${context}`]), timeoutMs);
  if (full.unavailable) {
    return { ok: false, kind: "unavailable", exitCode: 1, stdout: "", stderr: full.stderr, saVmEvents: [], saVmViolation: null, durationMs: Date.now() - startedAt };
  }
  if (full.timedOut) {
    return { ok: false, kind: "timeout", exitCode: 124, stdout: "", stderr: full.stderr, saVmEvents: [], saVmViolation: null, durationMs: Date.now() - startedAt };
  }
  if (full.status !== 0) {
    return { ok: false, kind: "sa_error", exitCode: full.status ?? 1, stdout: "", stderr: full.stderr || "git diff failed", saVmEvents: [], saVmViolation: null, durationMs: Date.now() - startedAt };
  }
  let diffText = full.stdout;
  let truncated = false;
  if (diffText.length > maxBytes) {
    diffText = diffText.slice(0, maxBytes);
    truncated = true;
  }
  return {
    ok: true,
    kind: "success",
    exitCode: 0,
    stdout: JSON.stringify({
      status: "ok",
      action: "git_diff",
      repo: repoRoot,
      staged: effectiveStaged,
      revision: rawRev || undefined,
      stat_only: false,
      files,
      insertions,
      deletions,
      diff: diffText,
      truncated
    }, null, 2),
    stderr: "",
    saVmEvents: [],
    saVmViolation: null,
    durationMs: Date.now() - startedAt
  };
}

export async function nativeGitLog(
  startPath: string,
  opts: { max_count?: number; target?: string; revision?: string; range?: string; oneline?: boolean; max_bytes?: number; max_tokens?: number; max_token?: number; maxtoken?: number; remaining_tokens?: number; tokens_remaining?: number; tokens_left?: number; timeout_ms?: number; timeout?: number },
  policy: SaVmPolicyConfig | undefined,
  cwd: string,
  startedAt: number
): Promise<SaVmRunResult> {
  const normalizedPolicy = normalizeSaVmPolicy(policy, cwd);
  const start = startPath && startPath.trim() ? startPath.trim() : cwd;
  const decision = checkSaVmPath(normalizedPolicy, "read", start, cwd);
  if (!decision.allowed) {
    return {
      ok: false,
      kind: "capability_denied",
      exitCode: 228,
      stdout: "",
      stderr: decision.reason,
      saVmEvents: [],
      saVmViolation: decision.reason ? { reason: decision.reason } : null,
      durationMs: Date.now() - startedAt
    };
  }
  const startAbs = isAbsolute(start) ? resolve(start) : resolve(cwd, start);
  const repoRoot = findGitRepoRoot(startAbs, resolve(cwd));
  if (!repoRoot) {
    return {
      ok: false,
      kind: "sa_error",
      exitCode: 1,
      stdout: "",
      stderr: `not a git repository within workspace roots: ${start}`,
      saVmEvents: [],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  }
  const rawRev = (typeof opts.target === "string" && opts.target.trim())
    || (typeof opts.revision === "string" && opts.revision.trim())
    || (typeof opts.range === "string" && opts.range.trim())
    || "";
  if (rawRev && !isSafeGitRevision(rawRev)) {
    return {
      ok: false,
      kind: "sa_error",
      exitCode: 1,
      stdout: "",
      stderr: `unsafe git revision '${rawRev}'; use a commit SHA, HEAD, HEAD~N, branch name, or A..B range`,
      saVmEvents: [],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  }
  let maxCount = typeof opts.max_count === "number" && Number.isFinite(opts.max_count) ? Math.floor(opts.max_count) : 10;
  maxCount = Math.min(100, Math.max(1, maxCount));
  const maxBytes = resolveGitMaxBytes(opts, 64 * 1024);
  const timeoutMs = resolveTimeoutMs(opts, 15_000);
  const argv = ["log", `--max-count=${maxCount}`, "--pretty=format:%H%x01%h%x01%an%x01%ad%x01%s%x01%b%x1e", "--date=iso", "--no-color", ...(rawRev ? [rawRev] : [])];
  const r = execGitSync(repoRoot, argv, timeoutMs);
  if (r.unavailable) {
    return { ok: false, kind: "unavailable", exitCode: 1, stdout: "", stderr: r.stderr, saVmEvents: [], saVmViolation: null, durationMs: Date.now() - startedAt };
  }
  if (r.timedOut) {
    return { ok: false, kind: "timeout", exitCode: 124, stdout: "", stderr: r.stderr, saVmEvents: [], saVmViolation: null, durationMs: Date.now() - startedAt };
  }
  if (r.status !== 0) {
    return { ok: false, kind: "sa_error", exitCode: r.status ?? 1, stdout: "", stderr: r.stderr || "git log failed", saVmEvents: [], saVmViolation: null, durationMs: Date.now() - startedAt };
  }
  const commits: Array<{ hash: string; short: string; author: string; date: string; subject: string; body: string }> = [];
  for (const record of r.stdout.split("\x1e")) {
    const t = record.replace(/^[\r\n]+/, "").trim();
    if (!t) continue;
    const parts = t.split("\x01");
    if (parts.length < 5) continue;
    commits.push({
      hash: (parts[0] ?? "").trim(),
      short: (parts[1] ?? "").trim(),
      author: (parts[2] ?? "").trim(),
      date: (parts[3] ?? "").trim(),
      subject: (parts[4] ?? "").trim(),
      body: (parts[5] ?? "").trim()
    });
    if (commits.length >= maxCount) break;
  }
  let out = JSON.stringify({ status: "ok", action: "git_log", repo: repoRoot, revision: rawRev || undefined, count: commits.length, commits, truncated: false }, null, 2);
  if (out.length > maxBytes) {
    out = out.slice(0, maxBytes);
    out += `\n[truncated: showing partial git_log output]`;
  }
  return {
    ok: true,
    kind: "success",
    exitCode: 0,
    stdout: out,
    stderr: r.stderr && /truncated to buffer size/i.test(r.stderr) ? r.stderr : "",
    saVmEvents: [],
    saVmViolation: null,
    durationMs: Date.now() - startedAt
  };
}

export async function nativeHttpFetch(
  url: string,
  method = "GET",
  headers?: Record<string, string>,
  body?: string,
  policy?: SaVmPolicyConfig,
  cwd = process.cwd(),
  startedAt = Date.now(),
  timeoutOpts?: { timeout_ms?: number; timeout?: number }
): Promise<SaVmRunResult> {
  const normalizedPolicy = normalizeSaVmPolicy(policy, cwd);
  const decision = checkSaVmHttp(normalizedPolicy, url, method);
  if (!decision.allowed) {
    return {
      ok: false,
      kind: "capability_denied",
      exitCode: 228,
      stdout: "",
      stderr: decision.reason,
      saVmEvents: [],
      saVmViolation: decision.reason ? { reason: decision.reason } : null,
      durationMs: Date.now() - startedAt
    };
  }
  const timeoutMs = resolveTimeoutMs(timeoutOpts, 15_000);
  try {
    const res = await fetch(url, {
      method,
      headers: headers ?? {},
      body: method === "POST" || method === "PUT" ? body : undefined,
      signal: AbortSignal.timeout(timeoutMs)
    });
    const text = await res.text();
    return {
      ok: res.ok,
      kind: res.ok ? "success" : "sa_error",
      exitCode: res.ok ? 0 : 1,
      stdout: text,
      stderr: res.ok ? "" : `HTTP ${res.status}: ${res.statusText}`,
      saVmEvents: [],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  } catch (err: unknown) {
    const isTimeout = (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError"))
      || String(err).toLowerCase().includes("timeout")
      || String(err).toLowerCase().includes("aborted");
    if (isTimeout) {
      return {
        ok: false,
        kind: "timeout",
        exitCode: 124,
        stdout: "",
        stderr: `http_fetch request timed out after ${timeoutMs}ms`,
        saVmEvents: [],
        saVmViolation: null,
        durationMs: Date.now() - startedAt
      };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      kind: "sa_error",
      exitCode: 1,
      stdout: "",
      stderr: msg,
      saVmEvents: [],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  }
}

// ---------------------------------------------------------------------------
// run_host structured binary executor & in-memory help cache
// ---------------------------------------------------------------------------

export const ALLOWED_HOST_SHORT_NAMES = new Set([
  "bun", "bun.exe",
  "node", "node.exe",
  "python", "python.exe", "python3",
  "zig", "zig.exe",
  "cargo", "cargo.exe",
  "rustc", "rustc.exe",
  "go", "go.exe",
  "git", "git.exe"
]);

export const ALLOWED_CARGO_SUBCOMMANDS = new Set([
  "check", "test", "clippy", "build", "run", "fmt", "version", "bench",
  "--version", "-v", "-V", "--help", "-h", "help"
]);

export const ALLOWED_GO_SUBCOMMANDS = new Set([
  "test", "vet", "build", "version", "env", "fmt", "run",
  "--help", "-h", "help", "version", "--version", "-v"
]);

export const FORBIDDEN_HOST_SUBCOMMANDS = new Set(["publish"]);
export const ALLOWED_HOST_ENV_KEYS = new Set([
  "SA_PLUGIN_DEV",
  "SA_DEV",
  "RUST_BACKTRACE",
  "ZIG_EXE",
  "NO_COLOR",
  "FORCE_COLOR",
  "CI",
  "GIT_TERMINAL_PROMPT",
  "PATH"
]);
const MAX_HOST_ARG_LENGTH = 4096;
const MAX_HOST_TOTAL_ARGS_LENGTH = 32768;

export interface SaVmProcessSession {
  id: string;
  child: ReturnType<typeof spawn>;
  pid: number | undefined;
  exe: string;
  args: string[];
  cwd: string;
  startedAt: number;
  stdoutChunks: string[];
  stderrChunks: string[];
  exitCode: number | null;
  status: "running" | "exited" | "killed" | "timed_out" | "crashed";
  closed: boolean;
  maxBufferBytes: number;
  autoKillTimer?: ReturnType<typeof setTimeout>;
}

export const saVmActiveSessions = new Map<string, SaVmProcessSession>();

interface RunHostCacheEntry {
  stdout: string;
  stderr: string;
  exitCode: number;
  mtimeMs: number;
}

export const runHostHelpCache = new Map<string, RunHostCacheEntry>();
export let runHostProcessSpawnCount = 0;
export let runHostCacheHitCount = 0;

export function resetRunHostCacheForTest(): void {
  runHostHelpCache.clear();
  runHostProcessSpawnCount = 0;
  runHostCacheHitCount = 0;
  for (const session of saVmActiveSessions.values()) {
    if (session.status === "running" && session.pid) {
      try { killProcessTree(session.pid); } catch {}
    }
  }
  saVmActiveSessions.clear();
}

function findInSystemPath(bin: string): string | null {
  const exts = process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  const pathDirs = (process.env.PATH || "").split(delimiter);
  for (const dir of pathDirs) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = join(dir, bin + (bin.toLowerCase().endsWith(ext.toLowerCase()) ? "" : ext));
      try {
        if (existsSync(candidate) && statSync(candidate).isFile()) {
          return candidate;
        }
      } catch {}
    }
  }
  return null;
}

export function resolveHostExecutable(exe: string, cwd: string): { ok: true; path: string; isAllowlist: boolean } | { ok: false; reason: string; kind: "capability_denied" | "unavailable" } {
  const cleanExe = exe.trim();
  if (!cleanExe) {
    return { ok: false, reason: "action 'run_host' requires an 'exe' parameter", kind: "capability_denied" };
  }

  const lower = cleanExe.toLowerCase();
  if (ALLOWED_HOST_SHORT_NAMES.has(lower)) {
    // 1. Environment overrides
    if (lower.startsWith("bun")) {
      const envBun = process.env.CODEX_UI_BUN_BIN?.trim() || process.env.BUN_BIN?.trim();
      if (envBun && existsSync(envBun)) return { ok: true, path: resolve(envBun), isAllowlist: true };
    }
    if (lower.startsWith("zig")) {
      const envZig = process.env.ZIG_EXE?.trim() || process.env.ZIG_BIN?.trim();
      if (envZig && existsSync(envZig)) return { ok: true, path: resolve(envZig), isAllowlist: true };
    }

    // 2. PATH search
    const inPath = findInSystemPath(cleanExe);
    if (inPath) return { ok: true, path: inPath, isAllowlist: true };

    // 3. Known fallback installation paths
    if (process.platform === "win32") {
      const localAppData = process.env.LOCALAPPDATA || "";
      if (lower.startsWith("bun")) {
        const defaultBun = join(localAppData, "Programs", "Bun", "bun.exe");
        if (existsSync(defaultBun)) return { ok: true, path: defaultBun, isAllowlist: true };
      }
      if (lower.startsWith("zig")) {
        const defaultZigCandidates = [
          "D:\\zig-x86_64-windows-0.14.1\\zig.exe",
          join(localAppData, "Programs", "zig", "zig.exe"),
          "C:\\Program Files\\zig\\zig.exe"
        ];
        for (const cand of defaultZigCandidates) {
          if (existsSync(cand)) return { ok: true, path: cand, isAllowlist: true };
        }
      }
      if (lower.startsWith("cargo") || lower.startsWith("rustc")) {
        const userProfile = process.env.USERPROFILE || process.env.HOME || "";
        const defaultCargo = join(userProfile, ".cargo", "bin", lower.endsWith(".exe") ? lower : `${lower}.exe`);
        if (existsSync(defaultCargo)) return { ok: true, path: defaultCargo, isAllowlist: true };
      }
      if (lower.startsWith("go")) {
        const goCandidates = [
          "C:\\Program Files\\Go\\bin\\go.exe",
          join(localAppData, "Programs", "Go", "bin", "go.exe")
        ];
        for (const cand of goCandidates) {
          if (existsSync(cand)) return { ok: true, path: cand, isAllowlist: true };
        }
      }
    } else {
      if (lower.startsWith("cargo") || lower.startsWith("rustc")) {
        const userHome = process.env.HOME || "";
        const defaultCargo = join(userHome, ".cargo", "bin", lower);
        if (existsSync(defaultCargo)) return { ok: true, path: defaultCargo, isAllowlist: true };
      }
    }

    return {
      ok: false,
      reason: `Binary '${cleanExe}' was not found on PATH or standard install locations`,
      kind: "unavailable"
    };
  }

  // Not in allowlist short names: must be workspace-internal path!
  const hasPathSep = cleanExe.includes("/") || cleanExe.includes("\\");
  if (!hasPathSep) {
    return {
      ok: false,
      reason: `exe '${cleanExe}' is not permitted. Only allowlist binaries (bun, node, python, zig, cargo, go, rustc, git) or workspace-internal binaries are allowed.`,
      kind: "capability_denied"
    };
  }

  const resolved = isAbsolute(cleanExe) ? resolve(cleanExe) : resolve(cwd, cleanExe);
  const normalizedCwd = resolve(cwd).replace(/\\/g, "/").toLowerCase();
  const normalizedResolved = resolved.replace(/\\/g, "/").toLowerCase();

  if (!normalizedResolved.startsWith(normalizedCwd + "/") && normalizedResolved !== normalizedCwd) {
    return {
      ok: false,
      reason: `exe '${cleanExe}' is outside permitted workspace roots. Only allowlist binaries (bun, node, python, zig, git) or workspace-internal binaries are allowed.`,
      kind: "capability_denied"
    };
  }

  if (!existsSync(resolved) || !statSync(resolved).isFile()) {
    return {
      ok: false,
      reason: `Workspace executable not found: ${cleanExe}`,
      kind: "unavailable"
    };
  }

  return { ok: true, path: resolved, isAllowlist: false };
}

export function sliceAndFilterOutput(
  rawStdout: string,
  options: {
    filter?: string;
    head_lines?: number;
    tail_lines?: number;
    max_tokens?: number;
    max_token?: number;
  }
): string {
  let lines = rawStdout.split(/\r?\n/);
  // Filter
  if (typeof options.filter === "string" && options.filter.trim()) {
    const f = options.filter.trim();
    let regex: RegExp | null = null;
    try {
      regex = new RegExp(f, "i");
    } catch {
      regex = null;
    }
    if (regex) {
      lines = lines.filter((line) => regex!.test(line));
    } else {
      const lower = f.toLowerCase();
      lines = lines.filter((line) => line.toLowerCase().includes(lower));
    }
  }

  // Slicing
  const head = typeof options.head_lines === "number" && options.head_lines > 0 ? Math.floor(options.head_lines) : undefined;
  const tail = typeof options.tail_lines === "number" && options.tail_lines > 0 ? Math.floor(options.tail_lines) : undefined;

  if (head !== undefined && tail !== undefined) {
    if (head + tail < lines.length) {
      const firstPart = lines.slice(0, head);
      const lastPart = lines.slice(-tail);
      lines = [...firstPart, `... [omitted ${lines.length - head - tail} lines] ...`, ...lastPart];
    }
  } else if (head !== undefined) {
    lines = lines.slice(0, head);
  } else if (tail !== undefined) {
    lines = lines.slice(-tail);
  }

  let result = lines.join("\n");

  // Token budgeting
  const maxTokens = typeof options.max_tokens === "number" && options.max_tokens > 0
    ? options.max_tokens
    : (typeof options.max_token === "number" && options.max_token > 0 ? options.max_token : 4000);
  const maxChars = maxTokens * 4;
  if (result.length > maxChars) {
    result = result.slice(0, maxChars) + `\n[run_host] Output truncated to ${maxTokens} tokens budget.`;
  }

  return result;
}

interface SpawnHostProcessResult {
  ok: boolean;
  kind: "success" | "crashed" | "timeout" | "running";
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  sessionId?: string;
  pid?: number;
}

async function spawnHostProcess(
  bin: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
  startedAt: number,
  yieldTimeMs?: number
): Promise<SpawnHostProcessResult> {
  return new Promise((resolveResult) => {
    let stdout = "";
    let stderr = "";
    let finished = false;

    let child: ReturnType<typeof spawn>;
    try {
      const isCmdOrBat = process.platform === "win32" && (bin.toLowerCase().endsWith(".cmd") || bin.toLowerCase().endsWith(".bat"));
      const spawnBin = isCmdOrBat ? (process.env.COMSPEC || "cmd.exe") : bin;
      const spawnArgs = isCmdOrBat ? ["/d", "/s", "/c", bin, ...args] : args;

      child = spawn(spawnBin, spawnArgs, {
        cwd,
        env,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
        shell: false
      });
    } catch (err) {
      resolveResult({
        ok: false,
        kind: "crashed",
        exitCode: null,
        stdout: "",
        stderr: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - startedAt
      });
      return;
    }

    let yieldTimer: ReturnType<typeof setTimeout> | null = null;
    let overallTimer: ReturnType<typeof setTimeout> | null = null;

    if (typeof yieldTimeMs === "number" && yieldTimeMs > 0) {
      yieldTimer = setTimeout(() => {
        if (finished) return;
        finished = true;
        if (overallTimer) clearTimeout(overallTimer);

        const sessionId = `proc-${randomUUID().slice(0, 8)}`;
        const session: SaVmProcessSession = {
          id: sessionId,
          child,
          pid: child.pid,
          exe: bin,
          args,
          cwd,
          startedAt,
          stdoutChunks: stdout ? [stdout] : [],
          stderrChunks: stderr ? [stderr] : [],
          exitCode: null,
          status: "running",
          closed: false,
          maxBufferBytes: MAX_STDOUT_BYTES
        };
        saVmActiveSessions.set(sessionId, session);

        child.stdout?.on("data", (chunk: Buffer) => {
          session.stdoutChunks.push(chunk.toString("utf8"));
          if (session.stdoutChunks.length > 2000) {
            session.stdoutChunks = [session.stdoutChunks.slice(-1000).join("")];
          }
        });
        child.stderr?.on("data", (chunk: Buffer) => {
          session.stderrChunks.push(chunk.toString("utf8"));
          if (session.stderrChunks.length > 1000) {
            session.stderrChunks = [session.stderrChunks.slice(-500).join("")];
          }
        });
        child.on("close", (code) => {
          session.status = "exited";
          session.exitCode = code;
          session.closed = true;
        });
        child.on("error", (err: Error) => {
          session.status = "crashed";
          session.stderrChunks.push(err.message);
          session.closed = true;
        });

        session.autoKillTimer = setTimeout(() => {
          if (session.status === "running") {
            session.status = "timed_out";
            session.closed = true;
            if (session.pid) {
              try { killProcessTree(session.pid); } catch {}
            }
          }
        }, Math.max(timeoutMs, 60_000));

        resolveResult({
          ok: true,
          kind: "running",
          exitCode: null,
          stdout: stdout.slice(0, MAX_STDOUT_BYTES),
          stderr: stderr.slice(0, MAX_STDERR_BYTES),
          durationMs: Date.now() - startedAt,
          sessionId,
          pid: child.pid
        });
      }, yieldTimeMs);
    }

    overallTimer = setTimeout(() => {
      if (finished) return;
      finished = true;
      if (yieldTimer) clearTimeout(yieldTimer);
      try { killProcessTree(child.pid); } catch {}
      resolveResult({
        ok: false,
        kind: "timeout",
        exitCode: 124,
        stdout: stdout.slice(0, MAX_STDOUT_BYTES),
        stderr: (stderr + `\n[timeout] run_host execution timed out after ${timeoutMs}ms`).trim(),
        durationMs: Date.now() - startedAt
      });
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdout.length < MAX_STDOUT_BYTES) {
        stdout += chunk.toString("utf8");
      }
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < MAX_STDERR_BYTES) {
        stderr += chunk.toString("utf8");
      }
    });

    child.on("error", (err: Error) => {
      if (finished) return;
      finished = true;
      if (yieldTimer) clearTimeout(yieldTimer);
      if (overallTimer) clearTimeout(overallTimer);
      try { killProcessTree(child.pid); } catch {}
      resolveResult({
        ok: false,
        kind: "crashed",
        exitCode: null,
        stdout: stdout.slice(0, MAX_STDOUT_BYTES),
        stderr: err.message,
        durationMs: Date.now() - startedAt
      });
    });

    child.on("close", (code) => {
      if (finished) return;
      finished = true;
      if (yieldTimer) clearTimeout(yieldTimer);
      if (overallTimer) clearTimeout(overallTimer);
      resolveResult({
        ok: code === 0,
        kind: code === 0 ? "success" : "crashed",
        exitCode: code,
        stdout: stdout.slice(0, MAX_STDOUT_BYTES),
        stderr: stderr.slice(0, MAX_STDERR_BYTES),
        durationMs: Date.now() - startedAt
      });
    });
  });
}

// Targeted safety gate for git via run_host: only block destructive history/worktree
// operations (reset --hard, clean, revert). All other git subcommands are allowed.
// Global flags with values (-C/-c/--git-dir/--work-tree/--namespace/--super-prefix/
// --config-env) are skipped so `git -C <path> status` is not misread as subcommand `<path>`.
export function checkGitSafety(args: string[]): { allowed: boolean; reason?: string } {
  let subcommand = "";
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? "";
    if (!a) continue;
    if (a === "--") {
      subcommand = String(args[i + 1] ?? "").toLowerCase();
      break;
    }
    if (a === "-C" || a === "-c") {
      i++;
      continue;
    }
    if ((a.startsWith("-C") && a.length > 2) || (a.startsWith("-c") && a.length > 2)) continue;
    if (
      a.startsWith("--git-dir") ||
      a.startsWith("--work-tree") ||
      a.startsWith("--namespace") ||
      a.startsWith("--super-prefix") ||
      a.startsWith("--config-env")
    ) {
      if (!a.includes("=")) i++;
      continue;
    }
    if (a.startsWith("-")) continue;
    subcommand = a.toLowerCase();
    break;
  }

  if (subcommand === "clean") {
    return {
      allowed: false,
      reason: "Blocked destructive 'git clean': permanently deletes untracked files. Use safe_delete for specific file removal."
    };
  }
  if (subcommand === "revert") {
    return {
      allowed: false,
      reason: "Blocked 'git revert': modifying git history via revert is prohibited by safety policy."
    };
  }
  if (subcommand === "reset") {
    const isHard = args.some((x) => {
      const t = String(x ?? "").trim().toLowerCase();
      return t === "--hard" || t.startsWith("--hard=");
    });
    if (isHard) {
      return {
        allowed: false,
        reason: "Blocked destructive 'git reset --hard': permanently discards uncommitted worktree changes."
      };
    }
  }
  return { allowed: true };
}

export async function nativeRunHost(
  rawInput: SaVmRunInput,
  policy: SaVmPolicyConfig | undefined,
  cwd: string,
  startedAt: number
): Promise<SaVmRunResult> {
  const exe = typeof rawInput.exe === "string" ? rawInput.exe.trim() : "";
  if (!exe) {
    return {
      ok: false,
      kind: "capability_denied",
      exitCode: 228,
      stdout: "",
      stderr: "action 'run_host' requires an 'exe' parameter",
      saVmEvents: [{ event: "violation", kind: "capability_denied", reason: "action 'run_host' requires an 'exe' parameter" }],
      saVmViolation: { rule: "process.run_host.exe_required", blocked: true },
      durationMs: Date.now() - startedAt
    };
  }
  const rawArgs = Array.isArray(rawInput.args) ? rawInput.args : [];
  const args: string[] = rawArgs.map((a) => (typeof a === "string" ? a : String(a)));
  const lowerExe = exe.toLowerCase();

  if (lowerExe.startsWith("cargo")) {
    const firstSub = args.find((a) => !a.startsWith("-"))?.toLowerCase() || (args.length === 0 ? "--help" : "");
    const isVersionOrHelp = args.some((a) => a === "--version" || a === "-V" || a === "-v" || a === "--help" || a === "-h" || a === "help");
    if (!isVersionOrHelp && firstSub && !ALLOWED_CARGO_SUBCOMMANDS.has(firstSub)) {
      return {
        ok: false,
        kind: "capability_denied",
        exitCode: 228,
        stdout: "",
        stderr: `Cargo subcommand '${firstSub}' is not permitted. Permitted subcommands: ${Array.from(ALLOWED_CARGO_SUBCOMMANDS).join(", ")}`,
        saVmEvents: [{ event: "violation", kind: "capability_denied", reason: `Cargo subcommand '${firstSub}' is not permitted.` }],
        saVmViolation: { rule: "process.run_host.cargo_subcommand", blocked: true },
        durationMs: Date.now() - startedAt
      };
    }
  }

  if (lowerExe.startsWith("go")) {
    const firstSub = args.find((a) => !a.startsWith("-"))?.toLowerCase() || (args.length === 0 ? "help" : "");
    const isVersionOrHelp = args.some((a) => a === "--version" || a === "-v" || a === "version" || a === "--help" || a === "-h" || a === "help");
    if (!isVersionOrHelp && firstSub && !ALLOWED_GO_SUBCOMMANDS.has(firstSub)) {
      return {
        ok: false,
        kind: "capability_denied",
        exitCode: 228,
        stdout: "",
        stderr: `Go subcommand '${firstSub}' is not permitted. Permitted subcommands: ${Array.from(ALLOWED_GO_SUBCOMMANDS).join(", ")}`,
        saVmEvents: [{ event: "violation", kind: "capability_denied", reason: `Go subcommand '${firstSub}' is not permitted.` }],
        saVmViolation: { rule: "process.run_host.go_subcommand", blocked: true },
        durationMs: Date.now() - startedAt
      };
    }
  }

  const resolution = resolveHostExecutable(exe, cwd);
  if (!resolution.ok) {
    return {
      ok: false,
      kind: resolution.kind,
      exitCode: resolution.kind === "capability_denied" ? 228 : 1,
      stdout: "",
      stderr: resolution.reason,
      saVmEvents: [{ event: "violation", kind: resolution.kind, reason: resolution.reason }],
      saVmViolation: resolution.kind === "capability_denied" ? { rule: "process.run_host.unauthorized_executable", blocked: true } : null,
      durationMs: Date.now() - startedAt
    };
  }
  const resolvedExe = resolution.path;

  // CWD validation
  const targetCwd = typeof rawInput.cwd === "string" && rawInput.cwd.trim()
    ? resolve(cwd, rawInput.cwd.trim())
    : cwd;
  const normalizedBase = resolve(cwd).replace(/\\/g, "/").toLowerCase();
  const normalizedRequested = targetCwd.replace(/\\/g, "/").toLowerCase();
  if (!normalizedRequested.startsWith(normalizedBase + "/") && normalizedRequested !== normalizedBase) {
    return {
      ok: false,
      kind: "capability_denied",
      exitCode: 228,
      stdout: "",
      stderr: `cwd '${rawInput.cwd}' is outside permitted workspace roots`,
      saVmEvents: [{ event: "violation", kind: "capability_denied", reason: `cwd '${rawInput.cwd}' is outside permitted workspace roots` }],
      saVmViolation: { rule: "fs.cwd_outside_workspace", blocked: true },
      durationMs: Date.now() - startedAt
    };
  }

  // Args validation

  for (const arg of args) {
    if (arg.length > MAX_HOST_ARG_LENGTH) {
      return {
        ok: false,
        kind: "capability_denied",
        exitCode: 228,
        stdout: "",
        stderr: `Argument exceeds maximum allowed length of ${MAX_HOST_ARG_LENGTH} characters`,
        saVmEvents: [{ event: "violation", kind: "capability_denied", reason: `Argument exceeds maximum allowed length of ${MAX_HOST_ARG_LENGTH} characters` }],
        saVmViolation: { rule: "process.run_host.max_arg_length", blocked: true },
        durationMs: Date.now() - startedAt
      };
    }
  }

  const totalArgsLength = args.reduce((sum, a) => sum + a.length, 0);
  if (totalArgsLength > MAX_HOST_TOTAL_ARGS_LENGTH) {
    return {
      ok: false,
      kind: "capability_denied",
      exitCode: 228,
      stdout: "",
      stderr: `Total arguments length exceeds maximum allowed limit of ${MAX_HOST_TOTAL_ARGS_LENGTH} characters`,
      saVmEvents: [{ event: "violation", kind: "capability_denied", reason: `Total arguments length exceeds maximum allowed limit of ${MAX_HOST_TOTAL_ARGS_LENGTH} characters` }],
      saVmViolation: { rule: "process.run_host.max_total_args_length", blocked: true },
      durationMs: Date.now() - startedAt
    };
  }

  // R5 bypass governance: block python -c / bun -e git passthrough + .git internals before spawn
  {
    const joined = args.join('\n');
    const exeLower = exe.toLowerCase();
    const isScriptHost = /^python[\d.]*(\.exe)?$/.test(exeLower)
      || exeLower === 'node' || exeLower === 'node.exe' || exeLower === 'bun' || exeLower === 'bun.exe';
    if (isScriptHost) {
      const hasGitToken = /\bgit\b/i.test(joined);
      const hasSpawnShim = /subprocess|spawnSync|\.spawn\s*\(|execSync|exec\s*\(|child_process/i.test(joined);
      const isInlineEval = args.some((a) => {
        const t = a.trim();
        return t === '-c' || t === '-e' || t === '--eval' || t === '--execute';
      });
      const readsGitInternals = /\.git\s*\/\s*(?:HEAD|config|index|refs|objects|FETCH_HEAD)/i.test(joined)
        || args.some((a) => /(?:^|[\/\\])\.git(?:[\/\\]|$)/i.test(a.trim()));
      if ((hasGitToken && (hasSpawnShim || isInlineEval)) || readsGitInternals) {
        const reason = readsGitInternals && !hasGitToken
          ? `run_host bypass blocked: reading .git/* internals is prohibited; use sa_vm git_status/git_diff instead.`
          : `run_host bypass blocked: invoking git via ${exe} -c/-e subprocess/spawn is prohibited; use sa_vm git_status for worktree cleanliness or sa_vm git_diff for uncommitted changes instead.`;
        return {
          ok: false,
          kind: "capability_denied" as const,
          exitCode: 228,
          stdout: "",
          stderr: reason,
          saVmEvents: [{ event: "violation", kind: "capability_denied", reason }],
          saVmViolation: { rule: "process.run_host.git_bypass_blocked", blocked: true },
          durationMs: Date.now() - startedAt
        };
      }
    }
  }

  // Destructive-git guard belongs to the VM safe sandbox (shield toggle), not to
  // the enhance tools: it only applies when exec interception is enabled
  // (tools.replaceExec). When the sandbox is off the terminal is fully open, so
  // blocking here would be both pointless and a tools/safety confusion.
  if ((lowerExe === "git" || lowerExe === "git.exe") && policy?.tools?.replaceExec === true) {
    const gitCheck = checkGitSafety(args);
    if (!gitCheck.allowed) {
      return {
        ok: false,
        kind: "capability_denied",
        exitCode: 228,
        stdout: "",
        stderr: gitCheck.reason ?? "Blocked destructive git command by safety policy.",
        saVmEvents: [{ event: "violation", kind: "capability_denied", reason: gitCheck.reason ?? "Blocked destructive git command." }],
        saVmViolation: { rule: "process.run_host.git_destructive_blocked", blocked: true },
        durationMs: Date.now() - startedAt
      };
    }
  }

  for (const arg of args) {
    const lowerArg = arg.toLowerCase().trim();
    if (FORBIDDEN_HOST_SUBCOMMANDS.has(lowerArg)) {
      return {
        ok: false,
        kind: "capability_denied",
        exitCode: 228,
        stdout: "",
        stderr: `Subcommand '${arg}' is forbidden in run_host`,
        saVmEvents: [{ event: "violation", kind: "capability_denied", reason: `Subcommand '${arg}' is forbidden in run_host` }],
        saVmViolation: { rule: "process.run_host.denied_subcommand", blocked: true },
        durationMs: Date.now() - startedAt
      };
    }
  }

  // Env validation
  if (rawInput.env && typeof rawInput.env === "object" && !Array.isArray(rawInput.env)) {
    for (const key of Object.keys(rawInput.env)) {
      if (!ALLOWED_HOST_ENV_KEYS.has(key)) {
        return {
          ok: false,
          kind: "capability_denied",
          exitCode: 228,
          stdout: "",
          stderr: `Environment variable '${key}' is not in the run_host allowlist`,
          saVmEvents: [{ event: "violation", kind: "capability_denied", reason: `Environment variable '${key}' is not in the run_host allowlist` }],
          saVmViolation: { rule: "process.run_host.env_not_allowed", blocked: true },
          durationMs: Date.now() - startedAt
        };
      }
    }
  }

  // Check help / version cache
  const isHelpOrVersion = args.some((a) =>
    a === "--help" || a === "-h" || a === "help" ||
    a === "--version" || a === "-v" || a === "version"
  );

  let exeMtime = 0;
  try {
    exeMtime = statSync(resolvedExe).mtimeMs;
  } catch {}

  const cacheKey = `${resolvedExe}:::${exeMtime}:::${args.join(" ")}`;
  if (isHelpOrVersion) {
    const cached = runHostHelpCache.get(cacheKey);
    if (cached && cached.mtimeMs === exeMtime) {
      runHostCacheHitCount++;
      const outputToSlice = cached.stdout || cached.stderr;
      const slicedStdout = sliceAndFilterOutput(outputToSlice, rawInput);
      return {
        ok: cached.exitCode === 0,
        kind: cached.exitCode === 0 ? "success" : "crashed",
        exitCode: cached.exitCode,
        stdout: slicedStdout,
        stderr: cached.stderr,
        saVmEvents: [{ event: "host_execution", exe, args, cwd: targetCwd, exitCode: cached.exitCode, durationMs: 0, cached: true }],
        saVmViolation: null,
        durationMs: 0
      };
    }
  }

  // Execute process
  runHostProcessSpawnCount++;
  const timeoutMs = resolveTimeoutMs(rawInput, 30_000);
  const yieldTimeMs = typeof rawInput.yield_time_ms === "number" && rawInput.yield_time_ms > 0
    ? rawInput.yield_time_ms
    : (typeof rawInput.yield_ms === "number" && rawInput.yield_ms > 0
      ? rawInput.yield_ms
      : (typeof rawInput.yieldTimeMs === "number" && rawInput.yieldTimeMs > 0 ? rawInput.yieldTimeMs : undefined));

  const runnerEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...(rawInput.env && typeof rawInput.env === "object" && !Array.isArray(rawInput.env) ? rawInput.env as Record<string, string> : {})
  };

  const execResult = await spawnHostProcess(resolvedExe, args, targetCwd, runnerEnv, timeoutMs, startedAt, yieldTimeMs);

  if (execResult.kind === "running") {
    const outputToSlice = execResult.stdout || execResult.stderr;
    const finalStdout = sliceAndFilterOutput(outputToSlice, rawInput);
    return {
      ok: true,
      kind: "running",
      exitCode: null,
      session_id: execResult.sessionId,
      sessionId: execResult.sessionId,
      pid: execResult.pid,
      stdout: finalStdout,
      stderr: execResult.stderr,
      message: `Process is still running after ${yieldTimeMs}ms. Managed under session '${execResult.sessionId}'. Use action 'write_stdin' to send input, 'session_status' to poll output, or 'kill_session' to stop it.`,
      saVmEvents: [{
        event: "host_execution",
        exe,
        args,
        cwd: targetCwd,
        exitCode: null,
        durationMs: execResult.durationMs,
        cached: false,
        sessionId: execResult.sessionId
      }],
      saVmViolation: null,
      durationMs: execResult.durationMs
    };
  }

  if (execResult.ok && isHelpOrVersion) {
    runHostHelpCache.set(cacheKey, {
      stdout: execResult.stdout,
      stderr: execResult.stderr,
      exitCode: execResult.exitCode ?? 0,
      mtimeMs: exeMtime
    });
  }

  const outputToSlice = execResult.stdout || execResult.stderr;
  const finalStdout = sliceAndFilterOutput(outputToSlice, rawInput);

  return {
    ok: execResult.ok,
    kind: execResult.kind,
    exitCode: execResult.exitCode,
    stdout: finalStdout,
    stderr: execResult.stderr,
    saVmEvents: [{
      event: "host_execution",
      exe,
      args,
      cwd: targetCwd,
      exitCode: execResult.exitCode,
      durationMs: execResult.durationMs,
      cached: false
    }],
    saVmViolation: null,
    durationMs: execResult.durationMs
  };
}

// ---------------------------------------------------------------------------
// Process Session Management (P0) & Local Checkpoints (P2)
// ---------------------------------------------------------------------------

export function nativeWriteStdin(
  rawInput: SaVmRunInput,
  _cwd: string,
  startedAt: number
): SaVmRunResult {
  const sessionId = typeof rawInput.session_id === "string" ? rawInput.session_id.trim()
    : (typeof rawInput.session === "string" ? rawInput.session.trim()
      : (typeof rawInput.sessionId === "string" ? rawInput.sessionId.trim() : ""));
  if (!sessionId) {
    return {
      ok: false,
      kind: "sa_error",
      exitCode: 1,
      stdout: "",
      stderr: "action 'write_stdin' requires a 'session_id' parameter",
      saVmEvents: [],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  }

  const session = saVmActiveSessions.get(sessionId);
  if (!session) {
    return {
      ok: false,
      kind: "sa_error",
      exitCode: 1,
      stdout: "",
      stderr: `Session '${sessionId}' not found or already terminated`,
      saVmEvents: [],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  }

  if (session.status !== "running") {
    return {
      ok: false,
      kind: "sa_error",
      exitCode: session.exitCode ?? 1,
      stdout: "",
      stderr: `Session '${sessionId}' is not running (status: ${session.status})`,
      saVmEvents: [],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  }

  const input = typeof rawInput.input === "string"
    ? rawInput.input
    : (typeof rawInput.content === "string"
      ? rawInput.content
      : (typeof (rawInput as any).text === "string" ? (rawInput as any).text : ""));

  const closeStdin = Boolean(rawInput.close_stdin || (rawInput as any).eof || (rawInput as any).close);

  try {
    if (session.child.stdin && !session.child.stdin.destroyed && session.child.stdin.writable) {
      if (input) {
        session.child.stdin.write(input, "utf8");
      }
      if (closeStdin) {
        session.child.stdin.end();
      }
    } else {
      return {
        ok: false,
        kind: "sa_error",
        exitCode: 1,
        stdout: "",
        stderr: `Session '${sessionId}' stdin is not writable or already closed`,
        saVmEvents: [],
        saVmViolation: null,
        durationMs: Date.now() - startedAt
      };
    }
  } catch (err) {
    return {
      ok: false,
      kind: "crashed",
      exitCode: 1,
      stdout: "",
      stderr: `Failed to write stdin: ${err instanceof Error ? err.message : String(err)}`,
      saVmEvents: [],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  }

  return {
    ok: true,
    action: "write_stdin",
    kind: "success",
    exitCode: null,
    session_id: sessionId,
    sessionId: sessionId,
    stdout: "",
    stderr: "",
    message: `Wrote ${Buffer.byteLength(input, "utf8")} bytes to stdin of session '${sessionId}'${closeStdin ? " (stdin closed)" : ""}`,
    saVmEvents: [{ event: "stdin_write", sessionId, bytes: Buffer.byteLength(input, "utf8"), closed: closeStdin }],
    saVmViolation: null,
    durationMs: Date.now() - startedAt
  };
}

export function nativeSessionStatus(
  rawInput: SaVmRunInput,
  _cwd: string,
  startedAt: number
): SaVmRunResult {
  const sessionId = typeof rawInput.session_id === "string" ? rawInput.session_id.trim()
    : (typeof rawInput.session === "string" ? rawInput.session.trim()
      : (typeof rawInput.sessionId === "string" ? rawInput.sessionId.trim() : ""));
  if (!sessionId) {
    return {
      ok: false,
      kind: "sa_error",
      exitCode: 1,
      stdout: "",
      stderr: "action 'session_status' requires a 'session_id' parameter",
      saVmEvents: [],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  }

  const session = saVmActiveSessions.get(sessionId);
  if (!session) {
    return {
      ok: false,
      kind: "sa_error",
      exitCode: 1,
      stdout: "",
      stderr: `Session '${sessionId}' not found`,
      saVmEvents: [],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  }

  const rawStdout = session.stdoutChunks.join("");
  const rawStderr = session.stderrChunks.join("");

  const drain = Boolean(rawInput.drain || (rawInput as any).clear);
  if (drain) {
    session.stdoutChunks = [];
    session.stderrChunks = [];
  }

  const slicedStdout = sliceAndFilterOutput(rawStdout, rawInput);

  return {
    ok: session.status !== "crashed" && session.status !== "timed_out",
    kind: session.status === "running" ? "running" : (session.status === "exited" && session.exitCode === 0 ? "success" : "crashed"),
    exitCode: session.exitCode,
    session_id: sessionId,
    sessionId: sessionId,
    status: session.status,
    pid: session.pid,
    stdout: slicedStdout,
    stderr: rawStderr,
    message: `Session '${sessionId}' is ${session.status}${session.exitCode !== null ? ` (exit code: ${session.exitCode})` : ""}`,
    saVmEvents: [{ event: "session_status", sessionId, status: session.status, exitCode: session.exitCode }],
    saVmViolation: null,
    durationMs: Date.now() - startedAt
  };
}

export function nativeKillSession(
  rawInput: SaVmRunInput,
  _cwd: string,
  startedAt: number
): SaVmRunResult {
  const sessionId = typeof rawInput.session_id === "string" ? rawInput.session_id.trim()
    : (typeof rawInput.session === "string" ? rawInput.session.trim()
      : (typeof rawInput.sessionId === "string" ? rawInput.sessionId.trim() : ""));
  if (!sessionId) {
    return {
      ok: false,
      kind: "sa_error",
      exitCode: 1,
      stdout: "",
      stderr: "action 'kill_session' requires a 'session_id' parameter",
      saVmEvents: [],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  }

  const session = saVmActiveSessions.get(sessionId);
  if (!session) {
    return {
      ok: false,
      kind: "sa_error",
      exitCode: 1,
      stdout: "",
      stderr: `Session '${sessionId}' not found`,
      saVmEvents: [],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  }

  if (session.status === "running") {
    if (session.autoKillTimer) clearTimeout(session.autoKillTimer);
    try {
      if (session.pid) killProcessTree(session.pid);
    } catch {}
    session.status = "killed";
    session.closed = true;
    session.exitCode = 137;
  }

  return {
    ok: true,
    action: "kill_session",
    kind: "success",
    exitCode: session.exitCode,
    session_id: sessionId,
    sessionId: sessionId,
    status: session.status,
    stdout: "",
    stderr: "",
    message: `Session '${sessionId}' terminated.`,
    saVmEvents: [{ event: "session_killed", sessionId, pid: session.pid }],
    saVmViolation: null,
    durationMs: Date.now() - startedAt
  };
}

export function nativeListSessions(
  startedAt: number
): SaVmRunResult {
  const sessions = Array.from(saVmActiveSessions.values()).map((s) => ({
    id: s.id,
    pid: s.pid,
    exe: s.exe,
    status: s.status,
    exitCode: s.exitCode,
    startedAt: s.startedAt,
    durationMs: Date.now() - s.startedAt
  }));

  return {
    ok: true,
    action: "list_sessions",
    kind: "success",
    exitCode: 0,
    stdout: JSON.stringify({ sessions }, null, 2),
    stderr: "",
    saVmEvents: [{ event: "list_sessions", count: sessions.length }],
    saVmViolation: null,
    durationMs: Date.now() - startedAt
  };
}

export function nativeLocalCheckpoint(
  rawInput: SaVmRunInput,
  cwd: string,
  startedAt: number
): SaVmRunResult {
  const targetCwd = typeof rawInput.cwd === "string" && rawInput.cwd.trim()
    ? resolve(cwd, rawInput.cwd.trim())
    : cwd;
  const repoRoot = findGitRepoRoot(targetCwd, cwd);
  if (!repoRoot) {
    return {
      ok: false,
      kind: "sa_error",
      exitCode: 1,
      stdout: "",
      stderr: "Cannot create local checkpoint: no git repository found in workspace.",
      saVmEvents: [],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  }

  const timeoutMs = resolveTimeoutMs(rawInput, 30_000);

  const statusRes = execGitSync(repoRoot, ["status", "--porcelain=v1"], timeoutMs);
  if (statusRes.status !== 0) {
    return {
      ok: false,
      kind: "sa_error",
      exitCode: statusRes.status,
      stdout: statusRes.stdout,
      stderr: statusRes.stderr || "git status failed",
      saVmEvents: [],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  }

  if (!statusRes.stdout.trim()) {
    const headRes = execGitSync(repoRoot, ["rev-parse", "HEAD"], 5_000);
    const commitSha = headRes.stdout.trim();
    return {
      ok: true,
      kind: "success",
      exitCode: 0,
      stdout: JSON.stringify({ action: "local_checkpoint", created: false, commit: commitSha, message: "Working tree is clean; nothing to checkpoint." }, null, 2),
      stderr: "",
      commit: commitSha,
      created: false,
      saVmEvents: [{ event: "local_checkpoint", created: false, commit: commitSha }],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  }

  const addRes = execGitSync(repoRoot, ["add", "-A"], timeoutMs);
  if (addRes.status !== 0) {
    return {
      ok: false,
      kind: "sa_error",
      exitCode: addRes.status,
      stdout: addRes.stdout,
      stderr: addRes.stderr || "git add failed",
      saVmEvents: [],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  }

  const userMsg = typeof rawInput.message === "string" && rawInput.message.trim()
    ? rawInput.message.trim()
    : (typeof rawInput.content === "string" && rawInput.content.trim() ? rawInput.content.trim() : "local checkpoint");
  const commitMsg = `[sa_vm checkpoint] ${userMsg}`;

  const commitRes = execGitSync(repoRoot, ["commit", "-m", commitMsg, "--no-verify", "--no-gpg-sign"], timeoutMs);
  if (commitRes.status !== 0) {
    return {
      ok: false,
      kind: "sa_error",
      exitCode: commitRes.status,
      stdout: commitRes.stdout,
      stderr: commitRes.stderr || "git commit failed",
      saVmEvents: [],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  }

  const headRes = execGitSync(repoRoot, ["rev-parse", "HEAD"], 5_000);
  const commitSha = headRes.stdout.trim();

  return {
    ok: true,
    kind: "success",
    exitCode: 0,
    stdout: JSON.stringify({ action: "local_checkpoint", created: true, commit: commitSha, message: commitMsg }, null, 2),
    stderr: "",
    commit: commitSha,
    created: true,
    saVmEvents: [{ event: "local_checkpoint", created: true, commit: commitSha, message: commitMsg }],
    saVmViolation: null,
    durationMs: Date.now() - startedAt
  };
}

export function nativeRestoreCheckpoint(
  rawInput: SaVmRunInput,
  cwd: string,
  startedAt: number
): SaVmRunResult {
  const targetCwd = typeof rawInput.cwd === "string" && rawInput.cwd.trim()
    ? resolve(cwd, rawInput.cwd.trim())
    : cwd;
  const repoRoot = findGitRepoRoot(targetCwd, cwd);
  if (!repoRoot) {
    return {
      ok: false,
      kind: "sa_error",
      exitCode: 1,
      stdout: "",
      stderr: "Cannot restore checkpoint: no git repository found in workspace.",
      saVmEvents: [],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  }

  const commit = typeof rawInput.commit === "string" ? rawInput.commit.trim()
    : (typeof (rawInput as any).sha === "string" ? (rawInput as any).sha.trim()
      : (typeof rawInput.target === "string" ? rawInput.target.trim() : ""));

  if (!commit) {
    return {
      ok: false,
      kind: "sa_error",
      exitCode: 1,
      stdout: "",
      stderr: "action 'restore_checkpoint' requires a 'commit' (SHA) parameter",
      saVmEvents: [],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  }

  if (!/^[a-zA-Z0-9_\-./~^]+$/.test(commit) || commit.startsWith("-")) {
    return {
      ok: false,
      kind: "capability_denied",
      exitCode: 228,
      stdout: "",
      stderr: `Invalid commit identifier format: '${commit}'`,
      saVmEvents: [{ event: "violation", kind: "capability_denied", reason: "Invalid commit identifier" }],
      saVmViolation: { rule: "git.checkpoint.invalid_commit", blocked: true },
      durationMs: Date.now() - startedAt
    };
  }

  const verifyRes = execGitSync(repoRoot, ["rev-parse", "--verify", `${commit}^{commit}`], 5_000);
  if (verifyRes.status !== 0) {
    return {
      ok: false,
      kind: "sa_error",
      exitCode: 1,
      stdout: "",
      stderr: `Checkpoint commit '${commit}' was not found in local git history.`,
      saVmEvents: [],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  }

  const resolvedSha = verifyRes.stdout.trim();
  const timeoutMs = resolveTimeoutMs(rawInput, 30_000);
  const resetRes = execGitSync(repoRoot, ["reset", "--hard", resolvedSha], timeoutMs);
  if (resetRes.status !== 0) {
    return {
      ok: false,
      kind: "sa_error",
      exitCode: resetRes.status,
      stdout: resetRes.stdout,
      stderr: resetRes.stderr || "git reset --hard failed",
      saVmEvents: [],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  }

  return {
    ok: true,
    kind: "success",
    exitCode: 0,
    stdout: JSON.stringify({ action: "restore_checkpoint", commit: resolvedSha, message: `Successfully restored local git checkpoint ${resolvedSha.slice(0, 8)}.` }, null, 2),
    stderr: "",
    commit: resolvedSha,
    saVmEvents: [{ event: "restore_checkpoint", commit: resolvedSha }],
    saVmViolation: null,
    durationMs: Date.now() - startedAt
  };
}

// ---------------------------------------------------------------------------
// Batch dependency violation detection for parallel execution
// ---------------------------------------------------------------------------

function extractTaskDependencies(task: SaVmRunInput, cwd: string): { writtenPaths: string[]; readPaths: string[] } {
  const writtenPaths: string[] = [];
  const readPaths: string[] = [];
  const rawAction = typeof task.action === "string" ? task.action.trim().toLowerCase() : "";
  const targetPath = (typeof task.path === "string" && task.path.trim())
    || (typeof task.file === "string" && task.file.trim())
    || (typeof task.target === "string" && task.target.trim())
    || "";
  // No-action fallback (non-throwing sniff): without this, dependency guard is
  // blind to {path,old_text}/{path,content} tasks that WILL write at dispatch.
  const taskRec = task as Record<string, unknown>;
  const sniffed = !rawAction && !task.source && targetPath
    ? (["old_text", "oldText", "old_string", "oldString", "old"].some((k) => typeof taskRec[k] === "string")
      ? "edit_file"
      : (typeof task.patch === "string" || typeof taskRec["diff"] === "string")
        ? "apply_patch"
        : (task.content !== undefined || ["contents", "text", "body", "data"].some((k) => taskRec[k] !== undefined))
          ? "write_file"
          : "read_file")
    : "";
  const action = rawAction || sniffed;

  const normalize = (p: string): string => {
    const abs = isAbsolute(p) ? resolve(p) : resolve(cwd, p);
    return abs.replace(/\\/g, "/").toLowerCase();
  };

  // Write actions
  if (action === "write_file" || action === "write") {
    if (targetPath) writtenPaths.push(normalize(targetPath));
  } else if (action === "edit_file" || action === "edit") {
    if (targetPath) writtenPaths.push(normalize(targetPath));
  } else if (action === "delete_file" || action === "delete" || action === "safe_delete" || action === "remove_file") {
    if (targetPath) writtenPaths.push(normalize(targetPath));
  } else if (action === "copy_file" || action === "copy" || action === "move_file" || action === "move" || action === "rename" || action === "rename_file") {
    const dest = (typeof task.to === "string" && task.to.trim()) || (typeof task.dest === "string" && task.dest.trim()) || "";
    if (dest) writtenPaths.push(normalize(dest));
    const from = (typeof task.from === "string" && task.from.trim()) || (typeof task.source === "string" && task.source.trim()) || "";
    if (from) readPaths.push(normalize(from));
  } else if (action === "extract_to_file" || action === "extract_file" || action === "extract_module" || action === "extract_component" || action === "extract_hook") {
    const src = (typeof task.source === "string" && task.source.trim()) || (typeof task.from === "string" && task.from.trim()) || "";
    const tgt = (typeof task.target === "string" && task.target.trim()) || (typeof task.to === "string" && task.to.trim()) || "";
    if (src) {
      writtenPaths.push(normalize(src));
      readPaths.push(normalize(src));
    }
    if (tgt) writtenPaths.push(normalize(tgt));
  } else if (action === "add_import" || action === "insert_import" || action === "organize_imports" || action === "clean_unused_imports" || action === "sort_imports" || action === "auto_fix_missing_imports" || action === "fix_missing_imports") {
    if (targetPath) writtenPaths.push(normalize(targetPath));
  } else if (action === "rename_symbol" || action === "symbol_rename") {
    // In-place rewrite: path single file, dir whole tree, files/candidates lists.
    if (targetPath) writtenPaths.push(normalize(targetPath));
    const dirScope = (typeof task.dir === "string" && task.dir.trim()) || "";
    if (dirScope) writtenPaths.push(normalize(dirScope));
    for (const key of ["files", "candidate_files"] as const) {
      const list = (task as Record<string, unknown>)[key];
      if (Array.isArray(list)) {
        for (const f of list) {
          if (typeof f === "string" && f.trim()) writtenPaths.push(normalize(f.trim()));
        }
      }
    }
  } else if (action === "move_file_with_imports" || action === "move_with_imports") {
    const from = (typeof task.from === "string" && task.from.trim()) || (typeof task.source === "string" && task.source.trim()) || (typeof task.path === "string" && task.path.trim()) || "";
    const to = (typeof task.to === "string" && task.to.trim()) || (typeof task.dest === "string" && task.dest.trim()) || "";
    if (from) { writtenPaths.push(normalize(from)); readPaths.push(normalize(from)); }
    if (to) writtenPaths.push(normalize(to));
  } else if (action === "ensure_dir" || action === "mkdir") {
    const dirPath = (typeof task.dir === "string" && task.dir.trim()) || targetPath;
    if (dirPath) writtenPaths.push(normalize(dirPath));
  } else if (action === "apply_patch" || action === "patch") {
    if (typeof task.patch === "string") {
      const patchLines = task.patch.split(/\r?\n/);
      for (const line of patchLines) {
        const m = /^\*\*\*\s*(?:Add File|Update File|Delete File):\s*(.+)$/.exec(line);
        if (m && m[1]) writtenPaths.push(normalize(m[1].trim()));
      }
    }
  } else if (action === "split_plan") {
    if (targetPath) readPaths.push(normalize(targetPath));
  } else if (action === "split_stage" || action === "split_refine" || action === "split_repair") {
    const ops = (task as Record<string, unknown>).ops ?? (task as Record<string, unknown>).tasks;
    if (Array.isArray(ops)) {
      for (const op of ops) {
        if (op && typeof op === "object" && typeof (op as Record<string, unknown>).path === "string") {
          const p = String((op as Record<string, unknown>).path).trim();
          if (p) writtenPaths.push(normalize(p));
        }
      }
    }
    if (targetPath) writtenPaths.push(normalize(targetPath));
  } else if (action === "split_status") {
    // manifest read only: no worktree paths to guard.
  } else if (action === "run_host" || action === "exec_host" || action === "host") {
    const args = Array.isArray(task.args) ? task.args.map(String) : [];
    const explicitOut = (typeof (task as any).output === "string" && (task as any).output.trim())
      || (typeof (task as any).output_file === "string" && (task as any).output_file.trim())
      || "";
    if (explicitOut) writtenPaths.push(normalize(explicitOut));

    for (let i = 0; i < args.length; i++) {
      const arg = args[i]!;
      if (arg === "-o" || arg === "--output") {
        if (i + 1 < args.length && !args[i + 1]!.startsWith("-")) {
          writtenPaths.push(normalize(args[i + 1]!));
        }
      } else if (arg.startsWith("-o=") || arg.startsWith("--output=")) {
        const val = arg.split("=")[1];
        if (val) writtenPaths.push(normalize(val));
      } else if (arg.startsWith("-femit-bin=")) {
        const val = arg.split("=")[1];
        if (val) writtenPaths.push(normalize(val));
      } else if (arg.startsWith("-femit-implib=")) {
        const val = arg.split("=")[1];
        if (val) writtenPaths.push(normalize(val));
      } else if (arg.startsWith("--out-dir=")) {
        const val = arg.split("=")[1];
        if (val) writtenPaths.push(normalize(val));
      }
    }

    if (args.some((a) => ["build", "compile", "build-exe", "build-obj", "build-lib"].includes(a.toLowerCase()))) {
      for (const arg of args) {
        if (/\.(?:exe|bin|out|wasm|obj|o)$/i.test(arg) && !/\.(?:sa|sla|zig|c|cpp|rs|ts|js)$/i.test(arg)) {
          writtenPaths.push(normalize(arg));
        }
      }
    }
  }

  // Read actions
  if (
    action === "read_file" || action === "read" ||
    action === "read_lines" || action === "read_many" ||
    action === "read_file_tail" || action === "tail_file" || action === "tail" ||
    action === "count_lines" || action === "line_count" ||
    action === "file_info" || action === "test_path" || action === "file_exists" || action === "exists" || action === "stat" ||
    action === "get_diagnostics" || action === "diagnostics" || action === "check_syntax" || action === "workspace_diagnostics" ||
    action === "file_outline" || action === "outline" || action === "workspace_outline" || action === "repo_map" ||
    action === "find_files" || action === "find" || action === "list_files" || action === "list_dir" ||
    action === "find_references" || action === "find_all_references" || action === "find_implementations" || action === "find_impl" ||
    action === "find_definition" || action === "goto_definition" || action === "def" ||
    action === "analyze_scope" || action === "scope_analysis" ||
    action === "code_graph" || action === "relation_graph" || action === "symbol_graph"
  ) {
    if (targetPath) readPaths.push(normalize(targetPath));
    const dirScope = (typeof task.dir === "string" && task.dir.trim()) || "";
    if (dirScope) readPaths.push(normalize(dirScope));
    // read_many takes files[] instead of path.
    const fileList = (task as Record<string, unknown>).files;
    if (Array.isArray(fileList)) {
      for (const f of fileList) {
        if (typeof f === "string" && f.trim()) readPaths.push(normalize(f.trim()));
      }
    }
  } else if (action === "grep_search" || action === "grep" || action === "grep_search_async" || action === "grep_async" || action === "async_grep") {
    if (targetPath) readPaths.push(normalize(targetPath));
    const dirScope = (typeof task.dir === "string" && task.dir.trim()) || "";
    if (dirScope) readPaths.push(normalize(dirScope));
  }

  return { writtenPaths, readPaths };
}

export function detectBatchDependencyViolation(
  tasks: SaVmRunInput[],
  cwd: string
): { kind: "read-after-write" | "write-write"; conflictedPath: string; writeTaskIndex: number; readTaskIndex: number } | null {
  const taskDeps = tasks.map((t, idx) => ({ idx, t, ...extractTaskDependencies(t, cwd) }));

  const writtenPathMap = new Map<string, { rawPath: string; taskIndex: number }>();
  for (const item of taskDeps) {
    for (const p of item.writtenPaths) {
      const prev = writtenPathMap.get(p);
      if (prev && prev.taskIndex !== item.idx) {
        // Two tasks concurrently writing one path race (lost update);
        // split into sequential calls. First reporter wins.
        return {
          kind: "write-write",
          conflictedPath: p,
          writeTaskIndex: prev.taskIndex,
          readTaskIndex: item.idx
        };
      }
      if (!prev) writtenPathMap.set(p, { rawPath: p, taskIndex: item.idx });
    }
  }

  if (writtenPathMap.size === 0) return null;

  for (const item of taskDeps) {
    for (const r of item.readPaths) {
      const match = writtenPathMap.get(r);
      // Same-task read+write (extract/move-with-imports touch their own
      // source) is NOT a batch conflict - only cross-task reads are.
      if (match && match.taskIndex !== item.idx) {
        const raw = item.t.path || item.t.file || item.t.target || match.rawPath;
        return {
          kind: "read-after-write",
          conflictedPath: raw,
          writeTaskIndex: match.taskIndex,
          readTaskIndex: item.idx
        };
      }
    }
  }

  return null;
}

function tryHandleLegacyTemplateSourceNatively(
  source: string,
  policy: SaVmPolicyConfig | undefined,
  cwd: string,
  startedAt: number
): Promise<SaVmRunResult> | null {
  if (!source || typeof source !== "string") return null;

  // Pattern 1: find files: sa_fs_find_files_to_stdout
  if (source.includes("sa_fs_find_files_to_stdout")) {
    const dirMatch = source.match(/let\s+dir\s*=\s*"([^"]*)";/);
    const patMatch = source.match(/let\s+pat\s*=\s*"([^"]*)";/);
    const dir = dirMatch && dirMatch[1] ? dirMatch[1] : ".";
    const pattern = patMatch && patMatch[1] ? patMatch[1] : "*";
    return nativeFindFiles(dir, pattern, 100, 5, policy, cwd, startedAt);
  }

  // Pattern 2: read file: sa_fs_read_to_stdout
  if (source.includes("sa_fs_read_to_stdout")) {
    const pMatch = source.match(/let\s+(?:p|path)\s*=\s*"([^"]*)";/);
    if (pMatch && pMatch[1]) {
      return nativeReadFile(pMatch[1], 65536, policy, cwd, startedAt);
    }
  }

  // Pattern 3: read lines: sa_fs_read_lines_to_stdout
  if (source.includes("sa_fs_read_lines_to_stdout")) {
    const pMatch = source.match(/let\s+(?:p|path)\s*=\s*"([^"]*)";/);
    const linesMatch = source.match(/sa_fs_read_lines_to_stdout\([^,]+,\s*[^,]+,\s*(\d+),\s*(\d+)/);
    if (pMatch && pMatch[1]) {
      const startLine = linesMatch && linesMatch[1] ? parseInt(linesMatch[1], 10) : 1;
      const endLine = linesMatch && linesMatch[2] ? parseInt(linesMatch[2], 10) : startLine + 100;
      return nativeReadLines(pMatch[1], startLine, endLine, 65536, policy, cwd, startedAt);
    }
  }

  // Pattern 4: write file: sa_fs_write_file
  if (source.includes("sa_fs_write_file")) {
    const pMatch = source.match(/let\s+(?:p|path)\s*=\s*"([^"]*)";/);
    const cMatch = source.match(/let\s+(?:c|content)\s*=\s*"([^"]*)";/);
    if (pMatch && pMatch[1]) {
      const content = cMatch && cMatch[1] ? cMatch[1] : "";
      return nativeWriteFile(pMatch[1], content, policy, cwd, startedAt);
    }
  }

  // Pattern 5: edit file: sa_fs_edit_file
  if (source.includes("sa_fs_edit_file")) {
    const pMatch = source.match(/let\s+(?:p|path)\s*=\s*"([^"]*)";/);
    const otMatch = source.match(/let\s+(?:ot|old_text|old)\s*=\s*"([^"]*)";/);
    const ntMatch = source.match(/let\s+(?:nt|new_text|new)\s*=\s*"([^"]*)";/);
    if (pMatch && pMatch[1] && otMatch && otMatch[1] && ntMatch && ntMatch[1]) {
      return nativeEditFile(pMatch[1], otMatch[1], ntMatch[1], policy, cwd, startedAt);
    }
  }

  return null;
}

/**
 * Line-bound coercion for read/extract ranges: models (and relays) often send
 * "500" strings or startLine camelCase. Dropping them silently slices 1-251
 * or trips the large-file targeted-read gate, so coerce instead of ignoring.
 */
function parseReadLineBound(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return Math.floor(value);
  if (typeof value === "string" && value.trim() !== "" && /^-?\d+(\.\d+)?$/.test(value.trim())) {
    const n = Math.floor(Number(value.trim()));
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function pickLineBound(input: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const k of keys) {
    const n = parseReadLineBound(input[k]);
    if (n !== undefined) return n;
  }
  return undefined;
}

function extractRawFilePath(input: Record<string, unknown> | undefined): string {  if (!input || typeof input !== "object") return "";
  const val = input.path ?? input.file ?? input.target ?? input.filePath ?? input.file_path ??
    input.targetFile ?? input.target_file ?? input.filename ?? input.fileName ??
    input.AbsolutePath ?? input.absolute_path ?? input.uri;
  if (typeof val !== "string") return "";
  let s = val.trim();
  if (s.startsWith("file:///")) {
    s = decodeURIComponent(s.slice(s.match(/^file:\/\/\/[a-zA-Z]:/) ? 8 : 7));
  } else if (s.startsWith("file://")) {
    s = decodeURIComponent(s.slice(7));
  }
  return s;
}

/**
 * Gate autonomous JEV helpers on explicit per-method policy flags.
 * Default (flag unset) preserves legacy behavior: allowed, skill advertisement
 * follows the JEV dialog master switch. Explicit `false` hard-denies even when
 * the model guesses the action name.
 */
function denyJevActiveTool(
  policy: SaVmPolicyConfig | undefined,
  startedAt: number,
  action: string,
  flag: "jevChoose" | "jevChecklist" | "jevEvaluate" | "jevThinking" | "jevRedteam" | "jevRank" | "jevScope" | "jevDispatch" | "jevConsistency" | "jevDone" | "jevDiagnose" | "jevEdgeCases" | "jevBlastRadius" | "jevIntent" | "jevNext" | "jevCompress" | "jevProgress" | "jevMemory"
): SaVmRunResult | null {
  if (policy?.tools?.[flag] !== false) return null;
  return {
    ok: false,
    kind: "capability_denied",
    exitCode: 228,
    stdout: "",
    stderr: `action '${action}' is disabled in current VM policy; enable ${flag} in enhancement tools to allow autonomous JEV calls`,
    saVmEvents: [],
    saVmViolation: { reason: `${flag} disabled` },
    durationMs: Date.now() - startedAt
  };
}

export async function runSaVmTool(
  rawInput: SaVmRunInput,
  policyOverrideOrOptions?: SaVmPolicyConfig | { cwd?: string; policy?: SaVmPolicyConfig; additionalRoots?: string[] },
  cwdOverride?: string
): Promise<SaVmRunResult> {
  const startedAt = Date.now();
  let release: (() => void) | undefined;
  try {
    let policy: SaVmPolicyConfig | undefined;
    let cwd: string;
    if (policyOverrideOrOptions && typeof policyOverrideOrOptions === "object" && ("cwd" in policyOverrideOrOptions || ("policy" in policyOverrideOrOptions && !("tools" in policyOverrideOrOptions)))) {
      const opts = policyOverrideOrOptions as { cwd?: string; policy?: SaVmPolicyConfig };
      cwd = opts.cwd ?? cwdOverride ?? rawInput.cwd ?? process.cwd();
      policy = opts.policy ?? rawInput.policy;
    } else {
      policy = (policyOverrideOrOptions as SaVmPolicyConfig | undefined) ?? rawInput.policy;
      cwd = cwdOverride ?? rawInput.cwd ?? process.cwd();
    }

    // 1. Native Action execution (read_file, find_files, write_file, edit_file, etc.)
    const action = typeof rawInput.action === "string" ? rawInput.action.trim().toLowerCase() : "";
    const targetFilePath = extractRawFilePath(rawInput as Record<string, unknown>);
    if (targetFilePath) {
      if (!rawInput.path) rawInput.path = targetFilePath;
      if (!rawInput.file) rawInput.file = targetFilePath;
      if (!rawInput.target) rawInput.target = targetFilePath;
    }

    // No-action sniffing must recognize WRITE intents: {path,old_text,...}
    // is an edit, {path,text/body/...} is a write. Otherwise edit intent
    // silently degrades to read_file and the model "edits" by reading.
    const sniffRecord = rawInput as Record<string, unknown>;
    const sniffHasOld = ["old_text", "oldText", "old_string", "oldString", "old"].some((k) => typeof sniffRecord[k] === "string");
    const sniffHasPatch = typeof rawInput.patch === "string" || typeof sniffRecord["diff"] === "string";
    const sniffHasBody = rawInput.content !== undefined || ["contents", "text", "body", "data"].some((k) => sniffRecord[k] !== undefined);
    const sniffedNoAction = !rawInput.source && targetFilePath
      ? (sniffHasOld ? "edit_file" : sniffHasPatch ? "apply_patch" : sniffHasBody ? "write_file" : "read_file")
      : "";
    const effectiveAction = action || sniffedNoAction;

  if (effectiveAction === "read" || effectiveAction === "read_file" || effectiveAction === "vm-read" || effectiveAction === "vm_read") {
    if (!targetFilePath) throw new SaVmInputError("action 'read_file' requires a 'path' parameter");
    if (rawInput.tail === true || (typeof rawInput.lines === "number" && rawInput.lines < 0)) {
      const lines = typeof rawInput.lines === "number" ? Math.abs(Math.floor(rawInput.lines)) : 100;
      return await nativeReadFileTail(targetFilePath, {
        lines,
        maxTokens: typeof rawInput.max_tokens === "number" ? rawInput.max_tokens : undefined,
        remainingTokens: typeof rawInput.remaining_tokens === "number" ? rawInput.remaining_tokens : undefined,
        maxBytes: typeof rawInput.max_bytes === "number" ? rawInput.max_bytes : undefined,
        maxLineLength: typeof rawInput.max_line_length === "number" ? rawInput.max_line_length : undefined,
        numbered: rawInput.numbered !== false
      }, policy, cwd, startedAt);
    }
    const maxTokens = typeof rawInput.max_tokens === "number"
      ? rawInput.max_tokens
      : (typeof rawInput.max_token === "number" ? rawInput.max_token : (typeof rawInput.maxtoken === "number" ? rawInput.maxtoken : undefined));
    const remainingTokens = typeof rawInput.remaining_tokens === "number"
      ? rawInput.remaining_tokens
      : (typeof rawInput.tokens_remaining === "number" ? rawInput.tokens_remaining : (typeof rawInput.tokens_left === "number" ? rawInput.tokens_left : undefined));
    const rawRec = rawInput as Record<string, unknown>;
    return await nativeReadFile(targetFilePath, {
      startLine: pickLineBound(rawRec, "start_line", "startLine"),
      endLine: pickLineBound(rawRec, "end_line", "endLine"),
      offset: pickLineBound(rawRec, "offset"),
      maxTokens,
      remainingTokens,
      maxBytes: typeof rawInput.max_bytes === "number" ? rawInput.max_bytes : undefined,
      maxLines: typeof rawInput.max_lines === "number" ? rawInput.max_lines : undefined,
      maxLineLength: typeof rawInput.max_line_length === "number" ? rawInput.max_line_length : undefined,
      numbered: rawInput.numbered !== false
    }, policy, cwd, startedAt);
  }

  if (effectiveAction === "read_lines") {
    if (!targetFilePath) throw new SaVmInputError("action 'read_lines' requires a 'path' parameter");
    if (rawInput.tail === true || (typeof rawInput.lines === "number" && rawInput.lines < 0)) {
      const lines = typeof rawInput.lines === "number" ? Math.abs(Math.floor(rawInput.lines)) : 100;
      return await nativeReadFileTail(targetFilePath, {
        lines,
        maxTokens: typeof rawInput.max_tokens === "number" ? rawInput.max_tokens : undefined,
        remainingTokens: typeof rawInput.remaining_tokens === "number" ? rawInput.remaining_tokens : undefined,
        maxBytes: typeof rawInput.max_bytes === "number" ? rawInput.max_bytes : undefined,
        maxLineLength: typeof rawInput.max_line_length === "number" ? rawInput.max_line_length : undefined,
        numbered: rawInput.numbered !== false
      }, policy, cwd, startedAt);
    }
    const rawRec = rawInput as Record<string, unknown>;
    const startLine = (() => {
      const n = pickLineBound(rawRec, "start_line", "startLine");
      return n !== undefined && n > 0 ? n : 1;
    })();
    const endLine = (() => {
      const n = pickLineBound(rawRec, "end_line", "endLine");
      return n !== undefined && n >= startLine ? n : (startLine + 250);
    })();
    const maxTokens = typeof rawInput.max_tokens === "number"
      ? rawInput.max_tokens
      : (typeof rawInput.max_token === "number" ? rawInput.max_token : (typeof rawInput.maxtoken === "number" ? rawInput.maxtoken : undefined));
    const remainingTokens = typeof rawInput.remaining_tokens === "number"
      ? rawInput.remaining_tokens
      : (typeof rawInput.tokens_remaining === "number" ? rawInput.tokens_remaining : (typeof rawInput.tokens_left === "number" ? rawInput.tokens_left : undefined));
    return await nativeReadFile(targetFilePath, {
      startLine,
      endLine,
      offset: typeof rawInput.offset === "number" ? rawInput.offset : undefined,
      maxTokens,
      remainingTokens,
      maxBytes: typeof rawInput.max_bytes === "number" ? rawInput.max_bytes : undefined,
      maxLines: typeof rawInput.max_lines === "number" ? rawInput.max_lines : undefined,
      maxLineLength: typeof rawInput.max_line_length === "number" ? rawInput.max_line_length : undefined,
      numbered: rawInput.numbered !== false
    }, policy, cwd, startedAt);
  }

  if (effectiveAction === "read_file_tail" || effectiveAction === "tail_file" || effectiveAction === "tail") {
    if (!targetFilePath) throw new SaVmInputError("action 'read_file_tail' requires a 'path' parameter");
    const lines = typeof rawInput.lines === "number" && rawInput.lines > 0 ? Math.floor(rawInput.lines) : 100;
    const maxTokens = typeof rawInput.max_tokens === "number"
      ? rawInput.max_tokens
      : (typeof rawInput.max_token === "number" ? rawInput.max_token : undefined);
    const remainingTokens = typeof rawInput.remaining_tokens === "number"
      ? rawInput.remaining_tokens
      : (typeof rawInput.tokens_remaining === "number" ? rawInput.tokens_remaining : undefined);
    return await nativeReadFileTail(targetFilePath, {
      lines,
      maxTokens,
      remainingTokens,
      maxBytes: typeof rawInput.max_bytes === "number" ? rawInput.max_bytes : undefined,
      maxLineLength: typeof rawInput.max_line_length === "number" ? rawInput.max_line_length : undefined,
      numbered: rawInput.numbered !== false
    }, policy, cwd, startedAt);
  }

  if (effectiveAction === "find" || effectiveAction === "find_files" || effectiveAction === "list_files") {
    const dir = (typeof rawInput.dir === "string" && rawInput.dir.trim()) || targetFilePath || ".";
    const pattern = typeof rawInput.pattern === "string" && rawInput.pattern.trim() ? rawInput.pattern.trim() : "*";
    const maxEntries = typeof rawInput.max_entries === "number" && rawInput.max_entries > 0 ? Math.floor(rawInput.max_entries) : 100;
    const maxDepth = typeof rawInput.max_depth === "number" && rawInput.max_depth > 0 ? Math.floor(rawInput.max_depth) : 5;
    return await nativeFindFiles(dir, pattern, maxEntries, maxDepth, policy, cwd, startedAt, {
      timeout_ms: rawInput.timeout_ms,
      timeout: rawInput.timeout
    }, {
      path_pattern: rawInput.path_pattern,
      is_regex: rawInput.is_regex ?? rawInput.regex,
      page: rawInput.page ?? rawInput.page_num ?? rawInput.pageNum ?? rawInput.p,
      page_size: rawInput.page_size ?? rawInput.pageSize ?? rawInput.per_page ?? rawInput.perPage,
      offset: rawInput.offset,
      count_cap: rawInput.count_cap ?? rawInput.countCap ?? rawInput.max_total,
      exact_total: rawInput.exact_total ?? rawInput.exactTotal
    });
  }

  if (effectiveAction === "write" || effectiveAction === "write_file") {
    if (!targetFilePath) throw new SaVmInputError("action 'write_file' requires a 'path' parameter");
    const raw = rawInput as Record<string, unknown>;
    const pickContent = (...keys: string[]): string | undefined => {
      for (const k of keys) {
        const v = raw[k];
        if (typeof v === "string") return v;
      }
      return undefined;
    };
    // Never silently truncate: text/contents/body/data are common model
    // spellings for the file body; missing body is an explicit error.
    const content = pickContent("content", "contents", "text", "body", "data");
    if (content === undefined) throw new SaVmInputError("action 'write_file' requires 'content' (full file text; also accepts contents/text/body/data) - refusing to truncate the file with an empty write");
    const manualOverride = rawInput.manualOverride === true || (raw as Record<string, unknown>).manual_override === true;
    return await nativeWriteFile(targetFilePath, content, policy, cwd, startedAt, { manualOverride });
  }

  if (effectiveAction === "edit" || effectiveAction === "edit_file") {
    if (!targetFilePath) throw new SaVmInputError("action 'edit_file' requires a 'path' parameter");
    const raw = rawInput as Record<string, unknown>;
    const pickStr = (...keys: string[]): string | undefined => {
      for (const k of keys) {
        const v = raw[k];
        if (typeof v === "string") return v;
      }
      return undefined;
    };
    // Accept camelCase / short aliases; explicitly reject input/output misuse
    // (mini models hallucinate {input,output} from the generic sa_vm schema).
    const oldText = pickStr("old_text", "oldText", "old_string", "oldString", "old") ?? "";
    const newText = pickStr("new_text", "newText", "new_string", "newString", "new") ?? "";
    if (!oldText.trim() && (typeof raw["input"] === "string" || typeof raw["output"] === "string")) {
      throw new SaVmInputError("action 'edit_file' requires 'old_text'/'new_text' (NOT 'input'/'output'). Example: {\"action\":\"edit_file\",\"path\":\"<file>\",\"old_text\":\"<exact unique snippet>\",\"new_text\":\"<replacement>\"}");
    }
    if (!oldText) throw new SaVmInputError("action 'edit_file' requires a non-empty 'old_text' (exact snippet from a prior read, with enough unique context)");
    const replaceAll = rawInput.replaceAll === true || rawInput.replace_all === true || (raw as Record<string, unknown>)["replaceAll"] === true;
    const manualOverride = rawInput.manualOverride === true || (raw as Record<string, unknown>).manual_override === true;
    return await nativeEditFile(targetFilePath, oldText, newText, policy, cwd, startedAt, { replaceAll, manualOverride });
  }

  // Exact-action routing: an explicit `action` always wins. Field-sniffing
  // (`patch` present without `action`) is only a back-compat fallback, so an
  // explicit action such as `jev_blast_radius` carrying `diff`/`patch`/`content`
  // can never be hijacked into apply_patch (regression: "invalid patch boundaries").
  const explicitAction = typeof rawInput.action === "string" ? rawInput.action.trim().toLowerCase() : "";
  if (effectiveAction === "apply_patch" || effectiveAction === "patch" || (!explicitAction && typeof rawInput.patch === "string")) {
    const raw = rawInput as Record<string, unknown>;
    const patch = typeof rawInput.patch === "string" ? rawInput.patch
      : typeof raw["diff"] === "string" ? (raw["diff"] as string)
      : (rawInput.content ?? "");
    if (!patch) throw new SaVmInputError("action 'apply_patch' requires 'patch' (or 'diff'/'content') parameter");
    return await nativeApplyPatch(patch, policy, cwd, rawInput.additionalRoots ?? [], startedAt);
  }

  if (effectiveAction === "delete" || effectiveAction === "delete_file" || effectiveAction === "remove_file") {
    if (!targetFilePath) throw new SaVmInputError("action 'delete_file' requires a 'path' parameter");
    return await nativeDeleteFile(targetFilePath, policy, cwd, startedAt);
  }

  if (effectiveAction === "safe_delete") {
    if (!targetFilePath) throw new SaVmInputError("action 'safe_delete' requires a 'path' parameter");
    return await nativeSafeDelete(targetFilePath, {
      check_references: rawInput.check_references,
      force: rawInput.force,
      max_results: rawInput.max_results,
      timeout_ms: rawInput.timeout_ms,
      timeout: rawInput.timeout
    }, policy, cwd, startedAt);
  }

  if (effectiveAction === "move" || effectiveAction === "move_file" || effectiveAction === "rename" || effectiveAction === "rename_file") {
    const raw = rawInput as Record<string, unknown>;
    const pickSrc = (...keys: string[]): string => {
      for (const k of keys) {
        const v = raw[k];
        if (typeof v === "string" && (v as string).trim()) return v as string;
      }
      return "";
    };
    const from = pickSrc("from", "source", "path", "file", "target") || targetFilePath || "";
    const to = pickSrc("to", "dest", "target2", "target") || (typeof rawInput.args?.[0] === "string" ? rawInput.args[0] : "");
    // Avoid from==to self-echo when both resolve to the same flat path key.
    if (!from || !to) throw new SaVmInputError("action 'move_file' requires 'from' (or 'path'/'source') and 'to' (or 'dest') parameters");
    return await nativeMoveFile(from, to, policy, cwd, startedAt);
  }

  if (effectiveAction === "ensure_dir" || effectiveAction === "mkdir") {
    const targetDir = (typeof rawInput.dir === "string" && rawInput.dir.trim())
      || (typeof rawInput.path === "string" && rawInput.path.trim())
      || (typeof rawInput.target === "string" && rawInput.target.trim());
    if (!targetDir) throw new SaVmInputError("action 'ensure_dir' requires a 'path' or 'dir' parameter");
    return await nativeEnsureDir(targetDir, policy, cwd, startedAt);
  }

  if (effectiveAction === "list_dir") {
    const dir = (typeof rawInput.dir === "string" && rawInput.dir.trim())
      || (typeof rawInput.path === "string" && rawInput.path.trim())
      || (typeof rawInput.file === "string" && rawInput.file.trim())
      || (typeof rawInput.target === "string" && rawInput.target.trim())
      || ".";
    const maxEntries = typeof rawInput.max_entries === "number" ? rawInput.max_entries : 200;
    const depth = typeof rawInput.max_depth === "number"
      ? rawInput.max_depth
      : (typeof rawInput.depth === "number" ? rawInput.depth : (rawInput.recursive ? 5 : 1));
    return await nativeListDir(
      dir,
      maxEntries,
      policy,
      cwd,
      startedAt,
      { timeout_ms: rawInput.timeout_ms, timeout: rawInput.timeout },
      { depth, max_depth: depth, recursive: rawInput.recursive === true, type: rawInput.type, pattern: typeof rawInput.pattern === "string" ? rawInput.pattern : undefined, path_pattern: rawInput.path_pattern, is_regex: rawInput.is_regex ?? rawInput.regex, exclude_dirs: parseExcludeDirs(rawInput), respect_gitignore: rawInput.respect_gitignore !== false, page: rawInput.page ?? rawInput.page_num ?? rawInput.pageNum ?? rawInput.p, page_size: rawInput.page_size ?? rawInput.pageSize ?? rawInput.per_page ?? rawInput.perPage, offset: rawInput.offset, count_cap: rawInput.count_cap ?? rawInput.countCap ?? rawInput.max_total, exact_total: rawInput.exact_total ?? rawInput.exactTotal }
    );
  }

  if (effectiveAction === "grep" || effectiveAction === "grep_search") {
    let query = typeof rawInput.query === "string" ? rawInput.query : (typeof rawInput.content === "string" ? rawInput.content : "");
    const dir = (typeof rawInput.dir === "string" && rawInput.dir.trim())
      || (typeof rawInput.path === "string" && rawInput.path.trim())
      || (typeof rawInput.file === "string" && rawInput.file.trim())
      || (typeof rawInput.target === "string" && rawInput.target.trim())
      || ".";
    let pattern = typeof rawInput.pattern === "string" && rawInput.pattern.trim() ? rawInput.pattern.trim() : "*";
    if (!query && pattern && pattern !== "*") {
      query = pattern;
      pattern = "*";
    }
    const maxMatches = typeof rawInput.max_matches === "number" ? rawInput.max_matches : typeof rawInput.max_results === "number" ? rawInput.max_results : 50;
    return await nativeGrepSearch(query, dir, pattern, maxMatches, policy, cwd, startedAt, {
      timeout_ms: rawInput.timeout_ms,
      timeout: rawInput.timeout
    }, {
      is_regex: rawInput.is_regex ?? rawInput.regex,
      case_sensitive: rawInput.case_sensitive === true,
      path_pattern: rawInput.path_pattern,
      max_file_bytes: rawInput.max_file_bytes ?? rawInput.maxFileBytes ?? rawInput.max_bytes,
      exclude_dirs: parseExcludeDirs(rawInput),
      respect_gitignore: rawInput.respect_gitignore !== false,
      page: rawInput.page ?? rawInput.page_num ?? rawInput.pageNum ?? rawInput.p,
      page_size: rawInput.page_size ?? rawInput.pageSize ?? rawInput.per_page ?? rawInput.perPage,
      offset: rawInput.offset,
      count_cap: rawInput.count_cap ?? rawInput.countCap ?? rawInput.max_total,
      exact_total: rawInput.exact_total ?? rawInput.exactTotal
    });
  }

  if (effectiveAction === "grep_async" || effectiveAction === "grep_search_async" || effectiveAction === "async_grep") {
    let query = rawInput.queries ?? (typeof rawInput.query === "string" ? rawInput.query : (typeof rawInput.content === "string" ? rawInput.content : ""));
    const dir = (typeof rawInput.dir === "string" && rawInput.dir.trim())
      || (typeof rawInput.path === "string" && rawInput.path.trim())
      || (typeof rawInput.file === "string" && rawInput.file.trim())
      || (typeof rawInput.target === "string" && rawInput.target.trim())
      || ".";
    let pattern = typeof rawInput.pattern === "string" && rawInput.pattern.trim() ? rawInput.pattern.trim() : "*";
    if (!query && pattern && pattern !== "*") {
      query = pattern;
      pattern = "*";
    }
    const maxMatches = typeof rawInput.max_matches === "number" ? rawInput.max_matches : typeof rawInput.max_results === "number" ? rawInput.max_results : 50;
    const concurrency = typeof rawInput.concurrency === "number" ? rawInput.concurrency : 16;
    return await nativeGrepSearchAsync(query, dir, pattern, maxMatches, concurrency, policy, cwd, startedAt, {
      timeout_ms: rawInput.timeout_ms,
      timeout: rawInput.timeout
    }, {
      is_regex: rawInput.is_regex ?? rawInput.regex,
      case_sensitive: rawInput.case_sensitive === true,
      path_pattern: rawInput.path_pattern,
      max_file_bytes: rawInput.max_file_bytes ?? rawInput.maxFileBytes ?? rawInput.max_bytes,
      exclude_dirs: parseExcludeDirs(rawInput),
      respect_gitignore: rawInput.respect_gitignore !== false,
      page: rawInput.page ?? rawInput.page_num ?? rawInput.pageNum ?? rawInput.p,
      page_size: rawInput.page_size ?? rawInput.pageSize ?? rawInput.per_page ?? rawInput.perPage,
      offset: rawInput.offset,
      count_cap: rawInput.count_cap ?? rawInput.countCap ?? rawInput.max_total,
      exact_total: rawInput.exact_total ?? rawInput.exactTotal
    });
  }

  if (effectiveAction === "copy" || effectiveAction === "copy_file") {
    const raw = rawInput as Record<string, unknown>;
    const pickSrc = (...keys: string[]): string => {
      for (const k of keys) {
        const v = raw[k];
        if (typeof v === "string" && (v as string).trim()) return v as string;
      }
      return "";
    };
    const from = pickSrc("from", "source", "path", "file", "target") || "";
    const to = pickSrc("to", "dest", "target2", "target") || (typeof rawInput.args?.[0] === "string" ? rawInput.args[0] : "");
    if (!from || !to) throw new SaVmInputError("action 'copy_file' requires 'from' (or 'path'/'source') and 'to' (or 'dest') parameters");
    return await nativeCopyFile(from, to, policy, cwd, startedAt);
  }

  if (effectiveAction === "stat" || effectiveAction === "file_info" || effectiveAction === "test_path" || effectiveAction === "file_exists" || effectiveAction === "exists") {
    const targetPath = (typeof rawInput.path === "string" && rawInput.path.trim())
      || (typeof rawInput.file === "string" && rawInput.file.trim())
      || (typeof rawInput.target === "string" && rawInput.target.trim());
    if (!targetPath) throw new SaVmInputError("action 'file_info' requires a 'path' parameter");
    return await nativeFileInfo(targetPath, policy, cwd, startedAt);
  }

  if (effectiveAction === "count_lines" || effectiveAction === "line_count" || effectiveAction === "wc" || effectiveAction === "count") {
    const targetPath = (typeof rawInput.path === "string" && rawInput.path.trim())
      || (typeof rawInput.file === "string" && rawInput.file.trim())
      || (typeof rawInput.target === "string" && rawInput.target.trim());
    if (!targetPath) throw new SaVmInputError("action 'count_lines' requires a 'path' parameter");
    return await nativeCountLines(targetPath, policy, cwd, startedAt);
  }

  if (effectiveAction === "git_status" || effectiveAction === "git-status") {
    const startPath = (typeof rawInput.repo === "string" && rawInput.repo.trim())
      || targetFilePath
      || cwd;
    return await nativeGitStatus(startPath, {
      short: rawInput.short,
      untracked: rawInput.untracked,
      max_entries: rawInput.max_entries,
      max_bytes: rawInput.max_bytes,
      max_tokens: rawInput.max_tokens,
      max_token: rawInput.max_token,
      maxtoken: rawInput.maxtoken,
      remaining_tokens: rawInput.remaining_tokens,
      tokens_remaining: rawInput.tokens_remaining,
      tokens_left: rawInput.tokens_left,
      timeout_ms: rawInput.timeout_ms,
      timeout: rawInput.timeout
    }, policy, cwd, startedAt);
  }

  if (effectiveAction === "git_diff" || effectiveAction === "git-diff") {
    const startPath = (typeof rawInput.repo === "string" && rawInput.repo.trim())
      || targetFilePath
      || (typeof rawInput.dir === "string" && rawInput.dir.trim())
      || cwd;
    let pathspec = targetFilePath
      || (typeof rawInput.dir === "string" && rawInput.dir.trim())
      || undefined;
    let revisionOpt = (typeof rawInput.revision === "string" && rawInput.revision.trim())
      || (typeof rawInput.range === "string" && rawInput.range.trim())
      || undefined;
    // `target` historically aliases a file path; for git_diff also accept it
    // as a revision (e.g. "HEAD~3") when it looks like one. File paths
    // rarely look like HEAD/SHA/range, so this keeps "对比最后3次修复" working
    // without breaking pathspec usage. Explicit revision/range wins.
    if (!revisionOpt && typeof rawInput.target === "string" && rawInput.target.trim()) {
      const t = rawInput.target.trim();
      if (/^(HEAD([~^]\d+)?([.]{2,3}.+)?|[0-9a-f]{7,40}([.]{2,3}[0-9a-f]{7,40})?|[A-Za-z0-9_.-]+[.]{2,3}.+)$/i.test(t) && isSafeGitRevision(t)) {
        revisionOpt = t;
        if (pathspec === t) pathspec = undefined;
      }
    }
    const statOnly = rawInput.stat_only === true || (rawInput as Record<string, unknown>).statOnly === true;
    // `context` is the jev_* supporting-text field, so git_diff also accepts
    // `diff_context` as its unambiguous integer alias.
    const rawDiffContext = typeof rawInput.diff_context === "number" && Number.isFinite(rawInput.diff_context)
      ? rawInput.diff_context
      : rawInput.context;
    const contextOpt = typeof rawDiffContext === "number" && Number.isFinite(rawDiffContext)
      ? rawDiffContext
      : typeof rawDiffContext === "string" && rawDiffContext.trim() !== "" && Number.isFinite(Number(rawDiffContext))
        ? Number(rawDiffContext)
        : undefined;
    return await nativeGitDiff(startPath, {
      pathspec,
      staged: rawInput.staged,
      stat_only: statOnly,
      context: contextOpt,
      target: revisionOpt,
      revision: revisionOpt,
      range: revisionOpt,
      max_files: rawInput.max_files,
      max_bytes: rawInput.max_bytes,
      max_tokens: rawInput.max_tokens,
      max_token: rawInput.max_token,
      maxtoken: rawInput.maxtoken,
      remaining_tokens: rawInput.remaining_tokens,
      tokens_remaining: rawInput.tokens_remaining,
      tokens_left: rawInput.tokens_left,
      timeout_ms: rawInput.timeout_ms,
      timeout: rawInput.timeout
    }, policy, cwd, startedAt);
  }

  if (effectiveAction === "git_log" || effectiveAction === "git-log") {
    const startPath = (typeof rawInput.repo === "string" && rawInput.repo.trim())
      || targetFilePath
      || (typeof rawInput.dir === "string" && rawInput.dir.trim())
      || cwd;
    let revisionOpt = (typeof rawInput.revision === "string" && rawInput.revision.trim())
      || (typeof rawInput.range === "string" && rawInput.range.trim())
      || (typeof rawInput.target === "string" && rawInput.target.trim())
      || undefined;
    // If target was actually a file path (extracted as startPath), don't treat
    // it as a revision unless it looks like one.
    if (revisionOpt && targetFilePath && revisionOpt === targetFilePath && !/^(HEAD([~^]\d+)?([.]{2,3}.+)?|[0-9a-f]{7,40}([.]{2,3}[0-9a-f]{7,40})?)$/i.test(revisionOpt) && !isSafeGitRevision(revisionOpt)) {
      revisionOpt = undefined;
    }
    const rawMaxCount = typeof rawInput.max_count === "number" && Number.isFinite(rawInput.max_count)
      ? rawInput.max_count
      : typeof (rawInput as Record<string, unknown>).maxCount === "number"
        ? (rawInput as Record<string, unknown>).maxCount as number
        : typeof (rawInput as Record<string, unknown>).count === "number" && Number.isFinite((rawInput as Record<string, unknown>).count as number)
          ? (rawInput as Record<string, unknown>).count as number
          : 10;
    return await nativeGitLog(startPath, {
      max_count: rawMaxCount,
      target: revisionOpt,
      revision: revisionOpt,
      range: revisionOpt,
      oneline: rawInput.oneline,
      max_bytes: rawInput.max_bytes,
      max_tokens: rawInput.max_tokens,
      max_token: rawInput.max_token,
      maxtoken: rawInput.maxtoken,
      remaining_tokens: rawInput.remaining_tokens,
      tokens_remaining: rawInput.tokens_remaining,
      tokens_left: rawInput.tokens_left,
      timeout_ms: rawInput.timeout_ms,
      timeout: rawInput.timeout
    }, policy, cwd, startedAt);
  }

  if (effectiveAction === "http_fetch" || effectiveAction === "fetch") {
    const url = rawInput.url ?? rawInput.path ?? "";
    if (!url) throw new SaVmInputError("action 'http_fetch' requires a 'url' parameter");
    const method = rawInput.method ?? "GET";
    return await nativeHttpFetch(url, method, rawInput.headers, rawInput.body ?? rawInput.content, policy, cwd, startedAt, { timeout_ms: rawInput.timeout_ms, timeout: rawInput.timeout });
  }

  if (effectiveAction === "clear_tool_history" || effectiveAction === "prune_tool_history") {
    const normalized = normalizeSaVmPolicy(policy, cwd);
    if (normalized.tools?.clearToolHistory !== true) {
      return {
        ok: false,
        kind: "capability_denied",
        exitCode: 228,
        stdout: "",
        stderr: "action 'clear_tool_history' is disabled in current VM policy; enable clearToolHistory in VM settings to allow autonomous context pruning",
        saVmEvents: [],
        saVmViolation: { reason: "clearToolHistory disabled" },
        durationMs: Date.now() - startedAt
      };
    }
    const keepLastNTurns = typeof rawInput.keep_last_n_turns === "number"
      ? Math.max(2, Math.floor(rawInput.keep_last_n_turns))
      : 2;
    const filterTools = Array.isArray(rawInput.filter_tools) && rawInput.filter_tools.length > 0
      ? rawInput.filter_tools.map(String)
      : ["read_file", "read_lines", "grep_search", "grep_search_async", "list_dir", "find_files"];
    const reason = typeof rawInput.reason === "string" && rawInput.reason.trim()
      ? rawInput.reason.trim()
      : "Pruned obsolete exploration tool outputs to preserve context";

    return {
      ok: true,
      kind: "success",
      exitCode: 0,
      stdout: JSON.stringify({
        status: "pruned",
        action: "clear_tool_history",
        keep_last_n_turns: keepLastNTurns,
        filter_tools: filterTools,
        reason,
        message: `Successfully marked tool outputs older than ${keepLastNTurns} turns for [${filterTools.join(", ")}] as pruned.`
      }, null, 2),
      stderr: "",
      saVmEvents: [
        {
          timestamp: Date.now(),
          type: "context_pruned",
          action: "clear_tool_history",
          keep_last_n_turns: keepLastNTurns,
          filter_tools: filterTools
        }
      ],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  }

  if (effectiveAction === "jev_choose" || effectiveAction === "jev_select") {
    const denied = denyJevActiveTool(policy, startedAt, "jev_choose", "jevChoose");
    if (denied) return denied;
    return await nativeJevChoose(rawInput, policy, cwd, startedAt);
  }

  if (effectiveAction === "jev_checklist" || effectiveAction === "jev_multi_choice") {
    const denied = denyJevActiveTool(policy, startedAt, "jev_checklist", "jevChecklist");
    if (denied) return denied;
    return await nativeJevChecklist(rawInput, policy, cwd, startedAt);
  }

  if (effectiveAction === "jev_evaluate" || effectiveAction === "jev_eval") {
    const denied = denyJevActiveTool(policy, startedAt, "jev_evaluate", "jevEvaluate");
    if (denied) return denied;
    return await nativeJevEvaluate(rawInput, policy, cwd, startedAt);
  }

  if (effectiveAction === "jev_thinking" || effectiveAction === "jev_think") {
    const denied = denyJevActiveTool(policy, startedAt, "jev_thinking", "jevThinking");
    if (denied) return denied;
    return await nativeJevThinking(rawInput, policy, cwd, startedAt);
  }

  if (effectiveAction === "jev_redteam" || effectiveAction === "jev_red") {
    const denied = denyJevActiveTool(policy, startedAt, "jev_redteam", "jevRedteam");
    if (denied) return denied;
    return await nativeJevRedteam(rawInput, policy, cwd, startedAt);
  }

  if (effectiveAction === "jev_rank") {
    const denied = denyJevActiveTool(policy, startedAt, "jev_rank", "jevRank");
    if (denied) return denied;
    return await nativeJevRank(rawInput, policy, cwd, startedAt);
  }

  if (effectiveAction === "jev_scope") {
    const denied = denyJevActiveTool(policy, startedAt, "jev_scope", "jevScope");
    if (denied) return denied;
    return await nativeJevScope(rawInput, policy, cwd, startedAt);
  }

  if (effectiveAction === "jev_dispatch" || effectiveAction === "jev_allocate" || effectiveAction === "jev_delegate") {
    const denied = denyJevActiveTool(policy, startedAt, "jev_dispatch", "jevDispatch");
    if (denied) return denied;
    return await nativeJevDispatch(rawInput, policy, cwd, startedAt);
  }

  if (effectiveAction === "jev_consistency") {
    const denied = denyJevActiveTool(policy, startedAt, "jev_consistency", "jevConsistency");
    if (denied) return denied;
    return await nativeJevConsistency(rawInput, policy, cwd, startedAt);
  }

  if (effectiveAction === "jev_done") {
    const denied = denyJevActiveTool(policy, startedAt, "jev_done", "jevDone");
    if (denied) return denied;
    return await nativeJevDone(rawInput, policy, cwd, startedAt);
  }

  if (effectiveAction === "jev_diagnose") {
    const denied = denyJevActiveTool(policy, startedAt, "jev_diagnose", "jevDiagnose");
    if (denied) return denied;
    return await nativeJevDiagnose(rawInput, policy, cwd, startedAt);
  }

  if (effectiveAction === "jev_edge_cases") {
    const denied = denyJevActiveTool(policy, startedAt, "jev_edge_cases", "jevEdgeCases");
    if (denied) return denied;
    return await nativeJevEdgeCases(rawInput, policy, cwd, startedAt);
  }

  if (effectiveAction === "jev_blast_radius") {
    const denied = denyJevActiveTool(policy, startedAt, "jev_blast_radius", "jevBlastRadius");
    if (denied) return denied;
    return await nativeJevBlastRadius(rawInput, policy, cwd, startedAt);
  }

  if (effectiveAction === "jev_intent") {
    const denied = denyJevActiveTool(policy, startedAt, "jev_intent", "jevIntent");
    if (denied) return denied;
    return await nativeJevIntent(rawInput, policy, cwd, startedAt);
  }

  if (effectiveAction === "jev_next") {
    const denied = denyJevActiveTool(policy, startedAt, "jev_next", "jevNext");
    if (denied) return denied;
    return await nativeJevNext(rawInput, policy, cwd, startedAt);
  }

  if (effectiveAction === "jev_progress") {
    const denied = denyJevActiveTool(policy, startedAt, "jev_progress", "jevProgress");
    if (denied) return denied;
    return await nativeJevProgress(rawInput, policy, cwd, startedAt);
  }

  if (effectiveAction === "jev_memory") {
    const denied = denyJevActiveTool(policy, startedAt, "jev_memory", "jevMemory");
    if (denied) return denied;
    return await nativeJevMemory(rawInput, policy, cwd, startedAt);
  }

  if (effectiveAction === "jev_compress") {
    const denied = denyJevActiveTool(policy, startedAt, "jev_compress", "jevCompress");
    if (denied) return denied;
    if (policy?.tools?.clearToolHistory === false) {
      return {
        ok: false,
        kind: "capability_denied",
        exitCode: 228,
        stdout: "",
        stderr: "action 'jev_compress' requires 'clearToolHistory' enabled in enhancement tools (§6) to prune; enable it first",
        saVmEvents: [],
        saVmViolation: { reason: "clearToolHistory disabled" },
        durationMs: Date.now() - startedAt
      };
    }
    const rawMode = String(rawInput.mode ?? rawInput.question ?? "auto");
    const mode = rawMode === "subscription" || rawMode === "token" ? rawMode : "auto";
    const rawKeep = Number(rawInput.keep_last_n_turns ?? 2);
    const keepLastNTurns = Number.isFinite(rawKeep) ? Math.max(2, Math.floor(rawKeep)) : 2;
    const threshold = Number(rawInput.threshold ?? 85);
    const plan = {
      action: "jev_compress",
      mode,
      steps: [
        "1. jev_checklist gate (conclusion_formed, no_future_dep, keep_recent>=2, only_readonly)",
        "2. add_memory: distill key facts with file:line hooks (<=1000 chars/memory; save_note supported as alias)",
        "3. clear_tool_history with keep_last_n_turns>=2, filter_tools=[read_file,read_lines,grep_search,grep_search_async,list_dir,find_files]",
        "4. continue; re-fetch via read_memory (or read_notes) + read_lines on demand"
      ],
      keep_last_n_turns: keepLastNTurns,
      filter_tools: ["read_file", "read_lines", "grep_search", "grep_search_async", "list_dir", "find_files"],
      threshold: Number.isFinite(threshold) ? threshold : 85,
      note: mode === "subscription"
        ? "aggressive: prune at each phase boundary"
        : mode === "token"
          ? "threshold-gated: prune only at/above threshold to avoid costly re-reads"
          : "auto: caller picks aggressive vs threshold by billing mode"
    };
    return {
      ok: true,
      kind: "success",
      exitCode: 0,
      stdout: JSON.stringify(plan, null, 2),
      stderr: "",
      saVmEvents: [{ timestamp: Date.now(), type: "compress_planned", action: "jev_compress", mode: String(mode) }],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  }

  if (
    effectiveAction === "ledger_status" ||
    effectiveAction === "accountability_status" ||
    effectiveAction === "vm_reputation" ||
    effectiveAction === "reputation_status"
  ) {
    const raw = rawInput as Record<string, unknown>;
    const customLedgerPath = typeof raw.ledger_path === "string" ? raw.ledger_path : undefined;
    const status = await getReputationStatus(cwd, customLedgerPath);
    const summaryLines = [
      `【SA-VM 责任与信誉账本 (Accountability Ledger)】`,
      `• 信誉分值：${status.score}/100`,
      `• 管控梯队：[${status.tier}] (${status.tier === "GREEN" ? "正常自治" : status.tier === "YELLOW" ? "中度审慎" : "高危管控 · JEV 全自动督导"})`,
      `• 历史惩罚项：${status.totalPenaltiesCount} 条（未赎回：${status.activePenalties.length} 条，已赎回：${status.redeemedPenalties.length} 条）`,
      `• 活性抗体规则：${status.antibodies.length} 条`,
      `• 账本路径：${status.ledgerPath}`,
    ];
    if (status.activePenalties.length > 0) {
      summaryLines.push(`• 未赎回惩罚：`);
      for (const p of status.activePenalties) {
        summaryLines.push(`  - [${p.id}] ${p.level} (${p.scoreDelta} pts): ${p.targetFile} -> ${p.errorSignature}`);
      }
    }
    if (status.antibodies.length > 0) {
      summaryLines.push(`• 已固化抗体规则 (永久免疫)：`);
      for (const a of status.antibodies) {
        summaryLines.push(`  - [${a.targetFile}] 规则: "${a.rule}" (经验: ${a.lesson})`);
      }
    }
    return {
      ok: true,
      kind: "success",
      exitCode: 0,
      stdout: JSON.stringify({
        action: "ledger_status",
        ...status,
        summary: summaryLines.join("\n"),
      }, null, 2),
      stderr: "",
      saVmEvents: [],
      saVmViolation: null,
      durationMs: Date.now() - startedAt
    };
  }

  if (effectiveAction === "record_penalty" || effectiveAction === "penalize") {
    const raw = rawInput as Record<string, unknown>;
    const targetFile = targetFilePath || (typeof raw.target === "string" ? raw.target : "");
    if (!targetFile) throw new SaVmInputError("action 'record_penalty' requires a 'path' or 'target' parameter");
    const rawLevel = typeof raw.level === "string" ? raw.level.trim().toUpperCase() : "L1_SYNTAX";
    const level: PenaltyLevel = (rawLevel === "L2_REGRESSION" || rawLevel === "L3_THRASH" || rawLevel === "CUSTOM") ? rawLevel : "L1_SYNTAX";
    const errorSignature = typeof raw.error_signature === "string" ? raw.error_signature : typeof raw.error === "string" ? raw.error : typeof raw.signature === "string" ? raw.signature : "Unspecified error";
    const details = typeof raw.details === "string" ? raw.details : typeof raw.message === "string" ? raw.message : undefined;
    const scoreDelta = typeof raw.score_delta === "number" ? raw.score_delta : typeof raw.delta === "number" ? raw.delta : undefined;
    const customLedgerPath = typeof raw.ledger_path === "string" ? raw.ledger_path : undefined;

    const result = await recordPenalty({
      targetFile,
      level,
      errorSignature,
      details,
      scoreDelta,
      cwd,
      customLedgerPath,
    });

    const summary = [
      `【SA-VM 惩罚记录已永久写入账本】`,
      `• 惩罚编号：[${result.penalty.id}]`,
      `• 违规等级：${result.penalty.level} (${result.penalty.scoreDelta} 分)`,
      `• 目标文件：${result.penalty.targetFile}`,
      `• 错误特征：${result.penalty.errorSignature}`,
      `• 最新信誉分：${result.status.score}/100 [梯队: ${result.status.tier}]`,
      `• 永久性约束：历史记录不可删除。请修复缺陷并提交 submit_redemption 获取愈合奖励。`,
    ].join("\n");

    return {
      ok: true,
      kind: "success",
      exitCode: 0,
      stdout: JSON.stringify({
        action: "record_penalty",
        penalty: result.penalty,
        status: result.status,
        summary,
      }, null, 2),
      stderr: "",
      saVmEvents: [{ event: "penalty_recorded", penaltyId: result.penalty.id, level: result.penalty.level }],
      saVmViolation: null,
      durationMs: Date.now() - startedAt,
    };
  }

  if (effectiveAction === "submit_redemption" || effectiveAction === "redeem_penalty" || effectiveAction === "claim_reward") {
    const raw = rawInput as Record<string, unknown>;
    const penaltyId = typeof raw.penalty_id === "string" ? raw.penalty_id : typeof raw.id === "string" ? raw.id : "";
    if (!penaltyId) throw new SaVmInputError("action 'submit_redemption' requires a 'penalty_id' parameter");
    const verificationEvidence = typeof raw.verification_evidence === "string" ? raw.verification_evidence : typeof raw.evidence === "string" ? raw.evidence : typeof raw.proof === "string" ? raw.proof : "";
    const lessonLearned = typeof raw.lesson_learned === "string" ? raw.lesson_learned : typeof raw.lesson === "string" ? raw.lesson : "";
    const antibodyRule = typeof raw.antibody_rule === "string" ? raw.antibody_rule : typeof raw.rule === "string" ? raw.rule : "";
    const customLedgerPath = typeof raw.ledger_path === "string" ? raw.ledger_path : undefined;

    const res = await submitRedemption({
      penaltyId,
      verificationEvidence,
      lessonLearned,
      antibodyRule,
      cwd,
      customLedgerPath,
    });

    if (!res.ok) {
      return {
        ok: false,
        kind: "sa_error",
        exitCode: 1,
        stdout: "",
        stderr: res.error ?? "Redemption rejected by supervisor",
        saVmEvents: [],
        saVmViolation: null,
        durationMs: Date.now() - startedAt,
      };
    }

    const summary = [
      `【SA-VM 赎回成功 · 愈合奖励已入账】`,
      `• 奖励编号：[${res.reward?.id}]`,
      `• 对应惩罚：[${res.reward?.linkedPenaltyId}] (已标记赎回，永久保留于历史库)`,
      `• 恢复分值：+${res.restoredScore} 分 -> 当前信誉分: ${res.status.score}/100 [梯队: ${res.status.tier}]`,
      `• 沉淀抗体：${res.reward?.antibodyRule}`,
      `• 学习经验：${res.reward?.lessonLearned}`,
    ].join("\n");

    return {
      ok: true,
      kind: "success",
      exitCode: 0,
      stdout: JSON.stringify({
        action: "submit_redemption",
        reward: res.reward,
        status: res.status,
        summary,
      }, null, 2),
      stderr: "",
      saVmEvents: [{ event: "reward_recorded", rewardId: res.reward?.id, linkedPenaltyId: res.reward?.linkedPenaltyId }],
      saVmViolation: null,
      durationMs: Date.now() - startedAt,
    };
  }

  if (effectiveAction === "get_antibodies" || effectiveAction === "list_antibodies") {
    const raw = rawInput as Record<string, unknown>;
    const customLedgerPath = typeof raw.ledger_path === "string" ? raw.ledger_path : undefined;
    const status = await getReputationStatus(cwd, customLedgerPath);
    const targetFile = targetFilePath || (typeof raw.target === "string" ? raw.target : "");

    const antibodies = targetFile
      ? status.antibodies.filter((a) => a.targetFile === targetFile || a.targetFile.endsWith(targetFile) || targetFile.endsWith(a.targetFile))
      : status.antibodies;

    return {
      ok: true,
      kind: "success",
      exitCode: 0,
      stdout: JSON.stringify({
        action: "get_antibodies",
        targetFile: targetFile || "all",
        antibodies,
        total: antibodies.length,
      }, null, 2),
      stderr: "",
      saVmEvents: [],
      saVmViolation: null,
      durationMs: Date.now() - startedAt,
    };
  }

  if (
    effectiveAction === "find_references" ||
    effectiveAction === "find_all_references" ||
    effectiveAction === "find_callers" ||
    effectiveAction === "references" ||
    effectiveAction === "find_usages"
  ) {
    const symbol = rawInput.symbol ?? rawInput.query ?? rawInput.content ?? "";
    return await nativeFindReferences(symbol, {
      detail: rawInput.detail,
      candidate_files: rawInput.candidate_files,
      files: rawInput.files,
      max_results: rawInput.max_results,
      limit: rawInput.limit,
      max_tokens: rawInput.max_tokens,
      dir: rawInput.dir,
      pattern: rawInput.pattern,
      exclude_comments: rawInput.exclude_comments,
      include_declarations: rawInput.include_declarations,
      timeout_ms: rawInput.timeout_ms,
      timeout: rawInput.timeout,
      page: rawInput.page ?? rawInput.page_num ?? rawInput.pageNum ?? rawInput.p,
      page_size: rawInput.page_size ?? rawInput.pageSize ?? rawInput.per_page ?? rawInput.perPage,
      offset: rawInput.offset,
      count_cap: rawInput.count_cap ?? rawInput.countCap ?? rawInput.max_total,
      exact_total: rawInput.exact_total ?? rawInput.exactTotal
    }, policy, cwd, startedAt);
  }

  if (
    effectiveAction === "find_implementations" ||
    effectiveAction === "find_impl" ||
    effectiveAction === "implementations"
  ) {
    const symbol = rawInput.symbol ?? rawInput.query ?? rawInput.content ?? rawInput.name ?? rawInput.target ?? "";
    return await nativeFindImplementations(symbol, {
      dir: rawInput.dir,
      pattern: rawInput.pattern,
      candidate_files: rawInput.candidate_files,
      files: rawInput.files,
      include_body: rawInput.include_body,
      detail: rawInput.detail,
      max_results: rawInput.max_results,
      limit: rawInput.limit,
      max_tokens: rawInput.max_tokens,
      timeout_ms: rawInput.timeout_ms,
      timeout: rawInput.timeout,
      page: rawInput.page ?? rawInput.page_num ?? rawInput.pageNum ?? rawInput.p,
      page_size: rawInput.page_size ?? rawInput.pageSize ?? rawInput.per_page ?? rawInput.perPage,
      offset: rawInput.offset,
      count_cap: rawInput.count_cap ?? rawInput.countCap ?? rawInput.max_total,
      exact_total: rawInput.exact_total ?? rawInput.exactTotal
    }, policy, cwd, startedAt);
  }

  if (
    effectiveAction === "file_outline" ||
    effectiveAction === "outline" ||
    effectiveAction === "list_symbols" ||
    effectiveAction === "file_symbols" ||
    effectiveAction === "document_symbols"
  ) {
    const targetPath = rawInput.path ?? rawInput.file ?? "";
    return await nativeFileOutline(targetPath, {
      detail: rawInput.detail,
      max_tokens: rawInput.max_tokens,
      max_file_bytes: rawInput.max_file_bytes ?? rawInput.maxFileBytes ?? rawInput.max_bytes
    }, policy, cwd, startedAt);
  }

  if (
    effectiveAction === "code_graph" ||
    effectiveAction === "relation_graph" ||
    effectiveAction === "symbol_graph"
  ) {
    return await nativeCodeGraph(rawInput, policy, cwd, startedAt);
  }

  if (effectiveAction === "workspace_outline" || effectiveAction === "outline_many" || effectiveAction === "project_outline") {
    const outlineDir = (typeof rawInput.dir === "string" && rawInput.dir.trim())
      || (typeof rawInput.path === "string" && rawInput.path.trim())
      || (typeof rawInput.file === "string" && rawInput.file.trim())
      || (typeof rawInput.target === "string" && rawInput.target.trim())
      || ".";
    return await nativeWorkspaceOutline(outlineDir, {
      pattern: typeof rawInput.pattern === "string" ? rawInput.pattern : undefined,
      path_pattern: rawInput.path_pattern,
      is_regex: rawInput.is_regex ?? rawInput.regex,
      max_files: rawInput.max_files,
      max_symbols_per_file: rawInput.max_symbols_per_file,
      max_tokens: rawInput.max_tokens,
      max_file_bytes: rawInput.max_file_bytes ?? rawInput.maxFileBytes ?? rawInput.max_bytes,
      exclude_dirs: parseExcludeDirs(rawInput),
      detail: rawInput.detail,
      timeout_ms: rawInput.timeout_ms,
      timeout: rawInput.timeout,
      page: rawInput.page ?? rawInput.page_num ?? rawInput.pageNum ?? rawInput.p,
      page_size: rawInput.page_size ?? rawInput.pageSize ?? rawInput.per_page ?? rawInput.perPage,
      offset: rawInput.offset,
      count_cap: rawInput.count_cap ?? rawInput.countCap ?? rawInput.max_total,
      exact_total: rawInput.exact_total ?? rawInput.exactTotal
    }, policy, cwd, startedAt);
  }

  if (effectiveAction === "read_many" || effectiveAction === "read_files") {
    const raw = rawInput as Record<string, unknown>;
    let rawFiles: unknown = raw.files ?? raw.paths ?? raw.filenames ?? raw.file_list ?? raw.fileList;
    if (rawFiles === undefined && typeof raw.path === "string") rawFiles = [raw.path];
    else if (rawFiles === undefined && typeof raw.file === "string") rawFiles = [raw.file];
    const rawList = Array.isArray(rawFiles)
      ? rawFiles
      : (typeof rawFiles === "string" ? [rawFiles] : []);
    const numOrUndef = (v: unknown): number | undefined => {
      if (typeof v === "number" && Number.isFinite(v)) return v;
      if (typeof v === "string" && /^-?\d+$/.test(v.trim())) return Number(v.trim());
      return undefined;
    };
    return await nativeReadMany(rawList as string[], {
      start_line: numOrUndef(raw.start_line ?? raw.startLine),
      end_line: numOrUndef(raw.end_line ?? raw.endLine),
      max_tokens_per_file: numOrUndef(raw.max_tokens_per_file ?? raw.maxTokensPerFile),
      max_tokens: numOrUndef(raw.max_tokens ?? raw.maxTokens ?? raw.max_token),
    }, policy, cwd, startedAt);
  }

  if (effectiveAction === "rename_symbol" || effectiveAction === "symbol_rename") {
    const symbol = rawInput.symbol ?? rawInput.old_name ?? rawInput.old_text ?? "";
    const newName = rawInput.new_name ?? rawInput.new_text ?? "";
    return await nativeRenameSymbol(symbol, newName, {
      path: rawInput.path,
      dir: rawInput.dir,
      candidate_files: rawInput.candidate_files,
      files: rawInput.files,
      dry_run: rawInput.dry_run,
      detail: rawInput.detail,
      timeout_ms: rawInput.timeout_ms,
      timeout: rawInput.timeout
    }, policy, cwd, startedAt);
  }

  if (effectiveAction === "move_file_with_imports" || effectiveAction === "move_with_imports") {
    const from = rawInput.from ?? rawInput.source ?? rawInput.path ?? "";
    const to = rawInput.to ?? rawInput.dest ?? rawInput.target ?? "";
    return await nativeMoveFileWithImports(from, to, {
      dry_run: rawInput.dry_run
    }, policy, cwd, startedAt);
  }

  if (
    effectiveAction === "find_definition" ||
    effectiveAction === "goto_definition" ||
    effectiveAction === "def" ||
    effectiveAction === "lookup_symbol" ||
    effectiveAction === "get_definition"
  ) {
    const symbol = rawInput.symbol ?? rawInput.query ?? rawInput.old_name ?? "";
    const targetPath = rawInput.path ?? rawInput.file ?? undefined;
    return await nativeFindDefinition(symbol, targetPath, {
      include_body: rawInput.include_body,
      max_lines: rawInput.max_lines
    }, policy, cwd, startedAt);
  }

  if (effectiveAction === "extract_to_file" || effectiveAction === "extract_file" || effectiveAction === "extract_module") {
    const source = rawInput.source ?? rawInput.from ?? rawInput.path ?? "";
    const target = rawInput.target ?? rawInput.to ?? rawInput.dest ?? "";
    const rawRec = rawInput as Record<string, unknown>;
    const startLine = pickLineBound(rawRec, "start_line", "startLine");
    const endLine = pickLineBound(rawRec, "end_line", "endLine");
    const symbols = rawInput.symbols ?? rawInput.exported_symbols;
    return await nativeExtractToFile(source, target, startLine, endLine, {
      symbols,
      component_name: rawInput.component_name,
      dry_run: rawInput.dry_run,
      raw: rawInput.raw === true || rawInput.mode === "raw",
      keep_source: (rawInput as Record<string, unknown>).keep_source === true || (rawInput as Record<string, unknown>).keepSource === true
    }, policy, cwd, startedAt);
  }

  if (effectiveAction === "add_import" || effectiveAction === "insert_import") {
    const targetPath = rawInput.path ?? rawInput.file ?? "";
    const statement = rawInput.statement ?? rawInput.import_statement;
    const symbol = rawInput.symbol;
    const module = rawInput.module;
    return await nativeAddImport(targetPath, {
      statement,
      symbol,
      module,
      is_type: rawInput.is_type,
      dry_run: rawInput.dry_run
    }, policy, cwd, startedAt);
  }

  if (effectiveAction === "get_diagnostics" || effectiveAction === "diagnostics" || effectiveAction === "check_syntax") {
    const targetPath = rawInput.path ?? rawInput.file ?? "";
    return await nativeGetDiagnostics(targetPath, policy, cwd, startedAt);
  }

  if (
    effectiveAction === "workspace_diagnostics" ||
    effectiveAction === "project_diagnostics" ||
    effectiveAction === "all_diagnostics"
  ) {
    const targetDir = rawInput.dir ?? rawInput.path ?? rawInput.file ?? ".";
    return await nativeWorkspaceDiagnostics(targetDir, {
      pattern: rawInput.pattern,
      max_files: rawInput.max_files,
      max_errors: rawInput.max_errors,
      max_tokens: rawInput.max_tokens,
      detail: rawInput.detail,
      timeout_ms: rawInput.timeout_ms,
      timeout: rawInput.timeout,
      page: rawInput.page ?? rawInput.page_num ?? rawInput.pageNum ?? rawInput.p,
      page_size: rawInput.page_size ?? rawInput.pageSize ?? rawInput.per_page ?? rawInput.perPage,
      offset: rawInput.offset,
      count_cap: rawInput.count_cap ?? rawInput.countCap ?? rawInput.max_total,
      exact_total: rawInput.exact_total ?? rawInput.exactTotal
    }, policy, cwd, startedAt);
  }

  if (effectiveAction === "repo_map" || effectiveAction === "repo-map") {
    const targetDir = (typeof rawInput.dir === "string" && rawInput.dir.trim())
      || (typeof rawInput.path === "string" && rawInput.path.trim())
      || (typeof rawInput.file === "string" && rawInput.file.trim())
      || (typeof rawInput.target === "string" && rawInput.target.trim())
      || ".";
    return await nativeRepoMap(targetDir, {
      pattern: typeof rawInput.pattern === "string" ? rawInput.pattern : undefined,
      path_pattern: rawInput.path_pattern,
      is_regex: rawInput.is_regex ?? rawInput.regex,
      max_files: rawInput.max_files,
      max_symbols_per_file: rawInput.max_symbols_per_file,
      max_tokens: rawInput.max_tokens ?? rawInput.max_token ?? rawInput.maxtoken,
      max_file_bytes: rawInput.max_file_bytes ?? rawInput.maxFileBytes ?? rawInput.max_bytes,
      exclude_dirs: parseExcludeDirs(rawInput),
      include_used_by: rawInput.detail !== false,
      timeout_ms: rawInput.timeout_ms,
      timeout: rawInput.timeout,
      page: rawInput.page ?? rawInput.page_num ?? rawInput.pageNum ?? rawInput.p,
      page_size: rawInput.page_size ?? rawInput.pageSize ?? rawInput.per_page ?? rawInput.perPage,
      offset: rawInput.offset,
      count_cap: rawInput.count_cap ?? rawInput.countCap ?? rawInput.max_total,
      exact_total: rawInput.exact_total ?? rawInput.exactTotal
    }, policy, cwd, startedAt);
  }

  if (
    effectiveAction === "add_memory" ||
    effectiveAction === "edit_memory" ||
    effectiveAction === "save_memory" ||
    effectiveAction === "save_note" ||
    effectiveAction === "add_note"
  ) {
    const key = (typeof rawInput.key === "string" && rawInput.key.trim())
      || (typeof rawInput.name === "string" && rawInput.name.trim())
      || (typeof rawInput.topic === "string" && rawInput.topic.trim())
      || (typeof rawInput.title === "string" && rawInput.title.trim())
      || (typeof rawInput.symbol === "string" && rawInput.symbol.trim())
      || "";
    const content = (typeof rawInput.content === "string" ? rawInput.content : "")
      || (typeof rawInput.memory === "string" ? rawInput.memory : "")
      || (typeof rawInput.fact === "string" ? rawInput.fact : "")
      || (typeof rawInput.statement === "string" ? rawInput.statement : "")
      || (typeof rawInput.reason === "string" ? rawInput.reason : "")
      || (typeof rawInput.value === "string" ? rawInput.value : "")
      || (typeof rawInput.text === "string" ? rawInput.text : "");
    const level = (typeof rawInput.level === "string" && rawInput.level.trim())
      || (typeof rawInput.priority === "string" && rawInput.priority.trim())
      || (typeof rawInput.importance === "string" && rawInput.importance.trim())
      || undefined;
    return await nativeSaveNote(key, content, level, policy, cwd, startedAt, rawInput.scope, effectiveAction);
  }

  if (
    effectiveAction === "read_memory" ||
    effectiveAction === "get_memory" ||
    effectiveAction === "search_memory" ||
    effectiveAction === "list_memory" ||
    effectiveAction === "read_notes" ||
    effectiveAction === "read_note" ||
    effectiveAction === "list_notes" ||
    effectiveAction === "search_notes" ||
    effectiveAction === "search_note"
  ) {
    const key = (typeof rawInput.key === "string" && rawInput.key.trim())
      || (typeof rawInput.name === "string" && rawInput.name.trim())
      || (typeof rawInput.topic === "string" && rawInput.topic.trim())
      || (typeof rawInput.query === "string" && rawInput.query.trim())
      || (typeof rawInput.q === "string" && rawInput.q.trim())
      || undefined;
    const maxTokens = rawInput.max_tokens ?? rawInput.max_token ?? rawInput.maxtoken;
    const remainingTokens = typeof rawInput.remaining_tokens === "number"
      ? rawInput.remaining_tokens
      : (typeof rawInput.tokens_remaining === "number" ? rawInput.tokens_remaining : (typeof rawInput.tokens_left === "number" ? rawInput.tokens_left : undefined));
    return await nativeReadNotes(key, maxTokens, remainingTokens, policy, cwd, startedAt, {
      page: rawInput.page ?? rawInput.page_num ?? rawInput.pageNum ?? rawInput.p,
      page_size: rawInput.page_size ?? rawInput.pageSize ?? rawInput.per_page ?? rawInput.perPage,
      offset: rawInput.offset
    }, rawInput.scope, effectiveAction);
  }

  if (
    effectiveAction === "delete_memory" ||
    effectiveAction === "remove_memory" ||
    effectiveAction === "clear_memory" ||
    effectiveAction === "delete_note" ||
    effectiveAction === "remove_note" ||
    effectiveAction === "clear_notes"
  ) {
    const key = (typeof rawInput.key === "string" && rawInput.key.trim())
      || (typeof rawInput.name === "string" && rawInput.name.trim())
      || (typeof rawInput.topic === "string" && rawInput.topic.trim())
      || undefined;
    const all = rawInput.all === true || effectiveAction === "clear_notes" || effectiveAction === "clear_memory";
    return await nativeDeleteNote(key, all, policy, cwd, startedAt, rawInput.scope, effectiveAction);
  }

  if (effectiveAction === "verify_loop" || effectiveAction === "verify-loop" || effectiveAction === "verify_changed") {
    const target = (typeof rawInput.dir === "string" && rawInput.dir.trim())
      || (typeof rawInput.path === "string" && rawInput.path.trim())
      || (typeof rawInput.target === "string" && rawInput.target.trim())
      || ".";
    const files = Array.isArray(rawInput.files)
      ? rawInput.files.filter((entry): entry is string => typeof entry === "string")
      : (typeof rawInput.files === "string" ? [rawInput.files] : undefined);
    return await nativeVerifyLoop(target, {
      files,
      pattern: typeof rawInput.pattern === "string" ? rawInput.pattern : undefined,
      max_files: rawInput.max_files,
      max_errors: rawInput.max_errors ?? rawInput.max_results ?? rawInput.limit,
      max_tokens: rawInput.max_tokens ?? rawInput.max_token ?? rawInput.maxtoken,
      timeout_ms: rawInput.timeout_ms,
      timeout: rawInput.timeout,
      page: rawInput.page ?? rawInput.page_num ?? rawInput.pageNum ?? rawInput.p,
      page_size: rawInput.page_size ?? rawInput.pageSize ?? rawInput.per_page ?? rawInput.perPage,
      offset: rawInput.offset,
      count_cap: rawInput.count_cap ?? rawInput.countCap ?? rawInput.max_total,
      exact_total: rawInput.exact_total ?? rawInput.exactTotal
    }, policy, cwd, startedAt);
  }

  if (effectiveAction === "replay_case" || effectiveAction === "run_regression" || effectiveAction === "regression_replay") {
    return await nativeReplayCase(rawInput as Record<string, unknown>, cwd, startedAt);
  }

  if (effectiveAction === "record_case" || effectiveAction === "save_case") {
    return await nativeRecordCase(rawInput as Record<string, unknown>, cwd, startedAt);
  }

  if (effectiveAction === "organize_imports" || effectiveAction === "clean_unused_imports" || effectiveAction === "sort_imports") {
    const targetPath = rawInput.path ?? rawInput.file ?? "";
    return await nativeOrganizeImports(targetPath, {
      sort: rawInput.sort,
      remove_unused: rawInput.remove_unused,
      merge_duplicates: rawInput.merge_duplicates,
      dry_run: rawInput.dry_run
    }, policy, cwd, startedAt);
  }

  if (effectiveAction === "analyze_scope" || effectiveAction === "scope_analysis") {
    const targetPath = rawInput.path ?? rawInput.file ?? "";
    const startLine = rawInput.start_line;
    const endLine = rawInput.end_line;
    return await nativeAnalyzeScope(targetPath, startLine, endLine, {
      component_name: rawInput.component_name
    }, policy, cwd, startedAt);
  }

  if (effectiveAction === "extract_component" || effectiveAction === "extract_hook") {
    const source = rawInput.source ?? rawInput.from ?? rawInput.path ?? "";
    const target = rawInput.target ?? rawInput.to ?? rawInput.dest ?? "";
    const rawRec = rawInput as Record<string, unknown>;
    return await nativeExtractComponent(source, target, pickLineBound(rawRec, "start_line", "startLine"), pickLineBound(rawRec, "end_line", "endLine"), {
      component_name: (rawInput as any).component_name ?? (rawInput as any).hook_name,
      hook_name: (rawInput as any).hook_name,
      dry_run: rawInput.dry_run,
      keep_source: (rawInput as Record<string, unknown>).keep_source === true || (rawInput as Record<string, unknown>).keepSource === true
    }, policy, cwd, startedAt);
  }

  if (effectiveAction === "auto_fix_missing_imports" || effectiveAction === "fix_missing_imports") {
    const targetPath = rawInput.path ?? rawInput.file ?? "";
    return await nativeAutoFixMissingImports(targetPath, { dry_run: rawInput.dry_run }, policy, cwd, startedAt);
  }

  if (effectiveAction === "analyze_coupling" || effectiveAction === "cluster_symbols") {
    const targetPath = rawInput.path ?? rawInput.file ?? "";
    return await nativeAnalyzeCoupling(targetPath, { top_n: (rawInput as any).top_n ?? (rawInput as any).topN }, policy, cwd, startedAt);
  }

  if (effectiveAction === "atomic_refactor" || effectiveAction === "refactor_dry_run") {
    const ops = Array.isArray((rawInput as any).ops) ? (rawInput as any).ops
      : Array.isArray((rawInput as any).files) ? (rawInput as any).files
      : (rawInput.path && typeof (rawInput as any).content === "string" ? [{ path: rawInput.path, content: (rawInput as any).content }] : []);
    return await nativeAtomicRefactor(ops, { dry_run: rawInput.dry_run }, policy, cwd, startedAt);
  }

  if (effectiveAction === "split_plan" || effectiveAction === "split_stage" || effectiveAction === "split_refine" || effectiveAction === "split_repair" || effectiveAction === "split_status") {
    const raw = rawInput as Record<string, unknown>;
    return await runSplitWorkflowAction({
      action: effectiveAction,
      path: (raw.path ?? raw.file) as string | undefined,
      session_id: (raw.session_id ?? raw.sessionId ?? raw.session) as string | undefined,
      task: raw.task as string | undefined,
      phase: raw.phase as string | undefined,
      module_name: (raw.module_name ?? raw.moduleName ?? raw.module) as string | undefined,
      ops: (Array.isArray(raw.ops) ? raw.ops : Array.isArray(raw.tasks) ? raw.tasks : undefined) as Array<{ path: string; content?: string; patch?: string }> | undefined,
      confirm: raw.confirm as boolean | undefined,
      additionalRoots: raw.additionalRoots as string[] | undefined,
    }, policy, cwd, startedAt) as SaVmRunResult;
  }

  if (effectiveAction === "run_bun") {
    let subcommand = typeof rawInput.subcommand === "string" ? rawInput.subcommand.trim().toLowerCase() : "";
    let args: string[] = Array.isArray(rawInput.args)
      ? rawInput.args.filter((a): a is string => typeof a === "string")
      : [];

    if (!subcommand && args.length > 0) {
      subcommand = args[0]!.toLowerCase();
      args = args.slice(1);
    }

    if (args.length === 0) {
      const fallbackTarget = typeof rawInput.test_file === "string" && rawInput.test_file.trim()
        ? rawInput.test_file.trim()
        : (typeof rawInput.path === "string" && rawInput.path.trim() ? rawInput.path.trim() : "");
      if (fallbackTarget) args.push(fallbackTarget);
    }

    if (!subcommand) {
      return {
        ok: false,
        kind: "capability_denied",
        exitCode: 228,
        stdout: "",
        stderr: "Bun execution denied: subcommand is required for run_bun",
        saVmEvents: [{ event: "violation", kind: "capability_denied", reason: "subcommand is required for run_bun" }],
        saVmViolation: { rule: "process.bun.subcommand_required", blocked: true },
        durationMs: Date.now() - startedAt
      };
    }

    // Check denylist (FR-2)
    if ((SA_VM_BUN_DENIED_SUBCOMMANDS as readonly string[]).includes(subcommand)) {
      const reason = `Bun subcommand '${subcommand}' is forbidden in sa-vm`;
      return {
        ok: false,
        kind: "capability_denied",
        exitCode: 228,
        stdout: "",
        stderr: `Bun execution denied: ${reason}`,
        saVmEvents: [{ event: "violation", kind: "capability_denied", reason }],
        saVmViolation: { rule: "process.bun.denied_subcommand", blocked: true },
        durationMs: Date.now() - startedAt
      };
    }

    // Check allowlist
    if (!(ALL_SA_VM_BUN_SUBCOMMANDS as readonly string[]).includes(subcommand as SaVmBunSubcommand)) {
      const reason = `Unknown or unsupported Bun subcommand: '${subcommand}'`;
      return {
        ok: false,
        kind: "capability_denied",
        exitCode: 228,
        stdout: "",
        stderr: `Bun execution denied: ${reason}`,
        saVmEvents: [{ event: "violation", kind: "capability_denied", reason }],
        saVmViolation: { rule: "process.bun.unsupported_subcommand", blocked: true },
        durationMs: Date.now() - startedAt
      };
    }

    // Check forbidden args / flags (FR-3)
    for (const arg of args) {
      if (arg === "--preload" || arg.startsWith("--preload=")) {
        const reason = "--preload flag is forbidden in sa-vm";
        return {
          ok: false,
          kind: "capability_denied",
          exitCode: 228,
          stdout: "",
          stderr: `Bun execution denied: ${reason}`,
          saVmEvents: [{ event: "violation", kind: "capability_denied", reason }],
          saVmViolation: { rule: "process.bun.preload_forbidden", blocked: true },
          durationMs: Date.now() - startedAt
        };
      }
      if (arg === "-e" || arg === "--eval" || arg.startsWith("-e=")) {
        const reason = "inline evaluation (-e, --eval) is forbidden in sa-vm";
        return {
          ok: false,
          kind: "capability_denied",
          exitCode: 228,
          stdout: "",
          stderr: `Bun execution denied: ${reason}`,
          saVmEvents: [{ event: "violation", kind: "capability_denied", reason }],
          saVmViolation: { rule: "process.bun.inline_code_forbidden", blocked: true },
          durationMs: Date.now() - startedAt
        };
      }
      if (/[;&|`$()<>]/.test(arg)) {
        const reason = `shell metacharacters are forbidden in bun argument: '${arg}'`;
        return {
          ok: false,
          kind: "capability_denied",
          exitCode: 228,
          stdout: "",
          stderr: `Bun execution denied: ${reason}`,
          saVmEvents: [{ event: "violation", kind: "capability_denied", reason }],
          saVmViolation: { rule: "process.bun.shell_metacharacters", blocked: true },
          durationMs: Date.now() - startedAt
        };
      }
    }

    const normalizedPolicy = normalizeSaVmPolicy(policy, cwd, rawInput.additionalRoots ?? []);

    let bun: string;
    try {
      bun = resolveBunBinary();
    } catch (error) {
      return {
        ok: false,
        kind: "unavailable",
        exitCode: null,
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
        saVmEvents: [],
        saVmViolation: null,
        durationMs: Date.now() - startedAt
      };
    }

    // VM sandbox off (policy === undefined) = fully open: bun subcommand gate
    // is skipped. Workspace file checks below still apply.
    const vmSandboxOff = policy === undefined;
    const policyDecision = vmSandboxOff
      ? { allowed: true as const, path: bun }
      : checkSaVmBunExecution(normalizedPolicy, bun, subcommand, args);
    if (!policyDecision.allowed) {
      return {
        ok: false,
        kind: "capability_denied",
        exitCode: 228,
        stdout: "",
        stderr: `Bun execution denied: ${policyDecision.reason}`,
        saVmEvents: [{ event: "violation", kind: "capability_denied", reason: policyDecision.reason }],
        saVmViolation: { rule: "process.bun", blocked: true },
        durationMs: Date.now() - startedAt
      };
    }

    const nonFlagArgs = args.filter((a) => !a.startsWith("-"));

    if (subcommand === "run") {
      if (nonFlagArgs.length === 0) {
        const reason = "'bun run' requires a target file path in sa-vm";
        return {
          ok: false,
          kind: "capability_denied",
          exitCode: 228,
          stdout: "",
          stderr: `Bun execution denied: ${reason}`,
          saVmEvents: [{ event: "violation", kind: "capability_denied", reason }],
          saVmViolation: { rule: "process.bun.run_target_required", blocked: true },
          durationMs: Date.now() - startedAt
        };
      }
      const targetFile = nonFlagArgs[0]!;
      const pathDecision = checkSaVmPath(normalizedPolicy, "read", targetFile, cwd);
      if (!pathDecision.allowed) {
        const reason = `target file path denied for 'bun run': ${pathDecision.reason}`;
        return {
          ok: false,
          kind: "capability_denied",
          exitCode: 228,
          stdout: "",
          stderr: `Bun execution denied: ${reason}`,
          saVmEvents: [{ event: "violation", kind: "capability_denied", reason }],
          saVmViolation: { rule: "process.bun.run_path_denied", blocked: true },
          durationMs: Date.now() - startedAt
        };
      }
      const resolvedTarget = resolve(cwd, targetFile);
      if (!pathWithin(cwd, resolvedTarget)) {
        const reason = `target file '${targetFile}' is outside workspace directory`;
        return {
          ok: false,
          kind: "capability_denied",
          exitCode: 228,
          stdout: "",
          stderr: `Bun execution denied: ${reason}`,
          saVmEvents: [{ event: "violation", kind: "capability_denied", reason }],
          saVmViolation: { rule: "process.bun.run_outside_workspace", blocked: true },
          durationMs: Date.now() - startedAt
        };
      }
      let isTargetAFile = false;
      try {
        isTargetAFile = existsSync(resolvedTarget) && statSync(resolvedTarget).isFile();
      } catch {
        isTargetAFile = false;
      }
      if (!isTargetAFile) {
        const reason = `'bun run' only allows executing existing workspace files (target file '${targetFile}' was not found in workspace). Arbitrary package.json scripts are disabled for sandbox safety.`;
        return {
          ok: false,
          kind: "capability_denied",
          exitCode: 228,
          stdout: "",
          stderr: `Bun execution denied: ${reason}`,
          saVmEvents: [{ event: "violation", kind: "capability_denied", reason }],
          saVmViolation: { rule: "process.bun.run_file_not_found", blocked: true },
          durationMs: Date.now() - startedAt
        };
      }
    } else if (subcommand === "test") {
      for (const targetFile of nonFlagArgs) {
        const pathDecision = checkSaVmPath(normalizedPolicy, "read", targetFile, cwd);
        if (!pathDecision.allowed) {
          const reason = `test file path denied: ${pathDecision.reason}`;
          return {
            ok: false,
            kind: "capability_denied",
            exitCode: 228,
            stdout: "",
            stderr: `Bun execution denied: ${reason}`,
            saVmEvents: [{ event: "violation", kind: "capability_denied", reason }],
            saVmViolation: { rule: "process.bun.test_path_denied", blocked: true },
            durationMs: Date.now() - startedAt
          };
        }
        const resolvedTarget = resolve(cwd, targetFile);
        if (!pathWithin(cwd, resolvedTarget)) {
          const reason = `test target '${targetFile}' is outside workspace directory`;
          return {
            ok: false,
            kind: "capability_denied",
            exitCode: 228,
            stdout: "",
            stderr: `Bun execution denied: ${reason}`,
            saVmEvents: [{ event: "violation", kind: "capability_denied", reason }],
            saVmViolation: { rule: "process.bun.test_outside_workspace", blocked: true },
            durationMs: Date.now() - startedAt
          };
        }
        if (!targetFile.includes("*") && !targetFile.includes("?") && !existsSync(resolvedTarget)) {
          const reason = `test file does not exist: ${targetFile}`;
          return {
            ok: false,
            kind: "capability_denied",
            exitCode: 228,
            stdout: "",
            stderr: `Bun execution denied: ${reason}`,
            saVmEvents: [{ event: "violation", kind: "capability_denied", reason }],
            saVmViolation: { rule: "process.bun.test_file_not_found", blocked: true },
            durationMs: Date.now() - startedAt
          };
        }
      }
    } else if (subcommand === "build") {
      const buildValueFlags = new Set([
        "--outdir",
        "--outfile",
        "--target",
        "--format",
        "--root",
        "--public-path",
        "--loader",
        "--entry-naming",
        "--chunk-naming",
        "--asset-naming",
        "--banner",
        "--footer",
        "--external",
        "--define"
      ]);
      const entryFiles: string[] = [];
      for (let i = 0; i < args.length; i++) {
        const a = args[i]!;
        if (a.startsWith("-")) {
          if (buildValueFlags.has(a)) {
            i++;
          }
          continue;
        }
        entryFiles.push(a);
      }

      if (entryFiles.length === 0) {
        const reason = "'bun build' requires at least one entry point file";
        return {
          ok: false,
          kind: "capability_denied",
          exitCode: 228,
          stdout: "",
          stderr: `Bun execution denied: ${reason}`,
          saVmEvents: [{ event: "violation", kind: "capability_denied", reason }],
          saVmViolation: { rule: "process.bun.build_entry_required", blocked: true },
          durationMs: Date.now() - startedAt
        };
      }
      for (const targetFile of entryFiles) {
        const pathDecision = checkSaVmPath(normalizedPolicy, "read", targetFile, cwd);
        if (!pathDecision.allowed) {
          const reason = `build entry path denied: ${pathDecision.reason}`;
          return {
            ok: false,
            kind: "capability_denied",
            exitCode: 228,
            stdout: "",
            stderr: `Bun execution denied: ${reason}`,
            saVmEvents: [{ event: "violation", kind: "capability_denied", reason }],
            saVmViolation: { rule: "process.bun.build_path_denied", blocked: true },
            durationMs: Date.now() - startedAt
          };
        }
        const resolvedTarget = resolve(cwd, targetFile);
        if (!pathWithin(cwd, resolvedTarget)) {
          const reason = `build entry '${targetFile}' is outside workspace directory`;
          return {
            ok: false,
            kind: "capability_denied",
            exitCode: 228,
            stdout: "",
            stderr: `Bun execution denied: ${reason}`,
            saVmEvents: [{ event: "violation", kind: "capability_denied", reason }],
            saVmViolation: { rule: "process.bun.build_outside_workspace", blocked: true },
            durationMs: Date.now() - startedAt
          };
        }
        if (!existsSync(resolvedTarget)) {
          const reason = `build entry file does not exist: ${targetFile}`;
          return {
            ok: false,
            kind: "capability_denied",
            exitCode: 228,
            stdout: "",
            stderr: `Bun execution denied: ${reason}`,
            saVmEvents: [{ event: "violation", kind: "capability_denied", reason }],
            saVmViolation: { rule: "process.bun.build_file_not_found", blocked: true },
            durationMs: Date.now() - startedAt
          };
        }
      }

      for (let i = 0; i < args.length; i++) {
        const arg = args[i]!;
        let outPath: string | null = null;
        if (arg === "--outdir" || arg === "--outfile") {
          outPath = args[i + 1] ?? null;
        } else if (arg.startsWith("--outdir=")) {
          outPath = arg.slice("--outdir=".length);
        } else if (arg.startsWith("--outfile=")) {
          outPath = arg.slice("--outfile=".length);
        }
        if (outPath) {
          const writeDecision = checkSaVmPath(normalizedPolicy, "write", outPath, cwd);
          if (!writeDecision.allowed) {
            const reason = `build output path '${outPath}' denied for write: ${writeDecision.reason}`;
            return {
              ok: false,
              kind: "capability_denied",
              exitCode: 228,
              stdout: "",
              stderr: `Bun execution denied: ${reason}`,
              saVmEvents: [{ event: "violation", kind: "capability_denied", reason }],
              saVmViolation: { rule: "process.bun.build_outdir_denied", blocked: true },
              durationMs: Date.now() - startedAt
            };
          }
          const resolvedOut = resolve(cwd, outPath);
          if (!pathWithin(cwd, resolvedOut)) {
            const reason = `build output path '${outPath}' is outside workspace directory`;
            return {
              ok: false,
              kind: "capability_denied",
              exitCode: 228,
              stdout: "",
              stderr: `Bun execution denied: ${reason}`,
              saVmEvents: [{ event: "violation", kind: "capability_denied", reason }],
              saVmViolation: { rule: "process.bun.build_outdir_outside_workspace", blocked: true },
              durationMs: Date.now() - startedAt
            };
          }
        }
      }
    } else if (subcommand === "--filter" || subcommand === "filter") {
      if (nonFlagArgs.length < 2) {
        const reason = "'bun --filter' requires a target package and script name (e.g. ['@codex-ui/shared', 'typecheck'])";
        return {
          ok: false,
          kind: "capability_denied",
          exitCode: 228,
          stdout: "",
          stderr: `Bun execution denied: ${reason}`,
          saVmEvents: [{ event: "violation", kind: "capability_denied", reason }],
          saVmViolation: { rule: "process.bun.filter_args_required", blocked: true },
          durationMs: Date.now() - startedAt
        };
      }
      const pkg = nonFlagArgs[0]!.trim();
      if (pkg.length === 0) {
        const reason = "'bun --filter' package name cannot be empty";
        return {
          ok: false,
          kind: "capability_denied",
          exitCode: 228,
          stdout: "",
          stderr: `Bun execution denied: ${reason}`,
          saVmEvents: [{ event: "violation", kind: "capability_denied", reason }],
          saVmViolation: { rule: "process.bun.filter_args_required", blocked: true },
          durationMs: Date.now() - startedAt
        };
      }
      const script = nonFlagArgs[1]!.toLowerCase();
      const allowedScripts: readonly string[] = ALL_SA_VM_BUN_FILTER_SCRIPTS;
      if (!allowedScripts.includes(script)) {
        const reason = `script '${script}' is not permitted with --filter (only ${allowedScripts.join(", ")} are allowed)`;
        return {
          ok: false,
          kind: "capability_denied",
          exitCode: 228,
          stdout: "",
          stderr: `Bun execution denied: ${reason}`,
          saVmEvents: [{ event: "violation", kind: "capability_denied", reason }],
          saVmViolation: { rule: "process.bun.filter_script_denied", blocked: true },
          durationMs: Date.now() - startedAt
        };
      }
    }

    const cleanArgs = args.filter((a) => a !== "--no-install" && a !== "--install");
    let commandArgs: string[];
    let timeoutMs = 120_000;

    if (subcommand === "--filter" || subcommand === "filter") {
      const pkg = nonFlagArgs[0]!;
      const script = nonFlagArgs[1]!.toLowerCase();
      const remainingArgs = cleanArgs.slice(2);
      commandArgs = ["--no-install", "--filter", pkg, script, ...remainingArgs];
      if (script === "test") timeoutMs = 300_000;
      else if (script === "build") timeoutMs = 180_000;
      else timeoutMs = 120_000;
    } else {
      commandArgs = [subcommand, "--no-install", ...cleanArgs];
      if (subcommand === "test") {
        timeoutMs = nonFlagArgs.length === 0 ? 300_000 : 120_000;
      } else if (subcommand === "build") {
        timeoutMs = 180_000;
      }
    }

    if (typeof rawInput.timeout_ms === "number" && rawInput.timeout_ms > 0) {
      timeoutMs = Math.max(1_000, Math.min(300_000, rawInput.timeout_ms));
    } else if (typeof rawInput.timeout === "number" && rawInput.timeout > 0) {
      timeoutMs = Math.max(1_000, Math.min(300_000, rawInput.timeout * 1000));
    }

    return await spawnScriptRunner(bun, commandArgs, cwd, timeoutMs, startedAt, false, {
      ...minimalRunnerEnv(),
      BUN_INSTALL_CACHE_DIR: join(cwd, ".codex-ultra", "bun-cache")
    });
  }

  if (effectiveAction === "run_bun_profile" || effectiveAction === "run_project_check" || effectiveAction === "project_check") {
    const profile = typeof rawInput.profile === "string" ? rawInput.profile.trim().toLowerCase() : "";
    const normalizedPolicy = normalizeSaVmPolicy(policy, cwd, rawInput.additionalRoots ?? []);
    // VM sandbox off (policy === undefined) = fully open: fixed-profile gate
    // is skipped. Test-file validation and integrity checks below still apply.
    const vmSandboxOffProfile = policy === undefined;
    const decision = vmSandboxOffProfile
      ? { allowed: true as const, path: profile }
      : checkSaVmBunProfile(normalizedPolicy, profile);
    if (!decision.allowed) {
      return {
        ok: false,
        kind: "capability_denied",
        exitCode: 228,
        stdout: "",
        stderr: `Project check profile denied: ${decision.reason}`,
        saVmEvents: [{ event: "violation", kind: "capability_denied", reason: decision.reason }],
        saVmViolation: { rule: "process.bunProfiles", blocked: true },
        durationMs: Date.now() - startedAt
      };
    }
    if (!SA_VM_BUN_PROFILES.includes(profile as SaVmBunProfile)) {
      throw new SaVmInputError(`Unknown project check profile: ${profile}`);
    }
    const integrity = verifyBunProfileIntegrity(profile as SaVmBunProfile, cwd);
    if (!integrity.ok) {
      return {
        ok: false,
        kind: "capability_denied",
        exitCode: 228,
        stdout: "",
        stderr: `Project check profile denied: ${integrity.reason}`,
        saVmEvents: [{ event: "violation", kind: "capability_denied", reason: integrity.reason }],
        saVmViolation: { rule: "process.bunProfiles.integrity", blocked: true },
        durationMs: Date.now() - startedAt
      };
    }

    let commandArgs: string[];
    if (profile === "server-test-file" || profile === "web-test-file" || profile === "shared-test-file") {
      const candidate = rawInput.test_file ?? rawInput.path ?? "";
      const validation = validateTestFilePath(profile as SaVmBunProfile, candidate, cwd);
      if (!validation.ok) {
        return {
          ok: false,
          kind: "capability_denied",
          exitCode: 228,
          stdout: "",
          stderr: `Test file execution denied: ${validation.reason}`,
          saVmEvents: [{ event: "violation", kind: "capability_denied", reason: validation.reason }],
          saVmViolation: { rule: "process.bunProfiles.test_file", blocked: true },
          durationMs: Date.now() - startedAt
        };
      }
      commandArgs = ["test", validation.relativePath];
    } else {
      const profileArgs: Record<string, string[]> = {
        "shared-typecheck": ["--filter", "@codex-ui/shared", "typecheck"],
        "protocol-typecheck": ["--filter", "@codex-ui/codex-protocol", "typecheck"],
        "server-typecheck": ["--filter", "@codex-ui/server", "typecheck"],
        "web-typecheck": ["--filter", "@codex-ui/web", "typecheck"],
        "free-key-typecheck": ["--filter", "@codex-ui/free-key-server", "typecheck"],
        "root-typecheck": ["--filter", "@codex-ui/shared", "--filter", "@codex-ui/codex-protocol", "--filter", "@codex-ui/server", "--filter", "@codex-ui/web", "--filter", "@codex-ui/free-key-server", "--parallel", "typecheck"],
        "shared-build": ["--filter", "@codex-ui/shared", "build"],
        "web-build": ["--filter", "@codex-ui/web", "build"]
      };
      commandArgs = profileArgs[profile]!;
    }

    let bun: string;
    try {
      bun = resolveBunBinary();
    } catch (error) {
      return {
        ok: false,
        kind: "unavailable",
        exitCode: null,
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
        saVmEvents: [],
        saVmViolation: null,
        durationMs: Date.now() - startedAt
      };
    }
    let projectCheckTimeoutMs = 120_000;
    if (profile.endsWith("-test-file") || profile === "root-typecheck") {
      projectCheckTimeoutMs = 300_000;
    } else if (profile.endsWith("-build")) {
      projectCheckTimeoutMs = 180_000;
    }
    if (typeof rawInput.timeout_ms === "number" && rawInput.timeout_ms > 0) {
      projectCheckTimeoutMs = Math.max(1_000, Math.min(300_000, rawInput.timeout_ms));
    } else if (typeof rawInput.timeout === "number" && rawInput.timeout > 0) {
      projectCheckTimeoutMs = Math.max(1_000, Math.min(300_000, rawInput.timeout * 1000));
    }
    return await spawnScriptRunner(bun, commandArgs, cwd, projectCheckTimeoutMs, startedAt, false, {
      ...minimalRunnerEnv(),
      BUN_INSTALL_CACHE_DIR: join(cwd, ".codex-ultra", "bun-cache")
    }, normalizeSaVmPolicy(policy, cwd).contextSavings);
  }

  if (effectiveAction === "run_host" || effectiveAction === "exec_host" || effectiveAction === "host") {
    return await nativeRunHost(rawInput, policy, cwd, startedAt);
  }

  if (effectiveAction === "write_stdin" || effectiveAction === "stdin" || effectiveAction === "input_stdin") {
    return nativeWriteStdin(rawInput, cwd, startedAt);
  }

  if (effectiveAction === "session_status" || effectiveAction === "read_session" || effectiveAction === "poll_session") {
    return nativeSessionStatus(rawInput, cwd, startedAt);
  }

  if (effectiveAction === "kill_session" || effectiveAction === "kill_process" || effectiveAction === "stop_session") {
    return nativeKillSession(rawInput, cwd, startedAt);
  }

  if (effectiveAction === "list_sessions") {
    return nativeListSessions(startedAt);
  }

  if (effectiveAction === "local_checkpoint" || effectiveAction === "checkpoint" || effectiveAction === "git_checkpoint") {
    return nativeLocalCheckpoint(rawInput, cwd, startedAt);
  }

  if (effectiveAction === "restore_checkpoint" || effectiveAction === "restore_git_checkpoint") {
    return nativeRestoreCheckpoint(rawInput, cwd, startedAt);
  }

  // 2. If source contains common SLA file templates, execute them natively as well
  if (typeof rawInput.source === "string") {
    const nativeLegacyPromise = tryHandleLegacyTemplateSourceNatively(rawInput.source, policy, cwd, startedAt);
    if (nativeLegacyPromise) {
      return await nativeLegacyPromise;
    }
  }

  // 3. Fallback to parallel or script/SLA engine
  const input = expandSaVmActionInput(rawInput);
  // Thread policy/cwd live in runSaVmTool locals (options arg), not on the
  // input object - without forwarding, every parallel subtask silently runs
  // under the DEFAULT policy (gated tools like extractToFile misreport as
  // disabled, restricted threads gain default rights).
  if (Array.isArray(input?.parallel)) {
    return runParallelSaVmTool({
      ...input,
      policy: (input as SaVmRunInput).policy ?? policy,
      cwd: (input as SaVmRunInput).cwd ?? cwd,
    });
  }
  void cleanupStaleSaVmTempRoots();
  release = await saVmProcessSemaphore.acquire();
  const normalized = normalizeSaVmRunInput(input);
    const tempRoot = await mkdtemp(join(tmpdir(), "codex-ultra-sa-vm-"));
    try {
      if (normalized.language === "js" || normalized.language === "py") {
        const isPy = normalized.language === "py";
        if (!isPy) {
          let bun: string;
          try {
            bun = resolveBunBinary();
          } catch (error) {
            return {
              ok: false,
              kind: "unavailable",
              exitCode: null,
              stdout: "",
              stderr: `${error instanceof Error ? error.message : String(error)} (install: https://bun.sh — Linux/macOS: curl -fsSL bun.sh/install | bash; Windows: irm bun.sh/install.ps1 | iex; FreeBSD: pkg install bun)`,
              saVmEvents: [],
              saVmViolation: null,
              durationMs: Date.now() - startedAt
            };
          }
          const scriptPath = join(tempRoot, `script-${randomUUID()}.ts`);
          await writeFile(scriptPath, normalized.source, { encoding: "utf8", mode: 0o600 });
          return await spawnScriptRunner(bun, [scriptPath, ...normalized.args], normalized.cwd, normalized.limits.deadline_ms, startedAt, false, undefined, normalizeSaVmPolicy(normalized.policy, normalized.cwd).contextSavings);
        }
        const bin = resolvePythonBinary();
        const scriptPath = join(tempRoot, `script-${randomUUID()}.py`);
        await writeFile(scriptPath, normalized.source, { encoding: "utf8", mode: 0o600 });
        const args = ["-u", scriptPath, ...normalized.args];
        return await spawnScriptRunner(bin, args, normalized.cwd, normalized.limits.deadline_ms, startedAt, true, undefined, normalizeSaVmPolicy(normalized.policy, normalized.cwd).contextSavings);

      }
      return {
        ok: false,
        kind: "capability_denied",
        exitCode: 228,
        stdout: "",
        stderr: "sa/sla runtime was removed in the bun branch; resubmit as js/ts via bun.",
        saVmEvents: [{ event: "violation", kind: "capability_denied", reason: "sa/sla runtime removed" }],
        saVmViolation: { rule: "execution.sa_removed", blocked: true },
        durationMs: Date.now() - startedAt
      };
    } finally {
      await rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
    }
  } catch (error) {
    const isCapDenied = error instanceof SaVmCapabilityDeniedError;
    const isInputError = error instanceof SaVmInputError;
    const kind: SaVmRunResult["kind"] = isCapDenied
      ? "capability_denied"
      : isInputError
        ? "sa_error"
        : "unavailable";
    return {
      ok: false,
      kind,
      exitCode: isCapDenied ? 228 : null,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
      saVmEvents: isCapDenied ? [{ event: "violation", kind: "capability_denied", reason: (error as Error).message }] : [],
      saVmViolation: isCapDenied ? { rule: "execution", blocked: true } : null,
      durationMs: Date.now() - startedAt
    };
  } finally {
    release?.();
  }
}


export function killProcessTree(pid: number | undefined): void {
  if (!pid || pid <= 0) return;
  if (process.platform === "win32") {
    try {
      spawnSync("taskkill", ["/pid", String(pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
    } catch {}
  } else {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      try { process.kill(pid, "SIGKILL"); } catch {}
    }
  }
}

export function resolvePythonBinary(): string {
  if (process.env.PYTHON?.trim() && existsSync(process.env.PYTHON.trim())) {
    return process.env.PYTHON.trim();
  }
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA || "";
    if (localAppData) {
      const candidates = [
        join(localAppData, "Python", "bin", "python.exe"),
        join(localAppData, "Programs", "Python", "Python314", "python.exe"),
        join(localAppData, "Programs", "Python", "Python313", "python.exe"),
        join(localAppData, "Programs", "Python", "Python312", "python.exe"),
        join(localAppData, "Programs", "Python", "Python311", "python.exe"),
        join(localAppData, "Programs", "Python", "Python310", "python.exe")
      ];
      for (const cand of candidates) {
        if (existsSync(cand)) return cand;
      }
    }
    return "python.exe";
  }
  return "python3";
}

const MAX_PARALLEL_TASKS = 32;
const MAX_PARALLEL_CONCURRENCY = 8;

async function runParallelSaVmTool(input: SaVmRunInput): Promise<SaVmRunResult> {
  const startedAt = Date.now();
  // Temporary shield (2026-10-01): parallel is chicken-rib next to native
  // multi-tool parallelism. Block by default; escape hatch
  // SA_VM_ENABLE_PARALLEL=true re-enables for batch-write compat.
  if (process.env.SA_VM_ENABLE_PARALLEL !== "true") {
    return {
      ok: false,
      kind: "capability_denied",
      exitCode: 228,
      stdout: "",
      stderr: "parallel is temporarily disabled: send independent work as multiple sa_vm calls in ONE round (native parallel, read-only calls run concurrently). Batch writes: send sequential edit_file/write_file calls or one apply_patch. Re-enable with SA_VM_ENABLE_PARALLEL=true.",
      saVmEvents: [],
      saVmViolation: { rule: "parallel.temporarily_disabled", blocked: true },
      durationMs: Date.now() - startedAt
    };
  }
  let tasks = Array.isArray(input.parallel) ? input.parallel : [];
  if (tasks.length === 0 || tasks.length > MAX_PARALLEL_TASKS) {
    return { ok: false, kind: "sa_error", exitCode: null, stdout: "", stderr: `parallel task count must be 1-${MAX_PARALLEL_TASKS}`, saVmEvents: [], saVmViolation: null, durationMs: 0 };
  }
  const concurrency = Math.max(1, Math.min(MAX_PARALLEL_CONCURRENCY, Math.trunc(input.concurrency ?? tasks.length)));
  // OPT-4/OPT-9 shared policy (default off; explicit true enables)
  const policyForSavings = normalizeSaVmPolicy(input.policy, input.cwd ?? "");
  const savingsForBudget = policyForSavings.contextSavings;
  const budgetEnabled = savingsForBudget?.parallelBudget === true;
  const maxReadFiles = savingsForBudget?.parallelMaxReadFiles ?? 4;
  const maxTotalBytes = savingsForBudget?.parallelMaxTotalBytes ?? 200 * 1024;
  if (budgetEnabled) {
    const expandedForQuota = tasks.map((task) => expandSaVmActionInput(task as SaVmRunInput));
    const fullReads = expandedForQuota.filter((task) => (task.action ?? "") === "read_file").length;
    if (fullReads > maxReadFiles) {
      return { ok: false, kind: "capability_denied", exitCode: 228, stdout: "", stderr: `[OPT-4] parallel batch rejected: ${fullReads} full read_file task(s) exceed the limit of ${maxReadFiles}. Scout with list_dir / find_references first, then read_lines for targeted ranges.`, saVmEvents: [], saVmViolation: { rule: "contextSavings.parallelBudget", blocked: false }, durationMs: Date.now() - startedAt };
    }
  }

  // Intra-batch dependency violation detection. Enforced only when a VM
  // policy is configured (sandbox on): with no policy the caller opted out
  // of VM sandboxing and batches run fully open as before.
  const batchCwd = input.cwd ?? process.cwd();
  const dependencyConflict = input.policy !== undefined
    ? detectBatchDependencyViolation(tasks as SaVmRunInput[], batchCwd)
    : null;
  if (dependencyConflict) {
    const isWriteWrite = dependencyConflict.kind === "write-write";
    return {
      ok: false,
      kind: "capability_denied",
      exitCode: 1,
      stdout: "",
      stderr: isWriteWrite
        ? `Dependency violation: intra-batch concurrent writes to '${dependencyConflict.conflictedPath}' race (lost update). Split into two sequential batches.`
        : `Dependency violation: intra-batch read of write/build output for '${dependencyConflict.conflictedPath}' is forbidden. Split into two sequential batches.`,
      saVmEvents: [{
        event: "violation",
        kind: "dependency_violation",
        path: dependencyConflict.conflictedPath,
        reason: isWriteWrite ? "intra-batch concurrent writes race" : "intra-batch read of write/build output is forbidden"
      }],
      saVmViolation: {
        rule: "parallel.dependency_violation",
        blocked: true,
        path: dependencyConflict.conflictedPath
      },
      durationMs: Date.now() - startedAt
    };
  }

  // OPT-9: same-batch deduplication — deduplicate identical read-only tasks
  const deduplicateEnabled = policyForSavings.contextSavings?.parallelDeduplication === true;
  const canonicalIndex: number[] = tasks.map((_, i) => i);
  if (deduplicateEnabled) {
    const keyToFirst = new Map<string, number>();
    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i]!;
      const key = `${task.cwd ?? input.cwd ?? ""}|${task.action ?? ""}|${task.path ?? ""}|${task.source ?? ""}|${JSON.stringify(task.args ?? [])}`;
      const first = keyToFirst.get(key);
      if (first !== undefined) {
        canonicalIndex[i] = first;
      } else {
        keyToFirst.set(key, i);
        canonicalIndex[i] = i;
      }
    }
  }

  // Only unique tasks
  const uniqueIndices = [...new Set(canonicalIndex)];
  const uniqueTasks = uniqueIndices.map((i) => tasks[i]!);

  const uniqueResults: Array<SaVmRunResult | undefined> = new Array(uniqueTasks.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (true) {
      const index = next++;
      if (index >= uniqueTasks.length) return;
      const task = uniqueTasks[index]!;
      uniqueResults[index] = await runSaVmTool({ ...task, parallel: undefined, cwd: task.cwd ?? input.cwd, additionalRoots: task.additionalRoots ?? input.additionalRoots, policy: task.policy ?? input.policy });
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, uniqueTasks.length) }, () => worker()));

  // Map back to original task order
  const indexToUniquePos = new Map(uniqueIndices.map((origIdx, pos) => [origIdx, pos]));
  const completed = tasks.map((_, i) => uniqueResults[indexToUniquePos.get(canonicalIndex[i]!)!]!) as SaVmRunResult[];
  const dedupNote = deduplicateEnabled && uniqueTasks.length < tasks.length
    ? `\n[OPT-9] ${tasks.length - uniqueTasks.length} duplicate task(s) deduplicated.`
    : "";

  const ok = completed.every((result) => result.ok);
  const PARALLEL_SINGLE_CAP = 20 * 1024;
  const stdoutParts = completed.map((result, index) => {
    let body = result.stdout;
    let tag = "";
    if (budgetEnabled && body.length > PARALLEL_SINGLE_CAP) {
      body = body.slice(0, PARALLEL_SINGLE_CAP);
      tag = " [OPT-4 single truncated]";
    }
    return `[parallel:${index}]${tag}\n${body}`;
  });
  let combinedStdout = stdoutParts.join("") + dedupNote;
  let budgetNote = "";
  if (budgetEnabled && combinedStdout.length > maxTotalBytes) {
    combinedStdout = combinedStdout.slice(0, maxTotalBytes);
    budgetNote = `\n[OPT-4] parallel total output truncated to ${maxTotalBytes} bytes; split the batch or narrow read ranges.`;
  }
  return {
    ok,
    kind: ok ? "success" : (completed.find((result) => !result.ok)?.kind ?? "crashed"),
    exitCode: ok ? 0 : (completed.find((result) => !result.ok)?.exitCode ?? 1),
    stdout: combinedStdout + budgetNote,
    stderr: completed.map((result, index) => result.stderr ? `[parallel:${index}]\n${result.stderr}` : "").join(""),
    saVmEvents: completed.flatMap((result, index) => result.saVmEvents.map((event) => ({ ...event, parallelIndex: index }))),
    saVmViolation: completed.find((result) => result.saVmViolation)?.saVmViolation ?? null,
    durationMs: Date.now() - startedAt
  };
}

async function spawnScriptRunner(
  bin: string,
  args: string[],
  cwd: string,
  deadlineMs: number,
  startedAt: number,
  isPy = false,
  runnerEnv?: NodeJS.ProcessEnv,
  slimPolicy?: SaVmContextSavingsConfig
): Promise<SaVmRunResult> {
  return new Promise((resolveResult) => {
    let stdout = "";
    let stderr = "";
    let finished = false;

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(bin, args, {
        cwd,
        env: {
          ...(runnerEnv ?? process.env),
          ...(isPy ? {
            PYTHONUNBUFFERED: "1",
            PYTHONDONTWRITEBYTECODE: "1",
            PYTHONIOENCODING: "utf-8"
          } : {})
        },
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        shell: false
      });
    } catch (err) {
      resolveResult({
        ok: false,
        kind: "crashed",
        exitCode: null,
        stdout: "",
        stderr: err instanceof Error ? err.message : String(err),
        saVmEvents: [],
        saVmViolation: null,
        durationMs: Date.now() - startedAt
      });
      return;
    }

    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      try { killProcessTree(child.pid); } catch {}
      resolveResult({
        ok: false,
        kind: "timeout",
        exitCode: null,
        stdout: stdout.slice(0, MAX_STDOUT_BYTES),
        stderr: (stderr + "\n[timeout] script execution exceeded deadline").trim(),
        saVmEvents: [],
        saVmViolation: null,
        durationMs: Date.now() - startedAt
      });
    }, deadlineMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdout.length < MAX_STDOUT_BYTES) stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < MAX_STDERR_BYTES) stderr += chunk.toString("utf8");
    });
    child.on("error", (err: Error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try { killProcessTree(child.pid); } catch {}
      resolveResult({
        ok: false,
        kind: "crashed",
        exitCode: null,
        stdout: stdout.slice(0, MAX_STDOUT_BYTES),
        stderr: err.message,
        saVmEvents: [],
        saVmViolation: null,
        durationMs: Date.now() - startedAt
      });
    });
    child.on("close", (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      let finalStdout = stdout.slice(0, MAX_STDOUT_BYTES);
      let finalStderr = stderr.slice(0, MAX_STDERR_BYTES);
      // OPT-3: slimRunnerOutput — compress successful output to a summary line
      if (code === 0 && slimPolicy?.slimRunnerOutput === true) {
        const lines = finalStdout.split("\n");
        const summaryLines = lines.filter((l) => /pass|fail|error|warning|✓|✗|ok\b/i.test(l));
        if (summaryLines.length > 0) {
          finalStdout = `[slim] ${summaryLines.slice(-3).join(" | ")}\n[OPT-3] Full output suppressed by slimRunnerOutput (${lines.length} lines).`;
        } else if (lines.length > 10) {
          finalStdout = `[slim] Exit 0. ${lines.length} lines of output.\n[OPT-3] Full output suppressed by slimRunnerOutput.`;
        }
      }
      resolveResult({
        ok: code === 0,
        kind: code === 0 ? "success" : "crashed",
        exitCode: code,
        stdout: finalStdout,
        stderr: finalStderr,
        saVmEvents: [],
        saVmViolation: null,
        durationMs: Date.now() - startedAt
      });
    });
  });
}

function resolveBunBinary(): string {
  const configured = process.env.CODEX_UI_BUN_BIN?.trim() || process.env.BUN_BIN?.trim();
  if (configured) {
    if (!isAbsolute(configured)) throw new Error("CODEX_UI_BUN_BIN must be an absolute path");
    if (!existsSync(configured)) throw new Error(`Configured Bun binary does not exist: ${configured}`);
    return configured;
  }
  if (process.versions.bun && isAbsolute(process.execPath)) return process.execPath;
  const defaultBun = join(process.env.USERPROFILE || process.env.HOME || "", ".bun", "bin", process.platform === "win32" ? "bun.exe" : "bun");
  if (existsSync(defaultBun)) return defaultBun;
  throw new Error("Bun runner is unavailable; configure CODEX_UI_BUN_BIN to an absolute Bun path");
}

function validateTestFilePath(profile: SaVmBunProfile, targetFile: unknown, cwd: string): { ok: true; relativePath: string } | { ok: false; reason: string } {
  if (typeof targetFile !== "string" || !targetFile.trim()) {
    return { ok: false, reason: "test_file parameter is required for test-file profiles" };
  }
  const normalized = targetFile.trim().replace(/\\/g, "/");
  if (normalized.includes("..") || /[\s;`$()&|<>:"*?]/.test(normalized)) {
    return { ok: false, reason: "invalid characters or path traversal in test_file" };
  }
  const prefixMap: Record<string, string> = {
    "server-test-file": "tests/server/",
    "web-test-file": "tests/web/",
    "shared-test-file": "tests/shared/"
  };
  const expectedPrefix = prefixMap[profile];
  if (!expectedPrefix || !normalized.startsWith(expectedPrefix)) {
    return { ok: false, reason: `test_file for ${profile} must start with '${expectedPrefix}'` };
  }
  if (!normalized.endsWith(".test.ts") && !normalized.endsWith(".test.tsx") && !normalized.endsWith(".test.js")) {
    return { ok: false, reason: "test_file must end with .test.ts, .test.tsx, or .test.js" };
  }
  const fullPath = resolve(cwd, normalized);
  const resolvedCwd = resolve(cwd);
  if (!fullPath.startsWith(resolvedCwd + sep) && fullPath !== resolvedCwd) {
    return { ok: false, reason: "test_file is outside workspace directory" };
  }
  if (!existsSync(fullPath)) {
    return { ok: false, reason: `test file does not exist: ${normalized}` };
  }
  return { ok: true, relativePath: normalized };
}

function verifyBunProfileIntegrity(profile: SaVmBunProfile, cwd: string): { ok: true } | { ok: false; reason: string } {
  const packagePath = join(cwd, "package.json");
  if (!existsSync(packagePath)) return { ok: false, reason: "Bun profiles require a repository root containing package.json" };
  let packageJson: { scripts?: Record<string, unknown> };
  try {
    packageJson = JSON.parse(readFileSync(packagePath, "utf8")) as { scripts?: Record<string, unknown> };
  } catch {
    return { ok: false, reason: "repository package.json is invalid" };
  }

  if (profile === "server-test-file" || profile === "web-test-file" || profile === "shared-test-file") {
    return { ok: true };
  }

  if (profile === "shared-build") {
    const pkg = join(cwd, "packages/shared/package.json");
    if (!existsSync(pkg)) return { ok: false, reason: "packages/shared/package.json is missing" };
    try {
      const data = JSON.parse(readFileSync(pkg, "utf8")) as { name?: string; scripts?: Record<string, unknown> };
      if (data.name !== "@codex-ui/shared") return { ok: false, reason: "packages/shared identity mismatch" };
      if (data.scripts?.build !== "tsc -p tsconfig.json") return { ok: false, reason: "shared build script changed" };
    } catch {
      return { ok: false, reason: "packages/shared/package.json is invalid" };
    }
    return { ok: true };
  }

  if (profile === "web-build") {
    const pkg = join(cwd, "apps/web/package.json");
    if (!existsSync(pkg)) return { ok: false, reason: "apps/web/package.json is missing" };
    try {
      const data = JSON.parse(readFileSync(pkg, "utf8")) as { name?: string; scripts?: Record<string, unknown> };
      if (data.name !== "@codex-ui/web") return { ok: false, reason: "apps/web identity mismatch" };
      if (typeof data.scripts?.build !== "string" || (!data.scripts.build.includes("build.ts") && !data.scripts.build.includes("Bun.build"))) {
        return { ok: false, reason: "web build script changed" };
      }
    } catch {
      return { ok: false, reason: "apps/web/package.json is invalid" };
    }
    return { ok: true };
  }

  const expected: Record<string, string> = {
    "shared-typecheck": "tsc -p tsconfig.json --noEmit --noUnusedLocals --noUnusedParameters --noFallthroughCasesInSwitch --noImplicitReturns --noImplicitOverride",
    "protocol-typecheck": "tsc -p tsconfig.json --noEmit --noUnusedLocals --noUnusedParameters --noFallthroughCasesInSwitch --noImplicitReturns --noImplicitOverride",
    "server-typecheck": "tsc -p tsconfig.json --noEmit --noUnusedLocals --noUnusedParameters --noFallthroughCasesInSwitch --noImplicitReturns --noImplicitOverride",
    "web-typecheck": "tsc -p tsconfig.json --noEmit --noFallthroughCasesInSwitch --noImplicitReturns --noImplicitOverride",
    "free-key-typecheck": "tsc -p tsconfig.json --noEmit --noUnusedLocals --noUnusedParameters --noFallthroughCasesInSwitch --noImplicitReturns --noImplicitOverride"
  };
  const packageName: Record<string, string> = {
    "shared-typecheck": "@codex-ui/shared",
    "protocol-typecheck": "@codex-ui/codex-protocol",
    "server-typecheck": "@codex-ui/server",
    "web-typecheck": "@codex-ui/web",
    "free-key-typecheck": "@codex-ui/free-key-server"
  };

  const targets = profile === "root-typecheck"
    ? (["shared-typecheck", "protocol-typecheck", "server-typecheck", "web-typecheck", "free-key-typecheck"] as const)
    : [profile as keyof typeof expected];

  for (const t of targets) {
    const subDir = t === "shared-typecheck" ? "packages/shared" : t === "protocol-typecheck" ? "packages/codex-protocol" : t === "server-typecheck" ? "apps/server" : t === "web-typecheck" ? "apps/web" : "apps/free-key-server";
    const workspacePath = join(cwd, subDir, "package.json");
    if (!existsSync(workspacePath)) return { ok: false, reason: `workspace package for ${t} is missing` };
    try {
      const workspace = JSON.parse(readFileSync(workspacePath, "utf8")) as { name?: unknown; scripts?: Record<string, unknown> };
      if (workspace.name !== packageName[t]) return { ok: false, reason: `workspace package identity mismatch for ${t}` };
      if (workspace.scripts?.typecheck !== expected[t]) return { ok: false, reason: `typecheck script changed; refusing to execute ${t}` };
    } catch {
      return { ok: false, reason: `workspace package.json for ${t} is invalid` };
    }
  }

  if (packageJson.scripts && typeof packageJson.scripts.typecheck === "string" && packageJson.scripts.typecheck.includes("run")) {
    return { ok: false, reason: "repository scripts appear modified; refusing Bun profile execution" };
  }

  return { ok: true };
}

function minimalRunnerEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    SystemRoot: process.env.SystemRoot ?? process.env.SYSTEMROOT ?? "",
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? process.env.USERPROFILE ?? "",
    USERPROFILE: process.env.USERPROFILE ?? process.env.HOME ?? "",
    TEMP: process.env.TEMP ?? process.env.TMP ?? "",
    TMP: process.env.TMP ?? process.env.TEMP ?? "",
    NODE_ENV: "test"
  };
  return env;
}

export type SaVmExecutableLanguage = "js" | "py";

export function normalizeSaVmRunInput(rawInput: SaVmRunInput): { source: string; language: SaVmExecutableLanguage; args: string[]; cwd: string; limits: typeof DEFAULT_LIMITS; policy: Record<string, unknown> } {
  const input = expandSaVmActionInput(rawInput);
  if (!input || typeof input.source !== "string") throw new SaVmInputError("source must be a string");
  if (Buffer.byteLength(input.source, "utf8") > MAX_SOURCE_BYTES) throw new SaVmInputError("source exceeds 512 KiB");

  const cwd = resolve(typeof input.cwd === "string" && input.cwd.trim() ? input.cwd : process.cwd());
  const policy = normalizeSaVmPolicy(input.policy, cwd, input.additionalRoots ?? []);

  const rawLang = String(input.language ?? "").trim().toLowerCase();
  if (rawLang === "sa" || rawLang === "sla") {
    throw new SaVmInputError('sa/sla runtime was removed in the bun branch; resubmit as js/ts via bun (action "run_js" or "run_bun").');
  }
  const isPy = rawLang === "py" || rawLang === "python";
  const isJs = rawLang === "" || rawLang === "js" || rawLang === "javascript" || rawLang === "node" || rawLang === "bun" || rawLang === "ts" || rawLang === "typescript";
  if (!isJs && !isPy) {
    throw new SaVmInputError(`unsupported language '${String(input.language ?? "")}'; bun branch supports js/ts (via bun) and py only.`);
  }
  const language: SaVmExecutableLanguage = isPy ? "py" : "js";

  if (language === "js" && policy.execution.javascript !== true) {
    throw new SaVmCapabilityDeniedError("JavaScript execution is disabled in VM settings and cannot bypass the VM sandbox. Please enable '允许 JavaScript / Node 脚本执行' in VM settings to run JS.");
  }
  if (language === "py" && policy.execution.python !== true) {
    throw new SaVmCapabilityDeniedError("Python execution is disabled in VM settings and cannot bypass the VM sandbox. Enable '允许 Python 脚本执行' in VM settings or use packaged native tools.");
  }

  const args = Array.isArray(input.args) ? input.args.filter((value): value is string => typeof value === "string").slice(0, 128) : [];
  if (args.some((value) => value.length > 4096)) throw new SaVmInputError("argument exceeds 4096 characters");
  const requested = input.requested_caps && typeof input.requested_caps === "object" ? input.requested_caps : {};
  normalizeFsCaps(requested.fs, cwd, policy);
  normalizeNetCaps(requested.net, policy);
  const envCaps = Array.isArray(requested.env)
    ? requested.env.filter((name): name is string => typeof name === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)).slice(0, 16)
    : [];
  for (const name of envCaps) {
    if (!policy.env.allow.includes(name)) throw new SaVmInputError(`environment capability denied by VM policy: ${name}`);
  }
  const requestedTimeout = typeof input.timeout_ms === "number" && input.timeout_ms > 0
    ? input.timeout_ms
    : typeof input.timeout === "number" && input.timeout > 0
      ? (input.timeout < 1000 ? input.timeout * 1000 : input.timeout)
      : undefined;
  const limits = {
    fuel: clampLimit(input.limits?.fuel, DEFAULT_LIMITS.fuel, LIMIT_CEILINGS.fuel),
    deadline_ms: clampLimit(requestedTimeout ?? input.limits?.deadline_ms, DEFAULT_LIMITS.deadline_ms, LIMIT_CEILINGS.deadline_ms),
    mem_cap_bytes: clampLimit(input.limits?.mem_cap_bytes, DEFAULT_LIMITS.mem_cap_bytes, LIMIT_CEILINGS.mem_cap_bytes),
    max_call_depth: clampLimit(input.limits?.max_call_depth, DEFAULT_LIMITS.max_call_depth, LIMIT_CEILINGS.max_call_depth)
  } as const;
  return {
    source: input.source,
    language,
    args,
    cwd,
    limits,
    policy: {
      schema: "sa.vm.policy/1",
      extern: {
        allow: [] as string[]
      },
      fs: {
        read: policy.fs.read,
        write: policy.fs.write,
      },
      http: { allow: policy.http.allow },
      env: { allow: envCaps.length > 0 ? envCaps : policy.env.allow },
      process: { spawn: policy.process.spawn, exec: policy.process.exec },
      net_raw: false,
      ffi: false,
      threads: false,
      limits: { fuel: limits.fuel, wall_clock_ms: limits.deadline_ms, mem_cap_bytes: limits.mem_cap_bytes }
    }
  };
}

function normalizeFsCaps(value: unknown, cwd: string, policy: ReturnType<typeof normalizeSaVmPolicy>): SaVmFsCapability[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    let op = "read";
    let rawPath = "";
    if (typeof entry === "string" && entry.trim()) {
      op = "read";
      rawPath = entry.trim();
    } else if (entry && typeof entry === "object") {
      const candidateOp = String((entry as { op?: unknown }).op ?? "read");
      const candidatePath = (entry as { path?: unknown }).path;
      if (typeof candidatePath === "string" && candidatePath.trim()) {
        op = candidateOp;
        rawPath = candidatePath.trim();
      }
    }
    if (!["read", "write", "append", "edit", "create", "delete", "rename", "metadata"].includes(op) || !rawPath) return [];
    const path = resolve(cwd, rawPath);
    const decision = op === "delete"
      ? policy.fs.delete === "deny"
        ? checkSaVmDelete(policy, rawPath, cwd)
        : checkSaVmPath(policy, "transfer", rawPath, cwd)
      : checkSaVmPath(policy, op === "read" || op === "metadata" ? "read" : op === "rename" ? "transfer" : "write", rawPath, cwd);
    if (!decision.allowed) {
      const prefix = op === "delete" && policy.fs.delete === "deny" ? "filesystem delete denied by VM policy" : "filesystem capability denied by VM policy";
      throw new SaVmInputError(`${prefix}: ${rawPath} (${decision.reason})`);
    }
    return [{ op: op as SaVmFsCapability["op"], path: decision.path ?? path }];
  }).slice(0, 128);
}

function normalizeNetCaps(value: unknown, policy: ReturnType<typeof normalizeSaVmPolicy>): SaVmNetCapability[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || typeof (entry as { url?: unknown }).url !== "string") return [];
    let parsed: URL;
    try { parsed = new URL((entry as { url: string }).url); } catch { return []; }
    if (parsed.username || parsed.password || parsed.protocol !== "https:") throw new SaVmInputError(`only HTTPS URLs without credentials are allowed: ${parsed.toString()}`);
    const methods = Array.isArray((entry as { methods?: unknown }).methods)
      ? (entry as { methods: unknown[] }).methods.filter((method): method is string => typeof method === "string").map((method) => method.toUpperCase()).slice(0, 16)
      : undefined;
    const checkedMethods = methods && methods.length > 0 ? methods : ["GET"];
    for (const method of checkedMethods) {
      const decision = checkSaVmHttp(policy, parsed.toString(), method);
      if (!decision.allowed) throw new SaVmInputError(`HTTP capability denied by VM policy: ${decision.reason}`);
    }
    return [{ url: parsed.toString(), methods: checkedMethods }];
  }).slice(0, 64);
}

function clampLimit(value: unknown, fallback: number, ceiling: number): number {
  const numeric = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.max(0, Math.min(ceiling, numeric));
}

export function resultKind(exitCode: number | null, stderr = ""): SaVmRunResult["kind"] {
  if (exitCode === 228) return "capability_denied";
  if (exitCode === 229) return "fuel_exhausted";
  if (exitCode === 230) return "timeout";
  if (exitCode === 231) return "mem_quota";
  if (exitCode === 233) return "policy_invalid";
  if (exitCode === 235) return "stack_overflow";
  if (exitCode === 1 && stderr.trim()) return "sa_error";
  if (exitCode !== null && exitCode < 128) return "success";
  return "crashed";
}

export function isSaVmBlockedToolName(value: unknown): boolean {
  return typeof value === "string" && /(?:^|[._:/-])(bash|shell|exec|python(?:\d+(?:\.\d+)?)?|py|node(?:js)?|bun(?:x)?|deno|ts-node|tsx|npx|javascript|typescript|js|powershell|pwsh|cmd|apply_patch|write_file|edit_file)(?:$|[._:/-])/i.test(value);
}

export { nativeJevChoose, nativeJevChecklist, nativeJevEvaluate, nativeJevThinking, nativeJevRedteam, nativeJevRank, nativeJevScope, nativeJevDispatch, nativeJevConsistency, nativeJevDone, nativeJevDiagnose, nativeJevEdgeCases, nativeJevBlastRadius, nativeJevIntent, nativeJevNext, nativeJevProgress } from "../../../backends/jev/src/jev/saVmJev.js";


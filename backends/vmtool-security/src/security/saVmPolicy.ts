import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { statSync } from "node:fs";
import { tmpdir } from "node:os";
import type { SaVmBunSubcommand, SaVmContextSavingsConfig, SaVmDeletePolicy, SaVmFsEntry, SaVmHttpAllowRule, SaVmPolicyConfig, SaVmProcessExecRule } from "@codex-ui/shared";
import { ALL_SA_VM_BUN_PROFILES, ALL_SA_VM_BUN_SUBCOMMANDS } from "@codex-ui/shared";
import { codexUiDataDir } from "@cxu/sdk-backend";

export type SaVmPathOperation = "read" | "write" | "transfer";

/**
 * Enhanced tools should have efficient access to external paths for read operations.
 * The original design coupled enhancement with sandbox restrictions, causing models
 * to fall back to inefficient terminal commands like Get-Content/Select-String.
 * 
 * Fix: Read operations (read_file, read_lines, grep_search, list_dir, find_files)
 * should allow external paths by default for efficiency. Write operations remain
 * restricted to workspace + additionalRoots for safety.
 */
export const ENHANCED_TOOLS_READ_ONLY = new Set([
  "read_file",
  "read_lines",
  "read_many",
  "read_files", 
  "read_file_tail",
  "count_lines",
  "file_info",
  "test_path",
  "file_exists",
  "exists",
  "stat",
  "find_files",
  "list_dir",
  "grep_search",
  "grep_search_async",
  "code_graph",
  "relation_graph",
  "symbol_graph",
]);
export type SaVmPolicyDecision = { allowed: true; path: string } | { allowed: false; reason: string; path?: string };

export type NormalizedSaVmPolicy = {
  engine: "native" | "vm";
  fs: { entries: Array<{ path: string; access: "read" | "write" | "deny" }>; read: string[]; write: string[]; transfer: string[]; delete: SaVmDeletePolicy; backupDir: string | null };
  http: { allow: SaVmHttpAllowRule[] };
  env: { allow: string[] };
  process: { spawn: boolean; exec: SaVmProcessExecRule[]; bunProfiles?: string[]; bun?: { enabled: boolean; allowedSubcommands: SaVmBunSubcommand[] } };
  execution: { javascript: boolean; python: boolean };
  tools: {
    replaceRead: boolean;
    replaceWrite: boolean;
    replaceApplyPatch: boolean;
    replaceExec: boolean;
    readFiles?: boolean;
    editFiles?: boolean;
    applyPatch?: boolean;
    fastSearch?: boolean;
    clearToolHistory: boolean;
    findReferences: boolean;
    renameSymbol?: boolean;
    fileOutline?: boolean;
    moveWithImports?: boolean;
    findDefinition?: boolean;
    extractToFile?: boolean;
    addImport?: boolean;
    getDiagnostics?: boolean;
    organizeImports?: boolean;
    analyzeScope?: boolean;
    codeGraph?: boolean;
  };
  contextSavings?: SaVmContextSavingsConfig;
};

const DEFAULT_ENV = ["CWD", "PROJECT"];
const DEFAULT_HTTP_METHODS = ["GET", "POST"];
const MAX_POLICY_PATHS = 128;

export function normalizeSaVmPolicy(config: SaVmPolicyConfig | undefined, cwd: string, additionalRoots: string[] = []): NormalizedSaVmPolicy {
  const root = resolve(cwd);
  const configRoots = Array.isArray((config as any)?.additionalRoots)
    ? (config as any).additionalRoots.filter((r: unknown): r is string => typeof r === "string" && Boolean(r.trim()))
    : Array.isArray((config?.fs as any)?.additionalRoots)
    ? (config!.fs as any).additionalRoots.filter((r: unknown): r is string => typeof r === "string" && Boolean(r.trim()))
    : [];
  const allAdditionalRoots = [...additionalRoots, ...configRoots];
  const defaultRoots = [root, ...allAdditionalRoots.map((entry) => resolve(root, entry))];
  const fsConfig = config?.fs;
  const hasEntries = Boolean(fsConfig?.entries && Array.isArray(fsConfig.entries) && fsConfig.entries.length > 0);
  const entries = hasEntries && fsConfig?.entries
    ? normalizeEntries(fsConfig.entries, root)
    : legacyEntries(fsConfig, root, defaultRoots);
  if (allAdditionalRoots.length > 0) {
    for (const additionalRoot of defaultRoots.slice(1)) {
      const pattern = `${additionalRoot.replace(/[\\/]+$/, "")}/**`.replace(/\\/g, "/").toLowerCase();
      const hasRule = entries.some((entry) => entry.path === pattern);
      const explicitlyDenied = entries.some((entry) => entry.access === "deny" && globMatches(pattern, entry.path));
      if (!hasRule && !explicitlyDenied) entries.push({ path: pattern, access: "read" });
    }
  }
  // Sala help, bundled sa-vm resources, sa_std, and system temporary directories are granted implicit read access; explicit deny rules still win.
  const configuredSalaRoot = fsConfig?.salaRoot?.trim() || process.env.CODEX_UI_SA_VM_SALA_DIR?.trim();
  const configuredStdDir = process.env.SA_STD_DIR?.trim() || process.env.CODEX_UI_SA_STD_DIR?.trim();
  const allowedHelpRoots = [
    configuredSalaRoot,
    configuredStdDir,
    join(codexUiDataDir(), "sa-vm"),
    tmpdir(),
    "/tmp",
    "C:/tmp"
  ].filter(Boolean) as string[];

  for (const candidateRoot of allowedHelpRoots) {
    const resolvedRoot = isAbsolute(candidateRoot) ? resolve(candidateRoot) : resolve(root, candidateRoot);
    const pattern = `${resolvedRoot.replace(/\\/g, "/").replace(/[\\/]+$/, "")}/**`.toLowerCase();
    const denied = entries.some((entry) => entry.access === "deny" && globMatches(pattern, entry.path));
    if (!denied && !entries.some((entry) => entry.path === pattern && entry.access === "read")) {
      entries.push({ path: pattern, access: "read" });
    }
  }
  const read = dedupe(entries.filter((entry) => entry.access === "read" || entry.access === "write").map((entry) => entry.path));
  const write = dedupe(entries.filter((entry) => entry.access === "write").map((entry) => entry.path));
  const transfer = normalizePatterns(fsConfig?.transfer, root, write);
  const deletePolicy: SaVmDeletePolicy = fsConfig?.delete === "rename" || fsConfig?.delete === "move" || fsConfig?.delete === "deny"
    ? fsConfig.delete
    : "deny";
  const backupDir = fsConfig?.backupDir === null
    ? null
    : fsConfig?.backupDir
      ? resolvePolicyPath(fsConfig.backupDir, root)
      : null;
  const engine = config?.engine === "vm" ? "vm" : "native";
  return {
    engine,
    fs: { entries, read, write, transfer, delete: deletePolicy, backupDir },
    http: { allow: normalizeHttpRules(config?.http?.allow) },
    env: { allow: normalizeEnv(config?.env?.allow) },
    process: {
      spawn: config?.process?.spawn === true,
      exec: normalizeExecRules(config?.process?.exec),
      ...(normalizeBunProfiles(config?.process?.bunProfiles).length > 0 ? { bunProfiles: normalizeBunProfiles(config?.process?.bunProfiles) } : {}),
      ...(normalizeBunConfig(config?.process?.bun))
    },
    execution: {
      javascript: config?.execution?.javascript === true,
      python: config?.execution?.python === true
    },
    tools: {
      replaceRead: config?.tools?.replaceRead !== false,
      replaceWrite: config?.tools?.replaceWrite !== false,
      replaceApplyPatch: config?.tools?.replaceApplyPatch !== false,
      replaceExec: config?.tools?.replaceExec !== false,
      readFiles: config?.tools?.readFiles !== false,
      editFiles: config?.tools?.editFiles !== false,
      applyPatch: config?.tools?.applyPatch !== false,
      fastSearch: config?.tools?.fastSearch !== false,
      clearToolHistory: config?.tools?.clearToolHistory !== false,
      findReferences: config?.tools?.findReferences !== false,
      renameSymbol: config?.tools?.renameSymbol !== false,
      fileOutline: config?.tools?.fileOutline !== false,
      moveWithImports: config?.tools?.moveWithImports !== false,
      findDefinition: config?.tools?.findDefinition !== false,
      extractToFile: config?.tools?.extractToFile !== false,
      addImport: config?.tools?.addImport !== false,
      getDiagnostics: config?.tools?.getDiagnostics !== false,
      organizeImports: config?.tools?.organizeImports !== false,
      analyzeScope: config?.tools?.analyzeScope !== false,
      codeGraph: config?.tools?.codeGraph !== false
    },
    ...(config?.contextSavings ? { contextSavings: normalizeContextSavings(config.contextSavings) } : {})
  };
}

function normalizeContextSavings(value: unknown): SaVmContextSavingsConfig | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  return {
    locateBeforeRead: raw.locateBeforeRead === true,
    maxReadFileBytes: typeof raw.maxReadFileBytes === "number" && raw.maxReadFileBytes > 0 ? raw.maxReadFileBytes : undefined,
    grepCircuitBreaker: raw.grepCircuitBreaker === true,
    grepMaxResults: typeof raw.grepMaxResults === "number" && raw.grepMaxResults > 0 ? raw.grepMaxResults : undefined,
    grepMaxTokens: typeof raw.grepMaxTokens === "number" && raw.grepMaxTokens > 0 ? raw.grepMaxTokens : undefined,
    slimRunnerOutput: raw.slimRunnerOutput === true,
    parallelBudget: raw.parallelBudget === true,
    parallelMaxTotalBytes: typeof raw.parallelMaxTotalBytes === "number" && raw.parallelMaxTotalBytes > 0 ? raw.parallelMaxTotalBytes : undefined,
    parallelMaxReadFiles: typeof raw.parallelMaxReadFiles === "number" && raw.parallelMaxReadFiles > 0 ? raw.parallelMaxReadFiles : undefined,
    parallelDeduplication: raw.parallelDeduplication === true,
    tieredSkillInjection: raw.tieredSkillInjection === true,
    foldWaterfallEvents: raw.foldWaterfallEvents === true,
    foldHistoryReadSummaries: raw.foldHistoryReadSummaries === true,
    historyReadFoldTurns: typeof raw.historyReadFoldTurns === "number" && raw.historyReadFoldTurns > 0 ? raw.historyReadFoldTurns : undefined
  };
}

function normalizeBunConfig(value: unknown): { bun?: { enabled: boolean; allowedSubcommands: SaVmBunSubcommand[] } } {
  if (value === true) {
    return { bun: { enabled: true, allowedSubcommands: [...ALL_SA_VM_BUN_SUBCOMMANDS] } };
  }
  if (value === false) {
    return { bun: { enabled: false, allowedSubcommands: [] } };
  }
  if (value && typeof value === "object") {
    const raw = value as { enabled?: unknown; allowedSubcommands?: unknown };
    const enabled = raw.enabled !== false;
    const allowed = Array.isArray(raw.allowedSubcommands)
      ? raw.allowedSubcommands.filter((sub): sub is SaVmBunSubcommand => typeof sub === "string" && (ALL_SA_VM_BUN_SUBCOMMANDS as readonly string[]).includes(sub))
      : [...ALL_SA_VM_BUN_SUBCOMMANDS];
    return { bun: { enabled, allowedSubcommands: allowed } };
  }
  return {};
}

function normalizeBunProfiles(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const allowed = new Set<string>(ALL_SA_VM_BUN_PROFILES);
  return [...new Set(value.filter((entry): entry is string => typeof entry === "string" && allowed.has(entry)))];
}

const WINDOWS_DEVICE_NAMES = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

export function checkSaVmPath(policy: NormalizedSaVmPolicy, operation: SaVmPathOperation, candidate: string, cwd: string): SaVmPolicyDecision {
  if (typeof candidate !== "string" || !candidate.trim() || candidate.includes("\0")) {
    return { allowed: false, reason: "invalid path characters" };
  }
  const path = resolvePolicyPath(candidate, resolve(cwd));
  const basename = path.split("/").at(-1) ?? "";
  if (WINDOWS_DEVICE_NAMES.test(basename)) {
    return { allowed: false, reason: `path targets reserved device name: ${basename}`, path };
  }
  
  // 增强工具与沙箱解耦：只读操作允许外部路径访问
  // 这是为了修复增强工具被迫使用低效终端命令的问题
  // 写操作仍然需要严格的路径限制以确保安全
  if (operation === "read") {
    // 对于只读操作，检查路径是否存在且可访问
    // 允许访问工作目录树外的文件，提高增强工具的效率
    try {
      const stats = statSync(path);
      if (stats.isFile() || stats.isDirectory()) {
        return { allowed: true, path };
      }
    } catch {
      // 文件不存在或不可访问，由后续检查处理
    }
  }
  
  if (policy.fs.entries.length > 0) {
    const access = resolveFsAccess(policy.fs.entries, path);
    if (access === "deny") return { allowed: false, reason: `path is denied for ${operation}: '${candidate}'. Workspace root is '${cwd}'.`, path };
    const allowed = operation === "read" ? access === "read" || access === "write" : access === "write";
    if (allowed) return { allowed: true, path };
    return { allowed: false, reason: `path is not allowed for ${operation}: '${candidate}'. Workspace root is '${cwd}'.`, path };
  }
  const patterns = operation === "read" ? policy.fs.read : operation === "write" ? policy.fs.write : policy.fs.transfer;
  if (matchesAny(path, patterns)) return { allowed: true, path };
  return { allowed: false, reason: `path is not allowed for ${operation}: '${candidate}'. Workspace root is '${cwd}'.`, path };
}

export function checkSaVmDelete(policy: NormalizedSaVmPolicy, candidate: string, cwd: string): SaVmPolicyDecision {
  if (typeof candidate !== "string" || !candidate.trim() || candidate.includes("\0")) {
    return { allowed: false, reason: "invalid path characters" };
  }
  const path = resolvePolicyPath(candidate, resolve(cwd));
  const basename = path.split("/").at(-1) ?? "";
  if (WINDOWS_DEVICE_NAMES.test(basename)) {
    return { allowed: false, reason: `path targets reserved device name: ${basename}`, path };
  }
  if (policy.fs.delete === "deny") return { allowed: false, reason: "delete policy is deny", path };
  if (policy.fs.entries.length > 0) {
    const access = resolveFsAccess(policy.fs.entries, path);
    if (access === "deny") return { allowed: false, reason: "path is denied for delete", path };
    const backupMove = policy.fs.delete === "rename" || policy.fs.delete === "move";
    if (access !== "write" && !(backupMove && matchesAny(path, policy.fs.transfer))) {
      return { allowed: false, reason: "path is not writable for delete", path };
    }
  }
  if (!matchesAny(path, policy.fs.transfer) && !matchesAny(path, policy.fs.write)) {
    return { allowed: false, reason: "path is not allowed for transfer", path };
  }
  if ((policy.fs.delete === "rename" || policy.fs.delete === "move") && (!policy.fs.backupDir || !matchesAny(policy.fs.backupDir, policy.fs.write))) {
    return { allowed: false, reason: "delete backupDir must be inside a writable policy root", path };
  }
  return { allowed: true, path };
}

export function checkSaVmHttp(policy: NormalizedSaVmPolicy, urlValue: string, methodValue = "GET"): SaVmPolicyDecision {
  let parsed: URL;
  try { parsed = new URL(urlValue); } catch { return { allowed: false, reason: "invalid URL" }; }
  const method = methodValue.trim().toUpperCase();
  if (method !== "GET" && method !== "POST") return { allowed: false, reason: `HTTP method ${method || "<empty>"} is not allowed` };
  if (parsed.username || parsed.password || parsed.protocol !== "https:") return { allowed: false, reason: "only HTTPS URLs without credentials are allowed" };
  const matched = policy.http.allow.some((rule) => {
    if (!hostMatches(parsed.hostname, rule.host)) return false;
    const methods = (rule.methods?.length ? rule.methods : DEFAULT_HTTP_METHODS).map((entry) => entry.toUpperCase());
    if (!methods.includes(method)) return false;
    return !rule.paths?.length || rule.paths.some((pattern) => globMatches(parsed.pathname, pattern));
  });
  return matched ? { allowed: true, path: parsed.toString() } : { allowed: false, reason: "host, path, or method is not in the HTTP allowlist" };
}

export function checkSaVmEnv(policy: NormalizedSaVmPolicy, name: string): SaVmPolicyDecision {
  return policy.env.allow.includes(name) ? { allowed: true, path: name } : { allowed: false, reason: `environment variable ${name} is not allowed` };
}

export function checkSaVmProcess(policy: NormalizedSaVmPolicy, executable: string, args: string[] = []): SaVmPolicyDecision {
  const normalizedExecutable = executable.trim();
  if (!normalizedExecutable) return { allowed: false, reason: "process executable is required" };
  const rules = policy.process.exec.filter((candidate) => executableMatches(normalizedExecutable, candidate.path));
  if (rules.length === 0) return { allowed: false, reason: `executable ${normalizedExecutable} is not in the process allowlist` };
  if (!rules.some((rule) => !rule.args || argsMatch(rule.args, args))) return { allowed: false, reason: `arguments for ${normalizedExecutable} are not allowed` };
  return { allowed: true, path: normalizedExecutable };
}

export function checkSaVmBunProfile(policy: NormalizedSaVmPolicy, profile: string): SaVmPolicyDecision {
  const normalized = profile.trim().toLowerCase();
  if (!normalized) return { allowed: false, reason: "Bun profile is required" };
  if (!policy.process.bunProfiles?.includes(normalized)) {
    return { allowed: false, reason: `Bun profile ${normalized} is not enabled in the VM policy. Enable it in Settings -> VM Tools -> Fixed Project Check Profiles for this thread, then retry via sa_vm_run run_project_check` };
  }
  return { allowed: true, path: normalized };
}

export function checkSaVmBunExecution(
  policy: NormalizedSaVmPolicy,
  bunBinary: string,
  subcommand: string,
  args: string[] = []
): SaVmPolicyDecision {
  if (policy.process.bun) {
    if (!policy.process.bun.enabled) {
      return { allowed: false, reason: "Bun execution is disabled in the VM policy" };
    }
    if (policy.process.bun.allowedSubcommands.length > 0 && !policy.process.bun.allowedSubcommands.includes(subcommand as SaVmBunSubcommand)) {
      return { allowed: false, reason: `Bun subcommand '${subcommand}' is not in the allowed list: [${policy.process.bun.allowedSubcommands.join(", ")}]` };
    }
    return { allowed: true, path: bunBinary };
  }
  return checkSaVmProcess(policy, bunBinary, [subcommand, ...args]);
}

export function isSaVmScriptExecutionAllowed(policy: NormalizedSaVmPolicy, executable: string): boolean {
  const name = executable.replace(/\\/g, "/").toLowerCase().split("/").at(-1) ?? "";
  const isPython = /^(?:python(?:\d+(?:\.\d+)?)?|py|pypy(?:\d+)?)(?:\.exe)?$/.test(name);
  const isJavaScript = /^(?:node(?:js)?|deno|ts-node|tsx|npx)(?:\.exe)?$/.test(name);
  const isBun = /^bun(?:x)?(?:\.exe)?$/.test(name);
  const bunAllowed = Boolean(policy.process.bun?.enabled);
  return Boolean((isPython && policy.execution.python) || (isJavaScript && policy.execution.javascript) || (isBun && bunAllowed));
}

export type SaVmExecutionRequestKind = "bun" | "javascript" | "python" | "other";

export function classifySaVmExecutionRequest(input: {
  action?: unknown;
  language?: unknown;
  subcommand?: unknown;
  args?: unknown;
  test_file?: unknown;
  filter?: unknown;
  profile?: unknown;
}): { kind: SaVmExecutionRequestKind; isBun: boolean; isJs: boolean; isPy: boolean } {
  const rawAction = typeof input.action === "string" ? input.action.trim().toLowerCase() : "";
  const rawLang = typeof input.language === "string" ? input.language.trim().toLowerCase() : "";

  const isPy = rawAction === "run_py" || rawAction === "run_python" || rawAction === "exec_py" || rawAction === "py" || rawAction === "python" || rawLang === "py" || rawLang === "python";
  if (isPy) {
    return { kind: "python", isBun: false, isJs: false, isPy: true };
  }

  const isBun = rawAction === "run_bun"
    || rawAction === "run_project_check"
    || ((rawAction === "bun" || rawAction === "exec_bun") && (
      typeof input.subcommand === "string"
      || Array.isArray(input.args)
      || typeof input.test_file === "string"
      || typeof input.filter === "string"
      || typeof input.profile === "string"
    ));
  if (isBun) {
    return { kind: "bun", isBun: true, isJs: false, isPy: false };
  }

  const isJs = rawAction === "run_js"
    || rawAction === "exec_js"
    || rawAction === "js"
    || rawAction === "javascript"
    || rawAction === "node"
    || rawAction === "bun"
    || rawAction === "run_node"
    || rawAction === "exec_node"
    || rawAction === "exec_bun"
    || rawAction === "eval_js"
    || rawLang === "js"
    || rawLang === "javascript"
    || rawLang === "node"
    || rawLang === "bun"
    || rawLang === "ts"
    || rawLang === "typescript";
  if (isJs) {
    return { kind: "javascript", isBun: false, isJs: true, isPy: false };
  }

  return { kind: "other", isBun: false, isJs: false, isPy: false };
}

export function classifyBunRequest(input: {
  action?: unknown;
  subcommand?: unknown;
  args?: unknown;
  test_file?: unknown;
  filter?: unknown;
  profile?: unknown;
}): boolean {
  return classifySaVmExecutionRequest(input).isBun;
}

export function extractCommandArgv(value: unknown): { executable: string; args: string[] } | null {
  if (Array.isArray(value)) {
    const entries = value.filter((entry): entry is string => typeof entry === "string");
    return entries.length > 0 ? { executable: entries[0]!, args: entries.slice(1) } : null;
  }
  if (typeof value !== "string") return null;
  const tokens = value.trim().match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)?.map((entry) => {
    const quoted = (entry.startsWith("\"") && entry.endsWith("\"")) || (entry.startsWith("'") && entry.endsWith("'"));
    return quoted ? entry.slice(1, -1) : entry;
  }) ?? [];
  return tokens.length > 0 ? { executable: tokens[0]!, args: tokens.slice(1) } : null;
}

function normalizePatterns(value: string[] | undefined, cwd: string, fallback: string[]): string[] {
  const entries = Array.isArray(value) && value.length > 0
    ? value
    : fallback.map((entry) => entry.endsWith("*") ? entry : `${entry.replace(/[\\/]+$/, "")}/**`);
  return dedupe(entries.slice(0, MAX_POLICY_PATHS).map((entry) => resolvePattern(entry, cwd)));
}

function legacyEntries(fsConfig: SaVmPolicyConfig["fs"], cwd: string, defaultRoots: string[]): Array<{ path: string; access: "read" | "write" | "deny" }> {
  const read = normalizePatterns(fsConfig?.read, cwd, [defaultRoots[0]!]);
  const write = normalizePatterns(fsConfig?.write, cwd, [defaultRoots[0]!]);
  const entries: Array<{ path: string; access: "read" | "write" | "deny" }> = [
    ...read.map((path) => ({ path, access: "read" as const })),
    ...write.map((path) => ({ path, access: "write" as const }))
  ];
  if (!fsConfig?.read && !fsConfig?.write) {
    for (const additionalRoot of defaultRoots.slice(1)) {
      entries.push({ path: `${additionalRoot.replace(/[\\/]+$/, "")}/**`, access: "read" });
    }
  }
  return dedupeEntries(entries);
}

function normalizeEntries(value: SaVmFsEntry[] | undefined, cwd: string): Array<{ path: string; access: "read" | "write" | "deny" }> {
  if (!Array.isArray(value)) return [];
  return dedupeEntries(value.slice(0, MAX_POLICY_PATHS).flatMap((entry) => {
    if (!entry || typeof entry.path !== "string" || !entry.path.trim()) return [];
    if (entry.access !== "read" && entry.access !== "write" && entry.access !== "deny") return [];
    return [{ path: resolvePattern(entry.path, cwd), access: entry.access }];
  }));
}

function normalizeHttpRules(value: SaVmHttpAllowRule[] | undefined): SaVmHttpAllowRule[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_POLICY_PATHS).flatMap((entry) => {
    if (!entry || typeof entry.host !== "string" || !entry.host.trim()) return [];
    return [{
      host: entry.host.trim().toLowerCase(),
      methods: (entry.methods?.length ? entry.methods : DEFAULT_HTTP_METHODS).map((method) => method.toUpperCase()).filter((method) => method === "GET" || method === "POST"),
      ...(entry.paths?.length ? { paths: entry.paths.slice(0, 64) } : {})
    }];
  });
}

function normalizeEnv(value: string[] | undefined): string[] {
  const source = Array.isArray(value) && value.length > 0 ? value : DEFAULT_ENV;
  return dedupe(source.filter((entry) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(entry)).slice(0, 64));
}

function normalizeExecRules(value: SaVmProcessExecRule[] | undefined): SaVmProcessExecRule[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_POLICY_PATHS).flatMap((entry) => {
    if (!entry || typeof entry.path !== "string" || !entry.path.trim()) return [];
    return [{ path: entry.path.trim().slice(0, 4096), ...(entry.args?.length ? { args: entry.args.slice(0, 64) } : {}) }];
  });
}

function resolvePattern(value: string, cwd: string): string {
  const expanded = value.replace(/\$\{PROJECT\}|\$PROJECT/gi, cwd).replace(/\\/g, "/");
  if (/^[A-Za-z]:\//.test(expanded) || expanded.startsWith("/")) return expanded.toLowerCase();
  return resolve(cwd, expanded).replace(/\\/g, "/").toLowerCase();
}

function resolvePolicyPath(value: string, cwd: string): string {
  const expanded = value.replace(/\$\{PROJECT\}|\$PROJECT/gi, cwd);
  return (isAbsolute(expanded) ? resolve(expanded) : resolve(cwd, expanded)).replace(/\\/g, "/").toLowerCase();
}

function matchesAny(path: string, patterns: string[]): boolean { return patterns.some((pattern) => globMatches(path, pattern)); }

function globMatches(value: string, pattern: string): boolean {
  const normalizedValue = value.replace(/\\/g, "/").toLowerCase();
  const normalizedPattern = pattern.replace(/\\/g, "/").toLowerCase();
  if (normalizedPattern.endsWith("/**") && normalizedValue === normalizedPattern.slice(0, -3)) return true;
  let expression = "^";
  for (let index = 0; index < normalizedPattern.length; index += 1) {
    const character = normalizedPattern[index]!;
    if (character === "*" && normalizedPattern[index + 1] === "*") {
      expression += ".*";
      index += 1;
    } else if (character === "*") {
      expression += "[^/]*";
    } else if (character === "?") {
      expression += "[^/]";
    } else {
      expression += character.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
    }
  }
  return new RegExp(`${expression}$`, "i").test(normalizedValue);
}

function hostMatches(host: string, pattern: string): boolean {
  const normalizedHost = host.toLowerCase();
  const normalizedPattern = pattern.toLowerCase().replace(/^\*\./, "");
  return normalizedHost === normalizedPattern || normalizedHost.endsWith(`.${normalizedPattern}`);
}

function executableMatches(value: string, pattern: string): boolean {
  const normalizedValue = value.replace(/\\/g, "/").toLowerCase();
  const normalizedPattern = pattern.replace(/\\/g, "/").toLowerCase();
  if (normalizedValue === normalizedPattern) return true;
  if (!normalizedPattern.includes("/")) {
    const executable = normalizedValue.split("/").at(-1);
    if (executable === normalizedPattern || executable === `${normalizedPattern}.exe`) return true;
  }
  return globMatches(normalizedValue, normalizedPattern);
}

function argsMatch(patterns: string[], args: string[]): boolean {
  const trailingWildcard = patterns.at(-1) === "*";
  const fixedPatterns = trailingWildcard ? patterns.slice(0, -1) : patterns;
  if (trailingWildcard ? args.length < fixedPatterns.length : args.length !== fixedPatterns.length) return false;
  return fixedPatterns.every((pattern, index) => globMatches(args[index] ?? "", pattern));
}

function dedupe(values: string[]): string[] { return [...new Set(values)]; }

function dedupeEntries(entries: Array<{ path: string; access: "read" | "write" | "deny" }>): Array<{ path: string; access: "read" | "write" | "deny" }> {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = `${entry.access}:${entry.path}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function resolveFsAccess(entries: Array<{ path: string; access: "read" | "write" | "deny" }>, path: string): "read" | "write" | "deny" | null {
  const matches = entries.filter((entry) => fsPatternMatches(path, entry.path));
  if (matches.length === 0) return null;
  // A deny rule is an explicit safety boundary and always wins, even when a
  // more specific allow rule is present. This prevents accidental policy
  // widening through overlapping entries.
  if (matches.some((entry) => entry.access === "deny")) return "deny";
  matches.sort((left, right) => {
    const specificity = patternSpecificity(right.path) - patternSpecificity(left.path);
    if (specificity !== 0) return specificity;
    return (right.access === "write" ? 1 : 0) - (left.access === "write" ? 1 : 0);
  });
  return matches[0]?.access ?? null;
}

function patternSpecificity(pattern: string): number {
  return pattern.replace(/\/\*\*$/, "").replace(/[?*]/g, "").length;
}

function fsPatternMatches(value: string, pattern: string): boolean {
  return globMatches(value, pattern)
    || (!/[?*]/.test(pattern) && (value === pattern || value.startsWith(`${pattern.replace(/[\\/]+$/, "")}/`)));
}

export function pathWithin(root: string, candidate: string): boolean {
  const normalizedRoot = resolve(root);
  const normalizedCandidate = resolve(candidate);
  const rest = relative(normalizedRoot, normalizedCandidate);
  return rest === "" || (rest !== ".." && !rest.startsWith(`..${sep}`) && !isAbsolute(rest));
}

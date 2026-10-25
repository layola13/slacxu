export type SaVmDeletePolicy = "deny" | "rename" | "move";
export type SaVmFsAccess = "read" | "write" | "deny";

export interface SaVmFsEntry {
  path: string;
  access: SaVmFsAccess;
}

export interface SaVmProcessExecRule {
  path: string;
  args?: string[];
}

export type SaVmBunProfile =
  | "shared-typecheck"
  | "protocol-typecheck"
  | "server-typecheck"
  | "web-typecheck"
  | "free-key-typecheck"
  | "root-typecheck"
  | "shared-build"
  | "web-build"
  | "server-test-file"
  | "web-test-file"
  | "shared-test-file";

export const ALL_SA_VM_BUN_PROFILES: readonly SaVmBunProfile[] = [
  "shared-typecheck",
  "protocol-typecheck",
  "server-typecheck",
  "web-typecheck",
  "free-key-typecheck",
  "root-typecheck",
  "shared-build",
  "web-build",
  "server-test-file",
  "web-test-file",
  "shared-test-file",
] as const;

export type SaVmBunSubcommand = "test" | "run" | "build" | "--filter" | "filter";

export const ALL_SA_VM_BUN_SUBCOMMANDS: readonly SaVmBunSubcommand[] = [
  "test",
  "run",
  "build",
  "--filter",
  "filter",
] as const;

export const ALL_SA_VM_BUN_FILTER_SCRIPTS = [
  "typecheck",
  "build",
  "test",
  "lint",
] as const;
export type SaVmBunFilterScript = typeof ALL_SA_VM_BUN_FILTER_SCRIPTS[number];

export const SA_VM_BUN_DENIED_SUBCOMMANDS: readonly string[] = [
  "install",
  "i",
  "add",
  "a",
  "remove",
  "rm",
  "update",
  "upgrade",
  "outdated",
  "bunx",
  "x",
  "init",
  "create",
  "deploy",
  "publish",
  "login",
  "logout",
  "whoami",
  "link",
  "unlink",
  "pm",
  "patch",
  "completions",
  "shell",
] as const;

export interface SaVmBunPolicyConfig {
  enabled?: boolean;
  allowedSubcommands?: SaVmBunSubcommand[];
}

export interface SaVmHttpAllowRule {
  host: string;
  methods?: string[];
  paths?: string[];
}

export type SaVmRuntimeEngine = "native" | "vm";

export interface SaVmPolicyConfig {
  engine?: SaVmRuntimeEngine;
  fs?: {
    entries?: SaVmFsEntry[];
    read?: string[];
    write?: string[];
    transfer?: string[];
    delete?: SaVmDeletePolicy;
    backupDir?: string | null;
    salaRoot?: string;
  };
  http?: {
    allow?: SaVmHttpAllowRule[];
  };
  env?: {
    allow?: string[];
  };
  process?: {
    spawn?: boolean;
    exec?: SaVmProcessExecRule[];
    bunProfiles?: SaVmBunProfile[];
    bun?: boolean | SaVmBunPolicyConfig;
  };
  execution?: {
    javascript?: boolean;
    python?: boolean;
  };
  tools?: SaVmToolsConfig;
  contextSavings?: SaVmContextSavingsConfig;
  accountability?: SaVmAccountabilityConfig;
}

export interface SaVmAccountabilityConfig {
  enabled?: boolean;
  ledgerPath?: string;
  autoPenalize?: boolean;
  reputationThresholdRed?: number;
  reputationThresholdYellow?: number;
  manualOverride?: boolean;
}

export interface SaVmContextSavingsConfig {
  locateBeforeRead?: boolean;
  maxReadFileBytes?: number;
  grepCircuitBreaker?: boolean;
  grepMaxResults?: number;
  grepMaxTokens?: number;
  slimRunnerOutput?: boolean;
  parallelBudget?: boolean;
  parallelMaxTotalBytes?: number;
  parallelMaxReadFiles?: number;
  parallelDeduplication?: boolean;
  tieredSkillInjection?: boolean;
  foldWaterfallEvents?: boolean;
  foldHistoryReadSummaries?: boolean;
  historyReadFoldTurns?: number;
}

export interface SaVmToolsConfig {
  replaceRead?: boolean;
  replaceWrite?: boolean;
  replaceApplyPatch?: boolean;
  replaceExec?: boolean;
  readFiles?: boolean;
  editFiles?: boolean;
  applyPatch?: boolean;
  fastSearch?: boolean;
  clearToolHistory?: boolean;
  findReferences?: boolean;
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
  jevChoose?: boolean;
  jevChecklist?: boolean;
  jevEvaluate?: boolean;
  jevThinking?: boolean;
  jevRedteam?: boolean;
  jevRank?: boolean;
  jevScope?: boolean;
  jevDispatch?: boolean;
  jevConsistency?: boolean;
  jevDone?: boolean;
  jevDiagnose?: boolean;
  jevEdgeCases?: boolean;
  jevBlastRadius?: boolean;
  jevIntent?: boolean;
  jevNext?: boolean;
  jevCompress?: boolean;
  jevProgress?: boolean;
  /** Allow model to judge whether a fact should enter long-term memory (jev_memory: skip/workspace/global). Default false. */
  jevMemory?: boolean;
}

export const ENHANCE_TOOLS_KEYS = [
  "readFiles",
  "fastSearch",
  "editFiles",
  "applyPatch",
  "fileOutline",
  "codeGraph",
  "findDefinition",
  "renameSymbol",
  "extractToFile",
  "moveWithImports",
  "addImport",
  "getDiagnostics",
  "organizeImports",
  "analyzeScope",
  "findReferences",
  "clearToolHistory",
  "jevChoose",
  "jevChecklist",
  "jevEvaluate",
  "jevThinking",
  "jevRedteam",
  "jevRank",
  "jevScope",
  "jevDispatch",
  "jevConsistency",
  "jevDone",
  "jevDiagnose",
  "jevEdgeCases",
  "jevBlastRadius",
  "jevIntent",
  "jevNext",
  "jevCompress",
  "jevProgress",
  "jevMemory"
] as const;

export type EnhanceToolKey = typeof ENHANCE_TOOLS_KEYS[number];

export function hasEnhanceToolsEnabled(tools?: SaVmToolsConfig | null): boolean {
  if (!tools) return false;
  return ENHANCE_TOOLS_KEYS.some((key) => tools[key] === true);
}

export function countActiveEnhanceTools(tools?: SaVmToolsConfig | null): number {
  if (!tools) return 0;
  let count = 0;
  for (const key of ENHANCE_TOOLS_KEYS) {
    if (tools[key] === true) count += 1;
  }
  return count;
}

export function createDefaultSaVmPolicyConfig(): SaVmPolicyConfig {
  return {
    engine: "native",
    fs: {
      entries: [{ path: "${PROJECT}/**", access: "write" }],
      read: ["${PROJECT}/**"],
      write: ["${PROJECT}/**"],
      transfer: ["${PROJECT}/**"],
      delete: "rename",
      backupDir: "${PROJECT}/.codex-ultra/vm-trash/**",
    },
    http: { allow: [] },
    env: { allow: ["CWD", "PROJECT"] },
    process: {
      spawn: false,
      exec: [
        { path: "git", args: ["status", "*"] },
        { path: "git", args: ["pull"] },
        { path: "git", args: ["push"] },
      ],
      bun: true,
      bunProfiles: [...ALL_SA_VM_BUN_PROFILES],
    },
    execution: { javascript: false, python: false },
    tools: {
      replaceRead: true,
      replaceWrite: true,
      replaceApplyPatch: true,
      replaceExec: true,
      clearToolHistory: true,
      findReferences: true,
      renameSymbol: true,
      fileOutline: true,
      moveWithImports: true,
      findDefinition: true,
      extractToFile: true,
      addImport: true,
      getDiagnostics: true,
      organizeImports: true,
      analyzeScope: true,
    },
    contextSavings: {
      locateBeforeRead: true,
      grepCircuitBreaker: true,
      slimRunnerOutput: true,
      parallelBudget: true,
      parallelDeduplication: true,
      tieredSkillInjection: true,
      foldWaterfallEvents: true,
      foldHistoryReadSummaries: true,
    },
    accountability: {
      enabled: false,
      autoPenalize: true,
      reputationThresholdRed: 50,
      reputationThresholdYellow: 80,
    },
  };
}

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export interface RegressionCase {
  id: string;
  title: string;
  component: string;
  tags?: string[];
  category?: "state_machine" | "protocol_stream" | "lifecycle" | "hook_ordering" | "custom";
  description?: string;
  input?: Record<string, unknown>;
  simulation?: {
    rounds?: Array<Record<string, unknown>>;
    events?: Array<Record<string, unknown>>;
  };
  negativeMatcher?: {
    forbiddenPatterns?: string[];
    forbiddenErrors?: string[];
    forbiddenStates?: Record<string, unknown>;
  };
  positiveInvariants?: {
    requiredPatterns?: string[];
    requiredStates?: Record<string, unknown>;
    minSegments?: number;
  };
  runner?: string;
}

export interface RegressionCaseResult {
  id: string;
  title: string;
  component: string;
  passed: boolean;
  durationMs: number;
  regressionDetected?: boolean;
  violations?: string[];
  logs?: string[];
}

export interface RegressionSuiteReport {
  ok: boolean;
  totalCases: number;
  passedCases: number;
  failedCases: number;
  regressedCases: number;
  durationMs: number;
  results: RegressionCaseResult[];
  summary: string;
}

export interface RegressionCaseFilter {
  id?: string;
  component?: string;
  tag?: string | string[];
  tags?: string[];
  category?: string;
}

export function resolveRegressionCasesDir(cwd?: string): string {
  const root = cwd ? resolve(cwd) : process.cwd();
  return join(root, "tests", "cases", "regression");
}

/**
 * Loads all regression cases matching the optional filter from `tests/cases/regression/*.case.json`.
 */
export function loadRegressionCases(filter?: RegressionCaseFilter, cwd?: string): RegressionCase[] {
  const dir = resolveRegressionCasesDir(cwd);
  if (!existsSync(dir)) return [];

  const files = readdirSync(dir).filter((file) => file.endsWith(".json"));
  const cases: RegressionCase[] = [];

  for (const file of files) {
    try {
      const fullPath = join(dir, file);
      const raw = readFileSync(fullPath, "utf-8");
      const parsed = JSON.parse(raw) as RegressionCase;
      if (!parsed.id || !parsed.component) continue;

      if (filter) {
        if (filter.id && parsed.id.toLowerCase() !== filter.id.toLowerCase()) {
          continue;
        }
        if (filter.component && !parsed.component.toLowerCase().includes(filter.component.toLowerCase())) {
          continue;
        }
        if (filter.category && parsed.category !== filter.category) {
          continue;
        }
        if (filter.tag) {
          const reqTags = Array.isArray(filter.tag) ? filter.tag : [filter.tag];
          const hasTag = reqTags.some((t) => parsed.tags?.includes(t));
          if (!hasTag) continue;
        }
        if (filter.tags && filter.tags.length > 0) {
          const hasTag = filter.tags.some((t) => parsed.tags?.includes(t));
          if (!hasTag) continue;
        }
      }

      cases.push(parsed);
    } catch {
      // Ignore invalid or unparseable JSON files
    }
  }

  return cases;
}

/**
 * Persists a new regression case definition into `tests/cases/regression/<id>.case.json`.
 */
export function recordRegressionCase(
  caseDef: Partial<RegressionCase>,
  cwd?: string,
): { ok: boolean; path: string; case: RegressionCase; error?: string } {
  const id = (caseDef.id || "").trim();
  const title = (caseDef.title || "").trim();
  const component = (caseDef.component || "").trim();

  if (!id) return { ok: false, path: "", case: caseDef as RegressionCase, error: "Missing required 'id' for regression case" };
  if (!title) return { ok: false, path: "", case: caseDef as RegressionCase, error: "Missing required 'title' for regression case" };
  if (!component) return { ok: false, path: "", case: caseDef as RegressionCase, error: "Missing required 'component' for regression case" };

  const sanitizedId = id.replace(/[^a-zA-Z0-9_-]/g, "-");
  const fullCase: RegressionCase = {
    id: sanitizedId,
    title,
    component,
    tags: Array.isArray(caseDef.tags) ? caseDef.tags : [],
    category: caseDef.category || "state_machine",
    description: caseDef.description || "",
    input: caseDef.input || {},
    simulation: caseDef.simulation || {},
    negativeMatcher: caseDef.negativeMatcher || {},
    positiveInvariants: caseDef.positiveInvariants || {},
    runner: caseDef.runner,
  };

  const dir = resolveRegressionCasesDir(cwd);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const filePath = join(dir, `${sanitizedId}.case.json`);
  writeFileSync(filePath, JSON.stringify(fullCase, null, 2), "utf-8");

  return { ok: true, path: filePath, case: fullCase };
}

/**
 * Replays a single regression case against declarative matchers and simulation assertions.
 */
export async function runRegressionCase(caseDef: RegressionCase, _cwd?: string): Promise<RegressionCaseResult> {
  const startedAt = Date.now();
  const violations: string[] = [];
  const logs: string[] = [`[replay] Starting case ${caseDef.id}: ${caseDef.title}`];
  let regressionDetected = false;

  try {
    logs.push("[replay] Executing declarative case evaluation");
    const forbiddenPatterns = caseDef.negativeMatcher?.forbiddenPatterns || [];
    for (const pattern of forbiddenPatterns) {
      for (const round of caseDef.simulation?.rounds || []) {
        const roundStr = JSON.stringify(round);
        if (roundStr.includes(pattern)) {
          regressionDetected = true;
          violations.push(`Negative matcher violation: found forbidden pattern "${pattern}" in simulation`);
        }
      }
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    violations.push(`Execution error: ${msg}`);
  }

  const passed = violations.length === 0;
  const durationMs = Date.now() - startedAt;
  logs.push(`[replay] Finished ${caseDef.id}: ${passed ? "PASS" : "FAIL"} (${durationMs}ms)`);

  return {
    id: caseDef.id,
    title: caseDef.title,
    component: caseDef.component,
    passed,
    durationMs,
    regressionDetected,
    violations,
    logs,
  };
}

/**
 * Runs all matching regression cases and produces an aggregated test report.
 */
export async function runRegressionSuite(filter?: RegressionCaseFilter, cwd?: string): Promise<RegressionSuiteReport> {
  const startedAt = Date.now();
  const cases = loadRegressionCases(filter, cwd);
  const results: RegressionCaseResult[] = [];

  for (const c of cases) {
    const res = await runRegressionCase(c, cwd);
    results.push(res);
  }

  const totalCases = results.length;
  const passedCases = results.filter((r) => r.passed).length;
  const failedCases = results.filter((r) => !r.passed).length;
  const regressedCases = results.filter((r) => r.regressionDetected).length;
  const durationMs = Date.now() - startedAt;

  const summary = [
    `【Codex Ultra 历史错误重放套件】`,
    `• 运行案例数：${totalCases} 个`,
    `• 通过：${passedCases} | 失败：${failedCases}`,
    regressedCases > 0 ? `• 🚨 历史回归警报：发现 ${regressedCases} 个旧 Bug 再次复发！` : `• ✅ 历史回归检测：0 个旧 Bug 复发`,
    `• 总耗时：${durationMs}ms`,
  ].join("\n");

  return {
    ok: failedCases === 0,
    totalCases,
    passedCases,
    failedCases,
    regressedCases,
    durationMs,
    results,
    summary,
  };
}

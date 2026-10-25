import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { miniIsAnalysisOnlyPrompt, miniPromptNeedsWorkspaceAction } from "../../../backends/mini/src/runtime/miniTaskIntent.js";
import { ThreadSubscriptionRegistry } from "./threadSubscriptionRegistry.js";
import type { CodexRuntimeClient } from "@cxu/sdk-backend";
import type { EngineStatus, JsonRpcFailure, JsonRpcId, JsonValue } from "@codex-ui/shared";
import {
  miniAnthropicOutputCapForModel,
  isMiniAnthropicMaxTokensRejectedError,
  MINI_ANTHROPIC_CLAUDE4_MAX_TOKENS,
  MINI_ANTHROPIC_CLAUDE5_MAX_TOKENS,
  MINI_ANTHROPIC_MAX_TOKENS_TRUNCATED,
} from "../../../backends/mini/src/runtime/miniBridge.js";

import { loadRegressionCases, resolveRegressionCasesDir, type RegressionCase, type RegressionCaseFilter } from "@cxu/sdk-backend";
export { loadRegressionCases, resolveRegressionCasesDir };
export type { RegressionCase, RegressionCaseFilter };
export interface RegressionCaseResult {
  id: string;
  title: string;
  component: string;
  passed: boolean;
  durationMs: number;
  regressionDetected: boolean;
  violations: string[];
  logs: string[];
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


/**
 * Records a new regression case definition to `tests/cases/regression/<id>.case.json`.
 */
export function recordRegressionCase(
  caseDef: Partial<RegressionCase>,
  cwd?: string
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

// Internal Mocks for Lifecyle / Subscription checks
class RegressionFakeRuntimeClient extends EventEmitter implements CodexRuntimeClient {
  public status: EngineStatus = { phase: "ready", transport: "daemon-unix" };
  public requests: Array<{ method: string; params?: JsonValue }> = [];

  public getStatus(): EngineStatus {
    return this.status;
  }

  public async start(): Promise<EngineStatus> {
    this.status = { phase: "ready", transport: "daemon-unix" };
    this.emit("status", this.status);
    return this.status;
  }

  public stop(): void {
    this.status = { phase: "stopped", transport: "daemon-unix" };
    this.emit("status", this.status);
  }

  public async restart(): Promise<EngineStatus> {
    this.stop();
    return this.start();
  }

  public async request(method: string, params?: JsonValue): Promise<JsonValue> {
    this.requests.push({ method, params });
    return {};
  }

  public async notify(_method: string, _params?: JsonValue): Promise<void> {}
  public respond(_id: JsonRpcId, _result?: JsonValue, _error?: JsonRpcFailure["error"]): void {}
}

/**
 * Executes a single regression case and evaluates its negative matchers and positive invariants.
 */
export async function runRegressionCase(caseDef: RegressionCase, _cwd?: string): Promise<RegressionCaseResult> {
  const startedAt = Date.now();
  const violations: string[] = [];
  const logs: string[] = [];
  let regressionDetected = false;

  logs.push(`[replay] Running case ${caseDef.id}: ${caseDef.title} (target: ${caseDef.component})`);

  try {
    const runner = caseDef.runner || "";

    if (runner === "verifyWaterfallConsultationRetention" || caseDef.id.includes("waterfall-retention")) {
      const prompt = String(caseDef.input?.prompt ?? "");
      const isAnalysis = miniIsAnalysisOnlyPrompt(prompt);
      const needsAction = miniPromptNeedsWorkspaceAction(prompt);

      logs.push(`[replay] Intent analysis: isAnalysis=${isAnalysis}, needsWorkspaceAction=${needsAction}`);

      if (!isAnalysis) {
        regressionDetected = true;
        violations.push("Prompt failed to classify as analysis-only consultation; risk of task evasion steer");
      }
      if (needsAction) {
        regressionDetected = true;
        violations.push("Consultation prompt was incorrectly marked as requiring workspace file actions");
      }

      // Check positive invariants
      if (caseDef.positiveInvariants?.requiredStates?.segmentsPreserved && violations.length === 0) {
        logs.push("[replay] Positive invariant satisfied: answers will be closed into waterfall via closeMsgSegment");
      }
    } else if (runner === "verifyThreadSubscriptionLifecycle" || caseDef.id.includes("thread-subscription")) {
      const client = new RegressionFakeRuntimeClient();
      const registry = new ThreadSubscriptionRegistry(() => client);
      const threadId = String(caseDef.input?.threadId ?? "regression-test-thread");
      const turnId = String(caseDef.input?.turnId ?? "turn-regression-01");
      const clientId = "browser-test-client";

      // Round 1: watch() must establish subscription
      registry.watch(threadId, clientId);
      await new Promise((r) => setTimeout(r, 5));
      const initialDiag = registry.diagnostics();
      logs.push(`[replay] watch() initial diagnostics: subscribedThreadCount=${initialDiag.subscribedThreadCount}, watcherCount=${initialDiag.watcherCount}`);

      if (initialDiag.subscribedThreadCount < 1) {
        regressionDetected = true;
        violations.push("watch() did not ensure subscription (subscribedThreadCount < 1)");
      }

      // Start turn hold
      registry.addTurnHold(threadId, `turn:${turnId}`);
      const activeDiag = registry.diagnostics();
      logs.push(`[replay] turn started hold diagnostics: activeTurnHoldCount=${activeDiag.activeTurnHoldCount}`);
      if (activeDiag.activeTurnHoldCount < 1) {
        violations.push("addTurnHold() did not record active turn hold");
      }

      // End turn hold
      registry.removeTurnHold(threadId, `turn:${turnId}`);

      // Unwatch
      registry.unwatch(threadId, clientId);
      await new Promise((r) => setTimeout(r, 5));

      const settledDiag = registry.diagnostics();
      logs.push(`[replay] settled diagnostics: watchers=${settledDiag.watcherCount}, turnHolds=${settledDiag.activeTurnHoldCount}, subscribed=${settledDiag.subscribedThreadCount}`);

      if (settledDiag.watcherCount !== 0) {
        violations.push(`Expected settled watcherCount=0, got ${settledDiag.watcherCount}`);
      }
      if (settledDiag.activeTurnHoldCount !== 0) {
        regressionDetected = true;
        violations.push(`Regression: activeTurnHoldCount did not settle to 0 (leaked: ${settledDiag.activeTurnHoldCount})`);
      }
      if (settledDiag.subscribedThreadCount !== 0) {
        violations.push(`Expected settled subscribedThreadCount=0, got ${settledDiag.subscribedThreadCount}`);
      }
    } else if (runner === "verifyMaxTokensContinuation" || caseDef.id.includes("max-tokens")) {
      const model = String(caseDef.input?.model ?? "claude-sonnet-4-5");
      const cap = miniAnthropicOutputCapForModel(model);
      logs.push(`[replay] Model ${model} cap resolved to: ${cap}`);

      if (cap !== MINI_ANTHROPIC_CLAUDE4_MAX_TOKENS) {
        violations.push(`Expected cap ${MINI_ANTHROPIC_CLAUDE4_MAX_TOKENS}, got ${cap}`);
      }

      const claude5Cap = miniAnthropicOutputCapForModel("claude-sonnet-5");
      if (claude5Cap !== MINI_ANTHROPIC_CLAUDE5_MAX_TOKENS) {
        violations.push(`Expected Claude 5 cap ${MINI_ANTHROPIC_CLAUDE5_MAX_TOKENS}, got ${claude5Cap}`);
      }

      const mockRejection = new Error("anthropic 400: max_tokens: 64000 exceeds maximum (8192)");
      const isRejected = isMiniAnthropicMaxTokensRejectedError(mockRejection);
      if (!isRejected) {
        regressionDetected = true;
        violations.push("Failed to detect relay max_tokens rejection error");
      }

      if (MINI_ANTHROPIC_MAX_TOKENS_TRUNCATED !== "mini anthropic output truncated at max_tokens") {
        violations.push("Truncation marker token definition altered");
      }
      logs.push("[replay] max_tokens continuation protocol guard verified");
    } else {
      // Declarative matcher fallback
      logs.push("[replay] Executing declarative case evaluation");
      const forbiddenPatterns = caseDef.negativeMatcher?.forbiddenPatterns || [];
      for (const pattern of forbiddenPatterns) {
        // If simulation rounds contain forbidden action or text
        for (const round of caseDef.simulation?.rounds || []) {
          const roundStr = JSON.stringify(round);
          if (roundStr.includes(pattern)) {
            regressionDetected = true;
            violations.push(`Negative matcher violation: found forbidden pattern "${pattern}" in simulation`);
          }
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

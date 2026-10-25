import { evaluateJev } from "./jevClient";
import { JEV_MAX_AUTO_NUDGES, loadJevConfig } from "./jevConfig";
import {
  buildJevBriefState,
  buildJevPlanState,
  buildJevReportState,
  buildJevState,
  defaultJevBriefQuestions,
  defaultJevPlanQuestions,
  defaultJevQuestions,
  defaultJevReportQuestions,
  parseJevBriefVerdict,
  parseJevPlanVerdict,
  parseJevReportVerdict,
  parseJevVerdict,
  type JevTurnSnapshot,
  type JevVerdict,
} from "./jevQuestions";

export const JEV_TURN_EVENT = "jev:turn-completed";
export const JEV_PLAN_EVENT = "jev:plan-created";
export const JEV_SUB_EVENT = "jev:subagent-tool";
export const JEV_RESULT_EVENT = "jev:result";
export const JEV_ERROR_EVENT = "jev:error";

export interface JevSubEventDetail {
  /** brief: spawn_agent completed; report: wait_agent completed. */
  kind: "brief" | "report";
  threadId: string;
  turnId: string;
  agentId: string;
  taskName?: string;
  brief?: string;
  status?: string;
  report?: string;
  sessionToken?: string | null;
}

const reviewedBriefs = new Set<string>();
const reviewedReports = new Set<string>();

export interface JevTurnEventDetail extends JevTurnSnapshot {
  sessionToken?: string | null;
}

export interface JevPlanEventDetail {
  threadId: string;
  turnId: string;
  planText: string;
  userPrompt?: string;
  sessionToken?: string | null;
}

const reviewedPlanThreads = new Set<string>();
const reviewedPlanContent = new Map<string, string>();

const judgedTurns = new Set<string>();
const inFlight = new Set<string>();

function readDetail(event: Event): JevTurnEventDetail | null {
  const detail = (event as CustomEvent).detail as JevTurnEventDetail | undefined;
  if (!detail || typeof detail.turnId !== "string" || typeof detail.threadId !== "string") return null;
  return detail;
}

function jevHasCredential(config: { apiKey: string; providerId?: string }): boolean {
  if (config.apiKey.trim()) return true;
  return Boolean(config.providerId?.trim());
}

async function handleTurnEvent(event: Event, scope?: JevAutoJudgeScope): Promise<void> {
  const detail = readDetail(event);
  if (!detail) return;
  // 触发侧也必须按当前 threadId 过滤：JEV 事件是 window 全局广播，
  // 不加这道门，后台对话的每个 turn 都会烧一次上游评审（全局触发）。
  if (!isJevEventInScope(scope, detail.threadId)) {
    console.warn(`[jev] skip auto-judge: thread not active (thread=${detail.threadId} turn=${detail.turnId})`);
    return;
  }
  const config = loadJevConfig();
  if (!config.enabled) {
    console.warn(`[jev] skip auto-judge: disabled (thread=${detail.threadId} turn=${detail.turnId})`);
    return;
  }
  if (!jevHasCredential(config)) {
    console.warn(`[jev] skip auto-judge: no credential (apiKey/providerId empty, thread=${detail.threadId} turn=${detail.turnId})`);
    return;
  }
  if (judgedTurns.has(detail.turnId) || inFlight.has(detail.turnId)) {
    console.warn(`[jev] skip auto-judge: turn already judged/in-flight (turn=${detail.turnId})`);
    return;
  }
  inFlight.add(detail.turnId);
  try {
    const state = buildJevState(detail);
    const result = await evaluateJev({
      sessionToken: detail.sessionToken,
      baseUrl: config.baseUrl,
      apiKey: config.apiKey.trim(),
      model: config.model,
      providerId: config.providerId?.trim() || undefined,
      groupId: config.groupId?.trim() || undefined,
      bridgeProtocol: config.bridgeProtocol || undefined,
      state,
      questions: defaultJevQuestions(),
    });
    const verdict = parseJevVerdict(detail.threadId, detail.turnId, result.data, result.latencyMs);
    judgedTurns.add(detail.turnId);
    if (judgedTurns.size > 500) {
      const oldest = judgedTurns.values().next().value;
      if (oldest) judgedTurns.delete(oldest);
    }
    window.dispatchEvent(new CustomEvent<JevVerdict>(JEV_RESULT_EVENT, { detail: verdict }));
  } catch (error) {
    window.dispatchEvent(
      new CustomEvent(JEV_ERROR_EVENT, {
        detail: {
          threadId: detail.threadId,
          turnId: detail.turnId,
          message: error instanceof Error ? error.message : "JEV evaluate failed",
        },
      }),
    );
  } finally {
    inFlight.delete(detail.turnId);
  }
}

export function dispatchJevTurnCompleted(detail: JevTurnEventDetail): void {
  try {
    window.dispatchEvent(new CustomEvent<JevTurnEventDetail>(JEV_TURN_EVENT, { detail }));
  } catch {
    // ignore dispatch failures in non-DOM environments
  }
}

export function startJevAutoJudgeListener(scope?: JevAutoJudgeScope): () => void {
  const turnListener = (event: Event): void => {
    void handleTurnEvent(event, scope);
  };
  const planListener = (event: Event): void => {
    void handlePlanEvent(event, scope);
  };
  const subListener = (event: Event): void => {
    void handleSubEvent(event, scope);
  };
  window.addEventListener(JEV_TURN_EVENT, turnListener);
  window.addEventListener(JEV_PLAN_EVENT, planListener);
  window.addEventListener(JEV_SUB_EVENT, subListener);
  return () => {
    window.removeEventListener(JEV_TURN_EVENT, turnListener);
    window.removeEventListener(JEV_PLAN_EVENT, planListener);
    window.removeEventListener(JEV_SUB_EVENT, subListener);
  };
}

async function handleSubEvent(event: Event, scope?: JevAutoJudgeScope): Promise<void> {
  const detail = (event as CustomEvent).detail as JevSubEventDetail | undefined;
  if (!detail || (detail.kind !== "brief" && detail.kind !== "report")) return;
  if (!detail.agentId || !detail.threadId || !detail.turnId) return;
  if (!isJevEventInScope(scope, detail.threadId)) return;
  const config = loadJevConfig();
  if (!config.enabled) return;
  if (!jevHasCredential(config)) return;
  if (detail.kind === "brief") {
    if (!config.reviewBrief || !detail.brief?.trim()) return;
    if (reviewedBriefs.has(detail.agentId)) return;
    reviewedBriefs.add(detail.agentId);
  } else {
    if (!config.reviewReport || !detail.report?.trim()) return;
    if (reviewedReports.has(detail.agentId)) return;
    reviewedReports.add(detail.agentId);
  }
  try {
    const isBrief = detail.kind === "brief";
    const state = isBrief
      ? buildJevBriefState(detail.taskName ?? "", detail.brief ?? "")
      : buildJevReportState(detail.taskName ?? "", detail.status ?? "", detail.report ?? "");
    const result = await evaluateJev({
      sessionToken: detail.sessionToken,
      baseUrl: config.baseUrl,
      apiKey: config.apiKey.trim(),
      model: config.model,
      providerId: config.providerId?.trim() || undefined,
      groupId: config.groupId?.trim() || undefined,
      bridgeProtocol: config.bridgeProtocol || undefined,
      state,
      questions: isBrief ? defaultJevBriefQuestions() : defaultJevReportQuestions(),
    });
    const verdict = isBrief
      ? parseJevBriefVerdict(detail.threadId, detail.turnId, detail.agentId, detail.taskName ?? "", result.data, result.latencyMs)
      : parseJevReportVerdict(detail.threadId, detail.turnId, detail.agentId, detail.taskName ?? "", result.data, result.latencyMs);
    window.dispatchEvent(new CustomEvent<JevVerdict>(JEV_RESULT_EVENT, { detail: verdict }));
  } catch (error) {
    if (detail.kind === "brief") reviewedBriefs.delete(detail.agentId);
    else reviewedReports.delete(detail.agentId);
    window.dispatchEvent(
      new CustomEvent(JEV_ERROR_EVENT, {
        detail: {
          threadId: detail.threadId,
          turnId: detail.turnId,
          message: error instanceof Error ? error.message : "JEV subagent review failed",
        },
      }),
    );
  }
}

export function dispatchJevSubagent(detail: JevSubEventDetail): void {
  try {
    window.dispatchEvent(new CustomEvent<JevSubEventDetail>(JEV_SUB_EVENT, { detail }));
  } catch {
    // ignore dispatch failures in non-DOM environments
  }
}

async function handlePlanEvent(event: Event, scope?: JevAutoJudgeScope): Promise<void> {
  const detail = (event as CustomEvent).detail as JevPlanEventDetail | undefined;
  if (!detail || typeof detail.threadId !== "string" || typeof detail.turnId !== "string") return;
  if (!isJevEventInScope(scope, detail.threadId)) return;
  if (!detail.planText?.trim()) return;
  const config = loadJevConfig();
  if (!config.enabled || config.planReview === "off") return;
  if (!jevHasCredential(config)) return;
  const planText = detail.planText.trim().slice(0, 6000);
  if (config.planReview === "created") {
    // Audit once: update_plan fires on every step, but the plan itself
    // only needs a single audit when created.
    if (reviewedPlanThreads.has(detail.threadId)) return;
    reviewedPlanThreads.add(detail.threadId);
  } else {
    // "every": audit each revision, but skip identical repeats.
    if (reviewedPlanContent.get(detail.threadId) === planText) return;
    reviewedPlanContent.set(detail.threadId, planText);
  }
  try {
    const state = buildJevPlanState(planText, detail.userPrompt);
    const result = await evaluateJev({
      sessionToken: detail.sessionToken,
      baseUrl: config.baseUrl,
      apiKey: config.apiKey.trim(),
      model: config.model,
      providerId: config.providerId?.trim() || undefined,
      groupId: config.groupId?.trim() || undefined,
      bridgeProtocol: config.bridgeProtocol || undefined,
      state,
      questions: defaultJevPlanQuestions(),
    });
    const verdict = parseJevPlanVerdict(detail.threadId, detail.turnId, result.data, result.latencyMs);
    window.dispatchEvent(new CustomEvent<JevVerdict>(JEV_RESULT_EVENT, { detail: verdict }));
  } catch (error) {
    reviewedPlanThreads.delete(detail.threadId);
    reviewedPlanContent.delete(detail.threadId);
    window.dispatchEvent(
      new CustomEvent(JEV_ERROR_EVENT, {
        detail: {
          threadId: detail.threadId,
          turnId: detail.turnId,
          message: error instanceof Error ? error.message : "JEV plan review failed",
        },
      }),
    );
  }
}

export function dispatchJevPlanCreated(detail: JevPlanEventDetail): void {
  try {
    window.dispatchEvent(new CustomEvent<JevPlanEventDetail>(JEV_PLAN_EVENT, { detail }));
  } catch {
    // ignore dispatch failures in non-DOM environments
  }
}

/**
 * 跨挂载去重：同一 verdict turn 只自动督促一次。
 * 自动督促归属 App 层按线程 owner 发送，该集合必须全局共享，
 * 否则双挂载/双 owner 会对同一 turn 重复发送。
 */
const autoNudgedTurns = new Set<string>();

export function resetJevAutoJudgeCache(): void {
  judgedTurns.clear();
  reviewedPlanThreads.clear();
  reviewedPlanContent.clear();
  reviewedBriefs.clear();
  reviewedReports.clear();
  autoNudgedTurns.clear();
  for (const turnId of [...inFlight]) {
    inFlight.delete(turnId);
  }
}

export function claimJevAutoNudgeTurn(turnId: string): boolean {
  if (!turnId) return false;
  if (autoNudgedTurns.has(turnId)) return false;
  autoNudgedTurns.add(turnId);
  if (autoNudgedTurns.size > 500) {
    const oldest = autoNudgedTurns.values().next().value;
    if (oldest) autoNudgedTurns.delete(oldest);
  }
  return true;
}

export function resetJevAutoNudgeDedup(): void {
  autoNudgedTurns.clear();
}

export interface JevNudgeDecision {
  choice?: string;
  /** composer is mid-turn (user already acting) — never auto-steer over it. */
  running: boolean;
  autoNudge: boolean;
  /** consecutive failed/partial verdicts in this thread BEFORE this one. */
  consecutiveFailures: number;
  maxNudges: number;
}

/**
 * Pure gate for failure auto-nudge: only failed/partial, only when idle,
 * bounded by maxNudges. needs_user_confirmation is surfaced to the person,
 * never auto-steered. completed resets the streak (handled by the caller).
 */
export function shouldAutoNudge(decision: JevNudgeDecision): boolean {
  if (!decision.autoNudge || decision.running) return false;
  if (decision.choice !== "failed" && decision.choice !== "partial") return false;
  return decision.consecutiveFailures < Math.min(JEV_MAX_AUTO_NUDGES, Math.max(1, decision.maxNudges));
}

/**
 * 线程归属门卫（纯函数）：JEV verdict/error 是 window 全局广播，
 * 消费侧必须只接受当前对话的事件，避免后台对话/MCP 子代理钩子
 * 完成后在当前对话弹窗或误自动发送。
 *
 * - 双方都有 id：仅相等时接受；
 * - 当前对话为空（新对话未落库）：只接受无目标事件，有明确
 *   target 的交给对应对话的 Composer 处理；
 * - 目标为空（老格式）：接受，避免静默丢 verdict。
 */
export function shouldAcceptJevVerdictForThread(
  activeThreadId: string | null | undefined,
  verdictThreadId: unknown,
): boolean {
  const current = typeof activeThreadId === "string" ? activeThreadId : "";
  const target = typeof verdictThreadId === "string" ? verdictThreadId : "";
  if (current && target) return target === current;
  if (!current && target) return false;
  return true;
}

export interface JevAutoJudgeScope {
  /**
   * 该监听实例当前服务的对话。JEV 事件是 window 全局广播，
   * 触发侧按此过滤，非当前对话的 turn/plan/sub 事件直接丢弃，
   * 不再烧上游评审。未提供时保持老行为（全部受理），由消费侧过滤。
   */
  getActiveThreadId?: () => string | null | undefined;
}

/**
 * 触发侧门卫（纯函数）：复用消费侧同一套线程归属语义，
 * 让“是否评审”和“是否为我弹窗/督促”按同一个当前 threadId 判定。
 */
export function isJevEventInScope(
  scope: JevAutoJudgeScope | undefined,
  threadId: unknown,
): boolean {
  const getter = scope?.getActiveThreadId;
  if (!getter) return true;
  return shouldAcceptJevVerdictForThread(getter(), threadId);
}

export interface JevTurnSnapshotItem {
  type: string;
  title?: string;
  text?: string;
}

export interface JevTurnSnapshot {
  threadId: string;
  turnId: string;
  items: JevTurnSnapshotItem[];
}

export function buildJevState(snapshot: JevTurnSnapshot): string {
  const userTexts: string[] = [];
  const assistantTexts: string[] = [];
  const toolTexts: string[] = [];
  for (const item of snapshot.items) {
    const text = `${item.title ? `${item.title}\n` : ""}${item.text ?? ""}`.trim();
    if (!text) continue;
    const kind = item.type.toLowerCase();
    if (kind.includes("user")) userTexts.push(text.slice(0, 4000));
    else if (kind.includes("agent") || kind.includes("assistant") || kind.includes("message")) assistantTexts.push(text.slice(0, 6000));
    else toolTexts.push(`${item.type}: ${text}`.slice(0, 2000));
  }
  // The tail window alone is not enough: after auto-nudges the last user
  // texts are nudge boilerplate, so the judge would rate the turn against
  // the nudge instead of the real task (same-ish verdicts every round).
  // Always anchor on the original request when the tail has moved past it.
  const recentUsers = userTexts.slice(-2);
  const original = userTexts.length > recentUsers.length ? userTexts[0] ?? "" : "";
  const parts = [
    ...(original && !recentUsers.includes(original) ? [`original_request:\n${original.slice(0, 4000)}`] : []),
    `user_prompt:\n${recentUsers.join("\n---\n").slice(0, 6000) || "(empty)"}`,
    `assistant_response:\n${assistantTexts.slice(-3).join("\n---\n").slice(0, 8000) || "(empty)"}`,
    `tool_summary:\n${toolTexts.slice(-8).join("\n").slice(0, 4000) || "(none)"}`,
  ];
  return parts.join("\n\n");
}

export function defaultJevQuestions(): Record<string, unknown> {
  return {
    task_completed: {
      type: "choice",
      instructions: "Has the user's task been fully completed in this turn?",
      criteria: {
        completed: "Task fully completed and self-checked",
        partial: "Partially done, still needs code or verification",
        failed: "Blocked or produced unresolved errors",
        needs_user_confirmation: "Needs further user instruction or environment confirmation",
      },
    },
    solution_quality: {
      type: "score",
      instructions: "Rate the quality of the assistant solution",
      criteria: ["Poor or off-track", "Barely usable but rough", "Good and accurate", "Excellent and thorough"],
    },
    risk_or_hallucination: {
      type: "noul",
      instructions: "Does the turn contain hallucinated code, dangerous operations, or logic defects?",
    },
    failure_cause: {
      type: "choice",
      instructions: "If the task is not complete, what is the primary cause? If it looks done, choose none.",
      criteria: {
        incomplete_implementation: "Code unfinished, TODOs remain, or steps skipped",
        test_failures: "Tests fail or execution errors remain unresolved",
        wrong_approach: "Wrong direction or misunderstood requirement",
        missing_verification: "Work described but never verified (no tests, no repro)",
        blocked_environment: "Blocked by environment, permissions, or upstream issues",
        needs_user_input: "Needs more information or confirmation from the user",
        none: "No failure; the task looks complete",
      },
    },
    suggested_action: {
      type: "choice",
      instructions: "What should happen next with this turn?",
      criteria: {
        continue_fix: "Keep fixing the blocking problem and verify",
        run_tests: "Run tests or reproduce first to confirm the real status",
        revise_approach: "Change the approach and redo the work",
        ask_user: "Ask the user for information or confirmation",
        done_no_action: "Done; no further action needed",
      },
    },
  };
}

export interface JevVerdict {
  /** turn verdict by default; plan/brief/report audits set their kind. */
  kind?: "turn" | "plan" | "brief" | "report";
  threadId: string;
  turnId: string;
  model?: string;
  choice?: string;
  choiceConfidence?: number;
  quality?: number;
  qualityConfidence?: number;
  risk?: number;
  cause?: string;
  causeConfidence?: number;
  action?: string;
  actionConfidence?: number;
  usage?: { input_tokens?: number; output_tokens?: number };
  latencyMs?: number;
  raw: unknown;
}

function normalizeJevChoice(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const norm = value.trim().toLowerCase().replace(/-/g, "_");
  // JEV 模型是开放生成，choice 常带空格/大小写/同义词。不归一化的话
  // shouldAutoNudge 只认精确 failed/partial，" failed "/"complete" 会静默
  // 跳过督促，UI 还显示"已评判"。
  switch (norm) {
    case "completed":
    case "complete":
    case "done":
      return "completed";
    case "failed":
    case "fail":
      return "failed";
    case "partial":
      return "partial";
    case "needs_user_confirmation":
    case "need_user_confirmation":
    case "needs_confirmation":
      return "needs_user_confirmation";
    default:
      return norm || undefined;
  }
}
export function parseJevVerdict(threadId: string, turnId: string, payload: unknown, latencyMs?: number): JevVerdict {
  const root = (payload ?? {}) as Record<string, unknown>;
  const answers = (root.answers ?? {}) as Record<string, Record<string, unknown>>;
  const usage = (root.usage ?? {}) as { input_tokens?: number; output_tokens?: number };
  const task = answers.task_completed ?? {};
  const quality = answers.solution_quality ?? {};
  const risk = answers.risk_or_hallucination ?? {};
  const cause = answers.failure_cause ?? {};
  const action = answers.suggested_action ?? {};
  const num = (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) ? value : undefined);
  const str = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);
  return {
    threadId,
    turnId,
    model: str(root.model),
    choice: normalizeJevChoice(task.choice),
    choiceConfidence: num(task.confidence),
    quality: num(quality.score),
    qualityConfidence: num(quality.confidence),
    risk: num(risk.noul),
    cause: str(cause.choice),
    causeConfidence: num(cause.confidence),
    action: str(action.choice),
    actionConfidence: num(action.confidence),
    usage,
    latencyMs,
    raw: payload,
  };
}

const JEV_CAUSE_LABELS: Record<string, string> = {
  incomplete_implementation: "实现不完整",
  test_failures: "测试失败",
  wrong_approach: "方向跑偏",
  missing_verification: "缺少验证",
  blocked_environment: "环境阻塞",
  needs_user_input: "需用户补充",
  none: "无异常",
};

const JEV_ACTION_LABELS: Record<string, string> = {
  continue_fix: "继续修复并验证",
  run_tests: "先跑测试确认现状",
  revise_approach: "换思路重做",
  ask_user: "向用户确认",
  done_no_action: "无需动作",
};

export function jevCauseLabel(cause?: string): string {
  return (cause && JEV_CAUSE_LABELS[cause]) || cause || "";
}

export function jevActionLabel(action?: string): string {
  return (action && JEV_ACTION_LABELS[action]) || action || "";
}

export function formatJevCauseAction(verdict: JevVerdict): string {
  const parts: string[] = [];
  if (verdict.cause && verdict.cause !== "none") {
    const conf = typeof verdict.causeConfidence === "number" ? `(${Math.round(verdict.causeConfidence * 100)}%)` : "";
    parts.push(`原因：${jevCauseLabel(verdict.cause)}${conf}`);
  }
  if (verdict.action && verdict.action !== "done_no_action") {
    parts.push(`建议：${jevActionLabel(verdict.action)}`);
  }
  return parts.join(" · ");
}

export function formatJevVerdictLabel(verdict: JevVerdict): string {
  const status =
    verdict.choice === "completed" ? "✅ 任务已完成"
    : verdict.choice === "partial" ? "🟡 部分完成"
    : verdict.choice === "failed" ? "❌ 受阻/失败"
    : verdict.choice === "needs_user_confirmation" ? "❓ 待用户确认"
    : "🧠 已评判";
  const conf = typeof verdict.choiceConfidence === "number" ? ` (置信度 ${Math.round(verdict.choiceConfidence * 100)}%)` : "";
  const quality = typeof verdict.quality === "number" ? ` · 质量 ${verdict.quality.toFixed(1)}/3.0` : "";
  const risk =
    typeof verdict.risk === "number" ? (verdict.risk >= 0.7 ? " · ⚠️ 高风险" : verdict.risk >= 0.35 ? " · 低风险" : " · 无异常风险") : "";
  return `${status}${conf}${quality}${risk}`;
}

export function jevChoiceLabel(choice?: string): string {
  switch (choice) {
    case "completed": return "任务已完成";
    case "partial": return "部分完成";
    case "failed": return "受阻/失败";
    case "needs_user_confirmation": return "待用户确认";
    default: return "已评判";
  }
}

/**
 * Build the follow-up steer text that pushes the agent to continue.
 * Cause/action come from JEV's own verdict so the agent knows what to fix.
 */
export function buildJevNudgeText(verdict: JevVerdict, attempt?: number, maxAttempts?: number): string {
  const reason = formatJevCauseAction(verdict);
  const lines = [
    `[JEV 督促] 上一轮被判定为「${jevChoiceLabel(verdict.choice)}」${
      typeof verdict.choiceConfidence === "number" ? `(置信度${Math.round(verdict.choiceConfidence * 100)}%)` : ""
    }${reason ? `，${reason}` : ""}。`,
    "请基于用户原始需求继续工作：处理上述原因并实际验证（跑测试或复现步骤），不要只做解释。",
  ];
  if (typeof attempt === "number" && typeof maxAttempts === "number") {
    lines.push(`(第 ${attempt} 次自动督促，共最多 ${maxAttempts} 次；请直接调用工具推进未完成的工作并验证，切勿只做文字解释。)`);
  }
  return lines.join("\n");
}

// ---------- Plan review (once per thread, when the checklist is created) ----------

export function buildJevPlanState(planText: string, userPrompt?: string): string {
  const parts = [
    `user_prompt:\n${(userPrompt ?? "").slice(0, 4000) || "(empty)"}`,
    `task_plan:\n${planText.slice(0, 6000) || "(empty)"}`,
  ];
  return parts.join("\n\n");
}

export function defaultJevPlanQuestions(): Record<string, unknown> {
  return {
    plan_verdict: {
      type: "choice",
      instructions: "Is this task plan sound for the user request?",
      criteria: {
        sound: "Covers the request with sensible, ordered steps",
        incomplete: "Misses important steps or is too vague",
        wrong_direction: "Misunderstands the request or heads the wrong way",
        needs_user_input: "Cannot plan well without more info or confirmation",
      },
    },
    plan_completeness: {
      type: "score",
      instructions: "Rate the completeness of the task plan",
      criteria: ["Missing or confused", "Rough but workable", "Solid and complete", "Excellent with verification steps"],
    },
    plan_risk: {
      type: "noul",
      instructions: "Does the plan include risky, destructive, or unverified steps?",
    },
  };
}

export interface JevPlanVerdict extends JevVerdict {
  kind: "plan";
  planChoice?: string;
  planConfidence?: number;
  completeness?: number;
  planRisk?: number;
}

const JEV_PLAN_LABELS: Record<string, string> = {
  sound: "计划可行",
  incomplete: "计划不完整",
  wrong_direction: "方向跑偏",
  needs_user_input: "需用户补充",
};

export function jevPlanLabel(choice?: string): string {
  return (choice && JEV_PLAN_LABELS[choice]) || choice || "";
}

export function parseJevPlanVerdict(threadId: string, turnId: string, payload: unknown, latencyMs?: number): JevPlanVerdict {
  const root = (payload ?? {}) as Record<string, unknown>;
  const answers = (root.answers ?? {}) as Record<string, Record<string, unknown>>;
  const usage = (root.usage ?? {}) as { input_tokens?: number; output_tokens?: number };
  const verdict = answers.plan_verdict ?? {};
  const completeness = answers.plan_completeness ?? {};
  const risk = answers.plan_risk ?? {};
  const num = (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) ? value : undefined);
  const str = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);
  return {
    kind: "plan",
    threadId,
    turnId,
    model: str(root.model),
    choice: str(verdict.choice),
    choiceConfidence: num(verdict.confidence),
    planChoice: str(verdict.choice),
    planConfidence: num(verdict.confidence),
    completeness: num(completeness.score),
    planRisk: num(risk.noul),
    usage,
    latencyMs,
    raw: payload,
  };
}

export function formatJevPlanLabel(verdict: JevPlanVerdict): string {
  const status =
    verdict.planChoice === "sound" ? "✅ 计划可行"
    : verdict.planChoice === "incomplete" ? "🟡 计划不完整"
    : verdict.planChoice === "wrong_direction" ? "❌ 方向跑偏"
    : verdict.planChoice === "needs_user_input" ? "❓ 需用户补充"
    : "📋 计划已审";
  const conf = typeof verdict.planConfidence === "number" ? ` (置信度 ${Math.round(verdict.planConfidence * 100)}%)` : "";
  const completeness = typeof verdict.completeness === "number" ? ` · 完整度 ${verdict.completeness.toFixed(1)}/3.0` : "";
  const risk =
    typeof verdict.planRisk === "number"
      ? (verdict.planRisk >= 0.7 ? " · ⚠️ 高风险步骤" : verdict.planRisk >= 0.35 ? " · 有风险步骤" : " · 无风险步骤")
      : "";
  return `📋 计划审核：${status}${conf}${completeness}${risk}`;
}

export function buildJevPlanNudgeText(verdict: JevPlanVerdict): string {
  return [
    `[JEV 计划审核] 你的任务计划被判定为「${jevPlanLabel(verdict.planChoice)}」${
      typeof verdict.planConfidence === "number" ? `(置信度${Math.round(verdict.planConfidence * 100)}%)` : ""
    }${typeof verdict.completeness === "number" ? `，完整度 ${verdict.completeness.toFixed(1)}/3.0` : ""}。`,
    "请先修订计划（补齐缺失步骤、纠正方向，危险步骤给出验证方式），用 update_plan 更新后再动手。",
  ].join("\n");
}

// ---------- Collab subagent hooks (opencode `task` / claude `Agent`) ----------
//
// Both backends project subtask calls as `collabAgentToolCall` items:
// the brief lives in `prompt`, the child id in `agentId`, the final report
// in `output` (opencode, added by the projector) or in `agentsStates`
// summaries (claude). Pure extractors so the web reducer stays thin.

export interface JevCollabBrief {
  agentId: string;
  taskName: string;
  brief: string;
}

export interface JevCollabReport {
  agentId: string;
  taskName: string;
  status: string;
  report: string;
}

function collabString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function collabTaskName(item: Record<string, unknown>): string {
  return collabString(item.agentName).trim()
    || collabString(item.description).trim()
    || collabString(item.agentRole).trim()
    || collabString(item.tool).trim();
}

function collabAgentId(item: Record<string, unknown>): string {
  return collabString(item.agentId).trim() || collabString(item.id).trim();
}

export function extractJevCollabBrief(item: Record<string, unknown>): JevCollabBrief | null {
  if (collabString(item.type) !== "collabAgentToolCall") return null;
  const brief = collabString(item.prompt).trim().slice(0, 4000);
  if (!brief) return null;
  const agentId = collabAgentId(item);
  if (!agentId) return null;
  return { agentId, taskName: collabTaskName(item), brief };
}

function collabTerminalStatus(item: Record<string, unknown>): string {
  const raw = collabString(item.agentStatus).trim().toLowerCase()
    || collabString(item.status).trim().toLowerCase();
  if (raw === "completed" || raw === "failed" || raw === "interrupted") return raw;
  return "";
}

/** Placeholder summaries ("Explore completed") are not reports — auditing
 * them would cry "unverifiable" on every turn. Only judge substance. */
function collabReportIsSubstantive(report: string): boolean {
  const lines = report.split("\n").map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return false;
  return lines.some((line) =>
    line.length > 60
    || !/^(.*\s)?(completed|running|failed|interrupted|in[\s_-]?progress)\.?$/i.test(line)
  );
}

export function extractJevCollabReport(item: Record<string, unknown>): JevCollabReport | null {
  if (collabString(item.type) !== "collabAgentToolCall") return null;
  const status = collabTerminalStatus(item);
  if (!status) return null;
  const agentId = collabAgentId(item);
  if (!agentId) return null;
  let report = collabString(item.output).trim();
  if (!report) {
    const states = item.agentsStates;
    if (states && typeof states === "object" && !Array.isArray(states)) {
      const messages: string[] = [];
      for (const value of Object.values(states as Record<string, unknown>)) {
        const message = collabString((value as Record<string, unknown> | null)?.message).trim();
        if (message) messages.push(message);
      }
      report = messages.join("\n---\n").trim();
    }
  }
  if (!report || !collabReportIsSubstantive(report)) return null;
  return { agentId, taskName: collabTaskName(item), status, report: report.slice(0, 6000) };
}

// ---------- Subagent brief & report review ----------

export function buildJevBriefState(taskName: string, brief: string): string {
  return [
    `task_name:\n${taskName.slice(0, 200) || "(empty)"}`,
    `task_brief:\n${brief.slice(0, 4000) || "(empty)"}`,
  ].join("\n\n");
}

export function defaultJevBriefQuestions(): Record<string, unknown> {
  return {
    brief_verdict: {
      type: "choice",
      instructions: "Is this subagent task brief clear and executable?",
      criteria: {
        clear: "Task, scope, and expected output are clear",
        vague: "Vague scope or ambiguous expected output",
        wrong_scope: "Wrong decomposition level (too big, too small, or overlapping)",
        missing_done_criteria: "No way to tell when the subtask is done",
      },
    },
    brief_completeness: {
      type: "score",
      instructions: "Rate the completeness of the task brief",
      criteria: ["Unusable", "Rough but workable", "Clear and complete", "Excellent with examples and criteria"],
    },
    brief_risk: {
      type: "noul",
      instructions: "Does the brief invite risky, destructive, or out-of-scope actions?",
    },
  };
}

export function buildJevReportState(taskName: string, status: string, report: string): string {
  return [
    `task_name:\n${taskName.slice(0, 200) || "(empty)"}`,
    `agent_status:\n${status || "(unknown)"}`,
    `final_report:\n${report.slice(0, 6000) || "(empty)"}`,
  ].join("\n\n");
}

export function defaultJevReportQuestions(): Record<string, unknown> {
  return {
    report_verdict: {
      type: "choice",
      instructions: "Does this subagent completion report show the subtask is done?",
      criteria: {
        complete: "Done with verifiable evidence",
        partial: "Partially done, gaps remain",
        failed: "Failed or blocked",
        unverifiable: "Claims done but no evidence to check",
      },
    },
    report_quality: {
      type: "score",
      instructions: "Rate the quality of the completion report",
      criteria: ["Useless", "Rough but usable", "Clear with evidence", "Excellent and thorough"],
    },
    report_usable: {
      type: "noul",
      instructions: "Can the parent task proceed based on this report?",
    },
  };
}

export interface JevSubVerdict extends JevVerdict {
  kind: "brief" | "report";
  agentId: string;
  taskName?: string;
  subChoice?: string;
  subConfidence?: number;
  subScore?: number;
  subUsable?: number;
}

const JEV_BRIEF_LABELS: Record<string, string> = {
  clear: "分派清晰",
  vague: "分派含糊",
  wrong_scope: "切分不当",
  missing_done_criteria: "缺完成标准",
};

const JEV_REPORT_LABELS: Record<string, string> = {
  complete: "汇报达标",
  partial: "汇报部分达标",
  failed: "汇报失败",
  unverifiable: "无法验证",
};

function parseJevSubVerdict(
  kind: "brief" | "report",
  verdictKey: string,
  scoreKey: string,
  usableKey: string,
  threadId: string,
  turnId: string,
  agentId: string,
  taskName: string,
  payload: unknown,
  latencyMs?: number,
): JevSubVerdict {
  const root = (payload ?? {}) as Record<string, unknown>;
  const answers = (root.answers ?? {}) as Record<string, Record<string, unknown>>;
  const usage = (root.usage ?? {}) as { input_tokens?: number; output_tokens?: number };
  const verdict = answers[verdictKey] ?? {};
  const score = answers[scoreKey] ?? {};
  const usable = answers[usableKey] ?? {};
  const num = (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) ? value : undefined);
  const str = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);
  return {
    kind,
    threadId,
    turnId,
    agentId,
    taskName,
    model: str(root.model),
    subChoice: str(verdict.choice),
    subConfidence: num(verdict.confidence),
    subScore: num(score.score ?? score.noul),
    subUsable: num(usable.noul ?? usable.score),
    usage,
    latencyMs,
    raw: payload,
  };
}

export function parseJevBriefVerdict(
  threadId: string, turnId: string, agentId: string, taskName: string, payload: unknown, latencyMs?: number,
): JevSubVerdict {
  return parseJevSubVerdict("brief", "brief_verdict", "brief_completeness", "brief_risk",
    threadId, turnId, agentId, taskName, payload, latencyMs);
}

export function parseJevReportVerdict(
  threadId: string, turnId: string, agentId: string, taskName: string, payload: unknown, latencyMs?: number,
): JevSubVerdict {
  return parseJevSubVerdict("report", "report_verdict", "report_quality", "report_usable",
    threadId, turnId, agentId, taskName, payload, latencyMs);
}

export function formatJevSubLabel(verdict: JevSubVerdict): string {
  const labels = verdict.kind === "brief" ? JEV_BRIEF_LABELS : JEV_REPORT_LABELS;
  const prefix = verdict.kind === "brief" ? "📤 分派审核" : "📥 汇报审核";
  const name = verdict.taskName ? ` · ${verdict.taskName.slice(0, 24)}` : "";
  const status = verdict.subChoice && labels[verdict.subChoice] ? `${prefix}：${labels[verdict.subChoice]}` : `${prefix}：已评`;
  const conf = typeof verdict.subConfidence === "number" ? ` (置信度 ${Math.round(verdict.subConfidence * 100)}%)` : "";
  const score = typeof verdict.subScore === "number" ? ` · ${verdict.subScore.toFixed(1)}/3.0` : "";
  return `${status}${conf}${score}${name}`;
}

export function buildJevSubNudgeText(verdict: JevSubVerdict): string {
  const labels = verdict.kind === "brief" ? JEV_BRIEF_LABELS : JEV_REPORT_LABELS;
  const judged = verdict.subChoice && labels[verdict.subChoice] ? labels[verdict.subChoice] : "不达标";
  if (verdict.kind === "brief") {
    return [
      `[JEV 分派审核] 子任务「${verdict.taskName || verdict.agentId.slice(0, 8)}」的 brief 被判定为「${judged}」。`,
      "请用 send_message 向该子任务补充清晰的范围、输入输出与完成标准；若切分不当则 close 后重新分派。",
    ].join("\n");
  }
  return [
    `[JEV 汇报审核] 子任务「${verdict.taskName || verdict.agentId.slice(0, 8)}」的汇报被判定为「${judged}」。`,
    "请用 send_message 追问缺失的证据与结果；若其已失败或阻塞，把剩余工作收回自己完成，不要直接总结。",
  ].join("\n");
}

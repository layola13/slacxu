/**
 * /goal continuation contract shared by the mini and codeCli bridges: the
 * completion signal, the per-continuation prompt and the budget wrap-up note.
 * Keeping them in one place stops the two runtimes from drifting apart (the
 * codeCli prompt was still the bare two-line nudge without a progress,
 * evidence or completion-audit contract).
 */

/** Marker the web client uses to hide internal continuation prompts. */
export const GOAL_CONTINUATION_MARKER = "[[codex-ultra:goal-continuation]]";

/**
 * The prompt asks for `GOAL_COMPLETE` on its own line. A plain substring
 * check also fired on sentences that merely mention the marker ("not
 * replying GOAL_COMPLETE yet"), ending unfinished goals. Only a line made of
 * the marker (optionally wrapped in markdown emphasis, code ticks, a bullet
 * or trailing punctuation) or a clear natural-language completion statement counts.
 */
const GOAL_COMPLETE_LINE_RE = /^[\s>*_`#-]*GOAL_COMPLETE[\s*_`.!]*$/im;

/**
 * Natural language completion patterns (Chinese & English).
 * Checked line-by-line so that models replying naturally without the exact
 * uppercase token still settle their goals instead of auto-continuing into a loop.
 */
const NATURAL_COMPLETE_LINE_RES: RegExp[] = [
  // Chinese: 目标已完成 / 任务已完成 / 目标已达成 / 已全部完成 / 已经完成所有任务 / 所有任务已完成
  /^[\s>*_`#-]*(?:(?:已经?|全部|所有)?(?:完成|达成)(?:所有|全部)?(?:目标|任务|工作|要求|需求)|(?:所有|全部|各项)?(?:目标|任务|工作|要求|需求)(?:已全部?完成|全部完成|已达成|已经完成|全部达成|已完成)|已全部完成)[\s*_`.!。！]*$/im,
  // English: goal completed / goal achieved / all tasks completed / all tasks done / all done / task completed
  /^[\s>*_`#-]*(?:(?:goal|objective)\s+(?:is\s+|has\s+been\s+)?(?:fully\s+)?(?:completed|achieved|fulfilled)|(?:all\s+)?(?:tasks?|work|requirements?)\s+(?:are|is|have\s+been|has\s+been)?\s*(?:fully\s+)?(?:completed|finished|done)|all\s+done)[\s*_`.!]*$/im,
];

/** Negation patterns on a line that disqualify completion (e.g. "尚未完成", "not completed yet"). */
const COMPLETION_NEGATION_RE = /(?:未|没有|尚未|未能|无法|暂不|还没|不(?:会|打算)?|not\s+|haven't\s+|hasn't\s+|cannot\s+|can't\s+|yet\s+to\s+)(?:完成|达成|实现|reply|claim|complete|achieve|finish|done)/i;

export function hasGoalCompleteSignal(text: string): boolean {
  const str = String(text ?? "");
  if (!str.trim()) return false;
  const lines = str.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (COMPLETION_NEGATION_RE.test(trimmed)) continue;
    if (GOAL_COMPLETE_LINE_RE.test(trimmed)) return true;
    for (const re of NATURAL_COMPLETE_LINE_RES) {
      if (re.test(trimmed)) return true;
    }
  }
  return false;
}

export const CONTINUATION_NUDGE_RE =
  /^\s*(?:继续|你继续|请继续|继续吧|接着做|接着|接着来|接着干|接着改|继续改|往下走|往下继续|继续执行|继续做|下一步|做吧|动手吧|开始吧|按计划|照计划|按这个思路来|你?调用啊?|continue|go\s*on|go\s*ahead|do\s*it|proceed|keep\s*going|next\s*step)\s*[.!。！]?$/i;

export function isMiniContinuationNudge(text: string): boolean {
  return CONTINUATION_NUDGE_RE.test(String(text ?? "").trim());
}

/** Injected once into a running goal turn when its token budget runs out (Codex budget_limit.md). */
export const GOAL_BUDGET_LIMIT_NOTE =
  "The /goal token budget is exhausted and the goal is now budget-limited: do NOT start new substantive work or emit more function calls. Wrap up this turn now: summarize verified progress, list remaining work or blockers, and give the user a clear next step - text only, with no additional tool calls.";

export type GoalContinuationState = {
  goalObjective?: string | null;
  goalTokensUsed?: number;
  goalTokenBudget?: number | null;
  goalStartedAt?: number;
};

export type GoalContinuationOptions = {
  count: number;
  max: number;
  /** Current plan/checklist, when the runtime can see it. */
  planText?: string;
  /** Consecutive no-progress continuations so far. */
  stagnantTurns?: number;
  /** No-progress turns that park the goal as blocked. */
  stagnantLimit?: number;
  /** Plan tool of this runtime (mini: update_plan, Claude CLI: TodoWrite). */
  planToolName?: string;
};

export function buildGoalContinuationPrompt(s: GoalContinuationState, opts: GoalContinuationOptions): string {
  const objective = (s.goalObjective ?? "").trim();
  const used = typeof s.goalTokensUsed === "number" ? s.goalTokensUsed : 0;
  const budget = typeof s.goalTokenBudget === "number" ? s.goalTokenBudget : null;
  const remaining = budget !== null ? Math.max(0, budget - used) : null;
  const elapsed = typeof s.goalStartedAt === "number"
    ? Math.max(0, Math.floor((Date.now() - s.goalStartedAt) / 1000))
    : 0;
  const stagnant = typeof opts.stagnantTurns === "number" ? Math.max(0, opts.stagnantTurns) : 0;
  const planTool = opts.planToolName ?? "update_plan";
  const lines = [
    GOAL_CONTINUATION_MARKER,
    `Continue working toward this persisted /goal objective (auto-continuation ${opts.count}/${opts.max}):`,
    "",
    objective,
    "",
    `Goal progress: attempt ${opts.count} of ${opts.max}; tokens used ${used}${budget !== null ? ` / budget ${budget} (remaining ${remaining})` : " (no token budget configured)"}; elapsed ${elapsed}s.${stagnant > 0 ? ` WARNING: the last ${stagnant} continuation(s) produced no new tool/plan/output change.` : ""}`,
  ];
  if (typeof opts.stagnantLimit === "number" && stagnant > 0 && stagnant >= opts.stagnantLimit - 1) {
    lines.push("Final notice: one more no-progress turn marks this goal blocked. Do NOT repeat the same reads, commands or plan. Take a different concrete action on the next unfinished requirement, or state the genuine blocker plainly.");
  }
  if (budget !== null && remaining !== null && remaining < budget * 0.25) {
    lines.push(`Budget warning: only ${remaining} tokens remain. Finish the smallest verifiable remainder now; do not start new multi-step exploration.`);
  }
  if (opts.planText?.trim()) {
    lines.push("", "Current authoritative plan (already decided — do NOT regenerate an identical list):", opts.planText.trim().slice(0, 2000));
  }
  lines.push(
    "",
    `Rules: report only verified tool results — never claim progress from memory; do NOT treat a ${planTool} call as doing the work; do not repeat completed steps; if the same blocker repeats with no file/tool change, say so instead of re-listing tasks.`,
    "Work from evidence: the current worktree and tool output are authoritative. Earlier history may be summarized or incomplete — use it to locate work, then inspect current state before relying on it or redoing it.",
    "No-progress check: classify the previous goal turn as progress (changed files/state or produced evidence that changes the next action) or no progress (status restatement, re-listed plan, repeated reads). After a no-progress turn, take a different concrete next action.",
    "Completion audit: GOAL_COMPLETE is a claim that EVERY requirement of the objective above is finished and verified by tool output in this conversation. If any requirement is missing, incomplete, or unverified — keep working instead of completing. Do not complete merely because the budget is nearly exhausted.",
    "Blocked audit: report blocked ONLY when the same blocking condition repeats with no tool/file change; otherwise keep making progress. Never re-list the plan as a substitute for doing the work.",
    "When the objective is fully achieved and every requirement is verified by tool output in this conversation, reply with exactly GOAL_COMPLETE on its own line and stop. Otherwise keep making concrete tool progress.",
  );
  return lines.join("\n");
}

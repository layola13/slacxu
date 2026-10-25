import type { GoalBannerState, GoalStatus } from "../../components/ChatPanel";

export function parseGoal(goal: Record<string, unknown>): GoalBannerState | null {
  const threadId = stringValue(goal.threadId);
  const objective = stringValue(goal.objective);
  if (!threadId || !objective) return null;
  return {
    threadId,
    objective,
    status: parseGoalStatus(goal.status),
    tokenBudget: numberValue(goal.tokenBudget) ?? null,
    tokensUsed: numberValue(goal.tokensUsed),
    timeUsedSeconds: numberValue(goal.timeUsedSeconds)
  };
}

export function parseGoalStatus(value: unknown): GoalStatus {
  switch (value) {
    case "active":
    case "paused":
    case "blocked":
    case "usageLimited":
    case "budgetLimited":
    case "complete":
      return value;
    default:
      return "active";
  }
}

export function buildLocalGoal(
  threadId: string,
  objective: string,
  status: GoalStatus,
  existing?: GoalBannerState,
): GoalBannerState {
  return {
    threadId,
    objective,
    status,
    tokenBudget: existing?.tokenBudget ?? null,
    tokensUsed: existing?.tokensUsed ?? 0,
    timeUsedSeconds: existing?.timeUsedSeconds ?? 0
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Parse `/goal [@budget] <objective>`: only an explicit `@`-prefixed leading
 * token (`@200k` / `@1.5M` / `@50000`) becomes tokenBudget. Anything else —
 * including objectives starting with a bare number like `5 files need
 * renaming` — stays verbatim as the objective. No `@` prefix means budget
 * undefined (fully backward compatible with pre-budget `/goal <text>`).
 */
export function parseGoalObjectiveWithBudget(raw: string): { objective: string; tokenBudget?: number | null } {
  const text = String(raw ?? "").trim();
  if (!text) return { objective: "" };
  const m = /^@(\d+(?:\.\d+)?\s*[kKmM]?)\s+(.+)$/.exec(text);
  if (!m) {
    // A `@`-leading token starting with a digit is a budget attempt, not an
    // @-mention: malformed ones (e.g. `@-5 x`, bare `@200k`) surface the
    // usage error instead of persisting the literal as the objective.
    if (/^@-?\d/.test(text)) return { objective: "" };
    return { objective: text };
  }
  const num = parseGoalBudgetToken(m[1]!.trim());
  // Out-of-range budget (`@0`, `@99999999` over the 10M cap): reject so the
  // caller shows usage instead of storing `"@…"` as a bogus objective.
  if (num === undefined) return { objective: "" };
  const objective = (m[2] ?? "").trim();
  if (!objective) return { objective: "" };
  return { objective, tokenBudget: num };
}

function parseGoalBudgetToken(token: string): number | undefined {
  const m = /^(\d+(?:\.\d+)?)\s*([kKmM]?)$/.exec(token.trim());
  if (!m) return undefined;
  const base = Number(m[1]);
  if (!Number.isFinite(base) || base <= 0) return undefined;
  const mult = m[2]?.toLowerCase() === "m" ? 1_000_000 : m[2]?.toLowerCase() === "k" ? 1_000 : 1;
  const out = Math.floor(base * mult);
  if (out <= 0 || out > 10_000_000) return undefined;
  return out;
}

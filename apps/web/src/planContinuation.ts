export const PLAN_CONTINUATION_MARKER = "[[codex-ultra:plan-continuation]]";

export const PLAN_CONTINUATION_PROMPT = `${PLAN_CONTINUATION_MARKER}
Continue developing the active plan autonomously. Inspect any remaining context, resolve non-blocking uncertainty with explicit reasonable assumptions, and produce a complete actionable plan without implementing it. Do not merely give a progress update or ask another question in prose. If user input is genuinely required because different answers would materially change the plan, use the user-input request tool and group all blocking questions together. Once the plan is complete, emit the final plan and stop.`;

export function isPlanContinuationPrompt(value: string): boolean {
  return value.trimStart().startsWith(PLAN_CONTINUATION_MARKER);
}

export function shouldAutomaticallyContinuePlan(input: {
  planModeEnabled: boolean;
  connected: boolean;
  activeThreadId: string | null;
  threadId: string;
  hasRunningTurn: boolean;
  hasPendingRequest: boolean;
  hasCompletedPlan: boolean;
}): boolean {
  return input.planModeEnabled
    && input.connected
    && input.activeThreadId === input.threadId
    && !input.hasRunningTurn
    && !input.hasPendingRequest
    && !input.hasCompletedPlan;
}

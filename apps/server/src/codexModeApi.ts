import type { JsonValue } from "@codex-ui/shared";

export const GOAL_CONTINUATION_MARKER = "[[codex-ultra:goal-continuation]]";

export function planTurnParams(input: Record<string, unknown>): Record<string, JsonValue> {
  const threadId = requiredText(input.threadId, "threadId");
  const prompt = requiredText(input.prompt, "prompt");
  const model = requiredText(input.model, "model");
  const params: Record<string, JsonValue> = {
    threadId,
    input: [{ type: "text", text: prompt, text_elements: [] }],
    sandboxPolicy: { type: "dangerFullAccess" },
    approvalPolicy: "never",
    effort: optionalText(input.effort) ?? "medium",
    model,
    collaborationMode: {
      mode: "plan",
      settings: {
        model,
        reasoning_effort: "medium",
        developer_instructions: "Develop the plan autonomously and inspect available context before asking questions. Resolve non-blocking uncertainty with explicit reasonable assumptions. If user input is genuinely required because the answer would materially change the plan, use the user-input request tool and group all blocking questions together. Do not implement changes while in Plan mode."
      }
    }
  };
  const cwd = optionalText(input.cwd);
  if (cwd) params.cwd = cwd;
  return params;
}

export function goalContinuationTurnParams(input: Record<string, unknown>, objective: string): Record<string, JsonValue> {
  const threadId = requiredText(input.threadId, "threadId");
  const model = requiredText(input.model, "model");
  const effort = optionalText(input.effort) ?? "medium";
  const params: Record<string, JsonValue> = {
    threadId,
    input: [{
      type: "text",
      text: `${GOAL_CONTINUATION_MARKER}\nContinue working toward this persisted /goal objective:\n\n${objective.trim()}`,
      text_elements: []
    }],
    sandboxPolicy: { type: "dangerFullAccess" },
    approvalPolicy: "never",
    effort,
    model,
    collaborationMode: {
      mode: "default",
      settings: { model, reasoning_effort: effort, developer_instructions: null }
    }
  };
  const cwd = optionalText(input.cwd);
  if (cwd) params.cwd = cwd;
  return params;
}

export function planAnswers(input: Record<string, unknown>): JsonValue {
  const answers = record(input.answers);
  const normalized: Record<string, JsonValue> = {};
  for (const [questionId, rawAnswer] of Object.entries(answers)) {
    const answer = record(rawAnswer);
    const values = Array.isArray(answer.answers)
      ? answer.answers.filter((value): value is string => typeof value === "string" && value.length > 0)
      : [];
    normalized[questionId] = { answers: values };
  }
  return { answers: normalized };
}

export function runningTurnIds(result: unknown): string[] {
  const root = record(result);
  const turns = Array.isArray(root.turns) ? root.turns : Array.isArray(root.data) ? root.data : [];
  return turns.flatMap((entry) => {
    const turn = record(entry);
    const id = optionalText(turn.id);
    const status = optionalText(turn.status)?.toLowerCase();
    return id && (status === "inprogress" || status === "running") ? [id] : [];
  });
}

export function goalFromResult(result: unknown): Record<string, unknown> | null {
  const goal = record(record(result).goal);
  return optionalText(goal.objective) ? goal : null;
}

function requiredText(value: unknown, name: string): string {
  const text = optionalText(value);
  if (!text) throw new Error(`${name} is required`);
  return text;
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function record(value: unknown): Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

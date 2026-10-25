import type { ThreadItem } from "./types.ts";

export type PlanStatus = "pending" | "in_progress" | "completed";
export type PlanStep = { step: string; status: PlanStatus };

/** Max steps per plan update (keeps the checklist visible, not a novel). */
export const MINI_PLAN_MAX_STEPS = 20;
/** Max chars per step title. */
export const MINI_PLAN_MAX_STEP_CHARS = 200;

export function normalizePlanStatus(v: unknown): PlanStatus {
  const t = String(v ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (t === "in_progress" || t === "inprogress" || t === "doing" || t === "active") return "in_progress";
  if (t === "completed" || t === "complete" || t === "done") return "completed";
  return "pending";
}

function titleOf(entry: unknown): string {
  if (!entry || typeof entry !== "object") return "";
  const rec = entry as Record<string, unknown>;
  for (const key of ["step", "content", "text", "title"]) {
    if (typeof rec[key] === "string" && (rec[key] as string).trim()) {
      return (rec[key] as string).trim().slice(0, MINI_PLAN_MAX_STEP_CHARS);
    }
  }
  return "";
}

/**
 * Accept the server-compatible shapes: {todos:[{content,status}]} or
 * {steps:[{step,status}]} (each entry also accepts step/content/text).
 * Null when no usable checklist was passed.
 */
export function extractPlanSteps(args: Record<string, any>): PlanStep[] | null {
  const raw = Array.isArray(args.todos) ? args.todos : Array.isArray(args.steps) ? args.steps : null;
  if (!raw) return null;
  const steps: PlanStep[] = [];
  for (const entry of raw.slice(0, MINI_PLAN_MAX_STEPS)) {
    const step = titleOf(entry);
    if (!step) continue;
    const status = normalizePlanStatus((entry as Record<string, unknown>).status);
    steps.push({ step, status });
  }
  return steps.length ? steps : null;
}

/**
 * Keep the plan contract small and deterministic. Exactly one step may be
 * in_progress at a time (mirrors the server-side mini validator).
 */
export function validatePlanSteps(steps: PlanStep[]): string | null {
  if (!steps.length) return "plan update rejected: no usable steps (each needs a step/content/text title)";
  const active = steps.filter((s) => s.status === "in_progress").length;
  if (active > 1) return "plan update rejected: only one step may be in_progress at a time";
  return null;
}

export function formatPlanText(steps: PlanStep[]): string {
  const done = steps.filter((s) => s.status === "completed").length;
  const lines = steps.map((s) => {
    const box = s.status === "completed" ? "[x]" : s.status === "in_progress" ? "[>] " : "[ ]";
    return `- ${box} ${s.step}`;
  });
  return `task plan (${done}/${steps.length} done):\n${lines.join("\n")}`;
}

/**
 * Apply an update_plan call to the thread: replace the live plan item (or
 * append one) and return the model-visible confirmation text. Pure except for
 * the in-place thread update, so it is trivially unit-testable.
 */
export function applyPlanUpdate(thread: ThreadItem[], args: Record<string, any>): string {
  const steps = extractPlanSteps(args);
  if (!steps) return "update_plan needs {todos:[{content,status}]} or {steps:[{step,status}]} with status pending|in_progress|completed.";
  const err = validatePlanSteps(steps);
  if (err) return err;
  const text = formatPlanText(steps);
  const item: ThreadItem = { type: "plan", plan: steps, text };
  const idx = thread.findIndex((t) => t.type === "plan");
  if (idx >= 0) thread[idx] = item;
  else thread.push(item);
  return text;
}

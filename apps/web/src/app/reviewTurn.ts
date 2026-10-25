import type { WorkbenchTurn } from "../state/codexClient";

export function isReviewModeActive(turn: WorkbenchTurn | null | undefined): boolean {
  if (!turn) return false;
  let active = false;
  for (const item of turn.items) {
    if (item.type === "enteredReviewMode") active = true;
    if (item.type === "exitedReviewMode") active = false;
  }
  return active;
}

export function isCannotSteerReviewTurnError(error: unknown): boolean {
  return /cannot steer (?:a )?review turn/i.test(errorText(error));
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) return String((error as { message?: unknown }).message ?? "");
  return "";
}

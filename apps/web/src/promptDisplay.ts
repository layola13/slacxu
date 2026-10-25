import { isGoalContinuationPrompt } from "./goalContinuation";
import { isPlanContinuationPrompt } from "./planContinuation";

const WEBDEV_USER_REQUEST_MARKER = "User request:";

export function displayPromptText(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  if (isGoalContinuationPrompt(trimmed)) {
    return "Continuing /goal";
  }
  if (isPlanContinuationPrompt(trimmed)) {
    return "Continuing /plan";
  }
  const markerIndex = trimmed.lastIndexOf(WEBDEV_USER_REQUEST_MARKER);
  if (markerIndex < 0 || !looksLikeInjectedWebDevPrompt(trimmed.slice(0, markerIndex))) {
    return trimmed;
  }
  const request = trimmed.slice(markerIndex + WEBDEV_USER_REQUEST_MARKER.length).trim();
  return request || trimmed;
}

function looksLikeInjectedWebDevPrompt(prefix: string): boolean {
  return (
    prefix.includes("Create the requested web app") ||
    prefix.includes("Use Bun for package management") ||
    prefix.includes("Only start the dev server after the files are ready") ||
    prefix.includes("First analyze the user's requirements")
  );
}

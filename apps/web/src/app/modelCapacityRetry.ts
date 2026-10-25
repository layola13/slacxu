export const MODEL_CAPACITY_RETRY_DELAY_MS = 5_000;
export const MODEL_CAPACITY_RETRY_SUCCESS_RETENTION_MS = 30_000;

export type ModelCapacityRetryState = {
  attempt: number;
  max: number;
  exhausted: boolean;
};

export type ModelCapacityRetryDecision =
  | { action: "disabled"; state: ModelCapacityRetryState }
  | { action: "ignored"; state: ModelCapacityRetryState }
  | { action: "schedule"; attempt: number; state: ModelCapacityRetryState }
  | { action: "exhausted"; state: ModelCapacityRetryState };

const CAPACITY_RETRY_ERROR_PATTERNS = [
  /selected model is at capacity/i,
  /model provider is rate-?limiting requests/i,
  /rate-?limiting requests/i
];

export function isModelCapacityRetryError(message: string): boolean {
  return CAPACITY_RETRY_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

export function decideModelCapacityRetry(input: {
  enabled: boolean;
  message: string;
  codexWillRetry: boolean;
  state: ModelCapacityRetryState;
}): ModelCapacityRetryDecision {
  if (!input.enabled) return { action: "disabled", state: input.state };
  if (input.codexWillRetry || !isModelCapacityRetryError(input.message)) {
    return { action: "ignored", state: input.state };
  }
  if (input.state.exhausted || input.state.attempt >= input.state.max) {
    return { action: "exhausted", state: { ...input.state, exhausted: true } };
  }
  const attempt = input.state.attempt + 1;
  return {
    action: "schedule",
    attempt,
    state: { ...input.state, attempt, exhausted: attempt >= input.state.max }
  };
}

export function shouldClearModelCapacityRetryEntry(input: {
  assistantOutputEvent: boolean;
  messageMethod: string;
  errorText: string;
}): boolean {
  if (input.assistantOutputEvent) {
    return true;
  }
  if (input.messageMethod !== "turn/completed") {
    return false;
  }
  return input.errorText.length === 0;
}

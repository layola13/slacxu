export const CODEX_STREAM_RETRY_MIN = 5;
export const CODEX_STREAM_RETRY_MAX = 100;
export const CODEX_STREAM_RETRY_DEFAULT = 5;

export function clampRetryCount(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed)
    ? Math.min(CODEX_STREAM_RETRY_MAX, Math.max(CODEX_STREAM_RETRY_MIN, Math.round(parsed)))
    : CODEX_STREAM_RETRY_DEFAULT;
}

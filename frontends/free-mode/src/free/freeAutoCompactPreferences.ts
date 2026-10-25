export const FREE_AUTOCOMPACT_DEFAULT_THRESHOLD = 80;
export const FREE_AUTOCOMPACT_MIN_THRESHOLD = 50;
export const FREE_AUTOCOMPACT_MAX_THRESHOLD = 95;

/** Cooldown between successive auto-compactions on the same thread, in ms. */
export const FREE_AUTOCOMPACT_COOLDOWN_MS = 60_000;

export function clampFreeAutoCompactThreshold(threshold: number): number {
  return Math.min(
    FREE_AUTOCOMPACT_MAX_THRESHOLD,
    Math.max(FREE_AUTOCOMPACT_MIN_THRESHOLD, Math.round(threshold))
  );
}

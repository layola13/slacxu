/** Stream "storm" stall thresholds (R2: owned by the SDK).
 *
 * Shared tuning constants: the host stream-retry monitor and the
 * OpenCode turn projector must agree on when a retry storm counts
 * as stalled, so the values live in the SDK, not in either consumer.
 */
export const STORM_STALLED_AFTER_ATTEMPTS = 3;
export const STORM_STALLED_AFTER_MS = 90_000;

export type ChatTypographyPreference = { fontSize: number; lineHeight: number; messageSpacing: number; goalMaxLines: number; runningHighlightColor: string };

export const DEFAULT_CHAT_TYPOGRAPHY: ChatTypographyPreference = { fontSize: 13, lineHeight: 1.52, messageSpacing: 6, goalMaxLines: 3, runningHighlightColor: "#3b82f6" };

export function parseChatTypographyPreference(value: unknown): ChatTypographyPreference | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const fontSize = Number(input.fontSize);
  const lineHeight = Number(input.lineHeight);
  const messageSpacing = input.messageSpacing == null ? DEFAULT_CHAT_TYPOGRAPHY.messageSpacing : Number(input.messageSpacing);
  const goalMaxLines = input.goalMaxLines == null ? DEFAULT_CHAT_TYPOGRAPHY.goalMaxLines : Number(input.goalMaxLines);
  const runningHighlightColor = typeof input.runningHighlightColor === "string" && /^#[0-9a-f]{6}$/i.test(input.runningHighlightColor)
    ? input.runningHighlightColor
    : DEFAULT_CHAT_TYPOGRAPHY.runningHighlightColor;
  if (!Number.isFinite(fontSize) || !Number.isFinite(lineHeight) || !Number.isFinite(messageSpacing) || !Number.isFinite(goalMaxLines)) return null;
  return {
    fontSize: Math.min(18, Math.max(11, fontSize)),
    lineHeight: Math.min(2, Math.max(1.25, lineHeight)),
    messageSpacing: Math.min(24, Math.max(0, messageSpacing)),
    goalMaxLines: Math.round(Math.min(12, Math.max(1, goalMaxLines))),
    runningHighlightColor
  };
}

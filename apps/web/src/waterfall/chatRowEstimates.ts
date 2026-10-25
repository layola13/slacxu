import type { ChatWaterfallRow } from "./types";
import type { ChatTypographyPreference } from "../chatTypography";

export function estimateChatRowSize(row: ChatWaterfallRow, expanded = false, typography?: ChatTypographyPreference): number {
  const textLength = row.text.length;
  const foldedReasoningHeight = row.reasoning ? 26 : 0;
  const fontSize = typography?.fontSize ?? 13;
  const lineHeight = typography?.lineHeight ?? 1.52;
  const messageSpacing = typography?.messageSpacing ?? 6;
  const textScale = (fontSize * lineHeight) / (13 * 1.52);
  switch (row.kind) {
    case "userMessage":
      return clamp(54 + (textLength / 18) * textScale, 58, 150) + messageSpacing;
    case "assistantMessage":
      return clamp(62 + foldedReasoningHeight + (textLength / 8) * textScale + (row.text.includes("```") ? 140 : 0), 68, 410) + messageSpacing;
    case "reasoningPreview":
      return 48 + messageSpacing;
    case "commandExecution":
      return (expanded ? clamp(112 + Math.min(textLength, 1800) / 16, 128, 420) : 52) + messageSpacing;
    case "commandGroup":
      return (expanded ? clamp(44 + (row.groupedRows?.length ?? 1) * 58, 110, 520) : 42) + messageSpacing;
    case "fileChange":
      return (expanded ? clamp(220 + textLength / 10, 260, 620) : 52) + messageSpacing;
    case "fileChangeGroup":
      return (expanded
        ? clamp(44 + (row.groupedRows?.length ?? 1) * 58, 110, 520)
        : 42) + messageSpacing;
    case "toolCall":
      return (expanded ? clamp(130 + textLength / 12, 160, 420) : 52) + messageSpacing;
    case "toolActivityGroup":
      return (expanded ? clamp(36 + (row.groupedRows?.length ?? 1) * 54, 96, 640) : 38) + messageSpacing;
    case "contextCompaction":
      return 108 + messageSpacing;
    default:
      return 72 + messageSpacing;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

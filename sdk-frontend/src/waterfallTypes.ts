/** Waterfall row contract types (R2: owned by the SDK). */
import type { WorkbenchItem } from "./workbenchTypes.js";

export type ChatTokenUsage = {
  totalTokens: number;
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens?: number;
  estimatedCostUsd?: number;
  totalEstimatedCostUsd?: number;
  billingSnapshot?: {
    inputUsdPerMillion: number;
    cachedInputUsdPerMillion: number;
    cacheWriteUsdPerMillion: number;
    outputUsdPerMillion: number;
    modelMultiplier: number;
    inputMultiplier: number;
    cacheReadMultiplier: number;
    cacheWriteMultiplier: number;
    outputMultiplier: number;
    groupRatio: number;
  };
  costBreakdownUsd?: {
    input: number;
    cachedInput: number;
    cacheWrite: number;
    output: number;
  };
};

export type ChatRowKind =
  | "userMessage"
  | "assistantMessage"
  | "plan"
  | "reasoningPreview"
  | "toolCall"
  | "toolActivityGroup"
  | "retryErrorGroup"
  | "toolResult"
  | "fileChange"
  | "fileChangeGroup"
  | "commandExecution"
  | "commandGroup"
  | "imageGeneration"
  | "imageView"
  | "contextCompaction"
  | "reviewMode"
  | "status"
  | "error"
  | "checkpoint"
  | "notice";

export type ChatRowRole = "user" | "assistant" | "tool" | "system";

export type ChatRowWidth = "prose" | "wide" | "full";

export type AssistantUsageDisplayMode = "summary" | "details";

export type CompactionSourceDetail = {
  source: "free" | "native";
  providerId?: string;
  model?: string;
};

export type ChatRequestUsage = {
  requestId: string;
  usage: ChatTokenUsage;
};

export type ChatWaterfallRow = {
  key: string;
  turnId: string;
  threadId: string;
  itemIds: string[];
  kind: ChatRowKind;
  role: ChatRowRole;
  text: string;
  title: string;
  status?: string;
  item: WorkbenchItem;
  reasoning?: string;
  searchText: string;
  floor?: {
    index: number;
    label: string;
  };
  width: ChatRowWidth;
  isLive: boolean;
  hideHeader?: boolean;
  assistantTone?: "plain" | "tinted";
  /** Whole-turn start, retained separately from the assistant item's own start. */
  turnStartedAt?: number;
  startedAt?: number;
  completedAt?: number;
  firstTokenAt?: number;
  /** Latest item update time; unlike startedAt this moves while a response streams. */
  updatedAt?: number;
  previewUrl?: string;
  tokenUsage?: ChatTokenUsage;
  requestUsage?: ChatRequestUsage[];
  groupedRows?: ChatWaterfallRow[];
  compactionMarker?: boolean;
  compactionSource?: "free" | "native";
  compactionProviderId?: string;
  compactionModel?: string;
  /** Which CLI ran the compaction; drives the card/marker label. */
  compactionBackend?: string;
};

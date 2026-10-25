import type { ReactNode } from "react";
import { useTopicTranscript, type TopicTranscriptStore } from "./topicTranscriptStore";
import type { PanelTranscriptProjection } from "./transcriptProjection";
import { useTopicUsage, type TopicUsageSnapshot, type TopicUsageStore } from "../usage/topicUsageStore";

export interface TopicConversationSnapshot {
  transcript: PanelTranscriptProjection;
  usage: TopicUsageSnapshot;
}

export interface TopicConversationStores {
  transcriptStore: TopicTranscriptStore;
  usageStore: TopicUsageStore;
}

/** Single per-pane subscription boundary for transcript and usage domains. */
export function TopicConversationBoundary({ transcriptStore, usageStore, topicId, children }: {
  transcriptStore: TopicTranscriptStore;
  usageStore: TopicUsageStore;
  topicId: string | null;
  children(value: TopicConversationSnapshot, stores: TopicConversationStores): ReactNode;
}) {
  const transcript = useTopicTranscript(transcriptStore, topicId);
  const usage = useTopicUsage(usageStore, topicId);
  // Stream scheduling already bounds transcript work before the external
  // store publishes. Deferring the published snapshot again can permanently
  // leave an active pane on an early child-membership projection while a busy
  // multi-agent stream keeps scheduling newer snapshots.
  return children({ transcript, usage }, { transcriptStore, usageStore });
}

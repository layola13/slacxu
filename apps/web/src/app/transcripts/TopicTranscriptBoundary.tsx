import { memo, type ReactNode } from "react";
import { useTopicTranscript, type TopicTranscriptStore } from "./topicTranscriptStore";
import type { PanelTranscriptProjection } from "./transcriptProjection";

interface TopicTranscriptBoundaryProps {
  store: TopicTranscriptStore;
  topicId: string | null;
  children(projection: PanelTranscriptProjection): ReactNode;
}

/** Isolates transcript renders from the application shell and sibling panes. */
function TopicTranscriptBoundaryImpl({ store, topicId, children }: TopicTranscriptBoundaryProps) {
  const projection = useTopicTranscript(store, topicId);
  return children(projection);
}

export const TopicTranscriptBoundary = memo(TopicTranscriptBoundaryImpl);

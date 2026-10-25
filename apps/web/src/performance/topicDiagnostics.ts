export interface TopicTranscriptDiagnostics {
  topicBucketCount: number;
  loadedSnapshotThreadCount: number;
  turnIndexCount: number;
  subscribedTopicCount: number;
  subscribedAgentOverviewCount: number;
  materializedProjectionCount: number;
  materializedAgentOverviewCount: number;
  notificationBatchCount: number;
  notificationCount: number;
  listenerWakeCount: number;
  agentOverviewListenerWakeCount: number;
  reducedThreadCount: number;
  reducedTurnCount: number;
}

export interface TopicUsageDiagnostics {
  usageThreadBucketCount: number;
  usageTurnBucketCount: number;
  usageRoutingEntryCount: number;
  usageSubscribedTopicCount: number;
  usageMaterializedSnapshotCount: number;
  usagePendingCount: number;
  usageUpdateCount: number;
  usageListenerWakeCount: number;
}

let provider: (() => TopicTranscriptDiagnostics) | null = null;
let usageProvider: (() => TopicUsageDiagnostics) | null = null;

export function registerTopicTranscriptDiagnostics(next: (() => TopicTranscriptDiagnostics) | null): void {
  provider = next;
}

export function registerTopicUsageDiagnostics(next: (() => TopicUsageDiagnostics) | null): void {
  usageProvider = next;
}

export function readTopicTranscriptDiagnostics(): (TopicTranscriptDiagnostics & Partial<TopicUsageDiagnostics>) | null {
  const transcript = provider?.() ?? null;
  const usage = usageProvider?.() ?? null;
  if (!transcript && !usage) return null;
  return { ...(transcript ?? emptyTranscriptDiagnostics()), ...(usage ?? {}) };
}

function emptyTranscriptDiagnostics(): TopicTranscriptDiagnostics {
  return {
    topicBucketCount: 0,
    loadedSnapshotThreadCount: 0,
    turnIndexCount: 0,
    subscribedTopicCount: 0,
    subscribedAgentOverviewCount: 0,
    materializedProjectionCount: 0,
    materializedAgentOverviewCount: 0,
    notificationBatchCount: 0,
    notificationCount: 0,
    listenerWakeCount: 0,
    agentOverviewListenerWakeCount: 0,
    reducedThreadCount: 0,
    reducedTurnCount: 0
  };
}

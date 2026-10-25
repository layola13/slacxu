const GOAL_STATUSES = new Set(["active", "paused", "blocked", "usageLimited", "budgetLimited", "complete"]);

export function sanitizeLowFpsPerformanceReport(value: unknown): Record<string, unknown> | null {
  const report = record(value);
  const fps = record(report.fps);
  const currentFps = finiteNumber(fps.current, 0, 1_000);
  if (currentFps === null) {
    return null;
  }

  const application = nullableRecord(report.application);
  const renderer = record(report.renderer);
  const concurrency = record(report.concurrency);
  const panels = record(report.panels);
  const goal = record(report.goal);
  const scroll = nullableRecord(report.scroll);
  const heap = nullableRecord(report.heap);
  const longTasks = record(report.longTasks);
  const page = record(report.page);

  return {
    version: 1,
    capturedAt: shortString(report.capturedAt, 64),
    fps: {
      current: currentFps,
      threshold: finiteNumber(fps.threshold, 1, 240),
      consecutiveLowSamples: finiteNumber(fps.consecutiveLowSamples, 1, 10_000),
      sampleWindowMs: finiteNumber(fps.sampleWindowMs, 1, 60_000),
      recentSamples: Array.isArray(fps.recentSamples)
        ? fps.recentSamples.slice(-20).map((sample) => finiteNumber(sample, 0, 1_000)).filter((sample) => sample !== null)
        : []
    },
    application: application ? {
      cpuUsagePercent: finiteNumber(application.cpuUsagePercent, 0, 10_000),
      memoryBytes: finiteNumber(application.memoryBytes, 0, 1e16),
      processCount: finiteNumber(application.processCount, 0, 100_000),
      includesCodexCli: booleanValue(application.includesCodexCli)
    } : null,
    renderer: {
      ...numericFields(renderer, [
      "waterfallRowCount",
      "pinnedLiveRowCount",
      "mountedRowCount",
      "waterfallDomNodeCount",
      "pageDomNodeCount",
      "codeBlockCount",
      "expandedCodeBlockCount",
      "plainCodeBlockCount",
      "mountedCodeLineCount",
      "commandOutputCount",
      "commandOutputSourceChars",
      "commandOutputRenderedChars",
      "commandOutputRenderedLines",
      "truncatedCommandOutputCount",
      "groupedCommandCount",
      "visibleGroupedCommandCount",
      "toolDetailCount",
      "runningAnimationCount"
      ], 1e9),
      activeVirtualPage: shortString(renderer.activeVirtualPage, 256)
    },
    concurrency: {
      ...numericFields(concurrency, ["workspacePaneCount", "mountedAgentSlotCount"], 100_000),
      focused: booleanValue(concurrency.focused),
      ...(concurrency.topicTranscripts && typeof concurrency.topicTranscripts === "object" ? { topicTranscripts: numericFields(record(concurrency.topicTranscripts), [
        "topicBucketCount",
        "loadedSnapshotThreadCount",
        "turnIndexCount",
        "subscribedTopicCount",
        "materializedProjectionCount",
        "notificationBatchCount",
        "notificationCount",
        "listenerWakeCount",
        "reducedThreadCount",
        "reducedTurnCount",
        "usageThreadBucketCount",
        "usageTurnBucketCount",
        "usageRoutingEntryCount",
        "usageSubscribedTopicCount",
        "usageMaterializedSnapshotCount",
        "usagePendingCount",
        "usageUpdateCount",
        "usageListenerWakeCount"
      ], 1e12) } : {}),
    },
    panels: booleanFields(panels, ["settings", "rightWorkspace", "explorer", "git", "gitDiff"]),
    goal: {
      visible: booleanValue(goal.visible),
      status: typeof goal.status === "string" && GOAL_STATUSES.has(goal.status) ? goal.status : null
    },
    scroll: scroll ? numericFields(scroll, ["scrollTop", "scrollHeight", "clientHeight", "distanceFromBottom"], 1e12) : null,
    heap: heap ? numericFields(heap, ["usedBytes", "totalBytes", "limitBytes"], 1e16) : null,
    longTasks: numericFields(longTasks, ["count", "totalDurationMs", "maxDurationMs", "lastDurationMs"], 1e12),
    page: {
      visibility: page.visibility === "visible" || page.visibility === "hidden" ? page.visibility : null,
      viewportWidth: finiteNumber(page.viewportWidth, 0, 100_000),
      viewportHeight: finiteNumber(page.viewportHeight, 0, 100_000),
      devicePixelRatio: finiteNumber(page.devicePixelRatio, 0, 100),
      uptimeMs: finiteNumber(page.uptimeMs, 0, 1e15),
      platform: shortString(page.platform, 64)
    }
  };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function nullableRecord(value: unknown): Record<string, unknown> | null {
  return value === null || value === undefined ? null : record(value);
}

function finiteNumber(value: unknown, min: number, max: number): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? value : null;
}

function booleanValue(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function shortString(value: unknown, maxLength: number): string | null {
  return typeof value === "string" && value.length <= maxLength ? value : null;
}

function numericFields(source: Record<string, unknown>, fields: string[], max: number): Record<string, number | null> {
  return Object.fromEntries(fields.map((field) => [field, finiteNumber(source[field], 0, max)]));
}

function booleanFields(source: Record<string, unknown>, fields: string[]): Record<string, boolean | null> {
  return Object.fromEntries(fields.map((field) => [field, booleanValue(source[field])]));
}

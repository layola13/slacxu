import { expect, test } from "bun:test";
import { sanitizeLowFpsPerformanceReport } from "../../apps/server/src/performanceReport";

test("performance reports retain diagnostic metadata and discard sensitive fields", () => {
  const report = sanitizeLowFpsPerformanceReport({
    version: 1,
    capturedAt: "2026-07-28T12:00:00.000Z",
    conversationText: "secret transcript",
    apiKey: "sk-secret",
    fps: { current: 4, threshold: 10, consecutiveLowSamples: 3, recentSamples: [60, 18, 4] },
    renderer: {
      activeVirtualPage: "parent:agent:child-15",
      waterfallRowCount: 600,
      mountedRowCount: 22,
      runningAnimationCount: 3,
      commandOutputSourceChars: 40_000,
      commandOutputRenderedChars: 12_000,
      truncatedCommandOutputCount: 1,
      messageBody: "do not log"
    },
    concurrency: {
      workspacePaneCount: 6,
      mountedAgentSlotCount: 100,
      focused: true,
      agentNames: ["secret"],
      topicTranscripts: {
        topicBucketCount: 101,
        loadedSnapshotThreadCount: 16,
        subscribedTopicCount: 2,
        materializedProjectionCount: 2,
        listenerWakeCount: 40,
        reducedThreadCount: 800,
        reducedTurnCount: 1_600,
        secretThreadId: "private-child"
      }
    },
    panels: { settings: true, explorer: false },
    goal: { visible: true, status: "active", objective: "private objective" },
    page: { visibility: "visible", viewportWidth: 1440, viewportHeight: 900, platform: "Win32", url: "/thread/private" }
  });

  expect(report).not.toBeNull();
  expect(report?.fps).toMatchObject({ current: 4, threshold: 10, consecutiveLowSamples: 3 });
  expect(report?.renderer).toMatchObject({
    activeVirtualPage: "parent:agent:child-15",
    waterfallRowCount: 600,
    mountedRowCount: 22,
    runningAnimationCount: 3,
    commandOutputSourceChars: 40_000,
    commandOutputRenderedChars: 12_000,
    truncatedCommandOutputCount: 1
  });
  expect(report?.concurrency).toMatchObject({
    workspacePaneCount: 6,
    mountedAgentSlotCount: 100,
    focused: true,
    topicTranscripts: {
      topicBucketCount: 101,
      loadedSnapshotThreadCount: 16,
      subscribedTopicCount: 2,
      materializedProjectionCount: 2,
      listenerWakeCount: 40,
      reducedThreadCount: 800,
      reducedTurnCount: 1_600
    }
  });
  expect(report?.goal).toEqual({ visible: true, status: "active" });
  const serialized = JSON.stringify(report);
  expect(serialized).not.toContain("secret transcript");
  expect(serialized).not.toContain("sk-secret");
  expect(serialized).not.toContain("private objective");
  expect(serialized).not.toContain("/thread/private");
  expect(serialized).not.toContain("private-child");
});

test("performance reports reject missing or invalid FPS samples", () => {
  expect(sanitizeLowFpsPerformanceReport({ fps: {} })).toBeNull();
  expect(sanitizeLowFpsPerformanceReport({ fps: { current: "4" } })).toBeNull();
  expect(sanitizeLowFpsPerformanceReport({ fps: { current: -1 } })).toBeNull();
});

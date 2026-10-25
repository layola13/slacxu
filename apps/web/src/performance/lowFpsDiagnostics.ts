import type { SystemMetrics } from "@codex-ui/shared";
import { readTopicTranscriptDiagnostics } from "./topicDiagnostics";

export const LOW_FPS_THRESHOLD = 10;
export const LOW_FPS_REQUIRED_SAMPLES = 3;
export const LOW_FPS_RECOVERY_THRESHOLD = 24;
export const LOW_FPS_RECOVERY_REQUIRED_SAMPLES = 5;
export const LOW_FPS_REPORT_COOLDOWN_MS = 60_000;

export type LowFpsState = {
  consecutiveLowSamples: number;
  consecutiveRecoverySamples: number;
  pressured: boolean;
  lastReportedAt: number | null;
};

export type LongTaskStats = {
  count: number;
  totalDurationMs: number;
  maxDurationMs: number;
  lastDurationMs: number;
};

export function createLowFpsState(): LowFpsState {
  return { consecutiveLowSamples: 0, consecutiveRecoverySamples: 0, pressured: false, lastReportedAt: null };
}

export function evaluateLowFpsSample(
  state: LowFpsState,
  sample: { fps: number; now: number; visible: boolean }
): { state: LowFpsState; shouldReport: boolean } {
  if (!sample.visible || !Number.isFinite(sample.fps)) {
    return {
      state: { ...state, consecutiveLowSamples: 0, consecutiveRecoverySamples: 0 },
      shouldReport: false
    };
  }

  if (state.pressured) {
    const consecutiveRecoverySamples = sample.fps >= LOW_FPS_RECOVERY_THRESHOLD
      ? Math.min(LOW_FPS_RECOVERY_REQUIRED_SAMPLES, state.consecutiveRecoverySamples + 1)
      : 0;
    const pressured = consecutiveRecoverySamples < LOW_FPS_RECOVERY_REQUIRED_SAMPLES;
    const cooldownElapsed = state.lastReportedAt === null || sample.now - state.lastReportedAt >= LOW_FPS_REPORT_COOLDOWN_MS;
    const shouldReport = sample.fps < LOW_FPS_THRESHOLD && cooldownElapsed;
    return {
      state: {
        consecutiveLowSamples: pressured ? LOW_FPS_REQUIRED_SAMPLES : 0,
        consecutiveRecoverySamples: pressured ? consecutiveRecoverySamples : 0,
        pressured,
        lastReportedAt: shouldReport ? sample.now : state.lastReportedAt
      },
      shouldReport
    };
  }

  if (sample.fps >= LOW_FPS_THRESHOLD) {
    return {
      state: { ...state, consecutiveLowSamples: 0, consecutiveRecoverySamples: 0 },
      shouldReport: false
    };
  }
  const consecutiveLowSamples = Math.min(LOW_FPS_REQUIRED_SAMPLES, state.consecutiveLowSamples + 1);
  const pressured = consecutiveLowSamples >= LOW_FPS_REQUIRED_SAMPLES;
  const cooldownElapsed = state.lastReportedAt === null || sample.now - state.lastReportedAt >= LOW_FPS_REPORT_COOLDOWN_MS;
  const shouldReport = consecutiveLowSamples >= LOW_FPS_REQUIRED_SAMPLES && cooldownElapsed;
  return {
    state: {
      consecutiveLowSamples,
      consecutiveRecoverySamples: 0,
      pressured,
      lastReportedAt: shouldReport ? sample.now : state.lastReportedAt
    },
    shouldReport
  };
}

export function collectLowFpsPerformanceReport(input: {
  fps: number;
  consecutiveLowSamples: number;
  recentFpsSamples: number[];
  metrics: SystemMetrics | null;
  longTasks: LongTaskStats;
  document: Document;
  window: Window;
}): Record<string, unknown> {
  const { document, window } = input;
  const waterfall = document.querySelector<HTMLElement>('[data-testid="conversation-waterfall"]');
  const scroll = document.querySelector<HTMLElement>('[data-testid="chat-waterfall-scroll"]');
  const codeBlocks = Array.from(document.querySelectorAll<HTMLElement>(".code-block"));
  const commandOutputs = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="command-output"]'));
  const commandGroups = Array.from(document.querySelectorAll<HTMLElement>("[data-grouped-command-count]"));
  const memory = (window.performance as Performance & {
    memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number };
  }).memory;
  const scrollTop = scroll?.scrollTop ?? 0;
  const scrollHeight = scroll?.scrollHeight ?? 0;
  const clientHeight = scroll?.clientHeight ?? 0;
  const goalSurface = document.querySelector<HTMLElement>('[data-testid="sticky-goal-bar"]');
  const promptRail = document.querySelector<HTMLElement>('[data-testid="chat-floor-rail"]');
  const topicTranscripts = readTopicTranscriptDiagnostics();

  return {
    version: 1,
    capturedAt: new Date().toISOString(),
    fps: {
      current: input.fps,
      threshold: LOW_FPS_THRESHOLD,
      consecutiveLowSamples: input.consecutiveLowSamples,
      sampleWindowMs: 1_000,
      recentSamples: input.recentFpsSamples.slice(-12)
    },
    application: input.metrics ? {
      cpuUsagePercent: input.metrics.application.cpuUsagePercent,
      memoryBytes: input.metrics.application.memoryBytes,
      processCount: input.metrics.application.processCount,
      includesCodexCli: input.metrics.application.includesCodexCli
    } : null,
    renderer: {
      activeVirtualPage: waterfall?.dataset.virtualPageKey ?? null,
      waterfallRowCount: integerAttribute(waterfall, "data-row-count"),
      pinnedLiveRowCount: integerAttribute(waterfall, "data-pinned-live-row-count"),
      mountedRowCount: waterfall?.querySelectorAll("[data-chat-row-key]").length ?? 0,
      waterfallDomNodeCount: waterfall?.querySelectorAll("*").length ?? 0,
      pageDomNodeCount: document.querySelectorAll("*").length,
      codeBlockCount: codeBlocks.length,
      expandedCodeBlockCount: codeBlocks.filter((node) => node.dataset.codeExpanded === "true").length,
      plainCodeBlockCount: codeBlocks.filter((node) => node.dataset.codeRenderMode === "plain").length,
      mountedCodeLineCount: codeBlocks.reduce((total, node) => total + integerAttribute(node, "data-code-line-count"), 0),
      commandOutputCount: commandOutputs.length,
      commandOutputSourceChars: commandOutputs.reduce((total, node) => total + integerAttribute(node, "data-command-output-total-chars"), 0),
      commandOutputRenderedChars: commandOutputs.reduce((total, node) => total + integerAttribute(node, "data-command-output-chars"), 0),
      commandOutputRenderedLines: commandOutputs.reduce((total, node) => total + integerAttribute(node, "data-command-output-lines"), 0),
      truncatedCommandOutputCount: commandOutputs.filter((node) => node.dataset.commandOutputTruncated === "true").length,
      groupedCommandCount: commandGroups.reduce((total, node) => total + integerAttribute(node, "data-grouped-command-count"), 0),
      visibleGroupedCommandCount: commandGroups.reduce((total, node) => total + integerAttribute(node, "data-visible-command-count"), 0),
      toolDetailCount: document.querySelectorAll('[data-testid="tool-audit-details"], [data-testid="file-audit-details"], [data-testid="tool-file-diff-details"]').length,
      runningAnimationCount: document.getAnimations().filter((animation) => animation.playState === "running").length
    },
    concurrency: {
      workspacePaneCount: document.querySelectorAll("[data-pane-id]").length,
      mountedAgentSlotCount: document.querySelectorAll('[data-testid^="parallel-agent-slot-"]').length,
      focused: document.hasFocus(),
      topicTranscripts
    },
    effects: {
      softwareRenderingMode: document.documentElement.dataset.softwareRendering === "true",
      performancePressure: document.documentElement.dataset.performancePressure === "true",
      canvasCount: document.querySelectorAll("canvas").length,
      videoCount: document.querySelectorAll("video").length,
      imageCount: document.querySelectorAll("img").length
    },
    input: {
      activeElement: document.activeElement?.tagName ?? null,
      splitDropZones: Boolean(document.querySelector('[data-testid="split-view-drop-zones"]')),
      draggingTaskTab: Boolean(document.querySelector('[data-testid="task-tab"][style*="grabbing"]')),
      modalCount: document.querySelectorAll('[role="dialog"], .MuiModal-root').length,
      backdropCount: document.querySelectorAll('.MuiBackdrop-root').length,
      pointerCaptureElements: document.querySelectorAll('[data-dragging="true"]').length
    },
    navigation: {
      promptRailVisible: Boolean(promptRail),
      promptRailCollapsed: promptRail?.dataset.collapsed === "true",
      promptRailDragging: promptRail?.dataset.dragging === "true",
      lastAction: scroll?.dataset.lastNavigationAction ?? null,
      lastRowIndex: integerDataset(scroll, "lastNavigationRowIndex"),
      lastActionAt: scroll?.dataset.lastNavigationAt ?? null
    },
    panels: {
      settings: Boolean(document.querySelector('[data-testid="settings-drawer"]')),
      rightWorkspace: Boolean(document.querySelector('[data-testid="right-workspace-panel"]')),
      explorer: Boolean(document.querySelector('[data-testid="workspace-explorer-panel"]')),
      git: Boolean(document.querySelector('[data-testid="git-review-panel"]')),
      gitDiff: Boolean(document.querySelector('[data-testid="git-review-diff"]'))
    },
    goal: {
      visible: Boolean(goalSurface),
      status: goalSurface?.dataset.goalStatus ?? null
    },
    scroll: scroll ? {
      scrollTop: Math.round(scrollTop),
      scrollHeight,
      clientHeight,
      distanceFromBottom: Math.max(0, Math.round(scrollHeight - scrollTop - clientHeight))
    } : null,
    heap: memory ? {
      usedBytes: memory.usedJSHeapSize,
      totalBytes: memory.totalJSHeapSize,
      limitBytes: memory.jsHeapSizeLimit
    } : null,
    longTasks: {
      count: input.longTasks.count,
      totalDurationMs: Math.round(input.longTasks.totalDurationMs),
      maxDurationMs: Math.round(input.longTasks.maxDurationMs),
      lastDurationMs: Math.round(input.longTasks.lastDurationMs)
    },
    page: {
      visibility: document.visibilityState,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
      uptimeMs: Math.round(window.performance.now()),
      platform: window.navigator.platform
    }
  };
}

function integerAttribute(element: HTMLElement | null, name: string): number {
  const value = Number(element?.getAttribute(name));
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : 0;
}

function integerDataset(element: HTMLElement | null, name: string): number | null {
  const value = Number(element?.dataset[name]);
  return Number.isInteger(value) && value >= 0 ? value : null;
}

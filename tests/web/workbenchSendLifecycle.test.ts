import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseComposerSlashCommand } from "../../apps/web/src/composer/composerSlashCommands";
import { PendingSendGate } from "../../apps/web/src/composer/PendingSendGate";
import { isReviewModeActive } from "../../apps/web/src/app/reviewTurn";
import type { WorkbenchTurn } from "../../apps/web/src/state/codexClient";

const root = join(import.meta.dir, "../..");

function readTree(dir) {
  if (!existsSync(dir)) return "";
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return [readTree(path)];
      return entry.name.endsWith(".ts") || entry.name.endsWith(".tsx") ? [readFileSync(path, "utf8")] : [];
    })
    .join("\n");
}
function assembledAppSource(rootDir) {
  return [
    readFileSync(join(rootDir, "apps/web/src/App.tsx"), "utf8"),
    readTree(join(rootDir, "apps/web/src/shell")),
    readTree(join(rootDir, "apps/web/src/components/dialogs")),
    readTree(join(rootDir, "apps/web/src/app/workbench")),
    readTree(join(rootDir, "apps/web/src/free")),
    readTree(join(rootDir, "frontends/free-mode/src/free")),
  ].join("\n");
}
const appSource = assembledAppSource(root);

test("sendPrompt pipeline enforces strict ordering: Slash -> Free Compaction Barrier -> Turn Dispatch", () => {
  const sendPromptIdx = appSource.indexOf("const sendPrompt = useCallback(");
  expect(sendPromptIdx).toBeGreaterThan(0);

  const slashIdx = appSource.indexOf("parseComposerSlashCommand", sendPromptIdx);
  const compactBarrierIdx = appSource.indexOf("freeCompactBarrierRef.current?.()", sendPromptIdx);
  const activeTurnCheckIdx = appSource.indexOf("latestActionableRunningTurn(state.turns, state.activeThreadId)", sendPromptIdx);
  const startTurnIdx = appSource.indexOf("startCodexTurn(text, images, mentions", sendPromptIdx);

  expect(slashIdx).toBeGreaterThan(sendPromptIdx);
  expect(compactBarrierIdx).toBeGreaterThan(slashIdx);
  expect(activeTurnCheckIdx).toBeGreaterThan(compactBarrierIdx);
  expect(startTurnIdx).toBeGreaterThan(activeTurnCheckIdx);
});

test("Slash commands intercept input before network turn submission", () => {
  const slashPlan = parseComposerSlashCommand("/plan on", [], []);
  expect(slashPlan).not.toBeNull();
  expect(slashPlan?.type).toBe("plan");

  const normalMsg = parseComposerSlashCommand("Hello world", [], []);
  expect(normalMsg).toBeNull();

  const slashImage = parseComposerSlashCommand("/image a futuristic city", [], []);
  expect(slashImage).not.toBeNull();
  expect(slashImage?.type).toBe("image");
  if (slashImage?.type === "image") {
    expect(slashImage.prompt).toBe("a futuristic city");
  }

  const slashCompact = parseComposerSlashCommand("/compact", [], []);
  expect(slashCompact).not.toBeNull();
  expect(slashCompact?.type).toBe("compact");
});

test("New thread send triggers thread/start and registers dynamic tools before turn/start", () => {
  expect(appSource).toContain("await client.rpc(\"thread/start\", startParams)");
  expect(appSource).toContain("startParams.dynamicTools = [saVmDynamicToolSpec(");
  expect(appSource).toContain("startParams.developerInstructions = saVmDeveloperInstructions(");
  expect(appSource).toContain("const threadResult = await client.rpc(\"thread/start\", startParams);");
  expect(appSource).toContain("const thread = asRecord(asRecord(threadResult).thread);");
});

test("Workspace chooser confirms once and does not reopen new-chat setup", () => {
  expect(appSource).toContain('data-testid="workspace-selection-panel"');
  expect(appSource).toContain('testId="workspace-cli-backend-toggle"');
  expect(appSource).toContain("await applyWorkspaceSelectionFromDialog(modeOverride);");
  expect(appSource).toContain("setWorkspaceSelectionPending(false);");
  expect(appSource).not.toContain("配置 CLI");
});

test("Repeated send on same active thread reuses threadId and bypasses thread/start", () => {
  expect(appSource).toContain("const requestedThreadId = options.threadIdOverride ?? state.activeThreadId;");
  expect(appSource).toContain("const threadId = options.threadIdOverride ?? await ensureActiveThread();");
  expect(appSource).toContain("await client.rpc(\"turn/start\", turnParams)");
});

test("Steer vs Interrupt behavior on active running turns", () => {
  expect(appSource).toContain("const steerPrompt = useCallback(");
  expect(appSource).toContain("const threadId = await startCodexTurn(text, images, mentions, { steerOnly: true });");
  expect(appSource).toContain("await client.rpc(\"turn/steer\", steerParams);");
  expect(appSource).toContain("expectedTurnId: activeTurn.id");

  // interruptTurn delegates to interruptTurnWithRetry
  expect(appSource).toContain("const interruptTurn = useCallback(");
  expect(appSource).toContain("await interruptTurnWithRetry({");
  expect(appSource).toContain("rpc: (");
  expect(appSource).toContain("client.rpc(method, params, options)");
});

test("Review turns cannot be steered and automatically trigger stopReviewAndStart", () => {
  const reviewTurn: WorkbenchTurn = {
    id: "turn-review-1",
    threadId: "t-1",
    status: "inProgress",
    startedAt: 1000,
    items: [{ id: "item-rev", type: "enteredReviewMode", review: "diff", status: "completed" }]
  };
  expect(isReviewModeActive(reviewTurn)).toBe(true);

  expect(appSource).toContain("if (isReviewModeActive(activeTurn)) {");
  expect(appSource).toContain("const stopReviewAndStart = async (reviewTurnId: string) => {");
  expect(appSource).toContain("await interruptTurn(threadId, reviewTurnId);");
  expect(appSource).toContain("await startNewTurn(reviewTurnId);");
});

test("Collaboration modes: Plan mode enables plan auto-continuation", () => {
  expect(appSource).toContain("collaborationMode: \"plan\", enablePlanAutoContinuation: true");
  expect(appSource).toContain("enablePlanAutoContinuation(threadId);");
  expect(appSource).toContain("buildPlanCollaborationMode(effectiveModel)");
});

test("JEV compress directive injects hidden instruction with displayText separation", () => {
  // MVP3增量版 (JEV选c)：一句话指令 + 计数快照/40项工具确认门控 + displayText分离。
  expect(appSource).toContain("runJevCompressDirective");
  expect(appSource).toContain("jevCompressDirectiveRef.current?.()");
  expect(appSource).toContain("[compress]若自上次裁剪有新增工具输出");
  expect(appSource).toContain("jevCompressBaselineRef");
  expect(appSource).toContain("isPrunableToolItem");
  expect(appSource).toContain('action:"jev_compress"');
  expect(appSource).toContain("displayText: text");
  // 兜底(a)：能力未开只提醒不拦截；jev-token按阈值，jev-sub高频。
  expect(appSource).toContain("JEV压缩未启用能力开关");
  expect(appSource).toContain("threadSelection.jevCompressThreshold");
  expect(appSource).toContain("jevCompressCooldownRef");
});

test("PendingSendGate releases reservation and prevents stuck state on failure", () => {
  const gate = new PendingSendGate();
  const appendId = "test-append-1";

  expect(gate.canCommit(appendId)).toBe(true);

  // When cancelled before commit, cancel returns true and blocks commit
  expect(gate.cancel(appendId)).toBe(true);
  expect(gate.canCommit(appendId)).toBe(false);
  expect(gate.beginCommit(appendId)).toBe(false);

  // Release frees the gate back to unblocked
  gate.release(appendId);
  expect(gate.canCommit(appendId)).toBe(true);
  expect(gate.beginCommit(appendId)).toBe(true);

  // Once committed, cancel returns false
  expect(gate.cancel(appendId)).toBe(false);

  // App.tsx catches turn errors, releases gate and clears pending accepted threads
  expect(appSource).toContain("pendingSendGateRef.current.release(pendingAppendId);");
  expect(appSource).toContain("setPendingAcceptedThreads((current: Set<string>) => {");
});

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { claimJevAutoNudgeTurn, resetJevAutoNudgeDedup } from "../../frontends/jev/src/jev/jevAutoJudge";

const appSrc = readFileSync(join(import.meta.dir, "../../apps/web/src/App.tsx"), "utf8")
  + readFileSync(join(import.meta.dir, "../../apps/web/src/shell/AppRoot.tsx"), "utf8")
  + readFileSync(join(import.meta.dir, "../../apps/web/src/app/workbench/useTaskTabsRuntime.ts"), "utf8")
  + readFileSync(join(import.meta.dir, "../../apps/web/src/app/workbench/useSocketPipeline.ts"), "utf8")
  + readFileSync(join(import.meta.dir, "../../apps/web/src/app/workbench/useComposerPipeline.ts"), "utf8")
  + readFileSync(join(import.meta.dir, "../../apps/web/src/app/workbench/useTurnOps.ts"), "utf8");
const composerSrc = readFileSync(join(import.meta.dir, "../../apps/web/src/composer/Composer.tsx"), "utf8");
const ownerHookSrc = readFileSync(join(import.meta.dir, "../../apps/web/src/app/jev/useJevAutoNudgeOwner.ts"), "utf8");

test("JEV auto-nudge is owned per verdict thread, never bound to global active", () => {
  // Owner lives in useJevAutoNudgeOwner and pins the send to the verdict's own thread.
  expect(ownerHookSrc).toContain("threadIdOverride: threadId");
  expect(ownerHookSrc).toContain("jevAutoNudge: true");
  expect(ownerHookSrc).toContain("forceNewTurn: true");
  // Running gate must check the owner thread, not the globally displayed one.
  expect(ownerHookSrc).toContain("latestActionableRunningTurn(turnsRef.current, threadId)");
  // Unknown owner must fail closed, never fall back to the active thread.
  expect(ownerHookSrc).toContain("if (!threadId || !turnId) return;");
  // App.tsx wires the hook
  expect(appSrc).toContain("useJevAutoNudgeOwner");
});

test("user-stopped threads suppress later auto-nudges until manual resend", () => {
  expect(ownerHookSrc).toContain("jevNudgeStoppedRef");
  // stop button + server interrupted notice both suppress + clear the streak.
  expect(appSrc).toContain("suppressThreadAutoNudge(activeRunningTurn.threadId)");
  expect(appSrc).toContain("suppressThreadAutoNudge(notificationThreadId)");
  // Manual sends lift the suppression; JEV's own sends must not self-clear it.
  expect(appSrc).toContain("if (!options.jevAutoNudge) {");
  expect(appSrc).toContain("resumeThreadAutoNudge(threadId)");
});

test("Composer no longer auto-sends verdicts to the global active thread", () => {
  // The old closed loop resent failed/partial verdicts through global onSend,
  // which races thread switches and resurrects stopped conversations.
  expect(composerSrc).not.toContain("jevSendRef.current(buildJevNudgeText");
  expect(composerSrc).not.toContain("jevFailStreakRef");
  expect(composerSrc).not.toContain("jevAutoNudgedTurns");
  expect(composerSrc).not.toContain("shouldAutoNudge");
  // Display stays scoped to the visible conversation; manual nudge stays.
  expect(composerSrc).toContain("shouldAcceptJevVerdictForThread");
  expect(composerSrc).toContain("handleJevNudge");
});

test("same verdict turn only nudges once across mounts", () => {
  resetJevAutoNudgeDedup();
  expect(claimJevAutoNudgeTurn("turn-dedup-1")).toBe(true);
  expect(claimJevAutoNudgeTurn("turn-dedup-1")).toBe(false);
  expect(claimJevAutoNudgeTurn("turn-dedup-2")).toBe(true);
  expect(claimJevAutoNudgeTurn("")).toBe(false);
  resetJevAutoNudgeDedup();
  expect(claimJevAutoNudgeTurn("turn-dedup-1")).toBe(true);
});

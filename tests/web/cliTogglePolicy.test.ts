import { expect, test } from "bun:test";
import { describeCliBackendUsage } from "../../apps/web/src/app/cli/cliTogglePolicy";

test("unused backend reports not in use", () => {
  const usage = describeCliBackendUsage("codex", {
    selections: { __new__: { cliBackend: "mini" } },
    threads: [],
    runningThreadIds: new Set(),
  });
  expect(usage.inUse).toBe(false);
  expect(usage.threadCount).toBe(0);
  expect(usage.runningCount).toBe(0);
});

test("thread bound to backend counts as in use", () => {
  const usage = describeCliBackendUsage("codex", {
    selections: {
      __new__: { cliBackend: "mini" },
      "thread-1": { cliBackend: "codex" },
    },
    threads: [{ id: "thread-2", cliBackend: "codex" }],
    runningThreadIds: new Set(),
  });
  expect(usage.inUse).toBe(true);
  expect(usage.threadCount).toBe(2);
});

test("running turn on backend counts as in use", () => {
  const usage = describeCliBackendUsage("claude", {
    selections: { "thread-1": { cliBackend: "claude" } },
    threads: [{ id: "thread-1", cliBackend: "claude" }],
    runningThreadIds: new Set(["thread-1"]),
  });
  expect(usage.inUse).toBe(true);
  expect(usage.runningCount).toBe(1);
});

test("auggie threads no longer count toward agy (auggie reopened as its own always-on embedded plugin)", () => {
  const agyUsage = describeCliBackendUsage("agy", {
    selections: { "thread-1": { cliBackend: "auggie" } },
    threads: [],
    runningThreadIds: new Set(),
  });
  expect(agyUsage.inUse).toBe(false);
  const agyOwnUsage = describeCliBackendUsage("agy", {
    selections: { "thread-1": { cliBackend: "agy" } },
    threads: [],
    runningThreadIds: new Set(),
  });
  expect(agyOwnUsage.inUse).toBe(true);
});

test("new-conversation composer selection alone is not usage", () => {
  const usage = describeCliBackendUsage("codex", {
    selections: { __new__: { cliBackend: "codex" } },
    threads: [],
    runningThreadIds: new Set(),
  });
  expect(usage.inUse).toBe(false);
});

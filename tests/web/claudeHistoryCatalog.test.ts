import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mergeThreadLists, normalizeThreads } from "../../apps/web/src/app/threads/threadCatalog.ts";

const appSource = readFileSync(join(import.meta.dir, "../../apps/web/src/App.tsx"), "utf8")
  + readFileSync(join(import.meta.dir, "../../apps/web/src/app/workbench/useComposerPipeline.ts"), "utf8")
  + readFileSync(join(import.meta.dir, "../../apps/web/src/app/workbench/useComposerThreadStart.ts"), "utf8");

/**
 * The history sidebar renders `threads.filter((t) => (t.cliBackend ?? "codex") === backendFilter)`.
 * A catalog entry that loses `cliBackend` therefore disappears from the Claude
 * filter entirely, which is how a restarted server appeared to forget every
 * Claude conversation even though `claude_sessions` still held the transcript.
 */
test("thread catalog keeps the Claude backend reported by thread/list", () => {
  const [claude, codex] = normalizeThreads([
    { id: "thread-claude", cliBackend: "claude", preview: "Claude conversation", recencyAt: 2 },
    { id: "thread-codex", cliBackend: "codex", preview: "Codex conversation", recencyAt: 1 }
  ]);

  expect(claude?.cliBackend).toBe("claude");
  expect(codex?.cliBackend).toBe("codex");
});

test("thread catalog accepts the snake_case backend field", () => {
  expect(normalizeThreads([{ id: "thread-1", cli_backend: "claude" }])[0]?.cliBackend).toBe("claude");
});

test("thread catalog leaves the backend unset when the server does not report one", () => {
  const [thread] = normalizeThreads([{ id: "thread-1", preview: "no backend" }]);
  // The sidebar defaults an absent value to Codex; an explicit wrong value
  // would instead hide a Claude thread behind the Codex filter.
  expect(thread?.cliBackend).toBeUndefined();
  expect(normalizeThreads([{ id: "thread-2", cliBackend: "gemini" }])[0]?.cliBackend).toBeUndefined();
});

test("merging catalogs does not drop a Claude thread's backend", () => {
  const listed = normalizeThreads([{ id: "thread-1", cliBackend: "claude", recencyAt: 5 }]);
  const renamed = mergeThreadLists(listed, [{ id: "thread-1", title: "Renamed", recencyAt: 6 }]);

  expect(renamed[0]?.cliBackend).toBe("claude");
  expect(renamed[0]?.title).toBe("Renamed");
});

test("a later normalized catalog without a backend does not erase an earlier one", () => {
  // Both lists carry every key, so the second entry's absent `cliBackend`
  // used to overwrite the first entry's value with undefined.
  const merged = mergeThreadLists(
    normalizeThreads([{ id: "thread-1", cliBackend: "claude", model: "claude-opus-5[1m]", recencyAt: 5 }]),
    normalizeThreads([{ id: "thread-1", recencyAt: 6 }])
  );

  expect(merged[0]?.cliBackend).toBe("claude");
  expect(merged[0]?.model).toBe("claude-opus-5[1m]");
  expect(merged[0]?.recencyAt).toBe(6);
});

test("an optimistically inserted thread carries the composer's backend", () => {
  // Regression: the optimistic catalog entry must use the freshly resolved
  // effectiveCliBackend (what was actually sent to thread/start), not the
  // stale runtimeSelection.cliBackend closure. The Codex app-server echoes no
  // cliBackend for codex threads, so the stale default ("mini") mislabeled a
  // user-selected codex thread as mini in the tab strip / history and poisoned
  // runtimeSelectionFallbackForThread on the next turn.
  expect(appSource).toContain("cliBackend: startedThread?.cliBackend ?? effectiveCliBackend");
  expect(appSource).not.toContain('cliBackend: startedThread?.cliBackend ?? runtimeSelection.cliBackend ?? "codex"');
});

import { describe, expect, test } from "bun:test";
import {
  catalogForOpenedThreads,
  isSshThread,
  mergeListedThreadsWithOptimistic,
  mergeSuccessfulThreadList,
  normalizeCliBackend,
  normalizeThreads,
  renameThreadAcrossCatalogs,
  sshThreadHostLabel,
  sshThreadTooltip
} from "../../apps/web/src/app/threads/threadCatalog";
import {
  isPiCliBackend,
  isGrokCliBackend,
  normalizeThreadCliBackend
} from "../../apps/web/src/app/runtime/cliBackendKind";

describe("SSH thread identity", () => {
  test("derives a concise host and remote cwd tooltip", () => {
    const thread = { workspaceMode: "ssh" as const, sshCommand: "ssh -p 2222 vscode@45.129.8.163", sshCwd: "~/projects/" };
    expect(isSshThread(thread)).toBe(true);
    expect(sshThreadHostLabel(thread)).toBe("vscode@45.129.8.163");
    expect(sshThreadTooltip(thread)).toBe("SSH · vscode@45.129.8.163 · ~/projects/");
  });

  test("does not mark local threads as SSH", () => {
    const thread = { workspaceMode: undefined, sshCommand: undefined, cwd: "E:\\projects\\sci" };
    expect(isSshThread(thread)).toBe(false);
    expect(sshThreadHostLabel(thread)).toBeNull();
    expect(sshThreadTooltip(thread)).toBeNull();
  });
});

describe("optimistic thread catalog", () => {
  test("keeps a newly created thread until thread/list indexes it", () => {
    const optimisticIds = new Set(["new-thread"]);
    const current = [{ id: "new-thread", cwd: "E:\\projects\\new" }, { id: "old-thread" }];

    expect(mergeListedThreadsWithOptimistic([{ id: "old-thread" }], current, optimisticIds)).toEqual([
      { id: "old-thread" },
      { id: "new-thread", cwd: "E:\\projects\\new" }
    ]);
    expect(optimisticIds.has("new-thread")).toBe(true);

    expect(mergeListedThreadsWithOptimistic([{ id: "new-thread", name: "Indexed" }], current, optimisticIds)).toEqual([
      { id: "new-thread", name: "Indexed" }
    ]);
    expect(optimisticIds.has("new-thread")).toBe(false);
  });

  test("keeps opened tabs visible when history search hides them", () => {
    expect(catalogForOpenedThreads(
      [{ id: "search-result" }],
      [{ id: "search-result" }, { id: "opened-thread", cwd: "E:\\projects\\opened" }, { id: "closed-thread" }],
      ["opened-thread"]
    )).toEqual([
      { id: "search-result" },
      { id: "opened-thread", cwd: "E:\\projects\\opened" }
    ]);
  });

  test("rename cannot replace the catalog with one thread", () => {
    expect(renameThreadAcrossCatalogs(
      [],
      [{ id: "renamed" }, { id: "running" }, { id: "history" }],
      "renamed",
      "New name"
    ).map((thread) => [thread.id, thread.name])).toEqual([
      ["renamed", "New name"],
      ["running", undefined],
      ["history", undefined]
    ]);
  });

  test("rename preserves an existing Claude backend on the renamed entry", () => {
    const renamed = renameThreadAcrossCatalogs(
      [],
      [{ id: "claude-thread", cliBackend: "claude" }],
      "claude-thread",
      "My Claude task",
      "claude"
    );
    expect(renamed.find((thread) => thread.id === "claude-thread")?.cliBackend).toBe("claude");
  });

  test("rename on a thread absent from the catalog carries the known backend so it stays under Claude", () => {
    // The fallback path previously created the optimistic entry with no
    // `cliBackend`, which defaulted to the Codex history filter. Passing the
    // known backend must keep the thread under the Claude filter.
    const created = renameThreadAcrossCatalogs([], [], "fresh-claude", "Fresh", "claude");
    expect(created.find((thread) => thread.id === "fresh-claude")?.cliBackend).toBe("claude");
  });

  test("rename preserves an existing Pi or Grok backend on the renamed entry", () => {
    const renamedPi = renameThreadAcrossCatalogs(
      [],
      [{ id: "pi-thread", cliBackend: "pi" }],
      "pi-thread",
      "My Pi task",
      "pi"
    );
    expect(renamedPi.find((thread) => thread.id === "pi-thread")?.cliBackend).toBe("pi");

    const renamedGrok = renameThreadAcrossCatalogs(
      [],
      [{ id: "grok-thread", cliBackend: "grok" }],
      "grok-thread",
      "My Grok task",
      "grok"
    );
    expect(renamedGrok.find((thread) => thread.id === "grok-thread")?.cliBackend).toBe("grok");
  });

  test("rename on a thread absent from the catalog carries Pi and Grok backends", () => {
    const createdPi = renameThreadAcrossCatalogs([], [], "fresh-pi", "Fresh Pi", "pi");
    expect(createdPi.find((thread) => thread.id === "fresh-pi")?.cliBackend).toBe("pi");

    const createdGrok = renameThreadAcrossCatalogs([], [], "fresh-grok", "Fresh Grok", "grok");
    expect(createdGrok.find((thread) => thread.id === "fresh-grok")?.cliBackend).toBe("grok");
  });

  test("rename preserves an existing OpenCode backend on the renamed entry", () => {
    const renamedOpencode = renameThreadAcrossCatalogs(
      [],
      [{ id: "opencode-thread", cliBackend: "opencode" }],
      "opencode-thread",
      "My OpenCode task",
      "opencode"
    );
    expect(renamedOpencode.find((thread) => thread.id === "opencode-thread")?.cliBackend).toBe("opencode");
  });

  test("rename on a thread absent from the catalog carries OpenCode backend", () => {
    const createdOpencode = renameThreadAcrossCatalogs([], [], "fresh-opencode", "Fresh OpenCode", "opencode");
    expect(createdOpencode.find((thread) => thread.id === "fresh-opencode")?.cliBackend).toBe("opencode");
  });

  test("normalizeThreads preserves additionalRoots", () => {
    const threads = normalizeThreads([
      { id: "thread-1", cwd: "D:/workspace", additionalRoots: ["D:/extra1", "D:/extra2"] }
    ]);
    expect(threads[0]?.additionalRoots).toEqual(["D:/extra1", "D:/extra2"]);
  });

  test("failed thread/list results cannot clear the existing catalog", () => {
    const current = [{ id: "thread-a" }, { id: "thread-b" }];
    expect(mergeSuccessfulThreadList(null, current, new Set())).toBeNull();
    expect(mergeSuccessfulThreadList([], current, new Set())).toEqual([]);
  });
});

describe("normalizeCliBackend and normalizeThreadCliBackend", () => {
  test("normalizeCliBackend preserves all known backends including pi and grok", () => {
    expect(normalizeCliBackend("pi")).toBe("pi");
    expect(normalizeCliBackend("grok")).toBe("grok");
    expect(normalizeCliBackend("claude")).toBe("claude");
    expect(normalizeCliBackend("auggie")).toBe("auggie");
    expect(normalizeCliBackend("agy")).toBe("agy");
    expect(normalizeCliBackend("opencode")).toBe("opencode");
    expect(normalizeCliBackend("mini")).toBe("mini");
    expect(normalizeCliBackend("codex")).toBe("codex");

    // Unrecognized or missing backends return undefined (treated as Codex)
    expect(normalizeCliBackend(undefined)).toBeUndefined();
    expect(normalizeCliBackend(null)).toBeUndefined();
    expect(normalizeCliBackend("")).toBeUndefined();
    expect(normalizeCliBackend("unknown")).toBeUndefined();
  });

  test("normalizeThreadCliBackend resolves all backends and defaults unknown to mini", () => {
    expect(normalizeThreadCliBackend("pi")).toBe("pi");
    expect(normalizeThreadCliBackend("grok")).toBe("grok");
    expect(normalizeThreadCliBackend("claude")).toBe("claude");
    expect(normalizeThreadCliBackend("openclaude")).toBe("mini");
    expect(normalizeThreadCliBackend("auggie")).toBe("auggie");
    expect(normalizeThreadCliBackend("agy")).toBe("agy");
    expect(normalizeThreadCliBackend("opencode")).toBe("opencode");
    expect(normalizeThreadCliBackend("mini")).toBe("mini");
    expect(normalizeThreadCliBackend("codex")).toBe("codex");

    expect(normalizeThreadCliBackend(undefined)).toBe("mini");
    expect(normalizeThreadCliBackend(null)).toBe("mini");
    expect(normalizeThreadCliBackend("something-else")).toBe("mini");

    expect(isPiCliBackend("pi")).toBe(true);
    expect(isPiCliBackend("codex")).toBe(false);
    expect(isGrokCliBackend("grok")).toBe(true);
    expect(isGrokCliBackend("pi")).toBe(false);
  });
});

import { expect, test } from "bun:test";
import {
  DEFAULT_RUNTIME_SELECTION,
  NEW_CONVERSATION_SELECTION_KEY,
  applyPersistedThreadRuntimeSelection,
  applyThreadRuntimeSelectionPatch,
  defaultHistorySelection,
  enqueueLatestThreadRuntimePersistence,
  mergePersistedRuntimeRouteSelection,
  mergeHydratedThreadRuntimeSelections,
  parseThreadRuntimeSelections,
  threadRuntimeSelectionsForPreferences
} from "../../apps/web/src/app/runtime/useThreadRuntimeSelections";
import { shouldRefreshFreeCompactionModels } from "../../frontends/free-mode/src/free/freeCompactionReadiness";

test("history fallback does not inherit new-conversation reasoning effort", () => {
  const parsed = parseThreadRuntimeSelections({
    [NEW_CONVERSATION_SELECTION_KEY]: {
      ...DEFAULT_RUNTIME_SELECTION,
      reasoningEffort: "minimal"
    }
  });

  expect(parsed[NEW_CONVERSATION_SELECTION_KEY]?.reasoningEffort).toBe("minimal");
  expect(defaultHistorySelection().reasoningEffort).toBe("medium");
});

test("persisted thread reasoning efforts remain isolated", () => {
  const parsed = parseThreadRuntimeSelections({
    "thread-a": { ...DEFAULT_RUNTIME_SELECTION, reasoningEffort: "high" },
    "thread-c": { ...DEFAULT_RUNTIME_SELECTION, reasoningEffort: "minimal" }
  });

  expect(parsed["thread-a"]?.reasoningEffort).toBe("high");
  expect(parsed["thread-c"]?.reasoningEffort).toBe("minimal");
});

test("fast and plan modes remain isolated by thread", () => {
  const parsed = parseThreadRuntimeSelections({
    "thread-a": { ...DEFAULT_RUNTIME_SELECTION, fastModeEnabled: true, planModeEnabled: false },
    "thread-b": { ...DEFAULT_RUNTIME_SELECTION, fastModeEnabled: false, planModeEnabled: true }
  });

  expect(parsed["thread-a"]).toMatchObject({ fastModeEnabled: true, planModeEnabled: false });
  expect(parsed["thread-b"]).toMatchObject({ fastModeEnabled: false, planModeEnabled: true });
});

test("new-conversation preferences never retain VM state", () => {
  const selections = parseThreadRuntimeSelections({
    [NEW_CONVERSATION_SELECTION_KEY]: {
      ...DEFAULT_RUNTIME_SELECTION,
      providerId: "relay-default",
      model: "model-default",
      vmEnabled: true,
      vmPolicy: { fs: { salaRoot: "E:/custom/sala" } }
    },
    "thread-a": {
      ...DEFAULT_RUNTIME_SELECTION,
      providerId: "relay-a",
      model: "model-a",
      freeAutoCompactEnabled: true
    }
  });

  expect(selections[NEW_CONVERSATION_SELECTION_KEY]).toMatchObject({ vmEnabled: false, vmPolicy: undefined });
  expect(threadRuntimeSelectionsForPreferences(selections)[NEW_CONVERSATION_SELECTION_KEY]).toMatchObject({ vmEnabled: false, vmPolicy: undefined });
  expect(selections["thread-a"]?.freeAutoCompactEnabled).toBe(true);
});

test("free auto-compaction preferences stay isolated by thread", () => {
  const parsed = parseThreadRuntimeSelections({
    "thread-a": {
      ...DEFAULT_RUNTIME_SELECTION,
      freeAutoCompactEnabled: true,
      freeAutoCompactThreshold: 68,
      freeAutoCompactProviderId: "relay-a",
      freeAutoCompactGroupId: "group-a",
      freeAutoCompactModel: "compact-a"
    },
    "thread-b": {
      ...DEFAULT_RUNTIME_SELECTION,
      freeAutoCompactEnabled: false,
      freeAutoCompactThreshold: 92,
      freeAutoCompactProviderId: "relay-b",
      freeAutoCompactGroupId: "group-b",
      freeAutoCompactModel: "compact-b"
    }
  });

  expect(parsed["thread-a"]).toMatchObject({
    freeAutoCompactEnabled: true,
    freeAutoCompactThreshold: 68,
    freeAutoCompactProviderId: "relay-a",
    freeAutoCompactGroupId: "group-a",
    freeAutoCompactModel: "compact-a"
  });
  expect(parsed["thread-b"]).toMatchObject({
    freeAutoCompactEnabled: false,
    freeAutoCompactThreshold: 92,
    freeAutoCompactProviderId: "relay-b",
    freeAutoCompactGroupId: "group-b",
    freeAutoCompactModel: "compact-b"
  });
});

test("enabled free compaction refreshes only the transient managed free route", () => {
  expect(shouldRefreshFreeCompactionModels(true, null)).toBe(true);
  expect(shouldRefreshFreeCompactionModels(true, "omniroute-free")).toBe(true);
  expect(shouldRefreshFreeCompactionModels(true, "custom-free-relay")).toBe(false);
  expect(shouldRefreshFreeCompactionModels(false, "omniroute-free")).toBe(false);
  expect(shouldRefreshFreeCompactionModels(true, null, "provider-missing")).toBe(true);
  expect(shouldRefreshFreeCompactionModels(true, null, "manual-model-unavailable")).toBe(true);
});

test("legacy per-thread manual free models migrate to the original free route", () => {
  const parsed = parseThreadRuntimeSelections({
    "thread-legacy": {
      ...DEFAULT_RUNTIME_SELECTION,
      freeAutoCompactEnabled: true,
      freeAutoCompactModel: "mimo-v2.5-free"
    }
  });

  expect(parsed["thread-legacy"]).toMatchObject({
    freeAutoCompactEnabled: true,
    freeAutoCompactProviderId: "omniroute-free",
    freeAutoCompactGroupId: "opencode-free",
    freeAutoCompactModel: "mimo-v2.5-free"
  });
});

test("relay, model, and reasoning changes stay isolated while switching threads", () => {
  let selections = parseThreadRuntimeSelections({
    "thread-a": { ...DEFAULT_RUNTIME_SELECTION, providerId: "relay-a", groupId: "group-a", model: "model-a", reasoningEffort: "high" },
    "thread-b": { ...DEFAULT_RUNTIME_SELECTION, providerId: "relay-b", groupId: "group-b", model: "model-b", reasoningEffort: "low" }
  });
  let revisions: Record<string, number> = {};

  ({ selections, revisions } = applyThreadRuntimeSelectionPatch(selections, revisions, "thread-a", {
    providerId: "relay-c",
    groupId: "group-c",
    model: "model-c",
    reasoningEffort: "minimal"
  }));

  expect(selections["thread-a"]).toMatchObject({
    providerId: "relay-c",
    groupId: "group-c",
    model: "model-c",
    reasoningEffort: "minimal"
  });
  expect(selections["thread-b"]).toMatchObject({
    providerId: "relay-b",
    groupId: "group-b",
    model: "model-b",
    reasoningEffort: "low"
  });
  expect(revisions).toEqual({ "thread-a": 1 });
});

test("persisted route metadata keeps the history fallback when fields are empty", () => {
  const fallback = { providerId: "relay-history", groupId: "group-history", model: "model-history" };

  expect(mergePersistedRuntimeRouteSelection(fallback, {
    providerId: null,
    groupId: "",
    model: ""
  })).toEqual(fallback);
  expect(mergePersistedRuntimeRouteSelection(fallback, {
    providerId: "relay-new",
    groupId: "group-new",
    model: "model-new"
  })).toEqual({ providerId: "relay-new", groupId: "group-new", model: "model-new" });
});

test("late preference and metadata snapshots cannot overwrite a user selection", () => {
  const oldSelection = {
    ...DEFAULT_RUNTIME_SELECTION,
    providerId: "old-relay",
    groupId: "old-group",
    model: "old-model",
    reasoningEffort: "high"
  };
  let selections = { "thread-a": oldSelection };
  let revisions: Record<string, number> = {};
  const requestRevision = revisions["thread-a"] ?? 0;

  ({ selections, revisions } = applyThreadRuntimeSelectionPatch(selections, revisions, "thread-a", {
    providerId: "new-relay",
    groupId: "new-group",
    model: "new-model",
    reasoningEffort: "minimal"
  }));

  const hydrated = mergeHydratedThreadRuntimeSelections(selections, { "thread-a": oldSelection }, revisions);
  const afterLateMetadata = applyPersistedThreadRuntimeSelection(
    hydrated,
    revisions,
    "thread-a",
    requestRevision,
    oldSelection,
    true
  );

  expect(afterLateMetadata["thread-a"]).toMatchObject({
    providerId: "new-relay",
    groupId: "new-group",
    model: "new-model",
    reasoningEffort: "minimal"
  });
});

test("new-conversation selection is copied to its real thread without affecting other threads", () => {
  const newConversation = {
    ...DEFAULT_RUNTIME_SELECTION,
    providerId: "relay-new",
    groupId: "group-new",
    model: "model-new",
    reasoningEffort: "minimal"
  };
  let selections = {
    [NEW_CONVERSATION_SELECTION_KEY]: newConversation,
    "thread-b": { ...DEFAULT_RUNTIME_SELECTION, model: "model-b", reasoningEffort: "high" }
  };
  let revisions: Record<string, number> = {};

  ({ selections, revisions } = applyThreadRuntimeSelectionPatch(
    selections,
    revisions,
    "thread-created",
    newConversation
  ));

  expect(selections["thread-created"]).toMatchObject(newConversation);
  expect(selections["thread-b"]).toMatchObject({ model: "model-b", reasoningEffort: "high" });
  expect(revisions["thread-created"]).toBe(1);
});

test("immediate per-thread persistence queues keep the latest isolated runtime selection", async () => {
  const queues = new Map<string, Promise<void>>();
  let selections = {
    "thread-a": { ...DEFAULT_RUNTIME_SELECTION, providerId: "relay-a", groupId: "group-a", model: "model-a", reasoningEffort: "medium", cliBackend: "claude" as const, fastModeEnabled: true },
    "thread-b": { ...DEFAULT_RUNTIME_SELECTION, providerId: "relay-b", groupId: "group-b", model: "model-b", reasoningEffort: "low", planModeEnabled: true }
  };
  const writes: Array<{ threadId: string; providerId: string | null; groupId: string | null; model: string; reasoningEffort: string; cliBackend: string; fastModeEnabled: boolean; planModeEnabled: boolean }> = [];
  let releaseFirstWrite = () => undefined;
  const firstWriteBlocked = new Promise<void>((resolve) => {
    releaseFirstWrite = resolve;
  });
  let writeCount = 0;
  const persist = async ({ selection }: { selection: typeof selections[string] & { threadId: string } }) => {
    writeCount += 1;
    if (writeCount === 1) await firstWriteBlocked;
    writes.push({
      threadId: selection.threadId,
      providerId: selection.providerId,
      groupId: selection.groupId,
      model: selection.model,
      reasoningEffort: selection.reasoningEffort,
      cliBackend: selection.cliBackend,
      fastModeEnabled: selection.fastModeEnabled,
      planModeEnabled: selection.planModeEnabled
    });
  };
  const enqueue = (threadId: string) => enqueueLatestThreadRuntimePersistence(
    queues,
    threadId,
    () => ({ token: "test", selection: { threadId, ...selections[threadId]! } }),
    persist
  );

  const first = enqueue("thread-a");
  await Promise.resolve();
  selections = {
    ...selections,
    "thread-a": { ...selections["thread-a"], model: "model-a2", reasoningEffort: "high" }
  };
  const second = enqueue("thread-a");
  const otherThread = enqueue("thread-b");
  releaseFirstWrite();
  await Promise.all([first, second, otherThread]);

  expect(writes.filter((write) => write.threadId === "thread-a").at(-1)).toEqual({
    threadId: "thread-a",
    providerId: "relay-a",
    groupId: "group-a",
    model: "model-a2",
    reasoningEffort: "high",
    cliBackend: "claude",
    fastModeEnabled: true,
    planModeEnabled: false
  });
  expect(writes.find((write) => write.threadId === "thread-b")).toEqual({
    threadId: "thread-b",
    providerId: "relay-b",
    groupId: "group-b",
    model: "model-b",
    reasoningEffort: "low",
    cliBackend: "mini",
    fastModeEnabled: false,
    planModeEnabled: true
  });
  expect(queues.size).toBe(0);
});

test("preserves all CLI backends across parse and patch with custom relays", () => {
  const parsed = parseThreadRuntimeSelections({
    "thread-agy": { ...DEFAULT_RUNTIME_SELECTION, cliBackend: "agy", providerId: "jiji-relay", model: "gpt-4o" },
    "thread-grok": { ...DEFAULT_RUNTIME_SELECTION, cliBackend: "grok", providerId: "deepkey-relay", model: "grok-4.6" },
    "thread-pi": { ...DEFAULT_RUNTIME_SELECTION, cliBackend: "pi", providerId: "custom-relay", model: "claude-3-5" },
    "thread-opencode": { ...DEFAULT_RUNTIME_SELECTION, cliBackend: "opencode", providerId: "opencode-local", model: "gpt-5.6" }
  });

  expect(parsed["thread-agy"]?.cliBackend).toBe("agy");
  expect(parsed["thread-grok"]?.cliBackend).toBe("grok");
  expect(parsed["thread-pi"]?.cliBackend).toBe("pi");
  expect(parsed["thread-opencode"]?.cliBackend).toBe("opencode");

  // When patching provider on an existing AGY thread, cliBackend is preserved
  const patched = applyThreadRuntimeSelectionPatch(
    parsed,
    {},
    "thread-agy",
    { providerId: "new-relay", groupId: "default", model: "gemini-2.5-pro", cliBackend: parsed["thread-agy"]!.cliBackend }
  );
  expect(patched.selections["thread-agy"]?.cliBackend).toBe("agy");
  expect(patched.selections["thread-agy"]?.providerId).toBe("new-relay");
  expect(patched.selections["thread-agy"]?.model).toBe("gemini-2.5-pro");
});

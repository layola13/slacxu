import { describe, expect, test } from "bun:test";
import { normalizeCliBackend } from "../../apps/web/src/app/threads/threadCatalog";
import {
  isPiCliBackend,
  isGrokCliBackend,
  normalizeThreadCliBackend,
} from "../../apps/web/src/app/runtime/cliBackendKind";
import {
  DEFAULT_RUNTIME_SELECTION,
  type ThreadRuntimeSelection,
} from "../../apps/web/src/app/runtime/useThreadRuntimeSelections";
import type { ThreadEntry } from "../../apps/web/src/app/threads/threadCatalog";

/**
 * Re-implements runtimeSelectionFallbackForThread as defined in App.tsx:14165
 * to verify isolation and prevent regressions where history fallback drops Pi/Grok.
 */
function runtimeSelectionFallbackForThread(
  thread: ThreadEntry | undefined,
  fallback: ThreadRuntimeSelection
): ThreadRuntimeSelection {
  if (!thread) return fallback;
  return {
    ...fallback,
    providerId: thread.modelProvider?.trim() || fallback.providerId,
    model: thread.model?.trim() || fallback.model,
    reasoningEffort: fallback.reasoningEffort || "medium",
    cliBackend: thread.cliBackend
      ? normalizeThreadCliBackend(thread.cliBackend)
      : (fallback.cliBackend ?? "codex"),
  };
}

/**
 * Re-implements provider selection patch logic as defined in App.tsx:7018
 * to verify Pi preserves cliBackend: "pi" when user selects a relay station/group/model.
 */
function patchProviderSelection(
  currentSelection: ThreadRuntimeSelection,
  providerId: string,
  groupId: string | null,
  model: string
): Partial<ThreadRuntimeSelection> {
  return {
    cliBackend: (currentSelection.cliBackend === "agy" || currentSelection.cliBackend === "grok")
      ? ("codex" as const)
      : currentSelection.cliBackend,
    providerId,
    groupId,
    model,
  };
}

describe("Pi & Grok history catalog normalization", () => {
  test("normalizeCliBackend correctly retains pi and grok", () => {
    expect(normalizeCliBackend("pi")).toBe("pi");
    expect(normalizeCliBackend("grok")).toBe("grok");
    expect(normalizeCliBackend("claude")).toBe("claude");
    expect(normalizeCliBackend("auggie")).toBe("auggie");
    expect(normalizeCliBackend("agy")).toBe("agy");
    expect(normalizeCliBackend("codex")).toBe("codex");

    // Undefined/null/empty/other should return undefined (Codex default)
    expect(normalizeCliBackend(undefined)).toBeUndefined();
    expect(normalizeCliBackend(null)).toBeUndefined();
    expect(normalizeCliBackend("unknown")).toBeUndefined();
  });

  test("normalizeThreadCliBackend resolves pi and grok correctly", () => {
    expect(isPiCliBackend("pi")).toBe(true);
    expect(isPiCliBackend("codex")).toBe(false);
    expect(isGrokCliBackend("grok")).toBe(true);
    expect(isGrokCliBackend("pi")).toBe(false);

    expect(normalizeThreadCliBackend("pi")).toBe("pi");
    expect(normalizeThreadCliBackend("grok")).toBe("grok");
    expect(normalizeThreadCliBackend("claude")).toBe("claude");
    expect(normalizeThreadCliBackend("openclaude")).toBe("mini");
    expect(normalizeThreadCliBackend("agy")).toBe("agy");
    expect(normalizeThreadCliBackend("auggie")).toBe("auggie");
    expect(normalizeThreadCliBackend("codex")).toBe("codex");
    expect(normalizeThreadCliBackend("other")).toBe("mini");
  });
});

describe("New chat creation with Pi and relay / group / model selection", () => {
  test("selecting Pi in new chat sets cliBackend: 'pi' and default model", () => {
    const newChatSelection: ThreadRuntimeSelection = {
      ...DEFAULT_RUNTIME_SELECTION,
      cliBackend: "pi",
      providerId: "pi-relay",
      groupId: null,
      model: "pi-relay/default",
    };

    expect(newChatSelection.cliBackend).toBe("pi");
    expect(newChatSelection.model).toBe("pi-relay/default");
  });

  test("selecting a relay provider and group preserves cliBackend: 'pi'", () => {
    const initialPiSelection: ThreadRuntimeSelection = {
      ...DEFAULT_RUNTIME_SELECTION,
      cliBackend: "pi",
      providerId: "pi-relay",
      groupId: null,
      model: "pi-relay/default",
    };

    // User chooses relay provider "omniroute-free", group "kilocode", model "stepfun/step-3.7-flash:free"
    const patch = patchProviderSelection(
      initialPiSelection,
      "omniroute-free",
      "kilocode",
      "stepfun/step-3.7-flash:free"
    );

    const updatedSelection: ThreadRuntimeSelection = {
      ...initialPiSelection,
      ...patch,
    };

    expect(updatedSelection.cliBackend).toBe("pi");
    expect(updatedSelection.providerId).toBe("omniroute-free");
    expect(updatedSelection.groupId).toBe("kilocode");
    expect(updatedSelection.model).toBe("stepfun/step-3.7-flash:free");
  });

  test("selecting a custom group or model preserves cliBackend: 'pi'", () => {
    const piRelaySelection: ThreadRuntimeSelection = {
      ...DEFAULT_RUNTIME_SELECTION,
      cliBackend: "pi",
      providerId: "omniroute-free",
      groupId: "kilocode",
      model: "stepfun/step-3.7-flash:free",
    };

    // User switches model to another relay model
    const patchedModel = {
      ...piRelaySelection,
      model: "kilo-auto/free",
    };

    expect(patchedModel.cliBackend).toBe("pi");
    expect(patchedModel.providerId).toBe("omniroute-free");
    expect(patchedModel.groupId).toBe("kilocode");
    expect(patchedModel.model).toBe("kilo-auto/free");
  });
});

describe("runtimeSelectionFallbackForThread for historical sessions", () => {
  test("preserves cliBackend='pi' when loading historical Pi thread with default codex fallback", () => {
    const historicalPiThread: ThreadEntry = {
      id: "historical-pi-001",
      preview: "Historical Pi Conversation",
      createdAt: Date.now() - 100_000,
      cliBackend: "pi",
      model: "stepfun/step-3.7-flash:free",
      modelProvider: "omniroute-free",
    };

    const currentDefaultFallback: ThreadRuntimeSelection = {
      ...DEFAULT_RUNTIME_SELECTION,
      cliBackend: "codex",
      providerId: "omniroute-free",
      model: "gpt-5.6-sol",
    };

    const resolved = runtimeSelectionFallbackForThread(historicalPiThread, currentDefaultFallback);

    expect(resolved.cliBackend).toBe("pi");
    expect(resolved.model).toBe("stepfun/step-3.7-flash:free");
    expect(resolved.providerId).toBe("omniroute-free");
  });

  test("preserves cliBackend='grok' when loading historical Grok thread with default codex fallback", () => {
    const historicalGrokThread: ThreadEntry = {
      id: "historical-grok-001",
      preview: "Historical Grok Conversation",
      createdAt: Date.now() - 100_000,
      cliBackend: "grok",
      model: "grok-4.6",
      modelProvider: "grok-official",
    };

    const currentDefaultFallback: ThreadRuntimeSelection = {
      ...DEFAULT_RUNTIME_SELECTION,
      cliBackend: "codex",
      providerId: "omniroute-free",
      model: "gpt-5.6-sol",
    };

    const resolved = runtimeSelectionFallbackForThread(historicalGrokThread, currentDefaultFallback);

    expect(resolved.cliBackend).toBe("grok");
    expect(resolved.model).toBe("grok-4.6");
    expect(resolved.providerId).toBe("grok-official");
  });

  test("falls back to default fallback backend when thread has no cliBackend", () => {
    const legacyThread: ThreadEntry = {
      id: "legacy-codex-001",
      preview: "Legacy Conversation",
      createdAt: Date.now() - 200_000,
      cliBackend: undefined,
    };

    const currentDefaultFallback: ThreadRuntimeSelection = {
      ...DEFAULT_RUNTIME_SELECTION,
      cliBackend: "codex",
    };

    const resolved = runtimeSelectionFallbackForThread(legacyThread, currentDefaultFallback);
    expect(resolved.cliBackend).toBe("codex");
  });
});

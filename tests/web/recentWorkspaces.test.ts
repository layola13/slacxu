import { describe, expect, test, beforeEach } from "bun:test";
import {
  normalizeWorkspacePathKey,
  loadRecentWorkspaces,
  saveRecentWorkspaces,
  recordRecentWorkspace,
  removeRecentWorkspace,
  clearRecentWorkspaces,
  loadWorkspaceVmPolicy,
  saveWorkspaceVmPolicy,
  createSaVmPolicyWithIdeTools
} from "../../apps/web/src/utils/recentWorkspaces";
import { createDefaultSaVmPolicyConfig } from "@codex-ui/shared";

// Mock localStorage for test environment
const store = new Map<string, string>();
globalThis.localStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, val: string) => { store.set(key, val); },
  removeItem: (key: string) => { store.delete(key); },
  clear: () => { store.clear(); },
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() { return store.size; }
} as unknown as Storage;

// Mock window for dispatchEvent
if (typeof globalThis.window === "undefined") {
  (globalThis as any).window = {
    dispatchEvent: () => true
  };
}

describe("recentWorkspaces", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test("normalizeWorkspacePathKey normalizes slashes and case", () => {
    expect(normalizeWorkspacePathKey("D:\\projects\\codex-ultra")).toBe("d:/projects/codex-ultra");
    expect(normalizeWorkspacePathKey("D:/projects/codex-ultra/")).toBe("d:/projects/codex-ultra");
    expect(normalizeWorkspacePathKey("  /home/user/code/  ")).toBe("/home/user/code");
  });

  test("records, deduplicates and orders recent workspaces", () => {
    recordRecentWorkspace("D:\\project1", "local");
    recordRecentWorkspace("D:\\project2", "local");
    recordRecentWorkspace("D:\\project1", "local");

    const items = loadRecentWorkspaces();
    expect(items.length).toBe(2);
    expect(items[0]?.path).toBe("D:\\project1");
    expect(items[1]?.path).toBe("D:\\project2");
  });

  test("removes and clears recent workspaces", () => {
    recordRecentWorkspace("D:\\projA", "local");
    recordRecentWorkspace("D:\\projB", "local");
    expect(loadRecentWorkspaces().length).toBe(2);

    removeRecentWorkspace("d:/proja", "local");
    expect(loadRecentWorkspaces().length).toBe(1);
    expect(loadRecentWorkspaces()[0]?.path).toBe("D:\\projB");

    clearRecentWorkspaces();
    expect(loadRecentWorkspaces().length).toBe(0);
  });

  test("supports SSH workspace records with sshCommand", () => {
    recordRecentWorkspace("/remote/path", "ssh", "ssh user@host");
    const items = loadRecentWorkspaces();
    expect(items[0]?.mode).toBe("ssh");
    expect(items[0]?.sshCommand).toBe("ssh user@host");
  });

  test("load and save workspace VM policy", () => {
    const policy = createSaVmPolicyWithIdeTools();
    saveWorkspaceVmPolicy("D:\\my-project", true, policy);

    const loaded = loadWorkspaceVmPolicy("D:/my-project/");
    expect(loaded).not.toBeNull();
    expect(loaded?.vmEnabled).toBe(true);
    expect(loaded?.vmPolicy.tools?.fileOutline).toBe(true);
    expect(loaded?.vmPolicy.tools?.findDefinition).toBe(true);
    expect(loaded?.vmPolicy.tools?.renameSymbol).toBe(true);
  });

  test("createSaVmPolicyWithIdeTools enables all 7 IDE tools and search/prune tools", () => {
    const policy = createSaVmPolicyWithIdeTools();
    expect(policy.tools?.fileOutline).toBe(true);
    expect(policy.tools?.findDefinition).toBe(true);
    expect(policy.tools?.renameSymbol).toBe(true);
    expect(policy.tools?.moveWithImports).toBe(true);
    expect(policy.tools?.extractToFile).toBe(true);
    expect(policy.tools?.addImport).toBe(true);
    expect(policy.tools?.getDiagnostics).toBe(true);
    expect(policy.tools?.findReferences).toBe(true);
    expect(policy.tools?.clearToolHistory).toBe(true);
  });
});

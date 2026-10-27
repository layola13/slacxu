import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  extractMiniEffort,
  miniSubagentMaxChildren,
  normalizeMiniEffort,
  validateMiniPlanSteps,
} from "../../backends/mini/src/runtime/miniBridge.ts";
import { resolveMiniUserInput } from "../../backends/mini/src/runtime/miniInput.ts";
import { MiniSessionStore } from "../../backends/mini/src/runtime/miniSessionStore.ts";
import type { RuntimeDatabase } from "../../apps/server/src/runtime/database.ts";

const SAVED_ENV = { ...process.env };
afterEach(() => {
  process.env = { ...SAVED_ENV };
});

describe("normalizeMiniEffort", () => {
  test("accepts canonical and alias spellings", () => {
    expect(normalizeMiniEffort("high")).toBe("high");
    expect(normalizeMiniEffort(" XHigh ")).toBe("xhigh");
    expect(normalizeMiniEffort("extra-high")).toBe("xhigh");
    expect(normalizeMiniEffort("x-high")).toBe("xhigh");
    expect(normalizeMiniEffort("none")).toBe("none");
  });

  test("rejects junk", () => {
    expect(normalizeMiniEffort(undefined)).toBeUndefined();
    expect(normalizeMiniEffort(42)).toBeUndefined();
    expect(normalizeMiniEffort("")).toBeUndefined();
    expect(normalizeMiniEffort("has space")).toBeUndefined();
    expect(normalizeMiniEffort("a".repeat(65))).toBeUndefined();
  });
});

describe("extractMiniEffort", () => {
  test("reads direct keys in priority order", () => {
    expect(extractMiniEffort({ effort: "low" })).toBe("low");
    expect(extractMiniEffort({ reasoningEffort: "high", effort: "low" })).toBe("low");
    expect(extractMiniEffort({ reasoning_effort: "medium" })).toBe("medium");
    expect(extractMiniEffort({ model_reasoning_effort: "xhigh" })).toBe("xhigh");
  });

  test("reads nested collaborationMode", () => {
    expect(extractMiniEffort({ collaborationMode: { effort: "high" } })).toBe("high");
    expect(extractMiniEffort({ collaborationMode: { reasoning_effort: "low" } })).toBe("low");
    expect(extractMiniEffort({ collaborationMode: {} })).toBeUndefined();
    expect(extractMiniEffort({})).toBeUndefined();
  });
});

describe("miniSubagentMaxChildren", () => {
  test("defaults to 5 and clamps env overrides", () => {
    delete process.env.MINI_SUBAGENT_MAX_CHILDREN;
    expect(miniSubagentMaxChildren()).toBe(5);
    process.env.MINI_SUBAGENT_MAX_CHILDREN = "3";
    expect(miniSubagentMaxChildren()).toBe(3);
    process.env.MINI_SUBAGENT_MAX_CHILDREN = "99";
    expect(miniSubagentMaxChildren()).toBe(32);
    process.env.MINI_SUBAGENT_MAX_CHILDREN = "junk";
    expect(miniSubagentMaxChildren()).toBe(5);
  });
});

describe("resolveMiniUserInput", () => {
  test("joins text blocks and falls back to prompt", async () => {
    const blocks = await resolveMiniUserInput([
      { type: "text", text: "hello" },
      { type: "input_text", text: "world" },
      { type: "unknown", text: "skipped" },
      null,
    ]);
    expect(blocks.text).toBe("hello\nworld");
    expect(blocks.images).toEqual([]);
    expect(blocks.content.length).toBe(2);
    const fallback = await resolveMiniUserInput([], "plain prompt");
    expect(fallback.text).toBe("plain prompt");
    expect(await resolveMiniUserInput(undefined)).toEqual({ text: "", images: [], content: [] });
  });

  test("resolves image url variants", async () => {
    const resolved = await resolveMiniUserInput([
      { type: "input_image", url: "data:image/png;base64,AAA" },
      { type: "image", image_url: { url: "data:image/png;base64,BBB" }, detail: "high" },
    ]);
    expect(resolved.images.length).toBe(2);
    expect(resolved.images[1]?.detail).toBe("high");
    expect(resolved.images[0]?.detail).toBe("auto");
  });

  test("skips missing local images without failing", async () => {
    const resolved = await resolveMiniUserInput(
      [{ type: "localimage", path: "/definitely/not/here.png" }],
      undefined,
      process.cwd(),
    );
    expect(resolved.images).toEqual([]);
    expect(resolved.text).toBe("");
  });
});

describe("validateMiniPlanSteps", () => {
  test("accepts one active step and completed plans", () => {
    expect(validateMiniPlanSteps([
      { step: "inspect", status: "completed" },
      { step: "edit", status: "in_progress" },
      { step: "verify", status: "pending" },
    ])).toBeNull();
    expect(validateMiniPlanSteps([{ step: "done", status: "completed" }])).toBeNull();
  });

  test("rejects multiple active steps", () => {
    expect(validateMiniPlanSteps([
      { step: "inspect", status: "in_progress" },
      { step: "edit", status: "in_progress" },
    ])).toContain("only one step");
  });
});

describe("MiniSessionStore", () => {
  function openStore(): { db: Database; store: MiniSessionStore } {
    const db = new Database(":memory:");
    return { db, store: new MiniSessionStore(db as unknown as RuntimeDatabase) };
  }

  test("upsert/get round-trips and merges on conflict", () => {
    const { db, store } = openStore();
    try {
      store.upsert({ threadId: "t1", ownerId: "u1", model: "m", cwd: "/w", stateJson: "{}" });
      expect(store.get("u1", "t1")?.model).toBe("m");
      store.upsert({ threadId: "t1", ownerId: "u1", stateJson: '{"a":1}' });
      const merged = store.get("u1", "t1");
      // Undefined fields do not clobber previously stored values.
      expect(merged?.model).toBe("m");
      expect(merged?.stateJson).toBe('{"a":1}');
      expect(store.get("u1", "missing")).toBeNull();
      expect(store.findByThreadId("t1")?.ownerId).toBe("u1");
      expect(store.listByOwner("u1").length).toBe(1);
      expect(store.listAll().length).toBe(1);
      store.delete("u1", "t1");
      expect(store.get("u1", "t1")).toBeNull();
    } finally {
      db.close();
    }
  });
});

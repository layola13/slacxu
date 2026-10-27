import { describe, expect, test } from "bun:test";
import { MiniModelHistoryCache } from "../../backends/mini/src/runtime/miniModelHistory.ts";

type WireItem = Record<string, unknown>;
const messages = [{ role: "user", content: "read file" }, { role: "assistant", content: "done" }];
const key = JSON.stringify({ route: "chat", model: "mini", system: "system-v1" });
const chatItems: WireItem[] = [
  { role: "user", content: "read file" },
  { role: "assistant", content: null, tool_calls: [{ id: "call-1", type: "function", function: { name: "read_file", arguments: '{"path":"a.ts"}' } }] },
  { role: "tool", tool_call_id: "call-1", content: "exact tool output\n" },
  { role: "assistant", content: "done" },
];

function seed(cache: MiniModelHistoryCache, session: object, items = chatItems): void {
  expect(cache.set(session, key, messages, items, 100_000)).toBe(true);
}

describe("MiniModelHistoryCache", () => {
  test("preserves the exact chat wire prefix without synthesizing system or recap items", () => {
    const cache = new MiniModelHistoryCache();
    const session = {};
    seed(cache, session);
    const prefix = cache.get(session, key, messages);
    expect(prefix).toEqual(chatItems);
    expect(JSON.stringify(prefix)).toBe(JSON.stringify(chatItems));
    expect([...(prefix ?? []), { role: "user", content: "next" }].slice(0, chatItems.length)).toEqual(chatItems);
  });

  test("preserves full Responses input including reasoning and tool output", () => {
    const cache = new MiniModelHistoryCache();
    const session = {};
    const items: WireItem[] = [
      { role: "developer", content: "system-v1" },
      { role: "user", content: [{ type: "input_text", text: "read file" }] },
      { type: "reasoning", id: "reason-1", encrypted_content: "opaque", summary: [] },
      { type: "function_call", call_id: "call-1", name: "read_file", arguments: '{"path":"a.ts"}' },
      { type: "function_call_output", call_id: "call-1", output: "exact tool output\n" },
      { type: "message", role: "assistant", content: [{ type: "output_text", text: "done", annotations: [] }] },
    ];
    const responsesKey = JSON.stringify({ route: "responses", system: "system-v1" });
    expect(cache.set(session, responsesKey, messages, items, 100_000)).toBe(true);
    expect(cache.get(session, responsesKey, messages)).toEqual(items);
    expect(JSON.stringify(cache.get(session, responsesKey, messages))).not.toContain("previous_response_id");
  });

  test("deep copies both writes and reads", () => {
    const cache = new MiniModelHistoryCache();
    const session = {};
    const items = [{ role: "assistant", content: [{ type: "output_text", text: "original" }] }];
    seed(cache, session, items);
    items[0]!.content[0]!.text = "mutated source";
    const first = cache.get(session, key, messages)!;
    expect(first).toEqual([{ role: "assistant", content: [{ type: "output_text", text: "original" }] }]);
    (first[0]!.content as Array<{ text: string }>)[0]!.text = "mutated result";
    first.push({ role: "user", content: "extra" });
    expect(cache.get(session, key, messages)).toEqual([{ role: "assistant", content: [{ type: "output_text", text: "original" }] }]);
  });

  for (const change of [{ route: "responses", model: "mini", system: "system-v1" }, { route: "chat", model: "mini", system: "system-v2" }]) {
    test(`invalidates and deletes on compatibility change ${JSON.stringify(change)}`, () => {
      const cache = new MiniModelHistoryCache();
      const session = {};
      seed(cache, session);
      expect(cache.get(session, JSON.stringify(change), messages)).toBeNull();
      expect(cache.get(session, key, messages)).toBeNull();
    });
  }

  test("matches message JSON rather than array identity", () => {
    const cache = new MiniModelHistoryCache();
    const session = {};
    seed(cache, session);
    expect(cache.get(session, key, JSON.parse(JSON.stringify(messages)))).toEqual(chatItems);
  });

  for (const changedMessages of [[...messages, { role: "user", content: "next" }], [{ role: "assistant", content: "compacted recap" }]]) {
    test(`invalidates message changes or compaction ${JSON.stringify(changedMessages)}`, () => {
      const cache = new MiniModelHistoryCache();
      const session = {};
      seed(cache, session);
      expect(cache.get(session, key, changedMessages)).toBeNull();
      expect(cache.get(session, key, messages)).toBeNull();
    });
  }

  test("accepts the exact character bound and deletes old cache on overflow", () => {
    const cache = new MiniModelHistoryCache();
    const session = {};
    const items = [{ role: "tool", content: "中文🙂" }];
    const size = JSON.stringify(items).length;
    expect(cache.set(session, key, messages, items, size)).toBe(true);
    expect(cache.get(session, key, messages)).toEqual(items);
    expect(cache.set(session, key, messages, items, size - 1)).toBe(false);
    expect(cache.get(session, key, messages)).toBeNull();
  });

  test("isolates session objects and supports explicit deletion", () => {
    const cache = new MiniModelHistoryCache();
    const first = { id: "same-id" };
    const second = { id: "same-id" };
    seed(cache, first);
    expect(cache.get(second, key, messages)).toBeNull();
    const secondItems = [{ role: "assistant", content: "second" }];
    seed(cache, second, secondItems);
    cache.delete(first);
    expect(cache.get(first, key, messages)).toBeNull();
    expect(cache.get(second, key, messages)).toEqual(secondItems);
    expect(new MiniModelHistoryCache().get(second, key, messages)).toBeNull();
  });

  test("serialization failures and invalid bounds safely discard old entries", () => {
    const cache = new MiniModelHistoryCache();
    const session = {};
    const circular: WireItem = {};
    circular.self = circular;
    for (const limit of [-1, NaN, Infinity]) {
      seed(cache, session);
      expect(cache.set(session, key, messages, chatItems, limit)).toBe(false);
      expect(cache.get(session, key, messages)).toBeNull();
    }
    seed(cache, session);
    expect(cache.set(session, key, messages, [circular], 100_000)).toBe(false);
    expect(cache.get(session, key, messages)).toBeNull();
    seed(cache, session);
    expect(cache.get(session, key, [circular])).toBeNull();
    expect(cache.get(session, key, messages)).toBeNull();
    expect(cache.set(session, key, [circular], chatItems, 100_000)).toBe(false);
  });

  test("accepts an empty sanitized history without requiring tool pair validation", () => {
    const cache = new MiniModelHistoryCache();
    const session = {};
    expect(cache.set(session, key, [], [], 2)).toBe(true);
    expect(cache.get(session, key, [])).toEqual([]);
  });
});

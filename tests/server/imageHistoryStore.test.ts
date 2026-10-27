import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { IMAGE_HISTORY_MAX_BYTES, ImageHistoryStore } from "../../apps/server/src/imageHistoryStore.ts";

// Path-only contract (SQLite OOM fix): every image must hit disk first and
// only the disk path enters the record. Base64 reaches the model only as a
// transient send-time payload, never as persisted history.

test("image history is stored independently by thread and request", () => {
  const db = new Database(":memory:");
  const store = new ImageHistoryStore({ connection: db });
  store.put("owner", {
    threadId: "thread", turnId: "turn", requestId: "request", status: "completed",
    items: [{ type: "image_generation_call", result: "", saved_path: "C:\\images\\fox.png" }]
  });
  expect(store.list("owner", "thread")).toMatchObject([{
    threadId: "thread", turnId: "turn", requestId: "request", status: "completed",
    items: [{ result: "", saved_path: "C:\\images\\fox.png" }]
  }]);
  expect(store.list("another-owner", "thread")).toEqual([]);
  db.close();
});

test("oversized legacy rows are skipped on read and do not brick put", () => {
  const db = new Database(":memory:");
  const store = new ImageHistoryStore({ connection: db });
  const big = "x".repeat(IMAGE_HISTORY_MAX_BYTES + 1024);
  const now = Date.now();
  db.prepare(`
    INSERT INTO image_history (owner_id, thread_id, turn_id, request_id, status, items_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run("owner", "poisoned", "turn-big", "req-big", "completed", JSON.stringify([{ blob: big }]), now, now);
  // Bounded read skips the poisoned row instead of OOMing the whole thread.
  const page = store.listPage("owner", "poisoned", { limit: 200 });
  expect(page.entries).toEqual([]);
  expect(page.omittedOversized).toBe(1);
  // PUT on the same thread still works (point-lookup, no full re-scan).
  const written = store.put("owner", {
    threadId: "poisoned", turnId: "turn-ok", requestId: "req-ok", status: "completed",
    items: [{ type: "image_generation_call", result: "", saved_path: "C:\\images\\fox.png" }]
  });
  expect(written.requestId).toBe("req-ok");
  expect(store.list("owner", "poisoned").map((e) => e.requestId)).toEqual(["req-ok"]);
  // Stats exposes the poison; purge removes only oversized rows.
  expect(store.stats("owner", "poisoned").oversized).toBe(1);
  expect(store.purgeOversized("owner", "poisoned")).toBe(1);
  expect(store.stats("owner", "poisoned").oversized).toBe(0);
  expect(store.list("owner", "poisoned").map((e) => e.requestId)).toEqual(["req-ok"]);
  db.close();
});

test("put rejects inline base64 so poisoned rows can never be written", () => {
  const db = new Database(":memory:");
  const store = new ImageHistoryStore({ connection: db });
  const base = { threadId: "t", turnId: "turn", requestId: "req", status: "completed" };
  // b64 key with payload.
  expect(() => store.put("owner", { ...base, items: [{ b64Json: "a".repeat(300) }] })).toThrow(
    "references, not inline image data",
  );
  // data: URL payload.
  expect(() => store.put("owner", { ...base, items: [{ url: `data:image/png;base64,${"b".repeat(300)}` }] })).toThrow(
    "references, not inline image data",
  );
  // Legacy generator shape: non-empty result on image_generation_call.
  expect(() =>
    store.put("owner", { ...base, items: [{ type: "image_generation_call", result: "c".repeat(300), saved_path: "/a.png" }] }),
  ).toThrow("references, not inline image data");
  // Oversized even without base64 markers.
  expect(() => store.put("owner", { ...base, items: [{ note: "x".repeat(IMAGE_HISTORY_MAX_BYTES + 1) }] })).toThrow(
    "references, not inline image data",
  );
  // Nothing was persisted by the rejected writes.
  expect(store.list("owner", "t")).toEqual([]);
  // Path-only payload still writes fine.
  const written = store.put("owner", {
    ...base,
    items: [{ type: "image_generation_call", result: "", saved_path: "/a/b.png" }],
  });
  expect(written.requestId).toBe("req");
  db.close();
});

test("get skips a poisoned single row instead of SQLITE_NOMEM", () => {
  const db = new Database(":memory:");
  const store = new ImageHistoryStore({ connection: db });
  const big = "x".repeat(IMAGE_HISTORY_MAX_BYTES + 1024);
  const now = Date.now();
  // Legacy row written before the path-only guard (bypasses put on purpose).
  db.prepare(
    `
    INSERT INTO image_history (owner_id, thread_id, turn_id, request_id, status, items_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run("owner", "t", "turn-big", "req-big", "completed", JSON.stringify([{ blob: big }]), now, now);
  // Point lookup must not throw/out-of-memory on the poisoned requestId.
  expect(store.get("owner", "t", "req-big")).toBeUndefined();
  expect(store.get("owner", "t", "req-missing")).toBeUndefined();
  db.close();
});

test("list pagination reports truncation", () => {
  const db = new Database(":memory:");
  const store = new ImageHistoryStore({ connection: db });
  for (let i = 0; i < 5; i += 1) {
    store.put("owner", {
      threadId: "thread", turnId: `turn-${i}`, requestId: `req-${i}`, status: "completed",
      items: [{ n: i }]
    });
  }
  const first = store.listPage("owner", "thread", { limit: 2, offset: 0 });
  expect(first.entries.map((e) => e.requestId)).toEqual(["req-0", "req-1"]);
  expect(first.truncated).toBe(true);
  const rest = store.listPage("owner", "thread", { limit: 10, offset: 2 });
  expect(rest.entries.map((e) => e.requestId)).toEqual(["req-2", "req-3", "req-4"]);
  expect(rest.truncated).toBe(false);
  db.close();
});

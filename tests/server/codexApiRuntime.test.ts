import { expect, test } from "bun:test";
import { CodexApiEventStore, CodexApiSessionStore } from "../../apps/server/src/codexApiRuntime.ts";

test("CodexApiEventStore bounds history and filters long-poll events", async () => {
  const store = new CodexApiEventStore(2);
  store.append("notification", { method: "one" }, "thread-1");
  const cursor = store.latestId();
  const waiting = store.wait(cursor, (event) => event.threadId === "thread-2", 1_000);
  store.append("notification", { method: "ignored" }, "thread-1");
  store.append("notification", { method: "matched" }, "thread-2");

  const events = await waiting;
  expect(events.map((event) => event.threadId)).toEqual(["thread-2"]);
  expect(store.list(0, () => true).map((event) => event.threadId)).toEqual(["thread-1", "thread-2"]);
});

test("CodexApiSessionStore scopes sessions and expires idle clients", () => {
  let sequence = 0;
  const store = new CodexApiSessionStore(100, () => `session-${++sequence}`);
  const session = store.create("owner-1", 1_000);

  expect(store.get(session.id, "owner-2", 1_050)).toBeNull();
  expect(store.get(session.id, "owner-1", 1_050)?.clientId).toBe("api-session-1");
  expect(store.sweep(1_151)).toEqual([session]);
  expect(store.get(session.id, "owner-1", 1_151)).toBeNull();
});

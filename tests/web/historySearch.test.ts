import { expect, test } from "bun:test";
import { extractThreadIdSearch, filterHistoryThreads } from "../../apps/web/src/historySearch.ts";

test("history search recognizes UUIDs written with or without dashes", () => {
  const id = "123e4567-e89b-12d3-a456-426614174000";
  expect(extractThreadIdSearch(id)).toBe(id);
  expect(extractThreadIdSearch(id.replace(/-/g, ""))).toBe(id);
});

test("history search matches thread_name and ranks title/id ahead of preview", () => {
  const threads = [
    { id: "thread-1", title: "Project Phoenix", preview: "project phoenix notes", recencyAt: 1 },
    { id: "thread-2", title: "Misc", preview: "project phoenix notes", recencyAt: 2 },
    { id: "thread-3", thread_name: "Daily Sync Review", preview: "catchup", recencyAt: 3 }
  ];

  expect(filterHistoryThreads(threads, "daily sync").map((thread) => thread.id)).toEqual(["thread-3"]);
  expect(filterHistoryThreads(threads, "phoenix")[0]?.id).toBe("thread-1");
});

test("history search supports fuzzy matching for typoed terms", () => {
  const threads = [
    { id: "thread-1", title: "History Search", preview: "chat log", recencyAt: 1 },
    { id: "thread-2", title: "Other", preview: "unrelated", recencyAt: 2 }
  ];

  expect(filterHistoryThreads(threads, "histroy").map((thread) => thread.id)).toContain("thread-1");
});

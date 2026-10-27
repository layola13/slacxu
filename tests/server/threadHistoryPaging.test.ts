import { expect, test } from "bun:test";
import { pageThreadHistory } from "../../apps/server/src/threadHistoryPaging.ts";

test("history pages sort turns and return only that page's messages", () => {
  const result = pageThreadHistory("thread", [
    { id: "old", status: "completed", createdAt: 1 },
    { id: "new", status: "completed", createdAt: 2 },
  ], [
    { id: "old-user", turnId: "old" },
    { id: "new-user", turnId: "new" },
  ], { limit: 1, sortDirection: "desc" });

  expect(result.turns.map((turn) => turn.id)).toEqual(["new"]);
  expect(result.turns[0]?.items).toEqual([{ id: "new-user", turnId: "new" }]);
  expect(result.nextCursor).toBe("new");
  expect(result.data).toEqual(result.turns);
});

test("history page cursor reaches the end without duplicating a turn", () => {
  const turns = [
    { id: "old", status: "completed", createdAt: 1 },
    { id: "new", status: "completed", createdAt: 2 },
  ];
  const first = pageThreadHistory("thread", turns, [], { limit: 1, sortDirection: "desc" });
  const second = pageThreadHistory("thread", turns, [], { limit: 1, sortDirection: "desc", cursor: first.nextCursor });

  expect(second.turns.map((turn) => turn.id)).toEqual(["old"]);
  expect(second.nextCursor).toBeNull();
});

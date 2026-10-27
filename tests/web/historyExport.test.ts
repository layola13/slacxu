import { describe, expect, test } from "bun:test";
import { buildCodexHistoryMarkdown, codexHistoryFilename, loadCompleteCodexHistory } from "../../apps/web/src/historyExport";
import type { ThreadEntry, WorkbenchTurn } from "../../apps/web/src/state/codexClient";

const thread: ThreadEntry = {
  id: "thread-12345678",
  title: "Export demo",
  historyMode: "legacy",
  model: "gpt-5.6",
  cwd: "E:/projects/demo"
};

const turns: WorkbenchTurn[] = [{
  id: "turn-1",
  threadId: thread.id,
  status: "completed",
  startedAt: 1_700_000_000,
  items: [
    { id: "user-1", type: "userMessage", title: "User", text: "Hello" },
    { id: "assistant-1", type: "agentMessage", title: "Codex", text: "Hi there" }
  ]
}];

describe("Codex history export", () => {
  test("renders metadata and turn items as markdown", () => {
    const markdown = buildCodexHistoryMarkdown(thread, turns);
    expect(markdown).toContain("# Export demo");
    expect(markdown).toContain("- Thread ID: thread-12345678");
    expect(markdown).toContain("### User\nHello");
    expect(markdown).toContain("### Codex\nHi there");
  });

  test("sanitizes the downloaded filename", () => {
    expect(codexHistoryFilename({ ...thread, title: "A:/bad\\name?" })).toBe("A--bad-name--thread-1.md");
  });

  test("loads all paginated pages", async () => {
    const calls: Array<[string, Record<string, unknown>]> = [];
    const client = {
      rpc: async (method: string, params: Record<string, unknown> = {}) => {
        calls.push([method, params]);
        if (method === "thread/read" && params.includeTurns === false) {
          return { thread: { id: thread.id, title: thread.title, historyMode: "paginated" } };
        }
        if (method === "thread/turns/list" && params.cursor === null) {
          return { data: [{ id: "turn-2", status: "completed", items: [] }], nextCursor: "older" };
        }
        return { data: [{ id: "turn-1", status: "completed", items: [] }], nextCursor: null };
      }
    };
    const loaded = await loadCompleteCodexHistory(client, thread.id);
    expect(loaded.turns.map((turn) => turn.id)).toEqual(["turn-1", "turn-2"]);
    expect(calls.filter(([method]) => method === "thread/turns/list")).toHaveLength(2);
  });
});

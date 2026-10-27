import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { projectTailRecords, readThreadHistoryTail } from "../../apps/server/src/threadHistoryTail";

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

describe("thread history tail", () => {
  test("starts at a complete JSONL boundary and never reads more than the requested tail", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cxu-tail-")); dirs.push(dir);
    const path = join(dir, "rollout.jsonl");
    const old = JSON.stringify({ type: "event_msg", payload: { type: "user_message", message: "old-" + "x".repeat(400) } });
    const recent = JSON.stringify({ type: "event_msg", payload: { type: "user_message", message: "recent" } });
    await writeFile(path, `${old}\n${recent}\n`);
    const result = await readThreadHistoryTail(path, { id: "thread-1", path }, Buffer.byteLength(recent) + 8);
    expect(result.tail.truncated).toBe(true);
    expect(result.tail.droppedPartialLine).toBe(true);
    expect(result.thread.turns.flatMap((turn) => turn.items).map((item) => item.content)).toEqual([[{ type: "text", text: "recent", text_elements: [] }]]);
  });

  test("reconstructs turns, updates duplicate tool calls, and retains compaction", () => {
    const turns = projectTailRecords([
      { type: "event_msg", payload: { type: "task_started", turn_id: "t1", started_at: 100 } },
      { type: "event_msg", payload: { type: "user_message", message: "hello" } },
      { type: "event_msg", payload: { type: "exec_command_begin", turn_id: "t1", call_id: "c1", command: ["rg", "x"] } },
      { type: "event_msg", payload: { type: "exec_command_end", turn_id: "t1", call_id: "c1", command: ["rg", "x"], aggregated_output: "ok", exit_code: 0 } },
      { type: "event_msg", payload: { type: "context_compacted" } },
      { type: "event_msg", payload: { type: "task_complete", turn_id: "t1", completed_at: 101 } },
    ]);
    expect(turns).toHaveLength(1);
    expect(turns[0]?.items.map((item) => item.type)).toEqual(["userMessage", "commandExecution", "contextCompaction"]);
    expect(turns[0]?.items[1]).toMatchObject({ id: "c1", aggregatedOutput: "ok", status: "completed" });
    expect(turns[0]?.startedAt).toBe(100_000);
    expect(turns[0]?.completedAt).toBe(101_000);
  });

  test("rejects a tail with no complete valid JSONL record", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cxu-tail-")); dirs.push(dir);
    const path = join(dir, "rollout.jsonl");
    await writeFile(path, "x".repeat(200));
    await expect(readThreadHistoryTail(path, { id: "thread-1" }, 20)).rejects.toThrow(/complete JSONL record|No valid JSONL records/);
  });
});

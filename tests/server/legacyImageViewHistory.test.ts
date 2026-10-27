import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { restoreLegacyImageViews } from "../../apps/server/src/legacyImageViewHistory.ts";

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

test("metadata-only responses never touch the history file", async () => {
  const metadata = { thread: { id: "thread-metadata", turns: [] } };
  await expect(restoreLegacyImageViews(metadata, "Z:/definitely-missing/history.jsonl")).resolves.toBe(metadata);
});

test("restores legacy view_image function calls into app-server turn history", async () => {
  const directory = mkdtempSync(join(tmpdir(), "codex-image-history-"));
  directories.push(directory);
  const path = join(directory, "rollout.jsonl");
  writeFileSync(path, [
    JSON.stringify({ type: "response_item", payload: { type: "function_call", name: "view_image", call_id: "call-image", arguments: JSON.stringify({ path: "C:\\images\\page.png" }), internal_chat_message_metadata_passthrough: { turn_id: "turn-1" } } }),
    JSON.stringify({ type: "response_item", payload: { type: "function_call_output", call_id: "call-image", output: "omitted" } })
  ].join("\n"));

  const result = await restoreLegacyImageViews({ data: [{ id: "turn-1", items: [{ id: "message-1", type: "agentMessage" }] }] }, path) as { data: Array<{ items: Array<Record<string, unknown>> }> };
  expect(result.data[0]?.items).toContainEqual({ id: "call-image", type: "imageView", path: "C:\\images\\page.png" });
});

test("does not duplicate imageView items already materialized by app-server", async () => {
  const directory = mkdtempSync(join(tmpdir(), "codex-image-history-"));
  directories.push(directory);
  const path = join(directory, "rollout.jsonl");
  writeFileSync(path, JSON.stringify({ type: "response_item", payload: { type: "function_call", name: "view_image", call_id: "call-image", arguments: JSON.stringify({ path: "page.png" }), internal_chat_message_metadata_passthrough: { turn_id: "turn-1" } } }));

  const result = await restoreLegacyImageViews({ thread: { turns: [{ id: "turn-1", items: [{ id: "call-image", type: "imageView", path: "page.png" }] }] } }, path) as { thread: { turns: Array<{ items: unknown[] }> } };
  expect(result.thread.turns[0]?.items).toHaveLength(1);
});

import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  containsInlineImagePayload,
  isInlineImageDataUrl,
  pathOnlyHistoryPlaceholder,
  persistImageApiResult,
  toPathOnlyImageBlock,
} from "../../apps/server/src/imagePersistence.ts";

test("generated images are persisted by path without retaining base64 or raw payload copies", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-ultra-image-"));
  try {
    const result = await persistImageApiResult({
      data: [{ url: "data:image/png;base64,aW1hZ2U=", b64Json: "aW1hZ2U=", revisedPrompt: "kept" }],
      raw: { data: [{ b64_json: "aW1hZ2U=" }] },
      model: "image-model"
    }, dir) as Record<string, unknown>;
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("aW1hZ2U=");
    expect(serialized).not.toContain('"raw"');
    const entry = (result.data as Array<Record<string, unknown>>)[0]!;
    expect(entry.revisedPrompt).toBe("kept");
    expect(await readFile(String(entry.savedPath), "utf8")).toBe("image");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// Path-only contract helpers: why they exist — SQLite must never see bitmap
// bytes (SQLITE_NOMEM via oversized items_json). Disk first, path in history,
// base64 only as a transient send-time model payload.

test("isInlineImageDataUrl flags bitmap URLs and ignores paths", () => {
  expect(isInlineImageDataUrl(`data:image/png;base64,${"a".repeat(64)}`)).toBe(true);
  expect(isInlineImageDataUrl("https://example.test/a.png")).toBe(false);
  expect(isInlineImageDataUrl("/data/attachments/shot.png")).toBe(false);
  expect(isInlineImageDataUrl("")).toBe(false);
});

test("containsInlineImagePayload detects b64 keys, data URLs and legacy result blobs", () => {
  expect(containsInlineImagePayload([{ b64Json: "aGVsbG8=" }])).toBe(true);
  expect(containsInlineImagePayload([{ url: `data:image/png;base64,${"a".repeat(300)}` }])).toBe(true);
  expect(
    containsInlineImagePayload([{ type: "image_generation_call", result: "a".repeat(300), saved_path: "/a.png" }]),
  ).toBe(true);
  // Path-only records are clean.
  expect(
    containsInlineImagePayload([
      { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] },
      { type: "image_generation_call", result: "", saved_path: "/a/b.png" },
      { type: "localImage", path: "/data/attachments/shot.png" },
    ]),
  ).toBe(false);
});

test("history echo builders carry paths only", () => {
  expect(toPathOnlyImageBlock({ path: "/data/attachments/shot.png", name: "shot.png" })).toEqual({
    type: "localImage",
    path: "/data/attachments/shot.png",
    name: "shot.png",
  });
  const placeholder = pathOnlyHistoryPlaceholder("paste.png", "inline image data is never persisted");
  expect(JSON.stringify(placeholder)).not.toContain(";base64,");
  expect(JSON.stringify(placeholder)).toContain("paste.png");
});

import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildClaudeUserContent,
  detectImageMediaType,
  extractTurnInput,
  imageMediaTypeForPath,
  parseDataUrl,
} from "../../backends/claude/src/runtime/claudeTurnInput";

/**
 * The composer emits one block list for both backends (`composerInputToUserInput`):
 * `text`, `image`, `mention` and `skill`. Codex consumes those natively; Claude
 * only accepts a string or an Anthropic `ContentBlockParam[]`, so images have to
 * become base64 image blocks and file attachments have to become `@"path"` refs
 * that the CLI's at-mention pipeline expands.
 */

// 1x1 transparent PNG.
const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

test("a plain text turn stays a plain string on the wire", async () => {
  const input = await extractTurnInput({ input: [{ type: "text", text: "hello", text_elements: [] }] });

  expect(input.text).toBe("hello");
  expect(input.images).toEqual([]);
  expect(buildClaudeUserContent(input.text, input.images)).toBe("hello");
});

test("legacy string and prompt params still resolve", async () => {
  expect((await extractTurnInput({ input: "typed directly" })).text).toBe("typed directly");
  expect((await extractTurnInput({ prompt: "legacy prompt" })).text).toBe("legacy prompt");
});

test("a pasted image becomes a base64 image block", async () => {
  const input = await extractTurnInput({
    input: [
      { type: "text", text: "what is this?", text_elements: [] },
      { type: "image", url: `data:image/png;base64,${PNG_BASE64}`, detail: "auto" },
    ],
  });

  expect(input.images).toHaveLength(1);
  expect(input.images[0]?.source).toEqual({ type: "base64", media_type: "image/png", data: PNG_BASE64 });
  expect(input.warnings).toEqual([]);
});

test("image blocks precede the prompt so the CLI reads the last block as the prompt", async () => {
  const input = await extractTurnInput({
    input: [
      { type: "text", text: "describe it", text_elements: [] },
      { type: "image", url: `data:image/png;base64,${PNG_BASE64}` },
    ],
  });
  const content = buildClaudeUserContent(input.text, input.images) as Array<{ type: string }>;

  expect(content.map((block) => block.type)).toEqual(["image", "text"]);
});

test("an image-only turn still sends content", async () => {
  const input = await extractTurnInput({ input: [{ type: "image", url: `data:image/png;base64,${PNG_BASE64}` }] });
  const content = buildClaudeUserContent(input.text, input.images) as Array<{ type: string }>;

  expect(input.text).toBe("");
  expect(content).toHaveLength(1);
  expect(content[0]?.type).toBe("image");
});

test("a remote image is forwarded as a URL source", async () => {
  const input = await extractTurnInput({ input: [{ type: "image", url: "https://example.invalid/cat.png" }] });

  expect(input.images[0]?.source).toEqual({ type: "url", url: "https://example.invalid/cat.png" });
});

test("an image on disk is inlined with the media type its extension implies", async () => {
  const path = join(mkdtempSync(join(tmpdir(), "claude-turn-input-")), "shot.png");
  writeFileSync(path, Buffer.from(PNG_BASE64, "base64"));

  const input = await extractTurnInput({ input: [{ type: "localImage", path, name: "shot.png" }] });

  expect(input.images[0]?.source).toEqual({ type: "base64", media_type: "image/png", data: PNG_BASE64 });
  expect(input.warnings).toEqual([]);
});

test("an unreadable image degrades to an @-ref instead of vanishing", async () => {
  const missing = join(tmpdir(), "claude-turn-input-missing", "nope.png");
  const input = await extractTurnInput({
    input: [
      { type: "text", text: "look", text_elements: [] },
      { type: "localImage", path: missing, name: "nope.png" },
    ],
  });

  // The CLI's Read tool can still load the file itself, so the attachment
  // survives as a path reference rather than being silently dropped.
  expect(input.images).toEqual([]);
  expect(input.text).toContain(`@"${missing}"`);
  expect(input.warnings[0]).toContain("nope.png");
});

test("a document mention becomes an @-ref the CLI expands", async () => {
  const path = "E:\\projects\\codex-react-ui\\README.md";
  const input = await extractTurnInput({
    input: [
      { type: "text", text: `summarize ${path}`, text_elements: [] },
      { type: "mention", name: "README.md", path },
    ],
  });

  // The composer already inlined the bare path, so it is rewritten in place
  // rather than repeated at the end of the prompt.
  expect(input.text).toBe(`summarize @"${path}"`);
  expect(input.text.match(/README\.md/g)).toHaveLength(1);
});

test("a mention the prompt does not name is appended", async () => {
  const input = await extractTurnInput({
    input: [
      { type: "text", text: "review this", text_elements: [] },
      { type: "skill", name: "deploy", path: "/skills/deploy/SKILL.md" },
    ],
  });

  expect(input.text).toBe('review this\n@"/skills/deploy/SKILL.md"');
});

test("the transcript echoes the typed text without the CLI's @-refs", async () => {
  const path = "/tmp/report.pdf";
  const input = await extractTurnInput({
    input: [
      { type: "text", text: `read ${path}`, text_elements: [] },
      { type: "mention", name: "report.pdf", path },
    ],
  });

  expect(input.displayText).toBe(`read ${path}`);
  expect(input.attachmentBlocks).toEqual([{ type: "mention", name: "report.pdf", path }]);
});

test("an unsupported media type falls back to the magic bytes", async () => {
  const input = await extractTurnInput({
    input: [{ type: "image", url: `data:application/octet-stream;base64,${PNG_BASE64}` }],
  });

  expect((input.images[0]?.source as { media_type: string }).media_type).toBe("image/png");
});

test("image/jpg is normalized to the media type the API accepts", async () => {
  const input = await extractTurnInput({ input: [{ type: "image", url: "data:image/jpg;base64,/9j/4AAQSkZJRg==" }] });

  expect((input.images[0]?.source as { media_type: string }).media_type).toBe("image/jpeg");
});

test("an empty image attachment is reported instead of sent", async () => {
  const input = await extractTurnInput({ input: [{ type: "image", url: "data:image/png;base64,", name: "blank.png" }] });

  expect(input.images).toEqual([]);
  expect(input.warnings[0]).toContain("blank.png");
});

test("media type detection covers the formats the Messages API accepts", () => {
  expect(detectImageMediaType(PNG_BASE64)).toBe("image/png");
  expect(detectImageMediaType("/9j/4AAQSkZJRg==")).toBe("image/jpeg");
  expect(detectImageMediaType("R0lGODlhAQABAAAAACw=")).toBe("image/gif");
  expect(detectImageMediaType("UklGRiQAAABXRUJQ")).toBe("image/webp");
  expect(detectImageMediaType("bm90IGFuIGltYWdl")).toBeUndefined();

  expect(imageMediaTypeForPath("C:/shots/a.JPEG")).toBe("image/jpeg");
  expect(imageMediaTypeForPath("/tmp/a.webp")).toBe("image/webp");
  expect(imageMediaTypeForPath("/tmp/notes.txt")).toBeUndefined();
});

test("data URLs parse with and without base64 encoding", () => {
  expect(parseDataUrl(`data:image/png;base64,${PNG_BASE64}`)).toEqual({ mediaType: "image/png", base64: PNG_BASE64 });
  expect(parseDataUrl("data:text/plain,hi")?.base64).toBe(Buffer.from("hi", "binary").toString("base64"));
  expect(parseDataUrl("https://example.invalid/a.png")).toBeNull();
});

// Path-only history (SQLite OOM fix): base64 is transient for the model call
// (images[]), while attachmentBlocks — the persisted echo — keeps no bytes.

test("a pasted data-URL image keeps base64 transient and history path-only", async () => {
  const input = await extractTurnInput({
    input: [{ type: "image", url: `data:image/png;base64,${PNG_BASE64}`, name: "paste.png" }],
  });

  // Model payload still gets base64 (hydrated at send time).
  expect(input.images).toHaveLength(1);
  // Persisted echo carries a placeholder, never the bitmap.
  expect(JSON.stringify(input.attachmentBlocks)).not.toContain(";base64,");
  expect(JSON.stringify(input.attachmentBlocks)).not.toContain(PNG_BASE64);
});

test("a disk image persists its path while the model gets transient base64", async () => {
  const path = join(mkdtempSync(join(tmpdir(), "claude-turn-input-")), "shot.png");
  writeFileSync(path, Buffer.from(PNG_BASE64, "base64"));

  const input = await extractTurnInput({ input: [{ type: "localImage", path, name: "shot.png" }] });

  expect(input.images).toHaveLength(1);
  expect(input.attachmentBlocks).toEqual([{ type: "localImage", path, name: "shot.png" }]);
  expect(JSON.stringify(input.attachmentBlocks)).not.toContain(";base64,");
});

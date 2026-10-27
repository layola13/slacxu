import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildOpencodePromptParts,
  extractOpencodeTurnInput,
} from "../../backends/opencode/src/runtime/opencodeCompatibleRuntime.js";
import { OpencodeBridge } from "../../backends/opencode/src/runtime/opencodeBridge.js";

// 1x1 transparent PNG
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const TINY_PNG_DATA_URL = `data:image/png;base64,${TINY_PNG_BASE64}`;

describe("opencode image parts", () => {
  test("text-only inputs keep legacy behavior", async () => {
    expect(await extractOpencodeTurnInput("hello")).toMatchObject({ text: "hello", fileParts: [] });
    expect(
      await extractOpencodeTurnInput([{ type: "text", text: "a" }, { type: "text", text: "b" }])
    ).toMatchObject({ text: "a\nb", fileParts: [] });
    expect(await extractOpencodeTurnInput(undefined, "  fallback  ")).toMatchObject({
      text: "  fallback  ",
      fileParts: [],
    });
  });

  test("data-URL image block becomes an opencode file part", async () => {
    const imageBlock = { type: "image", url: TINY_PNG_DATA_URL, detail: "auto" };
    const res = await extractOpencodeTurnInput([
      { type: "text", text: "看这张图" },
      imageBlock,
    ]);
    // Transient base64 for this turn's model call only (read-time hydration).
    expect(res.fileParts.length).toBe(1);
    expect(res.fileParts[0]).toMatchObject({ type: "file", mime: "image/png" });
    expect(res.fileParts[0]?.url.startsWith("data:image/png;base64,")).toBe(true);
    expect(typeof res.fileParts[0]?.filename).toBe("string");
    // Path-only history (SQLite OOM fix): the persisted echo must not carry
    // the raw data: URL block — base64 never lands in session/history storage.
    expect(res.attachmentBlocks).not.toContain(imageBlock);
    expect(JSON.stringify(res.attachmentBlocks)).not.toContain(";base64,");
    expect(res.warnings).toEqual([]);
  });

  test("local image path is read from disk and inlined", async () => {
    const dir = mkdtempSync(join(tmpdir(), "opencode-img-"));
    const abs = join(dir, "shot.png");
    writeFileSync(abs, Buffer.from(TINY_PNG_BASE64, "base64"));
    const res = await extractOpencodeTurnInput([{ type: "image", url: abs }], undefined, dir);
    // Model payload: transient base64 hydrated from disk at send time.
    expect(res.fileParts.length).toBe(1);
    expect(res.fileParts[0]).toMatchObject({ type: "file", mime: "image/png", filename: "shot.png" });
    expect(res.fileParts[0]?.url).toBe(TINY_PNG_DATA_URL);
    // Persisted echo: disk path only, no bitmap bytes.
    expect(res.attachmentBlocks).toEqual([{ type: "localImage", path: abs }]);
    expect(JSON.stringify(res.attachmentBlocks)).not.toContain(";base64,");
  });

  test("mention of a local image file is attached", async () => {
    const dir = mkdtempSync(join(tmpdir(), "opencode-img-"));
    const abs = join(dir, "a.png");
    writeFileSync(abs, Buffer.from(TINY_PNG_BASE64, "base64"));
    const mention = { type: "mention", name: "a.png", path: abs };
    const res = await extractOpencodeTurnInput([{ type: "text", text: abs }, mention]);
    expect(res.fileParts.length).toBe(1);
    expect(res.fileParts[0]?.mime).toBe("image/png");
    expect(res.attachmentBlocks).toContain(mention);
  });

  test("remote image URL is omitted with a warning, not silently dropped", async () => {
    const res = await extractOpencodeTurnInput([
      { type: "image", url: "https://example.com/a.png" },
    ]);
    expect(res.fileParts).toEqual([]);
    expect(res.warnings.length).toBe(1);
    expect(res.text).toContain("was omitted");
  });

  test("buildOpencodePromptParts shapes", () => {
    const file = { type: "file" as const, mime: "image/png", url: TINY_PNG_DATA_URL, filename: "image.png" };
    const withText = buildOpencodePromptParts("hi", [file]);
    expect(withText[0]).toEqual({ type: "text", text: "hi" });
    expect(withText[1]).toMatchObject({ type: "file", mime: "image/png" });

    const filesOnly = buildOpencodePromptParts("", [file]);
    expect(filesOnly.length).toBe(1);
    expect(filesOnly[0]).toMatchObject({ type: "file" });

    expect(buildOpencodePromptParts("", [])).toEqual([{ type: "text", text: "" }]);
  });

  test("bridge turn/start keeps image blocks and falls back preview for image-only turns", async () => {
    const bridge = new OpencodeBridge();
    const startRes = (await bridge.request("thread/start", {
      cwd: process.cwd(),
      model: "default",
    })) as any;
    const threadId = startRes.threadId;

    await bridge.request("turn/start", {
      threadId,
      input: [
        { type: "text", text: "看这张图" },
        { type: "image", url: TINY_PNG_DATA_URL, detail: "auto" },
      ],
    });
    const readRes = (await bridge.request("thread/read", { threadId })) as any;
    const userItem = readRes.thread.messages[0];
    expect(userItem.text).toBe("看这张图");
    expect(userItem.content.length).toBe(2);
    // Path-only persistence: the stored message must not retain the data: URL.
    expect(JSON.stringify(readRes.thread.messages[0])).not.toContain(";base64,");
    expect(readRes.thread.messages[0].content[1]).toMatchObject({ type: "text" });

    // Image-only turn gets a usable preview instead of an empty one.
    const start2 = (await bridge.request("thread/start", {
      cwd: process.cwd(),
      model: "default",
    })) as any;
    await bridge.request("turn/start", {
      threadId: start2.threadId,
      input: [{ type: "image", url: TINY_PNG_DATA_URL }],
    });
    const read2 = (await bridge.request("thread/read", { threadId: start2.threadId })) as any;
    // Image-only turn keeps the "[1 image(s)]" preview fallback, and the
    // persisted thread carries no base64 (model got the transient file part).
    expect(JSON.stringify(read2.thread)).not.toContain(";base64,");
    expect(read2.thread.preview).toBe("[1 image(s)]");
  });
});

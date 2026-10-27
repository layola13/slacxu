import { expect, test } from "bun:test";
import { COMPOSER_FILE_INPUT_ACCEPT, getLocalFilePath, isSupportedAttachmentFile } from "../../apps/web/src/composer/Composer.tsx";
import { composerInputToUserInput } from "../../apps/web/src/state/codexClient.ts";

test("composer accepts arbitrary file extensions without a frontend type rejection", () => {
  expect(COMPOSER_FILE_INPUT_ACCEPT).toBe("*/*");
  expect(isSupportedAttachmentFile(new File(["zip"], "hxcpptest.tasks.zip", { type: "application/zip" }))).toBe(true);
  expect(isSupportedAttachmentFile(new File(["data"], "model.custom-binary", { type: "application/x-custom" }))).toBe(true);
  expect(isSupportedAttachmentFile(new File(["data"], "README", { type: "" }))).toBe(true);
});

test("desktop file paths are forwarded without reading or uploading non-image content", () => {
  const file = new File(["zip"], "hxcpptest.tasks.zip", { type: "application/zip" }) as File & { path?: string };
  file.path = String.raw`C:\work\hxcpptest.tasks.zip`;
  expect(getLocalFilePath(file)).toBe(file.path);
});

// Path-only send (SQLite OOM fix): screenshots/pastes hit disk first and only
// the disk path travels in turn/start. The model still gets base64, but
// transiently — the server hydrates path->bytes at send time. Serialized
// input here must therefore never contain ";base64," for image attachments.

test("uploaded screenshots are sent as localImage disk paths, never base64", () => {
  const path = String.raw`C:\Users\zhan\.codex-ultra\attachments\shot-abc123.png`;
  const input = composerInputToUserInput("look at this", [{
    id: "img-1",
    name: "screenshot.png",
    url: "blob:http://127.0.0.1/preview",
    previewUrl: "blob:http://127.0.0.1/preview",
    path,
    size: 12345,
    mediaType: "image/png",
    kind: "image",
  }]);

  expect(input).toContainEqual({ type: "localImage", path, detail: "auto" });
  expect(JSON.stringify(input)).not.toContain(";base64,");
  expect(JSON.stringify(input)).not.toContain("blob:");
});

test("an image without a disk path is replaced by a placeholder instead of base64", () => {
  const input = composerInputToUserInput("look", [{
    id: "img-2",
    name: "paste.png",
    url: `data:image/png;base64,${"a".repeat(300)}`,
    size: 999,
    mediaType: "image/png",
    kind: "image",
  }]);

  expect(JSON.stringify(input)).not.toContain(";base64,");
  expect(JSON.stringify(input)).toContain("paste.png");
});

test("arbitrary file attachments are represented as paths for Codex CLI", () => {
  const path = String.raw`C:\Users\zhan\.codex-ultra\attachments\hxcpptest.tasks.zip`;
  const input = composerInputToUserInput("Inspect this task archive", [{
    id: "zip-1",
    name: "hxcpptest.tasks.zip",
    url: path,
    path,
    size: 128,
    mediaType: "application/zip",
    kind: "file"
  }]);

  expect(input[0]).toMatchObject({
    type: "text",
    text: `Inspect this task archive\n${path}`
  });
  expect(input).toHaveLength(2);
  expect(input[1]).toMatchObject({ type: "mention", name: "hxcpptest.tasks.zip", path });
});

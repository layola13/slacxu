import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { JsonValue } from "@codex-ui/shared";

const MAX_PERSISTED_IMAGE_BYTES = 128 * 1024 * 1024;

/**
 * Path-only contract for every persisted chat record (image_history,
 * session messages, JSONL history): images must hit disk first
 * (saveUploadedAttachment / persistImageApiResult) and only the disk path
 * enters the record. Base64 lives only in transient model payloads
 * (fileParts / Anthropic image blocks built at read time from the path).
 */
const INLINE_IMAGE_KEYS = new Set(["b64Json", "b64_json", "base64", "b64", "data"]);

export function isInlineImageDataUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.length < 32) return false;
  return trimmed.includes(";base64,") || /^data:image\//i.test(trimmed);
}

function hasInlineImagePayload(value: unknown, depth = 0): boolean {
  if (depth > 12) return false;
  if (typeof value === "string") {
    if (value.length < 256) return false;
    return value.includes(";base64,") || /data:image\//i.test(value);
  }
  if (Array.isArray(value)) return value.some((entry) => hasInlineImagePayload(entry, depth + 1));
  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (INLINE_IMAGE_KEYS.has(key) && typeof entry === "string" && entry.trim()) return true;
      if (key === "result" && typeof entry === "string" && entry.trim()) {
        const type = (value as Record<string, unknown>).type;
        if (type === "image_generation_call" || entry.length >= 256) return true;
      }
      if (hasInlineImagePayload(entry, depth + 1)) return true;
    }
  }
  return false;
}

export function containsInlineImagePayload(value: unknown): boolean {
  return hasInlineImagePayload(value);
}

/**
 * Build the history-safe echo of a composer image block: path reference
 * only, never bitmap bytes. Transient base64 for the model is produced
 * separately at read time (readOpencodeLocalImage / readImageFromDisk /
 * runMiniImageView), so dropping it here loses nothing.
 */
export function toPathOnlyImageBlock(input: {
  path?: string;
  name?: string;
  detail?: string;
}): Record<string, JsonValue> {
  const block: Record<string, JsonValue> = { type: "localImage", path: (input.path ?? "").trim() };
  if (input.name?.trim()) block.name = input.name.trim();
  if (input.detail?.trim()) block.detail = input.detail.trim();
  return block;
}

export function pathOnlyHistoryPlaceholder(name: string, reason: string): Record<string, JsonValue> {
  return { type: "text", text: `[Attached image "${name}" was omitted: ${reason}]`, text_elements: [] };
}

export async function persistImageApiResult(
  value: JsonValue,
  dataDir: string,
  fetchImage: typeof fetch = fetch
): Promise<JsonValue> {
  const source = asRecord(value);
  if (!Array.isArray(source.data)) return value;
  const attachmentsDir = join(dataDir, "attachments");
  await mkdir(attachmentsDir, { recursive: true, mode: 0o700 });
  const data: JsonValue[] = [];
  for (const rawEntry of source.data) {
    const entry = asRecord(rawEntry);
    const downloaded = await imageBytes(entry, fetchImage);
    if (!downloaded) throw new Error("Image API returned an image that could not be persisted");
    if (downloaded.bytes.byteLength > MAX_PERSISTED_IMAGE_BYTES) {
      throw new Error("Generated image exceeds 128 MiB persistence limit");
    }
    const extension = extensionForMediaType(downloaded.mediaType);
    const savedPath = join(attachmentsDir, `${Date.now().toString(36)}-${randomBytes(8).toString("hex")}.${extension}`);
    await writeFile(savedPath, downloaded.bytes, { mode: 0o600 });
    const { url: _url, b64Json: _b64Json, b64_json: _b64JsonSnake, ...metadata } = entry;
    data.push({
      ...metadata,
      savedPath,
      mediaType: downloaded.mediaType
    });
  }
  // Upstream raw payloads frequently contain a second full base64 copy. They are
  // diagnostics, not conversation state, so never send/store them in the renderer.
  const { raw: _raw, ...rest } = source;
  return { ...rest, data };
}

async function imageBytes(
  entry: Record<string, JsonValue>,
  fetchImage: typeof fetch
): Promise<{ bytes: Uint8Array; mediaType: string } | null> {
  const b64 = stringValue(entry.b64Json) ?? stringValue(entry.b64_json);
  if (b64) return { bytes: Uint8Array.from(Buffer.from(b64, "base64")), mediaType: stringValue(entry.mediaType) ?? "image/png" };
  const url = stringValue(entry.url);
  if (!url) return null;
  const dataUrl = /^data:([^;,]+);base64,(.+)$/s.exec(url);
  if (dataUrl) return { bytes: Uint8Array.from(Buffer.from(dataUrl[2]!, "base64")), mediaType: dataUrl[1] || "image/png" };
  if (!/^https?:\/\//i.test(url)) return null;
  const response = await fetchImage(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Failed to download generated image (${response.status})`);
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_PERSISTED_IMAGE_BYTES) throw new Error("Generated image exceeds 128 MiB persistence limit");
  const bytes = new Uint8Array(await response.arrayBuffer());
  return { bytes, mediaType: response.headers.get("content-type")?.split(";")[0]?.trim() || "image/png" };
}

function extensionForMediaType(mediaType: string): string {
  switch (mediaType.toLowerCase()) {
    case "image/jpeg": return "jpg";
    case "image/webp": return "webp";
    case "image/gif": return "gif";
    case "image/svg+xml": return "svg";
    default: return "png";
  }
}

function asRecord(value: unknown): Record<string, JsonValue> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, JsonValue> : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

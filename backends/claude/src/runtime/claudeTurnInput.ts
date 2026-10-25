import { readFile } from "node:fs/promises";
import type { JsonValue } from "@codex-ui/shared";
import { pathOnlyHistoryPlaceholder, toPathOnlyImageBlock } from "@cxu/sdk-backend";

/**
 * Converts workbench `turn/start` input blocks into the shape the Claude
 * Code stream-json stdin protocol expects.
 *
 * The composer emits the same block list for both backends (see
 * `composerInputToUserInput` in the web app): `text`, `image`, `localImage`,
 * `mention` and `skill`. Codex consumes those natively; Claude only accepts a
 * string or an Anthropic `ContentBlockParam[]`, so images become base64
 * `image` blocks and file attachments become `@"path"` refs that the CLI's
 * at-mention pipeline expands into real attachments.
 */

/** Raw bytes above this are not inlined — the CLI reads the file instead. */
const MAX_INLINE_IMAGE_BYTES = 24 * 1024 * 1024;

/** Media types the Messages API accepts for base64 image sources. */
const SUPPORTED_IMAGE_MEDIA_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

export type ClaudeImageSource =
  | { type: "base64"; media_type: string; data: string }
  | { type: "url"; url: string };

export type ClaudeImageBlock = { type: "image"; source: ClaudeImageSource };

export type ClaudeContentBlockParam =
  | { type: "text"; text: string }
  | ClaudeImageBlock;

export type ClaudeTurnInput = {
  /** Prompt text written to the CLI. File attachments appear as `@"path"`. */
  text: string;
  /** Text exactly as the composer sent it, used for the transcript bubble. */
  displayText: string;
  /** Attachments inlined as Anthropic image blocks. */
  images: ClaudeImageBlock[];
  /** Non-text composer blocks, echoed back so the UI renders attachments. */
  attachmentBlocks: JsonValue[];
  /** Attachments that could not be forwarded, surfaced on the stderr channel. */
  warnings: string[];
};

function blockRecord(value: JsonValue): Record<string, JsonValue> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, JsonValue>
    : {};
}

function stringField(record: Record<string, JsonValue>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

/** Detect the media type from base64 magic bytes, as the CLI does for bridge input. */
export function detectImageMediaType(base64: string): string | undefined {
  const head = base64.slice(0, 16);
  if (head.startsWith("/9j/")) return "image/jpeg";
  if (head.startsWith("iVBORw0KGgo")) return "image/png";
  if (head.startsWith("R0lGOD")) return "image/gif";
  if (head.startsWith("UklGR")) return "image/webp";
  return undefined;
}

export function imageMediaTypeForPath(path: string): string | undefined {
  switch (path.split(".").pop()?.toLowerCase()) {
    case "png": return "image/png";
    case "jpg":
    case "jpeg": return "image/jpeg";
    case "gif": return "image/gif";
    case "webp": return "image/webp";
    default: return undefined;
  }
}

/**
 * Pick a media type the API accepts. A declared type wins when supported,
 * otherwise fall back to magic-byte detection and finally to PNG — the CLI
 * re-encodes oversized images anyway, and a wrong-but-valid type beats a
 * rejected request.
 */
function normalizeImageMediaType(declared: string | undefined, base64: string): string {
  const lowered = declared?.toLowerCase();
  if (lowered === "image/jpg") return "image/jpeg";
  if (lowered && SUPPORTED_IMAGE_MEDIA_TYPES.has(lowered)) return lowered;
  return detectImageMediaType(base64) ?? "image/png";
}

export function parseDataUrl(url: string): { mediaType?: string; base64: string } | null {
  if (!url.startsWith("data:")) return null;
  const separator = url.indexOf(",");
  if (separator < 0) return null;
  const header = url.slice(5, separator);
  const payload = url.slice(separator + 1);
  const isBase64 = /;base64$/i.test(header);
  const mediaType = header.replace(/;base64$/i, "").split(";")[0]?.trim() || undefined;
  if (isBase64) {
    return { mediaType, base64: payload.replace(/\s+/g, "") };
  }
  return { mediaType, base64: Buffer.from(decodeURIComponent(payload), "binary").toString("base64") };
}

function isRemoteUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

async function readImageFromDisk(path: string): Promise<ClaudeImageBlock> {
  const bytes = await readFile(path);
  if (bytes.byteLength > MAX_INLINE_IMAGE_BYTES) {
    throw new Error(`image is ${Math.round(bytes.byteLength / 1024 / 1024)} MiB, above the inline limit`);
  }
  const base64 = bytes.toString("base64");
  return {
    type: "image",
    source: { type: "base64", media_type: normalizeImageMediaType(imageMediaTypeForPath(path), base64), data: base64 },
  };
}

/**
 * Splice an `@"path"` ref into the prompt. The composer already inlines the
 * bare path for file attachments, so rewrite that occurrence in place rather
 * than repeating it; otherwise append the ref at the end.
 */
function withPathRef(text: string, path: string): string {
  const quoted = `@"${path}"`;
  if (text.includes(quoted)) return text;
  const index = text.indexOf(path);
  if (index >= 0) return text.slice(0, index) + quoted + text.slice(index + path.length);
  return text ? `${text}\n${quoted}` : quoted;
}

/**
 * Build the Claude-facing prompt from workbench turn params.
 *
 * `params.input` accepts the composer block list, a plain string, or the
 * legacy `params.prompt` string.
 */
export async function extractTurnInput(params: Record<string, JsonValue>): Promise<ClaudeTurnInput> {
  const input = params.input;

  if (typeof input === "string") {
    return { text: input, displayText: input, images: [], attachmentBlocks: [], warnings: [] };
  }
  if (!Array.isArray(input)) {
    const prompt = typeof params.prompt === "string" ? params.prompt : "";
    return { text: prompt, displayText: prompt, images: [], attachmentBlocks: [], warnings: [] };
  }

  const textParts: string[] = [];
  const images: ClaudeImageBlock[] = [];
  const attachmentBlocks: JsonValue[] = [];
  const pathRefs: string[] = [];
  const warnings: string[] = [];

  for (const entry of input) {
    const block = blockRecord(entry);
    const type = typeof block.type === "string" ? block.type : "";

    if (type === "text" || type === "input_text" || type === "inputText") {
      if (typeof block.text === "string" && block.text) textParts.push(block.text);
      continue;
    }

    if (type === "mention" || type === "skill" || type === "file" || type === "document") {
      const path = stringField(block, ["path"]);
      if (path) {
        pathRefs.push(path);
        attachmentBlocks.push(entry);
      }
      continue;
    }

    if (type !== "image" && type !== "input_image" && type !== "inputImage" && type !== "localImage") {
      continue;
    }

    const source = stringField(block, ["url", "image_url", "imageUrl", "path"]);
    if (!source) continue;
    const label = stringField(block, ["name"]) ?? (source.startsWith("data:") ? "image" : source);

    const dataUrl = parseDataUrl(source);
    if (dataUrl) {
      if (!dataUrl.base64) {
        warnings.push(`Dropped empty image attachment ${label}`);
        attachmentBlocks.push(pathOnlyHistoryPlaceholder(label, "empty image data") as JsonValue);
        continue;
      }
      // Transient base64 for this turn's model call only; history keeps no bytes.
      images.push({
        type: "image",
        source: { type: "base64", media_type: normalizeImageMediaType(dataUrl.mediaType, dataUrl.base64), data: dataUrl.base64 },
      });
      attachmentBlocks.push(pathOnlyHistoryPlaceholder(label, "inline image data is never persisted; save it into the workspace first") as JsonValue);
      continue;
    }

    if (isRemoteUrl(source)) {
      images.push({ type: "image", source: { type: "url", url: source } });
      attachmentBlocks.push(entry);
      continue;
    }

    try {
      images.push(await readImageFromDisk(source));
      // Read-time hydration: base64 above is transient for the model call.
      attachmentBlocks.push(toPathOnlyImageBlock({ path: source, name: label }) as JsonValue);
    } catch (error) {
      // Falling back to an @-ref keeps the attachment usable: the CLI's Read
      // tool loads and downsamples the file itself.
      warnings.push(`Could not inline image ${label}: ${error instanceof Error ? error.message : String(error)}`);
      pathRefs.push(source);
      attachmentBlocks.push(entry);
    }
  }

  const displayText = textParts.join("\n");
  let text = displayText;
  for (const path of pathRefs) text = withPathRef(text, path);

  return { text, displayText, images, attachmentBlocks, warnings };
}

/**
 * Build the `message.content` payload for a stream-json user message.
 *
 * Plain text stays a string (what the CLI sees for a keyboard-typed prompt).
 * With attachments it becomes a block array with the prompt last, because
 * `processUserInputBase` reads the prompt from the final block and treats
 * everything before it as context.
 */
export function buildClaudeUserContent(text: string, images: ClaudeImageBlock[]): JsonValue {
  if (images.length === 0) return text;
  const blocks: ClaudeContentBlockParam[] = [...images];
  if (text) blocks.push({ type: "text", text });
  return blocks as unknown as JsonValue;
}

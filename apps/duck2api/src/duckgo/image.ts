// Port of E:\projects\duck2api\internal\duckgo\image.go (ReadImageResponse).
// Reads a Duck.ai SSE stream and extracts both text and image parts:
// - legacy `parts[]` entries typed "generated-image"/"image"
// - new format: `toolName === "GenerateImage"` with `data.b64Image`
//   (ui-component payload).

import type { UpstreamEvent, UpstreamImageData } from "./response.js";

export interface ExtractedImage {
  b64: string;
  format?: string;
  width?: number;
  height?: number;
}

export interface ImageStreamResult {
  text: string;
  images: ExtractedImage[];
}

function imageDataOf(data: UpstreamImageData | null | undefined): ExtractedImage | null {
  const b64 = typeof data?.b64Image === "string" ? data.b64Image : "";
  if (!b64) return null;
  const out: ExtractedImage = { b64 };
  if (typeof data?.format === "string" && data.format !== "") out.format = data.format;
  if (typeof data?.width === "number") out.width = data.width;
  if (typeof data?.height === "number") out.height = data.height;
  return out;
}

export function parseImageEvent(line: string): { text: string; images: ExtractedImage[] } {
  const textParts: string[] = [];
  const images: ExtractedImage[] = [];
  let payload = line.trim();
  if (payload.startsWith("data:")) payload = payload.slice(5).trim();
  if (!payload || payload.startsWith("[DONE]") || payload.startsWith("[PING]") || payload.startsWith("[CHAT_TITLE")) {
    return { text: "", images };
  }
  let event: UpstreamEvent;
  try {
    event = JSON.parse(payload) as UpstreamEvent;
  } catch {
    return { text: "", images };
  }
  if (!event || event.action !== "success") return { text: "", images };
  if (typeof event.message === "string" && event.message !== "") textParts.push(event.message);
  for (const part of event.parts ?? []) {
    if (part?.type === "generated-image" || part?.type === "image") {
      const direct = typeof part.result === "string" ? part.result : "";
      if (direct !== "") {
        const img: ExtractedImage = { b64: direct };
        if (typeof part.format === "string" && part.format !== "") img.format = part.format;
        if (typeof part.width === "number") img.width = part.width;
        if (typeof part.height === "number") img.height = part.height;
        images.push(img);
        continue;
      }
      const nested = imageDataOf(part.data);
      if (nested) images.push(nested);
    }
  }
  if (event.toolName === "GenerateImage") {
    const ui = imageDataOf(event.data);
    if (ui) images.push(ui);
  }
  return { text: textParts.join(""), images };
}

/** Port of ReadImageResponse: fold a full SSE body into text + images. */
export function readImageResponse(bodyText: string): ImageStreamResult {
  let text = "";
  const images: ExtractedImage[] = [];
  for (const rawLine of bodyText.split("\n")) {
    const line = rawLine.trim();
    if (!line || !line.startsWith("data:")) continue;
    const parsed = parseImageEvent(line);
    text += parsed.text;
    images.push(...parsed.images);
  }
  return { text, images };
}

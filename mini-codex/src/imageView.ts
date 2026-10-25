// Standalone image_view helper for the detached mini-codex CLI.
// Mirrors apps/server/src/agentRuntime/imageView.ts semantics (size enum
// original/720p, color enum rgba/rgb/gray, model-chosen params) without
// importing across the ultra workspace boundary.
import { readFile, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

export type ImageViewSize = "original" | "720p";
export type ImageViewColor = "rgba" | "rgb" | "gray";

export const IMAGE_VIEW_DEFAULT_SIZE: ImageViewSize = "720p";
export const IMAGE_VIEW_DEFAULT_COLOR: ImageViewColor = "rgb";

const MAX_SOURCE_BYTES = 32 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;

const EXT_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  bmp: "image/bmp",
  avif: "image/avif",
};

export const IMAGE_VIEW_TOOL = {
  name: "image_view",
  description:
    'View a local image file and attach it for visual inspection (screenshots, UI mockups, diagrams, photos, charts). Args: {path (REQUIRED, workspace-relative or absolute image path), size ("720p" default: downscale to fit 1280x720, cheaper; "original": full resolution for fine detail), color ("rgb" default; "rgba" preserves transparency; "gray" for text/diagrams)}. Returns a text summary; the image is attached to the result - inspect it visually in the next response.',
  schema: {
    type: "object",
    properties: {
      path: { type: "string" },
      size: { type: "string", enum: ["original", "720p"] },
      color: { type: "string", enum: ["rgba", "rgb", "gray"] },
    },
    required: ["path"],
    additionalProperties: false,
  },
};

export function normalizeImageSize(v: unknown): ImageViewSize | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim().toLowerCase();
  if (s === "original" || s === "raw" || s === "full") return "original";
  if (s === "720p" || s === "720" || s === "hd") return "720p";
  return undefined;
}

export function normalizeImageColor(v: unknown): ImageViewColor | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim().toLowerCase();
  if (s === "rgba" || s === "argb") return "rgba";
  if (s === "rgb") return "rgb";
  if (s === "gray" || s === "grey" || s === "grayscale" || s === "greyscale" || s === "mono") return "gray";
  return undefined;
}

export function imageViewArgError(a: Record<string, any>): string | null {
  if (typeof a.path !== "string" || !a.path.trim()) {
    return `image_view needs {"path":"<image file>"}. Optional: size "original"|"720p" (default "720p"), color "rgba"|"rgb"|"gray" (default "rgb").`;
  }
  if (a.size !== undefined && normalizeImageSize(a.size) === undefined) return `image_view size must be "original" or "720p", got ${JSON.stringify(a.size)?.slice(0, 80)}.`;
  if (a.color !== undefined && normalizeImageColor(a.color) === undefined) return `image_view color must be "rgba", "rgb" or "gray", got ${JSON.stringify(a.color)?.slice(0, 80)}.`;
  return null;
}

export type ImageViewResult = { ok: boolean; text: string; dataUrl?: string; displayPath: string };

async function loadSharp(): Promise<any> {
  try {
    // @ts-ignore - optional dependency
    const mod = await import("sharp");
    return (mod as any)?.default ?? (mod as any) ?? null;
  } catch {
    return null;
  }
}

export async function viewLocalImage(
  args: { path?: unknown; size?: unknown; color?: unknown },
  cwd: string,
): Promise<ImageViewResult> {
  const rawPath = typeof args.path === "string" ? args.path.trim() : "";
  const size = normalizeImageSize(args.size) ?? IMAGE_VIEW_DEFAULT_SIZE;
  const color = normalizeImageColor(args.color) ?? IMAGE_VIEW_DEFAULT_COLOR;
  if (!rawPath) return { ok: false, text: `image_view failed: missing "path".`, displayPath: "(missing path)" };
  const abs = isAbsolute(rawPath) ? rawPath : resolve(cwd || process.cwd(), rawPath);
  let display = abs;
  try {
    const rel = relative(cwd || process.cwd(), abs);
    if (rel && !rel.startsWith("..")) display = rel;
  } catch { /* keep abs */ }
  try {
    const st = await stat(abs);
    if (!st.isFile()) return { ok: false, text: `image_view failed: "${display}" is not a file.`, displayPath: display };
    if (st.size > MAX_SOURCE_BYTES) return { ok: false, text: `image_view failed: "${display}" exceeds size limit.`, displayPath: display };
  } catch {
    return { ok: false, text: `image_view failed: cannot access "${display}".`, displayPath: display };
  }
  const sharp = await loadSharp();
  if (!sharp) {
    const ext = abs.split(".").pop()?.toLowerCase() ?? "";
    const mime = EXT_MIME[ext];
    if (!mime) return { ok: false, text: `image_view failed: unsupported format for "${display}" (resize unavailable).`, displayPath: display };
    const buf = await readFile(abs);
    if (buf.length > MAX_OUTPUT_BYTES) return { ok: false, text: `image_view failed: "${display}" too large and resize unavailable.`, displayPath: display };
    return { ok: true, text: `viewed image "${display}" (${mime}, original bytes). The image is attached; inspect it visually.`, dataUrl: `data:${mime};base64,${buf.toString("base64")}`, displayPath: display };
  }
  try {
    const input = await readFile(abs);
    let pipeline = sharp(input, { animated: false });
    if (size === "720p") pipeline = pipeline.resize({ width: 1280, height: 720, fit: "inside", withoutEnlargement: true });
    let mime: string;
    if (color === "gray") { mime = "image/jpeg"; pipeline = pipeline.grayscale().jpeg({ quality: 82 }); }
    else if (color === "rgba") { mime = "image/png"; pipeline = pipeline.png(); }
    else { mime = "image/jpeg"; pipeline = pipeline.flatten({ background: "#ffffff" }).jpeg({ quality: 82 }); }
    const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
    if (data.length > MAX_OUTPUT_BYTES) return { ok: false, text: `image_view failed: processed image too large - retry with size "720p" and color "gray".`, displayPath: display };
    return { ok: true, text: `viewed image "${display}" (${info.width}x${info.height} ${mime}, size=${size} color=${color}). The image is attached; inspect it visually.`, dataUrl: `data:${mime};base64,${data.toString("base64")}`, displayPath: display };
  } catch (e) {
    return { ok: false, text: `image_view failed: "${display}" could not be decoded (${e instanceof Error ? e.message.slice(0, 160) : String(e).slice(0, 160)}).`, displayPath: display };
  }
}

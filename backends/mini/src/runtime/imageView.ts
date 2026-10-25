import { stat } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { homedir } from "node:os";
import { chooseMiniImageAnalysisProfile, normalizeMiniImageAnalysisMode, type MiniImageAnalysisMode, type MiniImageDetail } from "./miniImageAnalysisPolicy.js";

export const MINI_IMAGE_VIEW_SIZES = ["original", "720p"] as const;
export type MiniImageViewSize = (typeof MINI_IMAGE_VIEW_SIZES)[number];

export const MINI_IMAGE_VIEW_COLORS = ["rgba", "rgb", "gray"] as const;
export type MiniImageViewColor = (typeof MINI_IMAGE_VIEW_COLORS)[number];

export const MINI_IMAGE_VIEW_DEFAULT_SIZE: MiniImageViewSize = "720p";
export const MINI_IMAGE_VIEW_DEFAULT_COLOR: MiniImageViewColor = "rgb";

/** Largest source file accepted (protects against OOM on raw photos). */
export const MINI_IMAGE_VIEW_MAX_SOURCE_BYTES = 32 * 1024 * 1024;
/** Largest processed payload returned to the model. */
const MINI_IMAGE_VIEW_MAX_OUTPUT_BYTES = 10 * 1024 * 1024;

const IMAGE_720P_WIDTH = 1280;
const IMAGE_720P_HEIGHT = 720;

const EXT_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  bmp: "image/bmp",
  avif: "image/avif",
  tif: "image/tiff",
  tiff: "image/tiff",
  ico: "image/x-icon",
  svg: "image/svg+xml",
};

export const MINI_IMAGE_VIEW_TOOL = {
  name: "image_view",
  description:
    'View a local image file for visual inspection (screenshots, mockups, diagrams, photos). Ask JEV to choose analysisMode when the task is ambiguous: "ui" (screen layout), "ocr" (text), "shape" (contours/geometry/silhouette), "pixel" (transparency/colors), "diagram", or "photo". Args: {path (REQUIRED, workspace-relative, absolute, or ~/ image path; local files only, no URLs), analysisMode ("auto" default, or ui|ocr|shape|pixel|diagram|photo), task (short analysis goal), size (optional override: "720p" or "original"), color (optional override: "rgb", "rgba", or "gray")}. The selected mode controls resize/color/detail to avoid sending unnecessarily expensive pixels.',
  schema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Local image path (workspace-relative, absolute, or ~/); no URLs." },
      analysisMode: { type: "string", enum: ["auto", "ui", "ocr", "shape", "pixel", "diagram", "photo"], description: "JEV-selected visual analysis mode." },
      task: { type: "string", description: "Short visual analysis goal used by auto mode." },
      size: { type: "string", enum: ["original", "720p"], description: '"720p" (default) or "original".' },
      color: { type: "string", enum: ["rgba", "rgb", "gray"], description: '"rgb" (default), "rgba", or "gray".' },
    },
    required: ["path"],
    additionalProperties: false,
  },
};

export function normalizeMiniImageSize(v: unknown): MiniImageViewSize | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim().toLowerCase();
  if (s === "original" || s === "raw" || s === "full") return "original";
  if (s === "720p" || s === "720" || s === "hd") return "720p";
  return undefined;
}

export function normalizeMiniImageColor(v: unknown): MiniImageViewColor | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim().toLowerCase();
  if (s === "rgba" || s === "argb") return "rgba";
  if (s === "rgb") return "rgb";
  if (s === "gray" || s === "grey" || s === "grayscale" || s === "greyscale" || s === "mono") return "gray";
  return undefined;
}

export function miniImageViewArgError(a: Record<string, any>): string | null {
  const path = typeof a.path === "string" ? a.path.trim() : "";
  if (!path) return `image_view needs {"path":"<image file>"} (workspace-relative or absolute). Optional: size "original"|"720p" (default "720p"), color "rgba"|"rgb"|"gray" (default "rgb").`;
  if (a.size !== undefined && normalizeMiniImageSize(a.size) === undefined) {
    return `image_view size must be "original" or "720p" (default "720p"), got ${JSON.stringify(a.size)?.slice(0, 80)}.`;
  }
  if (a.color !== undefined && normalizeMiniImageColor(a.color) === undefined) {
    return `image_view color must be "rgba", "rgb" or "gray" (default "rgb"), got ${JSON.stringify(a.color)?.slice(0, 80)}.`;
  }
  if (a.analysisMode !== undefined && normalizeMiniImageAnalysisMode(a.analysisMode) === undefined) {
    return `image_view analysisMode must be "auto", "ui", "ocr", "shape", "pixel", "diagram" or "photo", got ${JSON.stringify(a.analysisMode)?.slice(0, 80)}.`;
  }
  return null;
}

export interface MiniImageViewResult {
  ok: boolean;
  /** Short text summary (also used as the persisted toolCall output). */
  text: string;
  /** Data URL for model input (omitted on failure). */
  dataUrl?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  bytes?: number;
  /** Path shown in UI / history (relative to cwd when inside it). */
  displayPath: string;
  size: MiniImageViewSize;
  color: MiniImageViewColor;
  analysisMode?: MiniImageAnalysisMode;
  detail?: MiniImageDetail;
  /** True when sharp was unavailable and the raw file was returned as-is. */
  degraded?: boolean;
}

async function loadSharp(): Promise<any> {
  try {
    // @ts-ignore - optional dependency, used loosely on purpose
    const mod = await import("sharp");
    return (mod as any)?.default ?? (mod as any) ?? null;
  } catch {
    return null;
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

/** Expand a leading `~` to the home directory (models emit it habitually). */
export function expandLeadingTilde(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) return join(homedir(), p.slice(2));
  return p;
}

export function isRemoteImageRef(p: string): boolean {
  return /^(https?|ftp):\/\//i.test(p.trim()) || /^data:(?:image|audio|video)\//i.test(p.trim());
}

export async function runMiniImageView(
  args: { path?: unknown; analysisMode?: unknown; task?: unknown; size?: unknown; color?: unknown },
  cwd: string,
): Promise<MiniImageViewResult> {
  const rawPath = typeof args.path === "string" ? args.path.trim() : "";
  const profile = chooseMiniImageAnalysisProfile(args.analysisMode, args.task);
  const size = normalizeMiniImageSize(args.size) ?? profile.size ?? MINI_IMAGE_VIEW_DEFAULT_SIZE;
  const color = normalizeMiniImageColor(args.color) ?? profile.color ?? MINI_IMAGE_VIEW_DEFAULT_COLOR;
  const analysisMode = profile.mode;
  const detail = profile.detail;
  const displayPath = rawPath || "(missing path)";
  if (!rawPath) {
    return { ok: false, text: `image_view failed: missing "path". Pass {"path":"<image file>"} with optional analysisMode and size/color overrides.`, displayPath, size, color, analysisMode, detail };
  }
  if (isRemoteImageRef(rawPath)) {
    return { ok: false, text: `image_view failed: remote URLs are not supported ("${displayPath}"). Save the image into the workspace first (workspace-relative path), then view the local file.`, displayPath, size, color, analysisMode, detail };
  }
  const expanded = expandLeadingTilde(rawPath);
  const abs = isAbsolute(expanded) ? expanded : resolve(cwd || process.cwd(), expanded);
  const display = (() => {
    try {
      const rel = relative(cwd || process.cwd(), abs);
      return rel && !rel.startsWith("..") ? rel : abs;
    } catch {
      return abs;
    }
  })();
  let info: { size: number; isFile: () => boolean };
  try {
    const st = await stat(abs);
    info = st;
    if (!st.isFile()) return { ok: false, text: `image_view failed: "${display}" is a directory, not an image file. Use sa_vm list_dir to browse it, then view a file inside.`, displayPath: display, size, color, analysisMode, detail };
    if (st.size > MINI_IMAGE_VIEW_MAX_SOURCE_BYTES) {
      return { ok: false, text: `image_view failed: "${display}" is ${formatBytes(st.size)}, over the ${formatBytes(MINI_IMAGE_VIEW_MAX_SOURCE_BYTES)} limit.`, displayPath: display, size, color, analysisMode, detail };
    }
  } catch {
    return { ok: false, text: `image_view failed: cannot access "${display}" (missing file or unreadable). Check the path with sa_vm list_dir/find_files first.`, displayPath: display, size, color, analysisMode, detail };
  }

  const sharp = await loadSharp();
  if (!sharp) {
    // Degraded path: return raw bytes so the model can still see the image.
    const ext = abs.split(".").pop()?.toLowerCase() ?? "";
    const mime = EXT_MIME[ext];
    if (!mime || mime === "image/svg+xml") {
      return { ok: false, text: `image_view failed: "${display}" has an unsupported or unknown image format${size !== "original" || color !== "rgb" ? " (and resize/convert is unavailable in this runtime)" : ""}.`, displayPath: display, size, color, analysisMode, detail };
    }
    if (info.size > MINI_IMAGE_VIEW_MAX_OUTPUT_BYTES) {
      return { ok: false, text: `image_view failed: "${display}" is ${formatBytes(info.size)} and resize is unavailable in this runtime - pick a smaller file.`, displayPath: display, size, color, analysisMode, detail };
    }
    const buf = await readFile(abs);
    return {
      ok: true,
      text: `viewed image "${display}" (${mime}, ${formatBytes(buf.length)}, mode=${analysisMode} detail=${detail}, original bytes - resize/convert unavailable in this runtime). The image is attached to this result; inspect it visually before summarizing.`,
      dataUrl: `data:${mime};base64,${buf.toString("base64")}`,
      mimeType: mime,
      bytes: buf.length,
      displayPath: display,
      size,
      color,
      analysisMode,
      detail,
      degraded: true,
    };
  }

  try {
    const input = await readFile(abs);
    let pipeline = sharp(input, { animated: false });
    const meta = await pipeline.metadata();
    const isGif = (meta.format ?? "").toLowerCase() === "gif";
    if (size === "720p") {
      pipeline = pipeline.resize({ width: IMAGE_720P_WIDTH, height: IMAGE_720P_HEIGHT, fit: "inside", withoutEnlargement: true });
    }
    let mime: string;
    if (color === "gray") {
      mime = "image/jpeg";
      pipeline = pipeline.grayscale().jpeg({ quality: size === "original" ? 90 : 82 });
    } else if (color === "rgba") {
      mime = "image/png";
      pipeline = pipeline.png();
    } else {
      mime = "image/jpeg";
      pipeline = pipeline.flatten({ background: "#ffffff" }).jpeg({ quality: size === "original" ? 90 : 82 });
    }
    const { data, info: outInfo } = await pipeline.toBuffer({ resolveWithObject: true });
    if (data.length > MINI_IMAGE_VIEW_MAX_OUTPUT_BYTES) {
      return { ok: false, text: `image_view failed: processed "${display}" is ${formatBytes(data.length)} (over limit) - retry with size "720p" and color "gray".`, displayPath: display, size, color, analysisMode, detail };
    }
    const suffix = isGif ? " (first frame)" : "";
    return {
      ok: true,
      text: `viewed image "${display}" (${outInfo.width}x${outInfo.height} ${mime}, ${formatBytes(data.length)}, mode=${analysisMode} detail=${detail} size=${size} color=${color})${suffix}. The image is attached to this result; inspect it visually before summarizing.`,
      dataUrl: `data:${mime};base64,${data.toString("base64")}`,
      mimeType: mime,
      width: outInfo.width,
      height: outInfo.height,
      bytes: data.length,
      displayPath: display,
      size,
      color,
      analysisMode,
      detail,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, text: `image_view failed: "${display}" could not be decoded as an image (${msg.slice(0, 200)}). Verify it is a valid png/jpg/webp/gif/bmp file.`, displayPath: display, size, color, analysisMode, detail };
  }
}

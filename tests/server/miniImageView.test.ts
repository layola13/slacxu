import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
  MINI_IMAGE_VIEW_DEFAULT_COLOR,
  MINI_IMAGE_VIEW_DEFAULT_SIZE,
  MINI_IMAGE_VIEW_TOOL,
  expandLeadingTilde,
  isRemoteImageRef,
  miniImageViewArgError,
  normalizeMiniImageColor,
  normalizeMiniImageSize,
  runMiniImageView,
} from "../../backends/mini/src/runtime/imageView.ts";
import { chooseMiniImageAnalysisProfile } from "../../backends/mini/src/runtime/miniImageAnalysisPolicy.ts";
import {
  expandMiniTildeArgs,
  historyItemToText,
  miniToolArgValidationError,
  miniToolsForDepth,
} from "../../backends/mini/src/runtime/miniBridge.ts";

// 1x1 transparent PNG fixture (no sharp needed to create it).
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==";

async function loadSharpForFixture(): Promise<any> {
  try {
    // @ts-ignore - optional dependency
    const mod = await import("sharp");
    return (mod as any)?.default ?? (mod as any) ?? null;
  } catch {
    return null;
  }
}

describe("mini image_view params", () => {
  test("size enum is case-insensitive with sensible aliases", () => {
    expect(normalizeMiniImageSize("720p")).toBe("720p");
    expect(normalizeMiniImageSize("720P")).toBe("720p");
    expect(normalizeMiniImageSize("original")).toBe("original");
    expect(normalizeMiniImageSize("原始")).toBeUndefined();
    expect(normalizeMiniImageSize("4k")).toBeUndefined();
    expect(normalizeMiniImageSize(undefined)).toBeUndefined();
    expect(MINI_IMAGE_VIEW_DEFAULT_SIZE).toBe("720p");
  });

  test("color enum covers rgba/rgb/gray with grey alias", () => {
    expect(normalizeMiniImageColor("rgba")).toBe("rgba");
    expect(normalizeMiniImageColor("RGB")).toBe("rgb");
    expect(normalizeMiniImageColor("gray")).toBe("gray");
    expect(normalizeMiniImageColor("grey")).toBe("gray");
    expect(normalizeMiniImageColor("cmyk")).toBeUndefined();
    expect(MINI_IMAGE_VIEW_DEFAULT_COLOR).toBe("rgb");
  });

  test("arg validation guides the model without executing", () => {
    expect(miniImageViewArgError({})).toMatch(/path/);
    expect(miniImageViewArgError({ path: "  " })).toMatch(/path/);
    expect(miniImageViewArgError({ path: "a.png", size: "4k" })).toMatch(/size/);
    expect(miniImageViewArgError({ path: "a.png", color: "cmyk" })).toMatch(/color/);
    expect(miniImageViewArgError({ path: "a.png", analysisMode: "unknown" })).toMatch(/analysisMode/);
    expect(miniImageViewArgError({ path: "a.png" })).toBeNull();
    expect(miniImageViewArgError({ path: "a.png", size: "720P", color: "GRAY" })).toBeNull();
    expect(miniToolArgValidationError("image_view", {})).toMatch(/path/);
    expect(miniToolArgValidationError("image_view", { path: "a.png" })).toBeNull();
  });

  test("JEV analysis profiles select economical model input", () => {
    expect(chooseMiniImageAnalysisProfile("ocr")).toEqual({ mode: "ocr", size: "original", color: "gray", detail: "high" });
    expect(chooseMiniImageAnalysisProfile("pixel")).toEqual({ mode: "pixel", size: "original", color: "rgba", detail: "high" });
    expect(chooseMiniImageAnalysisProfile("shape")).toEqual({ mode: "shape", size: "original", color: "gray", detail: "high" });
    expect(chooseMiniImageAnalysisProfile("auto", "读取网页文字").mode).toBe("ocr");
    expect(chooseMiniImageAnalysisProfile(undefined, "分析物体轮廓").mode).toBe("shape");
    expect(chooseMiniImageAnalysisProfile(undefined, "分析浏览器布局").mode).toBe("ui");
    expect(chooseMiniImageAnalysisProfile(undefined, "分析架构图").mode).toBe("diagram");
    expect(chooseMiniImageAnalysisProfile("auto").mode).toBe("auto");
  });

  test("tool spec exposes path/size/color for model choice", () => {
    expect(MINI_IMAGE_VIEW_TOOL.name).toBe("image_view");
    expect((MINI_IMAGE_VIEW_TOOL.schema.required as string[])).toContain("path");
    const props = MINI_IMAGE_VIEW_TOOL.schema.properties as Record<string, { enum?: string[] }>;
    expect(props.size?.enum).toEqual(["original", "720p"]);
    expect(props.color?.enum).toEqual(["rgba", "rgb", "gray"]);
  });

  test("mini tool list includes image_view at every depth", () => {
    expect(miniToolsForDepth(0).map((t) => t.name)).toContain("image_view");
    expect(miniToolsForDepth(1).map((t) => t.name)).toContain("image_view");
  });

  test("imageView history stays a one-line marker (no base64 leak)", () => {
    expect(historyItemToText({ type: "imageView", path: "shots/a.png", status: "completed" })).toBe("[viewed image: shots/a.png]");
  });
});

describe("mini image_view execution", () => {
  test("reads a png and returns an attachable data URL", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mini-img-"));
    try {
      const file = join(dir, "tiny.png");
      await writeFile(file, Buffer.from(TINY_PNG_BASE64, "base64"));
      const viewed = await runMiniImageView({ path: "tiny.png" }, dir);
      expect(viewed.ok).toBe(true);
      expect(viewed.dataUrl?.startsWith("data:image/")).toBe(true);
      expect(viewed.text).toMatch(/viewed image/);
      expect(viewed.displayPath).toBe("tiny.png");
      expect(viewed.analysisMode).toBe("auto");
      expect(viewed.detail).toBe("auto");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("missing files and non-images fail with guidance, not crashes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mini-img-"));
    try {
      const missing = await runMiniImageView({ path: "nope.png" }, dir);
      expect(missing.ok).toBe(false);
      expect(missing.text).toMatch(/cannot access/);
      expect(missing.analysisMode).toBe("auto");
      expect(missing.detail).toBe("auto");
      await writeFile(join(dir, "note.txt"), "hello");
      const notImage = await runMiniImageView({ path: "note.txt" }, dir);
      expect(notImage.ok).toBe(false);
      const remote = await runMiniImageView({ path: "https://example.com/a.png" }, dir);
      expect(remote.ok).toBe(false);
      expect(remote.text).toMatch(/remote URLs are not supported/);
      await mkdir(join(dir, "shots"), { recursive: true });
      const dirHit = await runMiniImageView({ path: "shots" }, dir);
      expect(dirHit.ok).toBe(false);
      expect(dirHit.text).toMatch(/list_dir/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("leading ~ resolves to the home directory", async () => {
    expect(expandLeadingTilde("~")).toBe(homedir());
    expect(expandLeadingTilde("~/a/b.png")).toBe(join(homedir(), "a/b.png"));
    expect(expandLeadingTilde("relative/a.png")).toBe("relative/a.png");
    expect(expandLeadingTilde("~other/a.png")).toBe("~other/a.png");
    expect(isRemoteImageRef("https://example.com/a.png")).toBe(true);
    expect(isRemoteImageRef("shots/a.png")).toBe(false);
    // End to end through a real home-relative file.
    const homeSub = join(homedir(), ".mini-img-test-tilde");
    await mkdir(homeSub, { recursive: true });
    try {
      await writeFile(join(homeSub, "tiny.png"), Buffer.from(TINY_PNG_BASE64, "base64"));
      const viewed = await runMiniImageView({ path: "~/.mini-img-test-tilde/tiny.png" }, tmpdir());
      expect(viewed.ok).toBe(true);
      expect(viewed.dataUrl?.startsWith("data:image/")).toBe(true);
    } finally {
      await rm(homeSub, { recursive: true, force: true });
    }
  });

  test("only path-like fields expand, code fields stay intact", () => {
    const out = expandMiniTildeArgs({
      action: "read_file",
      path: "~/notes/a.md",
      content: "~/not-a-path",
      source: "~/also-code",
      query: "~/query-text",
      pattern: "~/glob",
    });
    expect(out.path).toBe(join(homedir(), "notes/a.md"));
    expect(out.content).toBe("~/not-a-path");
    expect(out.source).toBe("~/also-code");
    expect(out.query).toBe("~/query-text");
    expect(out.pattern).toBe("~/glob");
  });

  test("batched tasks expand one level down", () => {
    const out = expandMiniTildeArgs({
      action: "parallel",
      parallel: [
        { action: "read_file", path: "~/a.md" },
        { action: "list_dir", dir: "relative" },
        "not-an-object",
      ],
    });
    expect(out.parallel[0].path).toBe(join(homedir(), "a.md"));
    expect(out.parallel[1].dir).toBe("relative");
    expect(out.parallel[2]).toBe("not-an-object");
  });
});

describe("mini image_view execution (resize)", () => {
  test("720p downscales and gray/rgba pick matching mime types", async () => {
    const sharp = await loadSharpForFixture();
    if (!sharp) {
      // Degraded runtime: raw bytes still returned, conversions skipped.
      const dir = await mkdtemp(join(tmpdir(), "mini-img-"));
      try {
        const file = join(dir, "tiny.png");
        await writeFile(file, Buffer.from(TINY_PNG_BASE64, "base64"));
        const viewed = await runMiniImageView({ path: file }, dir);
        expect(viewed.ok).toBe(true);
        expect(viewed.degraded).toBe(true);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
      return;
    }
    const dir = await mkdtemp(join(tmpdir(), "mini-img-"));
    try {
      const big = join(dir, "big.png");
      await sharp({ create: { width: 2000, height: 1500, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 0.5 } } })
        .png()
        .toFile(big);
      const small = await runMiniImageView({ path: "big.png", size: "720p", color: "rgb" }, dir);
      expect(small.ok).toBe(true);
      expect(small.width).toBeLessThanOrEqual(1280);
      expect(small.height).toBeLessThanOrEqual(720);
      expect(small.mimeType).toBe("image/jpeg");
      const gray = await runMiniImageView({ path: "big.png", size: "720p", color: "gray" }, dir);
      expect(gray.ok).toBe(true);
      expect(gray.mimeType).toBe("image/jpeg");
      const alpha = await runMiniImageView({ path: "big.png", size: "720p", color: "rgba" }, dir);
      expect(alpha.ok).toBe(true);
      expect(alpha.mimeType).toBe("image/png");
      expect(alpha.dataUrl?.startsWith("data:image/png;base64,")).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("analysis mode and task are reflected in processed output", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mini-img-"));
    try {
      const file = join(dir, "tiny.png");
      await writeFile(file, Buffer.from(TINY_PNG_BASE64, "base64"));
      const ocr = await runMiniImageView({ path: "tiny.png", analysisMode: "ocr" }, dir);
      expect(ocr.ok).toBe(true);
      expect(ocr.analysisMode).toBe("ocr");
      expect(ocr.detail).toBe("high");
      expect(ocr.size).toBe("original");
      expect(ocr.color).toBe("gray");
      expect(ocr.text).toMatch(/mode=ocr/);

      const overridden = await runMiniImageView({ path: "tiny.png", analysisMode: "ocr", size: "720p", color: "rgb" }, dir);
      expect(overridden.analysisMode).toBe("ocr");
      expect(overridden.size).toBe("720p");
      expect(overridden.color).toBe("rgb");
      expect(overridden.detail).toBe("high");

      const ui = await runMiniImageView({ path: "tiny.png", task: "分析浏览器布局" }, dir);
      expect(ui.analysisMode).toBe("ui");
      expect(ui.detail).toBe("high");
      expect(ui.text).toMatch(/mode=ui/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

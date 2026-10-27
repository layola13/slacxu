import { expect, test } from "bun:test";
import { staticAssetContentType } from "../../apps/server/src/staticAssetContentType.ts";

test("serves SVG and common web assets with browser-compatible content types", () => {
  expect(staticAssetContentType("icons/codex-color.svg")).toBe("image/svg+xml; charset=utf-8");
  expect(staticAssetContentType("assets/main.js")).toBe("application/javascript; charset=utf-8");
  expect(staticAssetContentType("assets/font.woff2")).toBe("font/woff2");
});

test("does not guess unknown static asset content types", () => {
  expect(staticAssetContentType("asset.unknown")).toBeNull();
});

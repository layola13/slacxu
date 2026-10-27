// Unit tests for the auggie bridge's host-side image validation (H5 in
// docs/auggie-default-rollout-todolist.md). Auggie accepts images natively
// over ACP (jpeg/png/gif/webp, mimeType required, ≤10 per message, ≤5MB
// base64 per image and per message) — violations must surface as hard errors
// so the turn is rejected instead of silently dropping input.
import { describe, expect, test } from "bun:test";
import {
  buildAuggiePromptBlocks,
  extractAuggieTurnInput,
} from "../../backends/auggie/src/runtime/auggieAgentBridge.js";

const MB = 1024 * 1024;
const pngData = (chars: number) => "i".repeat(chars);

function imageBlock(overrides: Record<string, unknown> = {}) {
  return { type: "image", data: pngData(100), mimeType: "image/png", ...overrides };
}

describe("auggie image passthrough validation", () => {
  test("text-only prompts produce no blocks beyond text and no errors", () => {
    const input = extractAuggieTurnInput({ prompt: "hello" });
    expect(input.errors).toEqual([]);
    expect(input.images).toEqual([]);
    expect(buildAuggiePromptBlocks(input.text, input.images)).toEqual([{ type: "text", text: "hello" }]);
  });

  test("valid image block passes through with mimeType preserved", () => {
    const input = extractAuggieTurnInput({ prompt: [{ type: "text", text: "look" }, imageBlock()] } as never);
    expect(input.errors).toEqual([]);
    expect(input.warnings).toEqual([]);
    expect(input.text).toBe("look");
    expect(input.images).toEqual([{ type: "image", data: pngData(100), mimeType: "image/png" }]);
    expect(buildAuggiePromptBlocks(input.text, input.images)).toHaveLength(2);
  });

  test("data-URI url shape is decoded into mimeType + base64 data", () => {
    const input = extractAuggieTurnInput({
      prompt: [{ type: "image", url: `data:image/webp;base64,${pngData(64)}` }],
    } as never);
    expect(input.errors).toEqual([]);
    expect(input.images).toEqual([{ type: "image", data: pngData(64), mimeType: "image/webp" }]);
  });

  test("missing mimeType is a hard error", () => {
    const input = extractAuggieTurnInput({ prompt: [imageBlock({ mimeType: undefined })] } as never);
    expect(input.images).toEqual([]);
    expect(input.errors.some((error) => error.includes("missing its required mimeType"))).toBe(true);
  });

  test("unsupported mimeType (e.g. bmp/svg) is a hard error", () => {
    for (const mimeType of ["image/bmp", "image/svg+xml"]) {
      const input = extractAuggieTurnInput({ prompt: [imageBlock({ mimeType })] } as never);
      expect(input.errors.some((error) => error.includes(mimeType))).toBe(true);
    }
  });

  test("empty base64 data is a hard error", () => {
    const input = extractAuggieTurnInput({ prompt: [imageBlock({ data: "" })] } as never);
    expect(input.errors.some((error) => error.includes("no base64 data"))).toBe(true);
  });

  test("a single image over the 5MB base64 cap is rejected", () => {
    const input = extractAuggieTurnInput({ prompt: [imageBlock({ data: pngData(5 * MB + 1) })] } as never);
    expect(input.errors.some((error) => error.includes("5MB base64 limit"))).toBe(true);
  });

  test("more than 10 images per message is rejected", () => {
    const blocks = Array.from({ length: 11 }, () => imageBlock());
    const input = extractAuggieTurnInput({ prompt: ["many", ...blocks] } as never);
    expect(input.images).toHaveLength(11);
    expect(input.errors.some((error) => error.includes("at most 10 images"))).toBe(true);
  });

  test("exactly 10 small images stay within every limit", () => {
    const blocks = Array.from({ length: 10 }, () => imageBlock());
    const input = extractAuggieTurnInput({ prompt: ["ok", ...blocks] } as never);
    expect(input.errors).toEqual([]);
    expect(input.images).toHaveLength(10);
  });

  test("combined base64 across images over the 5MB message budget is rejected even when each fits", () => {
    const half = pngData(3 * MB);
    const input = extractAuggieTurnInput({
      prompt: [imageBlock({ data: half }), imageBlock({ data: half })],
    } as never);
    expect(input.errors.some((error) => error.includes("per message"))).toBe(true);
  });

  test("unknown prompt block types degrade to warnings, not errors", () => {
    const input = extractAuggieTurnInput({ prompt: [{ type: "resource_link", uri: "x" }] } as never);
    expect(input.errors).toEqual([]);
    expect(input.warnings).toHaveLength(1);
  });
});

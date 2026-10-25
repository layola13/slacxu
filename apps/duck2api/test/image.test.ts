import { describe, expect, test } from "bun:test";
import { parseImageEvent, readImageResponse } from "../src/duckgo/image.js";

const UI_COMPONENT = JSON.stringify({
  action: "success",
  toolName: "GenerateImage",
  data: { b64Image: "AAA", format: "png", width: 1024, height: 1024 },
});
const LEGACY_PART = JSON.stringify({
  action: "success",
  message: "here",
  parts: [{ type: "generated-image", result: "BBB", format: "jpeg" }],
});
const TOOL_CALL = JSON.stringify({
  action: "success",
  role: "tool-invocation",
  state: "call",
  toolName: "WebSearch",
});

describe("readImageResponse (Go image.go parity)", () => {
  test("extracts ui-component GenerateImage plus legacy parts and text", () => {
    const sse = [
      `data: ${TOOL_CALL}`,
      `data: ${LEGACY_PART}`,
      `data: ${UI_COMPONENT}`,
      "data: [DONE]",
      "data: [PING]",
      "",
    ].join("\n");
    const res = readImageResponse(sse);
    expect(res.text).toBe("here");
    expect(res.images).toEqual([
      { b64: "BBB", format: "jpeg" },
      { b64: "AAA", format: "png", width: 1024, height: 1024 },
    ]);
  });

  test("GenerateImage without image data yields no image", () => {
    const res = readImageResponse(`data: ${JSON.stringify({ action: "success", toolName: "GenerateImage" })}\n`);
    expect(res.images).toEqual([]);
  });

  test("non-success and malformed lines are skipped", () => {
    const res = readImageResponse(
      ['data: {"action":"error"}', "data: not-json", "data: [CHAT_TITLE test]", ": comment"].join("\n"),
    );
    expect(res).toEqual({ text: "", images: [] });
  });

  test("parseImageEvent handles bare JSON without data prefix", () => {
    const res = parseImageEvent(UI_COMPONENT);
    expect(res.images).toEqual([{ b64: "AAA", format: "png", width: 1024, height: 1024 }]);
  });
});

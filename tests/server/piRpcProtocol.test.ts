import { describe, expect, test } from "bun:test";
import {
  PiLineFramingBuffer,
  formatPiExtensionUIResponse,
  formatPiRpcCommand,
  parsePiRpcLine,
  sanitizePiRpcText,
} from "../../backends/pi/src/runtime/piRpcProtocol.ts";

describe("PiLineFramingBuffer", () => {
  test("splits single line ending with newline", () => {
    const buf = new PiLineFramingBuffer();
    const lines = buf.push('{"type":"agent_start"}\n');
    expect(lines).toEqual(['{"type":"agent_start"}']);
    expect(buf.remaining).toBe("");
  });

  test("buffers partial line across multiple chunks", () => {
    const buf = new PiLineFramingBuffer();
    expect(buf.push('{"type":')).toEqual([]);
    expect(buf.remaining).toBe('{"type":');
    expect(buf.push('"turn_start"}\n')).toEqual(['{"type":"turn_start"}']);
    expect(buf.remaining).toBe("");
  });

  test("handles multiple lines in single chunk with CRLF", () => {
    const buf = new PiLineFramingBuffer();
    const lines = buf.push('{"type":"1"}\r\n{"type":"2"}\n');
    expect(lines).toEqual(['{"type":"1"}', '{"type":"2"}']);
  });

  test("clear resets buffer", () => {
    const buf = new PiLineFramingBuffer();
    buf.push("incomplete");
    expect(buf.remaining).toBe("incomplete");
    buf.clear();
    expect(buf.remaining).toBe("");
  });
});

describe("parsePiRpcLine", () => {
  test("parses success response", () => {
    const line = '{"id":"1","type":"response","command":"prompt","success":true}';
    const msg = parsePiRpcLine(line);
    expect(msg).toBeDefined();
    expect(msg?.type).toBe("response");
    if (msg?.type === "response") {
      expect(msg.command).toBe("prompt");
      expect(msg.success).toBe(true);
    }
  });

  test("parses error response", () => {
    const line = '{"id":"2","type":"response","command":"prompt","success":false,"error":"Authentication failed"}';
    const msg = parsePiRpcLine(line);
    expect(msg?.type).toBe("response");
    if (msg?.type === "response") {
      expect(msg.success).toBe(false);
      expect((msg as any).error).toBe("Authentication failed");
    }
  });

  test("parses session events", () => {
    expect(parsePiRpcLine('{"type":"agent_start"}')?.type).toBe("agent_start");
    expect(parsePiRpcLine('{"type":"turn_start"}')?.type).toBe("turn_start");
    expect(parsePiRpcLine('{"type":"agent_settled"}')?.type).toBe("agent_settled");
  });

  test("parses extension_ui_request", () => {
    const line = '{"type":"extension_ui_request","id":"uuid-123","method":"confirm","title":"Trust?","message":"Do you trust?"}';
    const msg = parsePiRpcLine(line);
    expect(msg?.type).toBe("extension_ui_request");
    expect((msg as any).id).toBe("uuid-123");
    expect((msg as any).method).toBe("confirm");
  });

  test("unknown event types pass through non-fatally", () => {
    const line = '{"type":"custom_future_event","payload":123}';
    const msg = parsePiRpcLine(line);
    expect(msg?.type).toBe("custom_future_event");
    expect((msg as any).payload).toBe(123);
  });

  test("returns null for malformed json or empty line", () => {
    expect(parsePiRpcLine("")).toBeNull();
    expect(parsePiRpcLine("   ")).toBeNull();
    expect(parsePiRpcLine("not json")).toBeNull();
    expect(parsePiRpcLine('{"no_type":true}')).toBeNull();
  });
});

describe("formatting and sanitization", () => {
  test("formatPiRpcCommand appends LF newline", () => {
    const cmd = formatPiRpcCommand({ type: "prompt", message: "hi" });
    expect(cmd.endsWith("\n")).toBe(true);
    expect(JSON.parse(cmd)).toEqual({ type: "prompt", message: "hi" });
  });

  test("formatPiExtensionUIResponse appends LF newline", () => {
    const res = formatPiExtensionUIResponse({ type: "extension_ui_response", id: "1", cancelled: true });
    expect(res.endsWith("\n")).toBe(true);
    expect(JSON.parse(res)).toEqual({ type: "extension_ui_response", id: "1", cancelled: true });
  });

  test("sanitizePiRpcText strips sensitive keys and tokens", () => {
    expect(sanitizePiRpcText("Error with sk-ant-api03-1234567890abcdef")).toBe("Error with sk-***");
    expect(sanitizePiRpcText("Header: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9")).toBe("Header: Bearer ***");
    expect(sanitizePiRpcText('{"apiKey": "sk-pi-spike-test-key-1234"}')).toContain("***");
  });
});

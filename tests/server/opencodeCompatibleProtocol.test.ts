import { describe, expect, test } from "bun:test";
import {
  parseOpencodeSseChunk,
  splitOpencodeSseRecords,
  type OpencodeMessagePartDeltaEvent,
  type OpencodeMessagePartUpdatedEvent,
  type OpencodePermissionAskedEvent,
  type OpencodeSessionErrorEvent,
  type OpencodeSessionIdleEvent,
} from "../../backends/opencode/src/runtime/opencodeCompatibleProtocol.js";

describe("opencodeCompatibleProtocol", () => {
  test("parseOpencodeSseChunk parses valid SSE data blocks", () => {
    const chunk = [
      'data: {"id":"1","type":"server.connected"}',
      "",
      'data: {"id":"2","type":"session.idle","properties":{"sessionID":"ses_123"}}',
      "",
    ].join("\n");

    const events = parseOpencodeSseChunk(chunk);
    expect(events.length).toBe(2);
    expect(events[0].type).toBe("server.connected");
    expect(events[1].type).toBe("session.idle");
    expect((events[1] as OpencodeSessionIdleEvent).properties.sessionID).toBe("ses_123");
  });

  test("splitOpencodeSseRecords handles Windows CRLF without replaying prior events", () => {
    const split = splitOpencodeSseRecords(
      "data: {\"id\":\"one\",\"type\":\"server.heartbeat\"}\r\n\r\ndata: {\"id\":\"two\",\"type\":\"server.connected\"}\r\n"
    );
    expect(split.records).toHaveLength(1);
    expect(split.records[0]).toContain("one");
    expect(split.remainder).toContain("two");
  });

  test("parseOpencodeSseChunk handles multiline or trailing data", () => {
    const chunk = 'data: {"id":"3","type":"message.part.delta","properties":{"sessionID":"ses_1","messageID":"msg_1","partID":"prt_1","field":"text","delta":"Hello"}}\n';
    const events = parseOpencodeSseChunk(chunk);
    expect(events.length).toBe(1);
    const delta = events[0] as OpencodeMessagePartDeltaEvent;
    expect(delta.properties.delta).toBe("Hello");
    expect(delta.properties.field).toBe("text");
  });

  test("parseOpencodeSseChunk ignores invalid JSON and non-events", () => {
    const chunk = [
      "event: ping",
      ": comment",
      "data: not-json",
      "",
      'data: {"id":"4","type":"session.error","properties":{"error":{"message":"Upstream 500"}}}',
      "",
    ].join("\n");

    const events = parseOpencodeSseChunk(chunk);
    expect(events.length).toBe(1);
    expect(events[0].type).toBe("session.error");
    expect((events[0] as OpencodeSessionErrorEvent).properties.error?.message).toBe("Upstream 500");
  });

  test("validates permission.asked event shape", () => {
    const chunk = 'data: {"id":"5","type":"permission.asked","properties":{"id":"per_123","sessionID":"ses_1","permission":"bash","patterns":["ls -la"]}}\n\n';
    const events = parseOpencodeSseChunk(chunk);
    expect(events.length).toBe(1);
    const asked = events[0] as OpencodePermissionAskedEvent;
    expect(asked.properties.id).toBe("per_123");
    expect(asked.properties.permission).toBe("bash");
    expect(asked.properties.patterns).toEqual(["ls -la"]);
  });
});

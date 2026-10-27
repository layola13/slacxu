import { expect, test } from "bun:test";
import { sanitizeRelayErrorText, turnToWorkbenchTurn } from "../../apps/web/src/state/codexClient";

const RAW_400 =
  'chat 400: {"error":{"message":"{\\"action\\":\\"error\\",\\"status\\":400,\\"type\\":\\"ERR_BAD_REQUEST\\"}","type":"relay_protocol_error","code":400}}';

test("raw relay 400 JSON collapses to a friendly message", () => {
  const out = sanitizeRelayErrorText(RAW_400);
  expect(out).not.toContain("relay_protocol_error");
  expect(out).not.toContain("ERR_BAD_REQUEST");
  expect(out).toContain("400");
  expect(out).toContain("重试");
});

test("relay 400 keeps the upstream reason instead of hiding it", () => {
  const out = sanitizeRelayErrorText(
    'chat 400: {"error":{"message":"Request must be proper JSON","type":"relay_protocol_error","code":400}}',
  );
  expect(out).not.toContain("relay_protocol_error");
  expect(out).toContain("relay 400");
  expect(out).toContain("Request must be proper JSON");
  expect(out).not.toContain("偶发");
});

test("nested upstream error blobs collapse to generic copy without leaking", () => {
  const out = sanitizeRelayErrorText(
    'chat 400: {"error":{"message":"{\\"type\\":\\"upstream_error\\",\\"code\\":\\"418\\"}","type":"relay_protocol_error","code":400}}',
  );
  expect(out).not.toContain("relay_protocol_error");
  expect(out).toContain("relay 400");
  expect(out).toContain("重试");
});

test("non-relay text passes through untouched", () => {
  expect(sanitizeRelayErrorText("Hi! What can I help you with?")).toBe("Hi! What can I help you with?");
  expect(sanitizeRelayErrorText("")).toBe("");
});

test("failed turn items no longer leak raw relay JSON", () => {
  const turn = turnToWorkbenchTurn("thread-1", {
    id: "turn-1",
    status: "failed",
    items: [{ id: "item-1", type: "agentMessage", text: RAW_400, status: "failed" }],
  });
  expect(turn?.items[0]?.text).not.toContain("relay_protocol_error");
  expect(turn?.items[0]?.text).toContain("重试");
});

import { expect, test } from "bun:test";
import { FreeCompactionFallbackTracker, inspectCompactionRelayRequest, isCompactionRelayRequest, isFreeCompactionFallbackStatus, resolveCompactionRelayRoute } from "../../backends/free-mode/src/free/compactionRelayRequest.ts";
import type { ThreadRuntimeMetadata } from "@codex-ui/shared";

function metadata(overrides: Partial<ThreadRuntimeMetadata> = {}): ThreadRuntimeMetadata {
  return {
    threadId: "thread-a",
    providerId: "paid-relay",
    groupId: "paid-group",
    model: "gpt-5.6-luna[270k]",
    reasoningEffort: "high",
    freeAutoCompactEnabled: true,
    freeAutoCompactThreshold: 80,
    freeAutoCompactModel: null,
    freeAutoCompactProviderId: null,
    freeAutoCompactGroupId: null,
    createdAt: 1,
    updatedAt: 2,
    ...overrides
  };
}

test("routes only explicitly selected compaction channels", () => {
  expect(resolveCompactionRelayRoute(metadata())).toBeNull();

  expect(resolveCompactionRelayRoute(metadata({
    freeAutoCompactProviderId: "custom-free",
    freeAutoCompactGroupId: "free-group",
    freeAutoCompactModel: "free-compact-model"
  }))).toEqual({
    providerId: "custom-free",
    groupId: "free-group",
    model: "free-compact-model"
  });
});

test("never changes the main selection or another thread route", () => {
  const first = metadata();
  const second = metadata({
    threadId: "thread-b",
    providerId: "nvidia",
    groupId: "nvidia-group",
    model: "gpt-5.4[190k]",
    freeAutoCompactEnabled: false
  });

  resolveCompactionRelayRoute(first);
  expect(first).toMatchObject({ providerId: "paid-relay", groupId: "paid-group", model: "gpt-5.6-luna[270k]" });
  expect(resolveCompactionRelayRoute(second)).toBeNull();
  expect(second).toMatchObject({ providerId: "nvidia", groupId: "nvidia-group", model: "gpt-5.4[190k]" });
});

test("rejects incomplete and hidden manual routes", () => {
  expect(resolveCompactionRelayRoute(metadata({ model: "unknown-model[270k]" }))).toBeNull();
  expect(resolveCompactionRelayRoute(metadata({ model: "gpt-5.4[190k]" }))).toBeNull();
  expect(resolveCompactionRelayRoute(metadata({
    freeAutoCompactProviderId: "omniroute-free",
    freeAutoCompactGroupId: "opencode-free",
    freeAutoCompactModel: "big-pickle"
  }))).toBeNull();
});

test("detects local Codex compaction on the normal Responses endpoint", async () => {
  const request = new Request("http://127.0.0.1/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-codex-turn-metadata": JSON.stringify({
        session_id: "thread-a",
        thread_id: "thread-a",
        request_kind: "compaction",
        compaction: { trigger: "auto", implementation: "local" }
      })
    },
    body: JSON.stringify({ model: "gpt-5.6-luna", input: [{ type: "message" }] })
  });

  expect(await isCompactionRelayRequest(request)).toBe(true);
  expect(await inspectCompactionRelayRequest(request)).toEqual({
    isCompaction: true,
    threadId: "thread-a",
    turnId: null
  });
});

test("does not classify a normal Responses request as compaction", async () => {
  const request = new Request("http://127.0.0.1/v1/responses", {
    method: "POST",
    headers: { "x-codex-turn-metadata": JSON.stringify({ request_kind: "turn" }) },
    body: JSON.stringify({ model: "gpt-5.6-luna", input: [{ type: "message" }] })
  });

  expect(await isCompactionRelayRequest(request)).toBe(false);
});

test("detects compaction metadata carried in the Responses body", async () => {
  const request = new Request("http://127.0.0.1/v1/responses", {
    method: "POST",
    body: JSON.stringify({
      model: "gpt-5.6-luna",
      client_metadata: {
        "x-codex-turn-metadata": JSON.stringify({ request_kind: "compaction" })
      },
      input: []
    })
  });

  expect(await isCompactionRelayRequest(request)).toBe(true);
});

test("detects object compaction metadata carried in the Responses body", async () => {
  const request = new Request("http://127.0.0.1/v1/responses", {
    method: "POST",
    body: JSON.stringify({
      model: "gpt-5.6-luna",
      client_metadata: {
        "x-codex-turn-metadata": { request_kind: "compaction" }
      },
      input: []
    })
  });

  expect(await isCompactionRelayRequest(request)).toBe(true);
});

test("falls back after three free failures without affecting other threads", () => {
  const tracker = new FreeCompactionFallbackTracker(3, 60_000);
  expect(tracker.recordFailure("thread-a", "turn-a")).toEqual({ failures: 1, fallbackNow: false });
  expect(tracker.recordFailure("thread-a", "turn-a")).toEqual({ failures: 2, fallbackNow: false });
  expect(tracker.recordFailure("thread-a", "turn-a")).toEqual({ failures: 3, fallbackNow: true });
  expect(tracker.shouldUseNative("thread-a", "turn-a")).toBe(true);
  expect(tracker.shouldUseNative("thread-b", "turn-a")).toBe(false);
  expect(tracker.shouldUseNative("thread-a", "turn-b")).toBe(false);
});

test("counts only throttling and upstream server failures", () => {
  expect(isFreeCompactionFallbackStatus(429)).toBe(true);
  expect(isFreeCompactionFallbackStatus(500)).toBe(true);
  expect(isFreeCompactionFallbackStatus(503)).toBe(true);
  expect(isFreeCompactionFallbackStatus(400)).toBe(false);
  expect(isFreeCompactionFallbackStatus(404)).toBe(false);
});

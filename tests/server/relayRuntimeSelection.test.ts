import { expect, test } from "bun:test";
import { resolveRelayGatewayTarget, resolveRelayRuntimeOwnerId } from "../../apps/server/src/relayRuntimeSelection.ts";

test("routes the next Responses request using the latest thread relay selection", () => {
  const target = resolveRelayGatewayTarget(
    new Headers({ "session-id": "thread-1" }),
    { providerId: "old-relay", groupId: "old-group" },
    (threadId) => ({
      threadId,
      providerId: "new-relay",
      groupId: "new-group",
      model: "gpt-5.6",
      reasoningEffort: "high",
      createdAt: 1,
      updatedAt: 2
    })
  );

  expect(target).toEqual({ providerId: "new-relay", groupId: "new-group", threadId: "thread-1" });
});

test("keeps the configured gateway path when the request has no thread selection", () => {
  expect(resolveRelayGatewayTarget(
    new Headers(),
    { providerId: "configured-relay", groupId: "configured-group" },
    () => null
  )).toEqual({ providerId: "configured-relay", groupId: "configured-group", threadId: null });
});

test("does not apply legacy local metadata to an unclaimed membership thread", () => {
  const ownerId = resolveRelayRuntimeOwnerId("legacy-thread", true, () => null);
  const target = resolveRelayGatewayTarget(
    new Headers({ "session-id": "legacy-thread" }),
    { providerId: "anyrouter", groupId: "gpt" },
    () => ownerId ? {
      threadId: "legacy-thread",
      providerId: "deepseek",
      groupId: "legacy-default",
      model: "deepseek-v4-flash",
      reasoningEffort: "high",
      createdAt: 1,
      updatedAt: 2
    } : null
  );

  expect(ownerId).toBeNull();
  expect(target).toEqual({ providerId: "anyrouter", groupId: "gpt", threadId: "legacy-thread" });
});

test("keeps local runtime switching when membership is disabled", () => {
  expect(resolveRelayRuntimeOwnerId("local-thread", false, () => null)).toBe("local");
});

test("extracts a thread id from turn metadata headers", () => {
  const target = resolveRelayGatewayTarget(
    new Headers({ "x-codex-turn-metadata": JSON.stringify({ thread_id: "thread-meta" }) }),
    { providerId: "fallback", groupId: "group" },
    (threadId) => threadId === "thread-meta" ? {
      threadId,
      providerId: "relay-meta",
      groupId: "group-meta",
      model: "model",
      reasoningEffort: "medium",
      createdAt: 1,
      updatedAt: 2
    } : null
  );
  expect(target).toEqual({ providerId: "relay-meta", groupId: "group-meta", threadId: "thread-meta" });
});

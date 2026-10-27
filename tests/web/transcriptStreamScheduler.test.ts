import { expect, test } from "bun:test";
import {
  TranscriptStreamBuffer,
  MAX_TRANSCRIPT_BATCH_SIZE,
  MAX_TRANSCRIPT_QUEUE_CAP
} from "../../apps/web/src/app/transcripts/useTranscriptStreamScheduler";
import type { CodexNotification } from "../../apps/web/src/app/appReducer";

function createDeltaNotification(threadId: string, turnId: string, itemId: string, delta: string): CodexNotification {
  return {
    method: "item/agentMessage/delta",
    params: { threadId, turnId, itemId, delta }
  } as unknown as CodexNotification;
}

function createCompletedNotification(threadId: string, turnId: string, itemId: string): CodexNotification {
  return {
    method: "item/completed",
    params: { threadId, turnId, itemId }
  } as unknown as CodexNotification;
}

test("TranscriptStreamBuffer handles basic batch flush within limit", () => {
  const buffer = new TranscriptStreamBuffer(256);
  expect(buffer.hasPending).toBe(false);
  expect(buffer.size).toBe(0);

  buffer.enqueue(createDeltaNotification("t1", "turn-1", "item-1", "hello "));
  buffer.enqueue(createDeltaNotification("t1", "turn-1", "item-1", "world"));

  expect(buffer.hasPending).toBe(true);
  expect(buffer.size).toBe(2);

  const batch = buffer.flushNextBatch();
  expect(batch).not.toBe(null);
  // Delats for the same target should be coalesced into 1
  expect(batch!.length).toBe(1);
  const params = (batch![0] as any).params;
  expect(params.delta).toBe("hello world");
  expect(buffer.hasPending).toBe(false);
});

test("TranscriptStreamBuffer collapses 1,000 background streaming deltas into 1 batch", () => {
  const buffer = new TranscriptStreamBuffer(256);

  // Simulate a tab in background receiving 1,000 rapid text deltas for one turn
  for (let i = 0; i < 1000; i++) {
    buffer.enqueue(createDeltaNotification("thread-bg", "turn-bg", "item-bg", `token${i} `));
  }

  // Because queue exceeded 512, proactive coalescing kept queue bounded
  expect(buffer.hasPending).toBe(true);

  // Flushing next batch coalesces the entire queue first
  const batch = buffer.flushNextBatch();
  expect(batch).not.toBe(null);
  expect(batch!.length).toBe(1);

  const params = (batch![0] as any).params;
  expect(params.delta).toContain("token0 ");
  expect(params.delta).toContain("token999 ");

  // The queue is now completely drained in a single shot without 10s of trailing yields
  expect(buffer.hasPending).toBe(false);
  expect(buffer.size).toBe(0);
});

test("TranscriptStreamBuffer preserves lifecycle events and distinct targets across turns", () => {
  const buffer = new TranscriptStreamBuffer(256);

  // Agent 1 streaming
  buffer.enqueue(createDeltaNotification("t1", "turn-1", "agent-1", "Thinking "));
  buffer.enqueue(createDeltaNotification("t1", "turn-1", "agent-1", "step 1."));
  buffer.enqueue(createCompletedNotification("t1", "turn-1", "agent-1"));

  // Agent 2 streaming in parallel
  buffer.enqueue(createDeltaNotification("t1", "turn-1", "agent-2", "Writing "));
  buffer.enqueue(createDeltaNotification("t1", "turn-1", "agent-2", "code."));
  buffer.enqueue(createCompletedNotification("t1", "turn-1", "agent-2"));

  const batch = buffer.flushNextBatch();
  expect(batch).not.toBe(null);
  expect(batch!.length).toBe(4);

  // Target 1 delta coalesced
  expect((batch![0] as any).params.delta).toBe("Thinking step 1.");
  // Target 1 completion preserved
  expect(batch![1].method).toBe("item/completed");
  expect((batch![1] as any).params.itemId).toBe("agent-1");

  // Target 2 delta coalesced
  expect((batch![2] as any).params.delta).toBe("Writing code.");
  // Target 2 completion preserved
  expect(batch![3].method).toBe("item/completed");
  expect((batch![3] as any).params.itemId).toBe("agent-2");
});

test("TranscriptStreamBuffer enforces safety queue cap and retains terminal lifecycle events", () => {
  const buffer = new TranscriptStreamBuffer(256);

  // Push 5,000 distinct non-coalescible notifications
  for (let i = 0; i < 5000; i++) {
    buffer.enqueue(createCompletedNotification("t1", `turn-${i}`, `item-${i}`));
  }

  // Coalesce queue should enforce MAX_TRANSCRIPT_QUEUE_CAP
  buffer.coalesceQueue();
  expect(buffer.size).toBeLessThanOrEqual(MAX_TRANSCRIPT_QUEUE_CAP);
});

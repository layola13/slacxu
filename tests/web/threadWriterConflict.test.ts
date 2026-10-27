import { expect, test } from "bun:test";
import { isThreadWriterConflict } from "../../apps/web/src/app/threadWriterConflict.ts";

test("recognizes Codex thread writer conflicts from errors and RPC payloads", () => {
  expect(isThreadWriterConflict(new Error("thread-store conflict: thread abc already has an active writer"))).toBe(true);
  expect(isThreadWriterConflict({ code: -32000, message: "Thread already has an active writer" })).toBe(true);
  expect(isThreadWriterConflict(new Error("Thread abc is open in another Codex Ultra instance"))).toBe(true);
});

test("does not classify ordinary relay and transcript failures as writer conflicts", () => {
  expect(isThreadWriterConflict(new Error("Request 'thread/start' timed out"))).toBe(false);
  expect(isThreadWriterConflict({ message: "Model provider not found" })).toBe(false);
});

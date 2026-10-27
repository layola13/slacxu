import { expect, test } from "bun:test";
import {
  CODEX_STREAM_RETRY_DEFAULT,
  CODEX_STREAM_RETRY_MAX,
  CODEX_STREAM_RETRY_MIN,
  clampRetryCount
} from "../../apps/web/src/state/retrySettings";

test("uses the official Codex stream retry default and enforces 5-100", () => {
  expect(CODEX_STREAM_RETRY_DEFAULT).toBe(5);
  expect(CODEX_STREAM_RETRY_MIN).toBe(5);
  expect(CODEX_STREAM_RETRY_MAX).toBe(100);
  expect(clampRetryCount(4)).toBe(5);
  expect(clampRetryCount("37")).toBe(37);
  expect(clampRetryCount(101)).toBe(100);
  expect(clampRetryCount("invalid")).toBe(5);
});

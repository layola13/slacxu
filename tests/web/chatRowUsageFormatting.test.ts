import { expect, test } from "bun:test";
import { formatElapsed, formatFirstToken } from "../../apps/web/src/waterfall/ChatRow";

test("first-token latency is independent per turn and normalizes mixed timestamp units", () => {
  expect(formatFirstToken(1_721_000_000, 1_721_000_001.25)).toBe("first 1.3s");
  expect(formatFirstToken(1_721_000_100_000, 1_721_000_101)).toBe("first 1.0s");
  expect(formatFirstToken(1_721_000_200, 1_721_000_203)).toBe("first 3.0s");
});

test("formats whole-turn elapsed time separately from item-local first-token time", () => {
  expect(formatFirstToken(282, 284)).toBe("first 2.0s");
  expect(formatElapsed(100, 284, 282)).toBe("elapsed 184s");
  expect(formatElapsed(100, 102, 100)).toBeNull();
});

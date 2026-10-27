import { expect, test } from "bun:test";
import {
  contextUsageMetrics,
  CONTEXT_USAGE_BASELINE_TOKENS,
  resolveContextWindowOverrideUpdate,
  resolveDisplayedContextWindow,
  resolveReportedContextWindow
} from "../../apps/web/src/contextUsage.ts";

test("uses current context usage instead of cumulative totals", () => {
  const metrics = contextUsageMetrics({ usedTokens: 249_000, contextWindow: 998_000 });
  expect(metrics.percentage).toBe(24);
  expect(metrics.ratio).toBeCloseTo((249_000 - CONTEXT_USAGE_BASELINE_TOKENS) / (998_000 - CONTEXT_USAGE_BASELINE_TOKENS));
});

test("clamps over-limit usage without displaying an impossible percentage", () => {
  expect(contextUsageMetrics({ usedTokens: 1_800_000, contextWindow: 258_000 })).toMatchObject({ ratio: 1, percentage: 100 });
});

test("prefers the active thread context window while runtime metadata refreshes", () => {
  expect(resolveDisplayedContextWindow(1_000_000, 258_000)).toBe(1_000_000);
  expect(resolveDisplayedContextWindow(null, 258_000)).toBe(258_000);
});

test("keeps the previous thread override until its runtime selection is loaded", () => {
  expect(resolveContextWindowOverrideUpdate("", 258_000)).toBeUndefined();
  expect(resolveContextWindowOverrideUpdate("gpt-5.6-luna", 1_000_000)).toBe(1_000_000);
});

test("trusts Codex effective window but preserves Claude explicit variants", () => {
  expect(resolveReportedContextWindow("codex", 950_000, 1_000_000)).toBe(950_000);
  expect(resolveReportedContextWindow("claude", 200_000, 1_000_000)).toBe(1_000_000);
  expect(resolveReportedContextWindow("codex", null, 257_000)).toBe(257_000);
});

test("keeps an explicit relay-group window above CLI stats", () => {
  expect(resolveReportedContextWindow("codex", 258_000, 258_000, 200_000)).toBe(200_000);
  expect(resolveDisplayedContextWindow(258_000, 258_000, 200_000)).toBe(200_000);
});

test("keeps a model context variant above the relay-group window", () => {
  expect(resolveReportedContextWindow("codex", 258_000, 200_000, 200_000, 1_000_000)).toBe(1_000_000);
  expect(resolveDisplayedContextWindow(258_000, 200_000, 200_000, 1_000_000)).toBe(1_000_000);
});

test("DEFAULT_CONTEXT_WINDOW_TOKENS is 272_000 and metrics handle 0 usedTokens cleanly", () => {
  const { DEFAULT_CONTEXT_WINDOW_TOKENS } = require("../../apps/web/src/contextUsage.ts");
  expect(DEFAULT_CONTEXT_WINDOW_TOKENS).toBe(272_000);
  const metrics = contextUsageMetrics({ usedTokens: 0, contextWindow: DEFAULT_CONTEXT_WINDOW_TOKENS });
  expect(metrics.percentage).toBe(0);
  expect(metrics.ratio).toBe(0);
});

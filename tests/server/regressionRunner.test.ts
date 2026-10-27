import { expect, test } from "bun:test";
import {
  loadRegressionCases,
  recordRegressionCase,
  runRegressionCase,
  runRegressionSuite,
} from "../../apps/server/src/regressionRunner.ts";

test("regressionRunner: loads initial seeded cases", () => {
  const cases = loadRegressionCases();
  expect(cases.length).toBeGreaterThanOrEqual(3);
  const ids = cases.map((c) => c.id);
  expect(ids).toContain("CASE-001-waterfall-retention-on-consultation");
  expect(ids).toContain("CASE-002-thread-subscription-ensure-subscribed");
  expect(ids).toContain("CASE-003-anthropic-max-tokens-continuation");
});

test("regressionRunner: filters cases by component and tag", () => {
  const miniCases = loadRegressionCases({ component: "miniBridge.ts" });
  expect(miniCases.length).toBeGreaterThanOrEqual(2);
  for (const c of miniCases) {
    expect(c.component).toContain("miniBridge");
  }

  const subCases = loadRegressionCases({ tag: "waiting-hang" });
  expect(subCases.length).toBe(1);
  expect(subCases[0].id).toBe("CASE-002-thread-subscription-ensure-subscribed");
});

test("regressionRunner: runs CASE-001 waterfall retention test", async () => {
  const cases = loadRegressionCases({ id: "CASE-001-waterfall-retention-on-consultation" });
  expect(cases.length).toBe(1);
  const res = await runRegressionCase(cases[0]);
  expect(res.passed).toBe(true);
  expect(res.regressionDetected).toBe(false);
  expect(res.violations).toHaveLength(0);
});

test("regressionRunner: runs CASE-002 subscription ensureSubscribed lifecycle test", async () => {
  const cases = loadRegressionCases({ id: "CASE-002-thread-subscription-ensure-subscribed" });
  expect(cases.length).toBe(1);
  const res = await runRegressionCase(cases[0]);
  expect(res.passed).toBe(true);
  expect(res.regressionDetected).toBe(false);
});

test("regressionRunner: runs CASE-003 max_tokens continuation test", async () => {
  const cases = loadRegressionCases({ id: "CASE-003-anthropic-max-tokens-continuation" });
  expect(cases.length).toBe(1);
  const res = await runRegressionCase(cases[0]);
  expect(res.passed).toBe(true);
  expect(res.regressionDetected).toBe(false);
});

test("regressionRunner: runs full regression suite cleanly", async () => {
  const report = await runRegressionSuite();
  expect(report.ok).toBe(true);
  expect(report.passedCases).toBe(report.totalCases);
  expect(report.regressedCases).toBe(0);
  expect(report.summary).toContain("0 个旧 Bug 复发");
});

test("regressionRunner: records a new case and detects a regression violation", async () => {
  const recorded = recordRegressionCase({
    id: "TEMP-TEST-001-sample-regression",
    title: "Temporary test case for negative matcher detection",
    component: "sampleComponent.ts",
    tags: ["temp"],
    simulation: {
      rounds: [{ text: "forbidden error occurred in round" }]
    },
    negativeMatcher: {
      forbiddenPatterns: ["forbidden error occurred"]
    }
  });

  expect(recorded.ok).toBe(true);
  expect(recorded.path).toContain("TEMP-TEST-001");

  const runResult = await runRegressionCase(recorded.case);
  expect(runResult.passed).toBe(false);
  expect(runResult.regressionDetected).toBe(true);
  expect(runResult.violations[0]).toContain("found forbidden pattern");

  // Clean up temp file
  const fs = await import("node:fs");
  if (fs.existsSync(recorded.path)) {
    fs.unlinkSync(recorded.path);
  }
});


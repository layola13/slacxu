import { expect, test } from "bun:test";
import { runSaVmTool } from "../../apps/server/src/saVmTool.ts";
import { nativeJevBlastRadius, nativeJevDone } from "../../backends/jev/src/jev/saVmJev.ts";

test("saVmTool: action 'replay_case' runs regression suite cleanly", async () => {
  const result = await runSaVmTool({
    action: "replay_case",
    component: "miniBridge.ts"
  });

  expect(result.ok).toBe(true);
  expect(result.exitCode).toBe(0);
  const data = JSON.parse(result.stdout);
  expect(data.totalCases).toBeGreaterThanOrEqual(2);
  expect(data.regressedCases).toBe(0);
  expect(data.summary).toContain("0 个旧 Bug 复发");
});

test("saVmTool: action 'replay_case' filters by case ID", async () => {
  const result = await runSaVmTool({
    action: "replay_case",
    id: "CASE-002-thread-subscription-ensure-subscribed"
  });

  expect(result.ok).toBe(true);
  const data = JSON.parse(result.stdout);
  expect(data.totalCases).toBe(1);
  expect(data.results[0].id).toBe("CASE-002-thread-subscription-ensure-subscribed");
  expect(data.results[0].passed).toBe(true);
});

test("saVmTool: action 'record_case' validates and writes a capsule file", async () => {
  const testCaseId = "TEMP-RECORD-001-test-capsule";
  const result = await runSaVmTool({
    action: "record_case",
    id: testCaseId,
    title: "Recorded temporary test capsule",
    component: "testModule.ts",
    tags: ["test", "integration"],
    description: "Temporary capsule to verify sa_vm record_case",
    input: { test: true },
    negative_matcher: { forbiddenPatterns: ["forbidden text"] }
  });

  expect(result.ok).toBe(true);
  const data = JSON.parse(result.stdout);
  expect(data.action).toBe("record_case");
  expect(data.path).toContain(testCaseId);

  // Clean up
  const fs = await import("node:fs");
  if (fs.existsSync(data.path)) {
    fs.unlinkSync(data.path);
  }
});

test("jev_blast_radius: links matching historical regression cases for modified component", async () => {
  const mockDiff = `
diff --git a/backends/mini/src/runtime/miniBridge.ts b/backends/mini/src/runtime/miniBridge.ts
--- a/backends/mini/src/runtime/miniBridge.ts
+++ b/backends/mini/src/runtime/miniBridge.ts
@@ -100,2 +100,2 @@
- const x = 1;
+ const x = 2;
`;

  const origFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    return new Response(
      JSON.stringify({
        answers: {
          side_effect: { choice: "benign", confidence: 0.95 },
          merge_verdict: { choice: "merge_now", confidence: 0.92 },
        },
      }),
      { status: 200 }
    );
  }) as typeof fetch;

  try {
    const result = await nativeJevBlastRadius({
      action: "jev_blast_radius",
      diff: mockDiff,
      target_component: "miniBridge.ts",
      apiKey: "mock-key",
      model: "mock-model"
    }, undefined, process.cwd(), Date.now());

    expect(result.ok).toBe(true);
    const data = JSON.parse(result.stdout);
    expect(data.historical_regression_cases).toBeDefined();
    expect(data.historical_regression_cases.length).toBeGreaterThanOrEqual(2);
    expect(data.summary).toContain("历史回归风险");
  } finally {
    globalThis.fetch = origFetch;
  }
});

test("jev_done: audits historical regression cases touched by work", async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    return new Response(
      JSON.stringify({
        answers: {
          completion: { choice: "completed", confidence: 0.96 },
          delivery: { choice: "sign_off", confidence: 0.95 },
        },
      }),
      { status: 200 }
    );
  }) as typeof fetch;

  try {
    const result = await nativeJevDone({
      action: "jev_done",
      user_request: "Refactor miniBridge stream handling",
      actual_work: "Updated miniBridge.ts to retain waterfall segments and tested regression",
      evidence: "Passed CASE-001-waterfall-retention-on-consultation and regressionRunner suite",
      apiKey: "mock-key",
      model: "mock-model"
    }, undefined, process.cwd(), Date.now());

    expect(result.ok).toBe(true);
    const data = JSON.parse(result.stdout);
    expect(data.historical_regression_cases_audited).toBeDefined();
    expect(data.historical_regression_cases_audited.length).toBeGreaterThanOrEqual(1);
    expect(data.summary).toContain("历史案例审计");
  } finally {
    globalThis.fetch = origFetch;
  }
});


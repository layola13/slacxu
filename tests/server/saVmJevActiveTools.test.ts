import { expect, test } from "bun:test";
import {
  JEV_ACT_NOW_DESC,
  JEV_ACT_NOW_KEY,
  JEV_BLAST_CLASSES,
  JEV_BLAST_VERDICTS,
  JEV_CONSISTENCY_STATUS,
  JEV_DONE_STATES,
  JEV_DONE_VERDICTS,
  JEV_EDGE_DIMENSIONS,
  JEV_FIX_NATURE,
  JEV_REDTEAM_RISKS,
  JEV_REDTEAM_VERDICTS,
  JEV_SCOPE_VERDICTS,
  normalizeChoiceOptions,
  normalizeChecklistItems,
  truncateJevContext,
  nativeJevChoose,
  nativeJevChecklist,
  nativeJevEvaluate,
  nativeJevThinking,
  nativeJevRedteam,
  nativeJevRank,
  nativeJevScope,
  nativeJevConsistency,
  nativeJevDone,
  nativeJevDiagnose,
  nativeJevEdgeCases,
  nativeJevBlastRadius,
  nativeJevIntent,
  nativeJevNext,
  splitPackedDoneSections,
  setSharedJevConfig,
  setJevThrottle,
  getJevThrottle,
  resolveJevMinIntervalMs,
  resolveJevMaxQueue,
  isJevThrottleEnabled,
  isCloudflareJevUpstream,
  buildCloudflareJevRequestUrl,
  resolveCloudflareJevModel,
  cloudflareJevBodyModel,
  unwrapJevUpstreamPayload,
  padCloudflareJevQuestions,
  buildJevConnectivityQuestions,
  CLOUDFLARE_JEV_DEFAULT_MODEL,
  CLOUDFLARE_JEV_PAD_QUESTION_ID,
  JEV_DEFAULT_MODEL,
} from "../../backends/jev/src/jev/saVmJev.ts";
import { runSaVmTool } from "../../apps/server/src/saVmTool.ts";

test("normalizeChoiceOptions converts objects and arrays to standardized option records", () => {
  const fromObj = normalizeChoiceOptions({ a: " Option A ", b: "Option B" });
  expect(fromObj).toEqual({ a: "Option A", b: "Option B" });

  const fromArr = normalizeChoiceOptions(["First option", "Second option"]);
  expect(fromArr).toEqual({ "1": "First option", "2": "Second option" });

  const empty = normalizeChoiceOptions({});
  expect(empty).toEqual({});

  const invalid = normalizeChoiceOptions(null);
  expect(invalid).toEqual({});
});

test("normalizeChecklistItems converts objects and arrays to checklist records", () => {
  const fromObj = normalizeChecklistItems({ null_safe: "Check null safety", compat: "Check compat" });
  expect(fromObj).toEqual({ null_safe: "Check null safety", compat: "Check compat" });

  const fromArr = normalizeChecklistItems(["No memory leak", "Passes tests"]);
  expect(fromArr).toEqual({ check_1: "No memory leak", check_2: "Passes tests" });
});

test("truncateJevContext safely bounds context string to 8000 characters", () => {
  const shortText = "const a = 1;";
  expect(truncateJevContext(shortText)).toBe("const a = 1;");

  const longText = "x".repeat(10_000);
  const truncated = truncateJevContext(longText);
  expect(truncated.length).toBeLessThan(8000);
  expect(truncated).toContain("...[truncated for JEV limit]");

  // Numbers (e.g. from git diff context) are safely ignored
  expect(truncateJevContext(3)).toBe("(no context provided)");
  expect(truncateJevContext(null)).toBe("(no context provided)");
});

test("nativeJevChoose validates parameters before any fetch", async () => {
  // Missing question
  expect(nativeJevChoose({ question: "" } as any)).rejects.toThrow("requires a non-empty 'question'");

  // Fewer than 2 options
  expect(nativeJevChoose({ question: "Which way?", options: { only_one: "Option A" } } as any)).rejects.toThrow(
    "requires at least 2 options"
  );
});

test("nativeJevChecklist validates check items before any fetch", async () => {
  expect(nativeJevChecklist({ checks: {} } as any)).rejects.toThrow("requires at least 1 check item");
});

test("nativeJevChoose returns capability_denied when JEV has no credentials", async () => {
  const origKey = process.env.JEV_API_KEY;
  const origUrl = process.env.JEV_BASE_URL;
  delete process.env.JEV_API_KEY;
  delete process.env.JEV_BASE_URL;
  setSharedJevConfig(null);

  try {
    const result = await nativeJevChoose({
      question: "Which approach?",
      options: { a: "Plan A", b: "Plan B" },
    } as any);

    expect(result.ok).toBe(false);
    expect(result.kind).toBe("capability_denied");
    expect(result.exitCode).toBe(228);
    expect(result.stderr).toContain("JEV is not configured");
  } finally {
    if (origKey !== undefined) process.env.JEV_API_KEY = origKey;
    if (origUrl !== undefined) process.env.JEV_BASE_URL = origUrl;
  }
});

test("nativeJevChoose executes single-choice evaluation and parses verdict", async () => {
  const origFetch = globalThis.fetch;
  let seenBody: any = null;
  let seenAuth = "";

  globalThis.fetch = (async (url: any, init: any) => {
    seenAuth = String(init?.headers?.Authorization ?? "");
    seenBody = JSON.parse(String(init?.body ?? "{}"));
    return new Response(
      JSON.stringify({
        model: "jev-latest",
        answers: {
          decision: {
            choice: "b",
            confidence: 0.94,
          },
        },
      }),
      { status: 200 }
    );
  }) as typeof fetch;

  try {
    const result = await nativeJevChoose({
      question: "How should we handle token overflow?",
      options: { a: "Truncate from head", b: "Sliding window buffer", c: "Fail with 413" },
      context: "Buffer has 2000 tokens capacity, incoming message is 3000 tokens",
      api_key: "test-jev-key",
      base_url: "https://mock.jev.ai/v1/systemone",
    } as any);

    expect(result.ok).toBe(true);
    expect(result.kind).toBe("success");
    expect(result.exitCode).toBe(0);
    expect(seenAuth).toBe("Bearer test-jev-key");
    expect(seenBody.model).toBe("jev-latest");
    expect(seenBody.questions.decision.type).toBe("choice");
    expect(seenBody.questions.decision.criteria).toEqual({
      a: "Truncate from head",
      b: "Sliding window buffer",
      c: "Fail with 413",
    });

    const parsed = JSON.parse(result.stdout);
    expect(parsed.action).toBe("jev_choose");
    expect(parsed.choice).toBe("b");
    expect(parsed.confidence).toBe(0.94);
    expect(parsed.description).toBe("Sliding window buffer");
    expect(parsed.summary).toContain("推荐方案：[b]（置信度 94%）");
    expect(parsed.summary).toContain("Sliding window buffer");
  } finally {
    globalThis.fetch = origFetch;
  }
});

test("nativeJevChecklist evaluates multi-item criteria and reports all_passed status", async () => {
  const origFetch = globalThis.fetch;
  let seenBody: any = null;

  globalThis.fetch = (async (url: any, init: any) => {
    seenBody = JSON.parse(String(init?.body ?? "{}"));
    return new Response(
      JSON.stringify({
        model: "jev-latest",
        answers: {
          null_safe: { choice: "pass", confidence: 0.96 },
          error_handling: { choice: "pass", confidence: 0.89 },
          backward_compat: { choice: "fail", confidence: 0.82 },
        },
      }),
      { status: 200 }
    );
  }) as typeof fetch;

  try {
    const result = await nativeJevChecklist({
      checks: {
        null_safe: "Protects against null/undefined inputs",
        error_handling: "Catches thrown errors and logs them",
        backward_compat: "Preserves 2-argument signature for legacy callers",
      },
      context: "function handle(req) { if (!req) return; throw new Error('boom'); }",
      api_key: "test-jev-key",
    } as any);

    expect(result.ok).toBe(true);
    expect(seenBody.questions.null_safe.type).toBe("choice");
    expect(seenBody.questions.error_handling.type).toBe("choice");
    expect(seenBody.questions.backward_compat.type).toBe("choice");

    const parsed = JSON.parse(result.stdout);
    expect(parsed.action).toBe("jev_checklist");
    expect(parsed.all_passed).toBe(false);
    expect(parsed.passed_count).toBe(2);
    expect(parsed.total_count).toBe(3);
    expect(parsed.checks.null_safe.passed).toBe(true);
    expect(parsed.checks.error_handling.passed).toBe(true);
    expect(parsed.checks.backward_compat.passed).toBe(false);
    expect(parsed.summary).toContain("1 项未通过 (2/3)");
    expect(parsed.summary).toContain("[null_safe] ✅ 通过");
    expect(parsed.summary).toContain("[backward_compat] ❌ 未通过");
  } finally {
    globalThis.fetch = origFetch;
  }
});

test("runSaVmTool dispatches jev_choose and jev_checklist seamlessly", async () => {
  const origFetch = globalThis.fetch;

  globalThis.fetch = (async () => {
    return new Response(
      JSON.stringify({
        model: "jev-latest",
        answers: {
          decision: { choice: "opt1", confidence: 0.99 },
          check1: { choice: "pass", confidence: 0.95 },
        },
      }),
      { status: 200 }
    );
  }) as typeof fetch;

  try {
    // Dispatch jev_choose
    const chooseResult = await runSaVmTool({
      action: "jev_choose",
      question: "Which library?",
      options: { opt1: "Option 1", opt2: "Option 2" },
      api_key: "k",
    });
    expect(chooseResult.ok).toBe(true);
    const chooseJson = JSON.parse(chooseResult.stdout);
    expect(chooseJson.choice).toBe("opt1");

    // Dispatch jev_checklist
    const checklistResult = await runSaVmTool({
      action: "jev_checklist",
      checks: { check1: "Verify integrity" },
      api_key: "k",
    });
    expect(checklistResult.ok).toBe(true);
    const checklistJson = JSON.parse(checklistResult.stdout);
    expect(checklistJson.all_passed).toBe(true);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test("setSharedJevConfig supplies credentials to nativeJevChoose when not provided in tool call", async () => {
  const origFetch = globalThis.fetch;
  let seenAuth = "";

  globalThis.fetch = (async (_url: any, init: any) => {
    seenAuth = String(init?.headers?.Authorization ?? "");
    return new Response(
      JSON.stringify({
        model: "jev-custom",
        answers: { decision: { choice: "x", confidence: 0.9 } },
      }),
      { status: 200 }
    );
  }) as typeof fetch;

  setSharedJevConfig({ apiKey: "shared-api-key-123", model: "jev-custom" });

  try {
    const result = await nativeJevChoose({
      question: "Which one?",
      options: { x: "Choice X", y: "Choice Y" },
    } as any);

    expect(result.ok).toBe(true);
    expect(seenAuth).toBe("Bearer shared-api-key-123");
    const json = JSON.parse(result.stdout);
    expect(json.choice).toBe("x");
  } finally {
    setSharedJevConfig(null);
    globalThis.fetch = origFetch;
  }
});

test("setJevRelayExecutor routes provider-based requests when apiKey is absent", async () => {
  const { setJevRelayExecutor } = await import("../../backends/jev/src/jev/saVmJev.ts");
  let relayCalled = false;
  let relayProvider = "";

  setJevRelayExecutor(async ({ providerId, questions }) => {
    relayCalled = true;
    relayProvider = providerId;
    return new Response(
      JSON.stringify({
        answers: { decision: { choice: "relay_opt", confidence: 0.98 } },
      }),
      { status: 200 }
    );
  });

  try {
    const result = await nativeJevChoose({
      question: "Relay check?",
      options: { relay_opt: "Relayed", local_opt: "Local" },
      jev_provider_id: "my-relay-provider",
    } as any);

    expect(result.ok).toBe(true);
    expect(relayCalled).toBe(true);
    expect(relayProvider).toBe("my-relay-provider");
    const json = JSON.parse(result.stdout);
    expect(json.choice).toBe("relay_opt");
  } finally {
    setJevRelayExecutor(null);
  }
});

test("nativeJevEvaluate validates questions and returns raw JEV response", async () => {
  const origFetch = globalThis.fetch;

  globalThis.fetch = (async () => {
    return new Response(
      JSON.stringify({
        model: "jev-latest",
        answers: { custom_q: { choice: "yes", confidence: 1.0 } },
      }),
      { status: 200 }
    );
  }) as typeof fetch;

  try {
    const result = await nativeJevEvaluate({
      questions: { custom_q: { type: "choice", instructions: "Is it valid?" } },
      context: "some state",
      api_key: "key",
    } as any);

    expect(result.ok).toBe(true);
    const json = JSON.parse(result.stdout);
    expect(json.answers.custom_q.choice).toBe("yes");
  } finally {
    globalThis.fetch = origFetch;
  }
});

test("runSaVmTool denies jev methods only on explicit policy false (unset = legacy allow)", async () => {
  const base = {
    question: "Which way?",
    options: { a: "Plan A", b: "Plan B" },
    api_key: "k",
  };

  // Explicit false -> capability_denied without touching network
  const denied = await runSaVmTool({ action: "jev_choose", ...base } as any, {
    tools: { jevChoose: false },
  } as any);
  expect(denied.ok).toBe(false);
  expect(denied.kind).toBe("capability_denied");
  expect(denied.exitCode).toBe(228);
  expect(denied.stderr).toContain("jevChoose");

  const deniedCheck = await runSaVmTool({ action: "jev_checklist", checks: { c1: "x" }, api_key: "k" } as any, {
    tools: { jevChecklist: false },
  } as any);
  expect(deniedCheck.kind).toBe("capability_denied");

  const deniedEval = await runSaVmTool(
    { action: "jev_evaluate", questions: { q: { type: "choice" } }, api_key: "k" } as any,
    { tools: { jevEvaluate: false } } as any
  );
  expect(deniedEval.kind).toBe("capability_denied");

  // Unset flags -> legacy path (reaches validation, not policy denial)
  const origFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    return new Response(JSON.stringify({ answers: { decision: { choice: "a", confidence: 1 } } }), {
      status: 200,
    });
  }) as typeof fetch;
  try {
    const allowed = await runSaVmTool({ action: "jev_choose", ...base } as any, { tools: {} } as any);
    expect(allowed.ok).toBe(true);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test("workspace skill renders JEV methods per policy flag, legacy master switch preserved", async () => {
  const { buildSaVmWorkspaceSkillMarkdown } = await import("../../apps/server/src/saVmWorkspaceSkill.ts");

  // Legacy: master on, no flags -> choose + checklist, no evaluate
  const legacy = buildSaVmWorkspaceSkillMarkdown({ enabled: true, jevActiveTools: true });
  expect(legacy).toContain("jev_choose");
  expect(legacy).toContain("jev_checklist");
  expect(legacy).not.toContain("jev_evaluate");

  // Legacy: master off -> section hidden
  const legacyOff = buildSaVmWorkspaceSkillMarkdown({ enabled: true, jevActiveTools: false });
  expect(legacyOff).not.toContain("jev_choose");
  expect(legacyOff).not.toContain("jev_checklist");

  // Flags touched: only enabled methods render, even with master off
  const flagged = buildSaVmWorkspaceSkillMarkdown({
    enabled: true,
    jevActiveTools: false,
    policy: { tools: { jevChoose: true, jevChecklist: false, jevEvaluate: true } } as any,
  });
  expect(flagged).toContain("jev_choose");
  expect(flagged).not.toContain("jev_checklist");
  expect(flagged).toContain("jev_evaluate");

  // Flags touched with all false -> section hidden
  const allOff = buildSaVmWorkspaceSkillMarkdown({
    enabled: true,
    jevActiveTools: true,
    policy: { tools: { jevChoose: false, jevChecklist: false } } as any,
  });
  expect(allOff).not.toContain("jev_choose");
  expect(allOff).not.toContain("jev_checklist");
});

test("nativeJevThinking validates goal/thoughts and reserves the act-now key", async () => {
  expect(nativeJevThinking({ goal: "" } as any)).rejects.toThrow("requires a non-empty 'goal'");
  expect(nativeJevThinking({ goal: "g", thoughts: {} } as any)).rejects.toThrow(
    "requires at least 1 thought"
  );
  expect(
    nativeJevThinking({ goal: "g", thoughts: { [JEV_ACT_NOW_KEY]: "hijack" } } as any)
  ).rejects.toThrow("reserved");
  expect(JEV_ACT_NOW_DESC.length).toBeGreaterThan(0);
});

test("nativeJevThinking truncates to 4 thoughts and returns act-now verdict", async () => {
  const origFetch = globalThis.fetch;
  let seenBody: any = null;

  globalThis.fetch = (async (_url: any, init: any) => {
    seenBody = JSON.parse(String(init?.body ?? "{}"));
    return new Response(
      JSON.stringify({ answers: { direction: { choice: JEV_ACT_NOW_KEY, confidence: 0.88 } } }),
      { status: 200 }
    );
  }) as typeof fetch;

  try {
    const thoughts: Record<string, string> = {};
    for (let i = 1; i <= 6; i++) thoughts[`t${i}`] = `thought ${i}`;
    const result = await nativeJevThinking({
      goal: "Pick a direction",
      thoughts,
      context: "ctx",
      api_key: "k",
    } as any);

    expect(result.ok).toBe(true);
    // 6 thoughts truncated to 4 + built-in brake = 5 criteria
    expect(Object.keys(seenBody.questions.direction.criteria)).toHaveLength(5);
    expect(seenBody.questions.direction.criteria[JEV_ACT_NOW_KEY]).toBe(JEV_ACT_NOW_DESC);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.action).toBe("jev_thinking");
    expect(parsed.act_now).toBe(true);
    expect(parsed.choice).toBe(JEV_ACT_NOW_KEY);
    expect(parsed.summary).toContain("直接行动");
  } finally {
    globalThis.fetch = origFetch;
  }
});

test("runSaVmTool routes jev_thinking aliases through the policy gate", async () => {
  const denied = await runSaVmTool(
    { action: "jev_think", goal: "g", thoughts: { t1: "a" } } as any,
    { tools: { jevThinking: false } } as any
  );
  expect(denied.ok).toBe(false);
  expect(denied.kind).toBe("capability_denied");
  expect(denied.stderr).toContain("jevThinking");

  const origFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    return new Response(
      JSON.stringify({ answers: { direction: { choice: "t1", confidence: 0.9 } } }),
      { status: 200 }
    );
  }) as typeof fetch;
  try {
    const allowed = await runSaVmTool(
      { action: "jev_thinking", goal: "g", thoughts: { t1: "a", t2: "b" }, api_key: "k" } as any,
      { tools: {} } as any
    );
    expect(allowed.ok).toBe(true);
    expect(JSON.parse(allowed.stdout).act_now).toBe(false);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test("workspace skill renders jev_thinking per flag with legacy master fallback", async () => {
  const { buildSaVmWorkspaceSkillMarkdown } = await import("../../apps/server/src/saVmWorkspaceSkill.ts");

  // Legacy master on (no flags) -> thinking advertised alongside choose/checklist
  const legacy = buildSaVmWorkspaceSkillMarkdown({ enabled: true, jevActiveTools: true });
  expect(legacy).toContain("jev_thinking");

  // Flags touched: thinking on alone, master off
  const thinkingOnly = buildSaVmWorkspaceSkillMarkdown({
    enabled: true,
    jevActiveTools: false,
    policy: { tools: { jevThinking: true } } as any,
  });
  expect(thinkingOnly).toContain("jev_thinking");
  expect(thinkingOnly).not.toContain("jev_choose");
  expect(thinkingOnly).not.toContain("jev_checklist");
});

test("nativeJevRedteam validates target and sends fixed taxonomy questions", async () => {
  expect(nativeJevRedteam({ target: "" } as any)).rejects.toThrow("requires a non-empty 'target'");
  expect(Object.keys(JEV_REDTEAM_RISKS).length).toBeGreaterThanOrEqual(6);
  expect(JEV_REDTEAM_VERDICTS.proceed).toBeTruthy();
  expect(JEV_REDTEAM_VERDICTS.harden_first).toBeTruthy();
  expect(JEV_REDTEAM_VERDICTS.stop).toBeTruthy();

  const origFetch = globalThis.fetch;
  let seenBody: any = null;
  globalThis.fetch = (async (_url: any, init: any) => {
    seenBody = JSON.parse(String(init?.body ?? "{}"));
    return new Response(
      JSON.stringify({
        answers: {
          primary_risk: { choice: "race_condition", confidence: 0.81 },
          verdict: { choice: "harden_first", confidence: 0.77 },
        },
      }),
      { status: 200 }
    );
  }) as typeof fetch;

  try {
    const result = await nativeJevRedteam({
      target: "Migrate payments table with zero downtime",
      context: "Postgres, 2M rows, dual-write plan",
      api_key: "k",
    } as any);
    expect(result.ok).toBe(true);
    expect(Object.keys(seenBody.questions)).toEqual(["primary_risk", "verdict"]);
    expect(seenBody.questions.primary_risk.criteria.race_condition).toBe(
      JEV_REDTEAM_RISKS.race_condition
    );
    const parsed = JSON.parse(result.stdout);
    expect(parsed.action).toBe("jev_redteam");
    expect(parsed.primary_risk).toBe("race_condition");
    expect(parsed.verdict).toBe("harden_first");
    expect(parsed.summary).toContain("红队审查");
    expect(parsed.summary).toContain("harden_first");
  } finally {
    globalThis.fetch = origFetch;
  }
});

test("runSaVmTool routes jev_redteam aliases through the policy gate", async () => {
  const denied = await runSaVmTool(
    { action: "jev_red", target: "do risky thing" } as any,
    { tools: { jevRedteam: false } } as any
  );
  expect(denied.ok).toBe(false);
  expect(denied.kind).toBe("capability_denied");
  expect(denied.stderr).toContain("jevRedteam");

  const origFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    return new Response(
      JSON.stringify({
        answers: {
          primary_risk: { choice: "scope_creep", confidence: 0.6 },
          verdict: { choice: "proceed", confidence: 0.9 },
        },
      }),
      { status: 200 }
    );
  }) as typeof fetch;
  try {
    const allowed = await runSaVmTool(
      { action: "jev_redteam", target: "ship it", api_key: "k" } as any,
      { tools: {} } as any
    );
    expect(allowed.ok).toBe(true);
    expect(JSON.parse(allowed.stdout).verdict).toBe("proceed");
  } finally {
    globalThis.fetch = origFetch;
  }
});

test("workspace skill renders jev_redteam per flag with legacy master fallback", async () => {
  const { buildSaVmWorkspaceSkillMarkdown } = await import("../../apps/server/src/saVmWorkspaceSkill.ts");

  const legacy = buildSaVmWorkspaceSkillMarkdown({ enabled: true, jevActiveTools: true });
  expect(legacy).toContain("jev_redteam");

  const redOnly = buildSaVmWorkspaceSkillMarkdown({
    enabled: true,
    jevActiveTools: false,
    policy: { tools: { jevRedteam: true } } as any,
  });
  expect(redOnly).toContain("jev_redteam");
  expect(redOnly).not.toContain("jev_thinking");
});

test("nativeJevRank validates items and dedupes repeated picks", async () => {
  expect(nativeJevRank({ items: { only: "one" } } as any)).rejects.toThrow("at least 2 items");

  const origFetch = globalThis.fetch;
  let seenBody: any = null;
  globalThis.fetch = (async (_url: any, init: any) => {
    seenBody = JSON.parse(String(init?.body ?? "{}"));
    return new Response(
      JSON.stringify({
        answers: {
          rank_1: { choice: "b", confidence: 0.9 },
          rank_2: { choice: "b", confidence: 0.8 },
          rank_3: { choice: "c", confidence: 0.7 },
        },
      }),
      { status: 200 }
    );
  }) as typeof fetch;

  try {
    const result = await nativeJevRank({
      items: { a: "A", b: "B", c: "C", d: "D" },
      criterion: "ROI",
      api_key: "k",
    } as any);
    expect(result.ok).toBe(true);
    expect(Object.keys(seenBody.questions)).toEqual(["rank_1", "rank_2", "rank_3"]);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.action).toBe("jev_rank");
    // Duplicate rank_2 pick is dropped; unranked keeps submission order
    expect(parsed.ranking.map((entry: any) => entry.key)).toEqual(["b", "c"]);
    expect(parsed.unranked).toEqual(["a", "d"]);
    expect(parsed.summary).toContain("ROI");
  } finally {
    globalThis.fetch = origFetch;
  }
});

test("nativeJevScope returns size verdict with and without phases", async () => {
  expect(nativeJevScope({ task: "" } as any)).rejects.toThrow("non-empty 'task'");
  expect(Object.keys(JEV_SCOPE_VERDICTS)).toEqual(["right_sized", "split_2_3", "split_many", "merge"]);

  const origFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    return new Response(
      JSON.stringify({
        answers: {
          size: { choice: "split_2_3", confidence: 0.75 },
          weakest_unit: { choice: "p2", confidence: 0.66 },
        },
      }),
      { status: 200 }
    );
  }) as typeof fetch;

  try {
    const result = await nativeJevScope({
      task: "Rewrite auth module",
      phases: { p1: "Login", p2: "Session refresh" },
      api_key: "k",
    } as any);
    expect(result.ok).toBe(true);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.size_verdict).toBe("split_2_3");
    expect(parsed.weakest_unit).toBe("p2");
    expect(parsed.summary).toContain("范围把关");
  } finally {
    globalThis.fetch = origFetch;
  }
});

test("nativeJevConsistency audits each constraint with overall verdict", async () => {
  expect(nativeJevConsistency({ plan: "p", constraints: {} } as any)).rejects.toThrow(
    "at least 1 constraint"
  );
  expect(nativeJevConsistency({ plan: "", constraints: { a: "b" } } as any)).rejects.toThrow(
    "non-empty 'plan'"
  );

  const origFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    return new Response(
      JSON.stringify({
        answers: {
          no_mock: { choice: "violated", confidence: 0.9 },
          typed: { choice: "holds", confidence: 0.95 },
        },
      }),
      { status: 200 }
    );
  }) as typeof fetch;

  try {
    const result = await nativeJevConsistency({
      plan: "Do the thing",
      constraints: { no_mock: "No mocks", typed: "Keep types" },
      api_key: "k",
    } as any);
    expect(result.ok).toBe(true);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.consistent).toBe(false);
    expect(parsed.violated_count).toBe(1);
    expect(parsed.constraints.no_mock.status).toBe("violated");
    expect(parsed.constraints.typed.status).toBe("holds");
    expect(Object.keys(JEV_CONSISTENCY_STATUS)).toEqual(["holds", "violated", "unclear"]);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test("runSaVmTool gates jev_rank/scope/consistency on explicit false", async () => {
  for (const [action, flag, input] of [
    ["jev_rank", "jevRank", { items: { a: "A", b: "B" } }],
    ["jev_scope", "jevScope", { task: "t" }],
    ["jev_dispatch", "jevDispatch", { question: "t", options: { a: "A", b: "B" } }],
    ["jev_consistency", "jevConsistency", { plan: "p", constraints: { c: "d" } }],
  ] as Array<[string, string, Record<string, unknown>]>) {
    const denied = await runSaVmTool({ action, ...input } as any, { tools: { [flag]: false } } as any);
    expect(denied.kind).toBe("capability_denied");
    expect(denied.exitCode).toBe(228);
  }
});

test("workspace skill renders rank/scope/consistency per flag with legacy fallback", async () => {
  const { buildSaVmWorkspaceSkillMarkdown } = await import("../../apps/server/src/saVmWorkspaceSkill.ts");

  const legacy = buildSaVmWorkspaceSkillMarkdown({ enabled: true, jevActiveTools: true });
  expect(legacy).toContain("jev_rank");
  expect(legacy).toContain("jev_scope");
  expect(legacy).toContain("jev_dispatch");
  expect(legacy).toContain("jev_consistency");

  const scopedOnly = buildSaVmWorkspaceSkillMarkdown({
    enabled: true,
    jevActiveTools: false,
    policy: { tools: { jevRank: true, jevScope: true, jevConsistency: true } } as any,
  });
  expect(scopedOnly).toContain("jev_rank");
  expect(scopedOnly).toContain("jev_scope");
  expect(scopedOnly).toContain("jev_consistency");
  expect(scopedOnly).not.toContain("action: 'jev_redteam'");
  expect(scopedOnly).not.toContain("action: 'jev_dispatch'");
});

test("nativeJevDone validates triple and returns delivery verdict", async () => {
  expect(nativeJevDone({ user_request: "", actual_work: "w" } as any)).rejects.toThrow(
    "non-empty 'user_request'"
  );
  expect(nativeJevDone({ user_request: "r", actual_work: "" } as any)).rejects.toThrow(
    "non-empty 'actual_work'"
  );
  expect(Object.keys(JEV_DONE_STATES)).toEqual([
    "truly_completed",
    "incomplete_with_todos",
    "unverified_claim",
    "diverged",
  ]);

  const origFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    return new Response(
      JSON.stringify({
        answers: {
          completion: { choice: "incomplete_with_todos", confidence: 0.83 },
          delivery: { choice: "keep_working", confidence: 0.9 },
        },
      }),
      { status: 200 }
    );
  }) as typeof fetch;

  try {
    const result = await nativeJevDone({
      user_request: "Support X",
      actual_work: "Implemented X with TODO left",
      evidence: "tests pass",
      api_key: "k",
    } as any);
    expect(result.ok).toBe(true);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.completion_state).toBe("incomplete_with_todos");
    expect(parsed.delivery).toBe("keep_working");
    expect(parsed.summary).toContain("交付核准");
  } finally {
    globalThis.fetch = origFetch;
  }
});

test("nativeJevDone accepts bridge-packed question+context when canonical fields are dropped", async () => {
  // The opencode sa_vm_run bridge forwards question+context for jev_done but
  // drops content/user_request/actual_work/evidence; the server must still
  // reach the upstream verdict instead of failing validation.
  const origFetch = globalThis.fetch;
  let seenBody: any = null;
  globalThis.fetch = (async (_url: any, init: any) => {
    seenBody = JSON.parse(String(init?.body ?? "{}"));
    return new Response(
      JSON.stringify({
        answers: {
          completion: { choice: "truly_completed", confidence: 0.7 },
          delivery: { choice: "deliver_to_user", confidence: 0.8 },
        },
      }),
      { status: 200 }
    );
  }) as typeof fetch;

  setJevThrottle({ minIntervalMs: 0, enabled: false });
  try {
    const result = await nativeJevDone({
      question: "测试JEV间隔调用可靠性",
      context: "实际工作: 串行间隔测试全部成功; 证据: latency 250~350ms",
      api_key: "k",
    } as any);
    expect(result.ok).toBe(true);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.completion_state).toBe("truly_completed");
    expect(String(seenBody?.state ?? "")).toContain("测试JEV间隔调用可靠性");
  } finally {
    setJevThrottle(null);
    globalThis.fetch = origFetch;
  }
});

test("splitPackedDoneSections recovers the triple from a packed question", () => {
  expect(splitPackedDoneSections("plain question without markers")).toEqual({});
  const packed = "原始需求: 修好登录\n实际工作: 改了auth.ts并补测试\n证据: 39/39通过";
  const sections = splitPackedDoneSections(packed);
  expect(sections.request).toBe("修好登录");
  expect(sections.work).toBe("改了auth.ts并补测试");
  expect(sections.evidence).toBe("39/39通过");
});

test("nativeJevDone accepts a packed question when only question survives transit", async () => {
  const origFetch = globalThis.fetch;
  let seenBody: any = null;
  globalThis.fetch = (async (_url: any, init: any) => {
    seenBody = JSON.parse(String(init?.body ?? "{}"));
    return new Response(
      JSON.stringify({
        answers: {
          completion: { choice: "truly_completed", confidence: 0.7 },
          delivery: { choice: "deliver_to_user", confidence: 0.8 },
        },
      }),
      { status: 200 }
    );
  }) as typeof fetch;

  setJevThrottle({ minIntervalMs: 0, enabled: false });
  try {
    const result = await nativeJevDone({
      question: "原始需求: 修好登录\n实际工作: 改了auth.ts并补测试\n证据: 39/39通过",
      api_key: "k",
    } as any);
    expect(result.ok).toBe(true);
    const state = String(seenBody?.state ?? "");
    expect(state).toContain("修好登录");
    expect(state).toContain("改了auth.ts并补测试");
    expect(state).toContain("39/39通过");
  } finally {
    setJevThrottle(null);
    globalThis.fetch = origFetch;
  }
});

test("nativeJevDiagnose arbitrates cause and fix nature", async () => {
  expect(nativeJevDiagnose({ error_summary: "", hypotheses: { a: "A", b: "B" } } as any)).rejects.toThrow(
    "non-empty 'error_summary'"
  );
  expect(nativeJevDiagnose({ error_summary: "boom", hypotheses: { a: "A" } } as any)).rejects.toThrow(
    "at least 2 hypotheses"
  );

  const origFetch = globalThis.fetch;
  let seenBody: any = null;
  globalThis.fetch = (async (_url: any, init: any) => {
    seenBody = JSON.parse(String(init?.body ?? "{}"));
    return new Response(
      JSON.stringify({
        answers: {
          most_likely_cause: { choice: "race", confidence: 0.72 },
          fix_nature: { choice: "symptom_patch", confidence: 0.68 },
        },
      }),
      { status: 200 }
    );
  }) as typeof fetch;

  try {
    const result = await nativeJevDiagnose({
      error_summary: "Cannot read headers of undefined",
      hypotheses: { race: "WS race", empty: "502 empty body" },
      proposed_fix: "Default new Headers()",
      api_key: "k",
    } as any);
    expect(result.ok).toBe(true);
    expect(Object.keys(seenBody.questions)).toEqual(["most_likely_cause", "fix_nature"]);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.most_likely_cause).toBe("race");
    expect(parsed.fix_nature).toBe("symptom_patch");
    expect(Object.keys(JEV_FIX_NATURE)).toEqual(["root_cause_fix", "symptom_patch", "risky_mask"]);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test("nativeJevDiagnose skips fix question without proposed fix", async () => {
  const origFetch = globalThis.fetch;
  let seenBody: any = null;
  globalThis.fetch = (async (_url: any, init: any) => {
    seenBody = JSON.parse(String(init?.body ?? "{}"));
    return new Response(
      JSON.stringify({ answers: { most_likely_cause: { choice: "empty", confidence: 0.6 } } }),
      { status: 200 }
    );
  }) as typeof fetch;

  try {
    const result = await nativeJevDiagnose({
      error_summary: "boom",
      hypotheses: { race: "R", empty: "E" },
      api_key: "k",
    } as any);
    expect(result.ok).toBe(true);
    expect(Object.keys(seenBody.questions)).toEqual(["most_likely_cause"]);
    expect(JSON.parse(result.stdout).fix_nature).toBeNull();
  } finally {
    globalThis.fetch = origFetch;
  }
});

test("nativeJevEdgeCases names weakest dimensions with dedupe", async () => {
  expect(nativeJevEdgeCases({ code: "" } as any)).rejects.toThrow("non-empty 'code'");
  expect(Object.keys(JEV_EDGE_DIMENSIONS)).toHaveLength(5);

  const origFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    return new Response(
      JSON.stringify({
        answers: {
          weakest_dimension: { choice: "null_empty_omitted", confidence: 0.77 },
          runner_up_dimension: { choice: "null_empty_omitted", confidence: 0.5 },
        },
      }),
      { status: 200 }
    );
  }) as typeof fetch;

  try {
    const result = await nativeJevEdgeCases({
      code: "export function f(s: string) { return s.trim(); }",
      api_key: "k",
    } as any);
    expect(result.ok).toBe(true);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.weakest_dimension).toBe("null_empty_omitted");
    // Duplicate runner-up is dropped
    expect(parsed.runner_up_dimension).toBeNull();
    expect(parsed.summary).toContain("边界筛查");
  } finally {
    globalThis.fetch = origFetch;
  }
});

test("nativeJevBlastRadius reviews a diff with merge verdict", async () => {
  expect(nativeJevBlastRadius({ diff: "" } as any)).rejects.toThrow("non-empty 'diff'");

  const origFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    return new Response(
      JSON.stringify({
        answers: {
          side_effect: { choice: "api_break", confidence: 0.84 },
          merge_verdict: { choice: "needs_compat_shim", confidence: 0.79 },
        },
      }),
      { status: 200 }
    );
  }) as typeof fetch;

  try {
    const result = await nativeJevBlastRadius({
      diff: "-export function f(a: string)\n+export function f(a: string, b: number)",
      target_component: "shared/util.ts",
      api_key: "k",
    } as any);
    expect(result.ok).toBe(true);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.side_effect).toBe("api_break");
    expect(parsed.merge_verdict).toBe("needs_compat_shim");
    expect(parsed.target_component).toBe("shared/util.ts");
    expect(parsed.summary).toContain("爆炸半径");
  } finally {
    globalThis.fetch = origFetch;
  }
});

test("nativeJevIntent validates input and classifies via taxonomy", async () => {
  expect(nativeJevIntent({ question: "" } as any)).rejects.toThrow("non-empty 'question'");
  expect(nativeJevIntent({ question: "hi", options: { only: "one" } } as any)).rejects.toThrow(
    "at least 2 candidate interpretations"
  );

  const origFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    return new Response(
      JSON.stringify({
        answers: {
          primary_intent: { choice: "bug_fix", confidence: 0.91 },
          clarity: { choice: "clear", confidence: 0.88 },
        },
      }),
      { status: 200 }
    );
  }) as typeof fetch;

  try {
    const result = await nativeJevIntent({
      question: "登录接口 500 了，修一下",
      api_key: "k",
    } as any);
    expect(result.ok).toBe(true);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.action).toBe("jev_intent");
    expect(parsed.primary_intent).toBe("bug_fix");
    expect(parsed.clarity).toBe("clear");
    expect(parsed.suggested_first_step).toContain("复现");
    expect(parsed.summary).toContain("意图分析");
  } finally {
    globalThis.fetch = origFetch;
  }
});

test("nativeJevNext picks next task and judges momentum", async () => {
  expect(nativeJevNext({ question: "" } as any)).rejects.toThrow("non-empty 'question'");
  expect(nativeJevNext({ question: "done", options: { only: "one" } } as any)).rejects.toThrow(
    "at least 2 candidate next tasks"
  );

  const origFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    return new Response(
      JSON.stringify({
        answers: {
          next_task: { choice: "b", confidence: 0.86 },
          momentum: { choice: "continue_now", confidence: 0.93 },
        },
      }),
      { status: 200 }
    );
  }) as typeof fetch;

  try {
    const result = await nativeJevNext({
      question: "登录 500 已修复，回归测试通过",
      options: { a: "补接口文档", b: "修支付回调 502" },
      api_key: "k",
    } as any);
    expect(result.ok).toBe(true);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.action).toBe("jev_next");
    expect(parsed.next_task).toBe("b");
    expect(parsed.next_description).toBe("修支付回调 502");
    expect(parsed.momentum).toBe("continue_now");
    expect(parsed.auto_continue).toBe(true);
    expect(parsed.summary).toContain("续接");
  } finally {
    globalThis.fetch = origFetch;
  }
});

test("runSaVmTool gates jev_done/diagnose/edge/blast on explicit false", async () => {
  for (const [action, flag, input] of [
    ["jev_done", "jevDone", { user_request: "r", actual_work: "w" }],
    ["jev_diagnose", "jevDiagnose", { error_summary: "e", hypotheses: { a: "A", b: "B" } }],
    ["jev_edge_cases", "jevEdgeCases", { code: "const x = 1;" }],
    ["jev_blast_radius", "jevBlastRadius", { diff: "-a\n+b" }],
  ] as Array<[string, string, Record<string, unknown>]>) {
    const denied = await runSaVmTool({ action, ...input } as any, { tools: { [flag]: false } } as any);
    expect(denied.kind).toBe("capability_denied");
    expect(denied.exitCode).toBe(228);
  }
});

test("workspace skill renders done/diagnose/edge/blast per flag with legacy fallback", async () => {
  const { buildSaVmWorkspaceSkillMarkdown } = await import("../../apps/server/src/saVmWorkspaceSkill.ts");

  const legacy = buildSaVmWorkspaceSkillMarkdown({ enabled: true, jevActiveTools: true });
  expect(legacy).toContain("jev_done");
  expect(legacy).toContain("jev_diagnose");
  expect(legacy).toContain("jev_edge_cases");
  expect(legacy).toContain("jev_blast_radius");

  const doneOnly = buildSaVmWorkspaceSkillMarkdown({
    enabled: true,
    jevActiveTools: false,
    policy: { tools: { jevDone: true, jevDiagnose: true, jevEdgeCases: true, jevBlastRadius: true } } as any,
  });
  expect(doneOnly).toContain("jev_done");
  expect(doneOnly).toContain("jev_diagnose");
  expect(doneOnly).toContain("jev_edge_cases");
  expect(doneOnly).toContain("jev_blast_radius");
  expect(doneOnly).not.toContain("jev_rank");
});

test("normalizeChoiceOptions and normalizeChecklistItems accept JSON string and newline string", () => {
  const jsonOptions = normalizeChoiceOptions('{"opt1": "Option 1", "opt2": "Option 2"}');
  expect(jsonOptions).toEqual({ opt1: "Option 1", opt2: "Option 2" });

  const jsonArray = normalizeChoiceOptions('["First", "Second"]');
  expect(jsonArray).toEqual({ "1": "First", "2": "Second" });

  const newlineOptions = normalizeChoiceOptions("1. Candidate Alpha\n2. Candidate Beta\n3. Candidate Gamma");
  expect(newlineOptions).toEqual({ "1": "Candidate Alpha", "2": "Candidate Beta", "3": "Candidate Gamma" });

  const jsonChecks = normalizeChecklistItems('{"c1": "Check one", "c2": "Check two"}');
  expect(jsonChecks).toEqual({ c1: "Check one", c2: "Check two" });

  const newlineChecks = normalizeChecklistItems("- First check\n- Second check");
  expect(newlineChecks).toEqual({ check_1: "First check", check_2: "Second check" });
});

test("runSaVmTool jev_blast_radius is not hijacked into apply_patch when diff or patch is present", async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    return new Response(
      JSON.stringify({
        model: "jev-latest",
        answers: {
          side_effect: { choice: "local_only", confidence: 0.98 },
          merge_verdict: { choice: "safe_to_apply", confidence: 0.95 },
        },
      }),
      { status: 200 }
    );
  }) as typeof fetch;

  try {
    const res = await runSaVmTool({
      action: "jev_blast_radius",
      diff: "--- a/foo.ts\n+++ b/foo.ts\n@@ -1 +1 @@\n-const x = 1;\n+const x = 2;",
      target_component: "foo",
      api_key: "dummy",
    });
    expect(res.ok).toBe(true);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.action).toBe("jev_blast_radius");
    expect(parsed.merge_verdict).toBe("safe_to_apply");
  } finally {
    globalThis.fetch = origFetch;
  }
});

test("JEV active tools fall back to alternate field names gracefully", async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    return new Response(
      JSON.stringify({
        model: "jev-latest",
        answers: {
          direction: { choice: "t1", confidence: 0.9 },
          size: { choice: "right_sized", confidence: 0.9 },
          completion: { choice: "fulfilled", confidence: 0.9 },
          delivery: { choice: "deliver_now", confidence: 0.9 },
          most_likely_cause: { choice: "h1", confidence: 0.9 },
          weakest_dimension: { choice: "null_and_empty", confidence: 0.9 },
          runner_up_dimension: { choice: "boundary_off_by_one", confidence: 0.8 },
        },
      }),
      { status: 200 }
    );
  }) as typeof fetch;

  try {
    // jev_thinking with task/content fallback for goal
    const thinking = await runSaVmTool({
      action: "jev_thinking",
      task: "Refactor storage engine",
      thoughts: { t1: "Use sqlite", t2: "Use jsonl" },
      api_key: "dummy",
    });
    expect(thinking.ok).toBe(true);

    // jev_scope with goal fallback for task
    const scope = await runSaVmTool({
      action: "jev_scope",
      goal: "Implement multi-tenant auth",
      api_key: "dummy",
    });
    expect(scope.ok).toBe(true);

    // jev_done with prompt/goal fallback for user_request and content for actual_work
    const done = await runSaVmTool({
      action: "jev_done",
      prompt: "Add tests for auth",
      content: "Added 10 unit tests in auth.test.ts",
      api_key: "dummy",
    });
    expect(done.ok).toBe(true);

    // jev_diagnose with content fallback for error_summary
    const diagnose = await runSaVmTool({
      action: "jev_diagnose",
      content: "NullPointerException at line 42",
      hypotheses: { h1: "Unchecked null from DB", h2: "Stale cache" },
      api_key: "dummy",
    });
    expect(diagnose.ok).toBe(true);

    // jev_edge_cases with content fallback for code
    const edge = await runSaVmTool({
      action: "jev_edge_cases",
      content: "function divide(a: number, b: number) { return a / b; }",
      api_key: "dummy",
    });
    expect(edge.ok).toBe(true);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test("jev throttle defaults to 500ms interval and stays enabled", () => {
  const savedEnvInterval = process.env.JEV_MIN_INTERVAL_MS;
  const savedEnvDisabled = process.env.JEV_THROTTLE_DISABLED;
  const savedEnvQueue = process.env.JEV_MAX_QUEUE;
  delete process.env.JEV_MIN_INTERVAL_MS;
  delete process.env.JEV_THROTTLE_DISABLED;
  delete process.env.JEV_MAX_QUEUE;
  setSharedJevConfig(null);
  setJevThrottle(null);
  try {
    expect(resolveJevMinIntervalMs()).toBe(500);
    expect(resolveJevMaxQueue()).toBe(16);
    expect(isJevThrottleEnabled()).toBe(true);
    expect(getJevThrottle()).toEqual({ minIntervalMs: 500, maxQueueLength: 16, enabled: true });
  } finally {
    if (savedEnvInterval !== undefined) process.env.JEV_MIN_INTERVAL_MS = savedEnvInterval;
    if (savedEnvDisabled !== undefined) process.env.JEV_THROTTLE_DISABLED = savedEnvDisabled;
    if (savedEnvQueue !== undefined) process.env.JEV_MAX_QUEUE = savedEnvQueue;
    setJevThrottle(null);
  }
});

test("jev throttle serializes concurrent calls with the configured interval", async () => {
  const origFetch = globalThis.fetch;
  const startTimes: number[] = [];
  globalThis.fetch = (async () => {
    startTimes.push(Date.now());
    return new Response(
      JSON.stringify({
        model: "jev-latest",
        answers: { decision: { choice: "a", confidence: 0.9 } },
      }),
      { status: 200 }
    );
  }) as typeof fetch;

  setJevThrottle({ minIntervalMs: 150, enabled: true });
  try {
    const [first, second] = await Promise.all([
      nativeJevChoose({ question: "Q1?", options: { a: "A", b: "B" }, api_key: "dummy" } as any),
      nativeJevChoose({ question: "Q2?", options: { a: "A", b: "B" }, api_key: "dummy" } as any),
    ]);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(startTimes).toHaveLength(2);
    // Serial slot: second upstream start must wait for the 150ms interval.
    expect(startTimes[1] - startTimes[0]).toBeGreaterThanOrEqual(100);
  } finally {
    setJevThrottle(null);
    globalThis.fetch = origFetch;
  }
});

test("jev throttle disabled switch skips the wait", async () => {  const origFetch = globalThis.fetch;
  const startTimes: number[] = [];
  globalThis.fetch = (async () => {
    startTimes.push(Date.now());
    return new Response(
      JSON.stringify({
        model: "jev-latest",
        answers: { decision: { choice: "a", confidence: 0.9 } },
      }),
      { status: 200 }
    );
  }) as typeof fetch;

  setJevThrottle({ minIntervalMs: 5_000, enabled: false });
  try {
    expect(isJevThrottleEnabled()).toBe(false);
    const elapsedStart = Date.now();
    const [first, second] = await Promise.all([
      nativeJevChoose({ question: "Q1?", options: { a: "A", b: "B" }, api_key: "dummy" } as any),
      nativeJevChoose({ question: "Q2?", options: { a: "A", b: "B" }, api_key: "dummy" } as any),
    ]);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    // Disabled: must not wait out the 5s interval.
    expect(Date.now() - elapsedStart).toBeLessThan(5_000);
  } finally {
    setJevThrottle(null);
    globalThis.fetch = origFetch;
  }
});

test("jev throttle fails fast when the queue is full", async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    // Slow upstream: holds the slot so concurrent callers pile up.
    await new Promise((resolve) => setTimeout(resolve, 300));
    return new Response(
      JSON.stringify({
        model: "jev-latest",
        answers: { decision: { choice: "a", confidence: 0.9 } },
      }),
      { status: 200 }
    );
  }) as typeof fetch;

  setJevThrottle({ minIntervalMs: 0, maxQueueLength: 1, enabled: true });
  try {
    const settled = await Promise.allSettled([
      nativeJevChoose({ question: "Q1?", options: { a: "A", b: "B" }, api_key: "dummy" } as any),
      nativeJevChoose({ question: "Q2?", options: { a: "A", b: "B" }, api_key: "dummy" } as any),
      nativeJevChoose({ question: "Q3?", options: { a: "A", b: "B" }, api_key: "dummy" } as any),
    ]);
    const fulfilled = settled.filter((r) => r.status === "fulfilled");
    const rejected = settled.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(2);
    for (const r of rejected) {
      expect(String((r as PromiseRejectedResult).reason?.message ?? r)).toContain("overloaded");
    }
  } finally {
    setJevThrottle(null);
    globalThis.fetch = origFetch;
  }
});

test("cloudflare jev upstream detection is host-based", () => {
  expect(isCloudflareJevUpstream("https://api.cloudflare.com/client/v4/accounts/ACCT/ai/run")).toBe(true);
  expect(isCloudflareJevUpstream("HTTPS://API.CLOUDFLARE.COM/client/v4/accounts/x/ai/run/")).toBe(true);
  expect(isCloudflareJevUpstream("https://api.typesafe.ai/v1/systemone")).toBe(false);
  expect(isCloudflareJevUpstream("https://relay.example.com/v1/systemone")).toBe(false);
  expect(isCloudflareJevUpstream("")).toBe(false);
});

test("cloudflare jev request url appends the model path", () => {
  const base = "https://api.cloudflare.com/client/v4/accounts/ACCT/ai/run";
  expect(buildCloudflareJevRequestUrl(base, "clef-flash")).toBe(`${base}/@cf/cloudflare/clef-flash`);
  expect(buildCloudflareJevRequestUrl(`${base}/`, "clef-flash")).toBe(`${base}/@cf/cloudflare/clef-flash`);
  expect(buildCloudflareJevRequestUrl(base, "@cf/cloudflare/clef-flash")).toBe(`${base}/@cf/cloudflare/clef-flash`);
  expect(buildCloudflareJevRequestUrl(base, "custom/path-model")).toBe(`${base}/custom/path-model`);
  expect(buildCloudflareJevRequestUrl(base, "")).toBe(`${base}/@cf/cloudflare/${CLOUDFLARE_JEV_DEFAULT_MODEL}`);
});

test("cloudflare jev body model is always the bare name", () => {
  expect(cloudflareJevBodyModel("clef-flash")).toBe("clef-flash");
  expect(cloudflareJevBodyModel("@cf/cloudflare/clef-flash")).toBe("clef-flash");
  expect(cloudflareJevBodyModel("")).toBe(CLOUDFLARE_JEV_DEFAULT_MODEL);
});

test("cloudflare jev model maps blank/jev defaults to clef-flash", () => {
  expect(resolveCloudflareJevModel("")).toBe(CLOUDFLARE_JEV_DEFAULT_MODEL);
  expect(resolveCloudflareJevModel(JEV_DEFAULT_MODEL)).toBe(CLOUDFLARE_JEV_DEFAULT_MODEL);
  expect(resolveCloudflareJevModel("clef-flash")).toBe("clef-flash");
  expect(resolveCloudflareJevModel("@cf/cloudflare/clef-flash")).toBe("@cf/cloudflare/clef-flash");
});

test("jev upstream payload unwrap tolerates data/result envelopes", () => {
  const answers = { decision: { choice: "a", confidence: 0.9 } };
  expect(unwrapJevUpstreamPayload({ data: { answers } })).toEqual({ answers });
  expect(unwrapJevUpstreamPayload({ result: { answers } })).toEqual({ answers });
  expect(unwrapJevUpstreamPayload({ answers })).toEqual({ answers });
});

test("cloudflare pads single-question payloads to satisfy the 2-question minimum", () => {
  const single = { decision: { type: "choice" } };
  const padded = padCloudflareJevQuestions(single as Record<string, unknown>);
  expect(Object.keys(padded)).toEqual(["decision", CLOUDFLARE_JEV_PAD_QUESTION_ID]);
  expect((padded.decision as Record<string, unknown>).type).toBe("choice");
  const pad = padded[CLOUDFLARE_JEV_PAD_QUESTION_ID] as Record<string, unknown>;
  expect(pad.type).toBe("choice");
  expect(Object.keys((pad.criteria ?? {}) as Record<string, unknown>).length).toBeGreaterThanOrEqual(2);

  const two = { a: { type: "choice" }, b: { type: "choice" } };
  expect(padCloudflareJevQuestions(two as Record<string, unknown>)).toBe(two);
});

test("jev connectivity questions match each upstream contract", () => {
  const cf = buildJevConnectivityQuestions("https://api.cloudflare.com/client/v4/accounts/ACCT/ai/run");
  const cfKeys = Object.keys(cf);
  expect(cfKeys.length).toBeGreaterThanOrEqual(2);
  for (const key of cfKeys) {
    const q = cf[key] as Record<string, unknown>;
    expect(q.type).toBe("choice");
    expect(Object.keys((q.criteria ?? {}) as Record<string, unknown>).length).toBeGreaterThanOrEqual(2);
  }
  expect(buildJevConnectivityQuestions("https://api.typesafe.ai/v1/systemone")).toEqual({
    is_test: { type: "noul", instructions: "Is this a connectivity test?" },
  });
});

test("nativeJevChoose routes cloudflare base urls to the ai/run model path", async () => {
  const origFetch = globalThis.fetch;
  let seenUrl = "";
  let seenAuth = "";
  let seenBody: any = null;
  globalThis.fetch = (async (url: any, init: any) => {
    seenUrl = String(url);
    seenAuth = String(init?.headers?.Authorization ?? "");
    seenBody = JSON.parse(String(init?.body ?? "{}"));
    return new Response(
      JSON.stringify({
        result: {
          answers: { decision: { choice: "b", confidence: 0.88 } },
          model: "clef-flash",
        },
        success: true,
      }),
      { status: 200 }
    );
  }) as typeof fetch;

  setJevThrottle({ minIntervalMs: 0, enabled: false });
  try {
    const result = await nativeJevChoose({
      question: "Which approach?",
      options: { a: "Plan A", b: "Plan B" },
      context: "cloudflare routing probe",
      api_key: "cf-token",
      base_url: "https://api.cloudflare.com/client/v4/accounts/ACCT/ai/run",
    } as any);

    expect(seenUrl).toBe("https://api.cloudflare.com/client/v4/accounts/ACCT/ai/run/@cf/cloudflare/clef-flash");
    expect(seenAuth).toBe("Bearer cf-token");
    expect(seenBody.model).toBe("clef-flash");
    expect(seenBody.questions.decision.type).toBe("choice");
    // Lone `decision` is padded so Cloudflare's 2-question minimum passes.
    expect(Object.keys(seenBody.questions).sort()).toEqual(["_cf_pad", "decision"]);
    expect(result.ok).toBe(true);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.choice).toBe("b");
    expect(parsed.confidence).toBe(0.88);
  } finally {
    setJevThrottle(null);
    globalThis.fetch = origFetch;
  }
});

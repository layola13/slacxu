import { describe, expect, test } from "bun:test";
import { diagnoseAgentReadiness } from "../../apps/server/src/agentReadiness.ts";

const catalog = {
  models: [{
    slug: "gpt-v2",
    multi_agent_version: "v2",
    supported_reasoning_levels: [{ effort: "medium" }, { effort: "high" }]
  }]
};

const readyInput = {
  appServerReady: true,
  agentMode: "enabled" as const,
  config: { agents: { enabled: true }, features: { multi_agent_v2: { enabled: true, max_concurrent_threads_per_session: 5 } } },
  model: "gpt-v2",
  reasoningEffort: "medium",
  childCount: 2,
  catalog
};

describe("diagnoseAgentReadiness", () => {
  test("reports a disabled per-thread Agents override", () => {
    const result = diagnoseAgentReadiness({ ...readyInput, agentMode: "disabled" });
    expect(result.code).toBe("AGENTS_DISABLED");
  });

  test("reports missing and disabled V2 config when inheriting", () => {
    expect(diagnoseAgentReadiness({ ...readyInput, agentMode: "inherit", config: { agents: { enabled: true } } }).code).toBe("AGENTS_V2_CONFIG_MISSING");
    expect(diagnoseAgentReadiness({ ...readyInput, agentMode: "inherit", config: { agents: { enabled: true }, features: { multi_agent_v2: { enabled: false } } } }).code).toBe("AGENTS_V2_DISABLED");
  });

  test("reports empty model and catalog failures", () => {
    expect(diagnoseAgentReadiness({ ...readyInput, model: "" }).code).toBe("AGENTS_MODEL_EMPTY");
    expect(diagnoseAgentReadiness({ ...readyInput, catalog: null }).code).toBe("AGENTS_MODEL_CATALOG_MISSING");
    expect(diagnoseAgentReadiness({ ...readyInput, catalog: { models: [] } }).code).toBe("AGENTS_MODEL_CATALOG_EMPTY");
  });

  test("reports unsynchronized and non-V2 models", () => {
    expect(diagnoseAgentReadiness({ ...readyInput, model: "missing" }).code).toBe("AGENTS_MODEL_NOT_SYNCED");
    expect(diagnoseAgentReadiness({ ...readyInput, catalog: { models: [{ slug: "gpt-v2", multi_agent_version: null }] } }).code).toBe("AGENTS_MODEL_NOT_V2_COMPATIBLE");
  });

  test("reports invalid reasoning, concurrency, role model and running thread", () => {
    expect(diagnoseAgentReadiness({ ...readyInput, reasoningEffort: "ultra" }).code).toBe("AGENTS_REASONING_UNSUPPORTED");
    expect(diagnoseAgentReadiness({ ...readyInput, childCount: 0 }).code).toBe("AGENTS_CONCURRENCY_INVALID");
    expect(diagnoseAgentReadiness({ ...readyInput, childCount: 1, roles: [{ enabled: true, name: "one" }, { enabled: true, name: "two" }] }).code).toBe("AGENTS_CONCURRENCY_EXCEEDED");
    expect(diagnoseAgentReadiness({ ...readyInput, roles: [{ enabled: true, name: "bad", model: "missing" }] }).code).toBe("AGENTS_ROLE_MODEL_NOT_SYNCED");
    expect(diagnoseAgentReadiness({ ...readyInput, threadRunning: true }).code).toBe("AGENTS_THREAD_RUNNING");
  });

  test("allows empty roster and returns AGENTS_READY with a warning", () => {
    const result = diagnoseAgentReadiness(readyInput);
    expect(result.ready).toBe(true);
    expect(result.code).toBe("AGENTS_READY");
    expect(result.warnings[0]?.message).toContain("仍可直接调用 spawn_agent");
    expect(result.checks.rootIncluded).toBe(true);
  });
});

import { expect, test } from "bun:test";
import {
  buildAgentThreadConfig,
  parseAgentRuntimeOverride
} from "../../apps/web/src/app/runtime/useThreadRuntimeSelections";
import { applyReasoningEffortAgentDefaults } from "@codex-ui/shared";

test("maps Ultra reasoning to proactive Agents defaults", () => {
  expect(applyReasoningEffortAgentDefaults("ultra", {
    mode: "inherit", childCount: null, model: "", reasoningEffort: "", roles: []
  })).toMatchObject({ reasoningEffort: "ultra", agents: { mode: "enabled", childCount: 30 } });
});

test("inherits global agent configuration without thread overrides", () => {
  expect(buildAgentThreadConfig(parseAgentRuntimeOverride(undefined))).toBeUndefined();
});

test("maps child count and agent defaults to Codex dotted config keys", () => {
  expect(buildAgentThreadConfig({
    mode: "enabled",
    childCount: 5,
    model: "gpt-5.6-terra",
    reasoningEffort: "max",
    roles: []
  })).toEqual({
    "features.multi_agent_v2.enabled": true,
    "features.multi_agent_v2.max_concurrent_threads_per_session": 6,
    "agents.default_subagent_model": "gpt-5.6-terra",
    "agents.default_subagent_reasoning_effort": "max"
  });
});

test("can disable Multi Agent V2 for one conversation", () => {
  expect(buildAgentThreadConfig({
    mode: "disabled",
    childCount: 12,
    model: "gpt-5.6-luna",
    reasoningEffort: "high",
    roles: []
  })).toEqual({ "features.multi_agent_v2.enabled": false });
});

test("maps a heterogeneous role roster to spawn-agent guidance", () => {
  const config = buildAgentThreadConfig({
    mode: "enabled",
    childCount: 2,
    model: "",
    reasoningEffort: "",
    roles: [
      { id: "research", name: "Researcher", responsibility: "Inspect the architecture.", model: "gpt-5.6-terra", reasoningEffort: "high", enabled: true },
      { id: "review", name: "Reviewer", responsibility: "Review regressions.", model: "gpt-5.6-luna", reasoningEffort: "xhigh", enabled: true },
      { id: "off", name: "Disabled", responsibility: "Do not use.", model: "gpt-5.6-sol", reasoningEffort: "low", enabled: false }
    ]
  });
  expect(config?.["features.multi_agent_v2.expose_spawn_agent_model_overrides"]).toBe(true);
  expect(config?.["features.multi_agent_v2.root_agent_usage_hint_text"]).toContain('Researcher [task_name="research"; model="gpt-5.6-terra", reasoning_effort="high"]');
  expect(config?.["features.multi_agent_v2.root_agent_usage_hint_text"]).not.toContain("Disabled");
});

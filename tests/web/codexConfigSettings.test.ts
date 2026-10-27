import { expect, test } from "bun:test";
import { getDynamicCodexConfigFields } from "../../apps/web/src/state/codexConfigSettings.ts";

test("expands every multi-agent v2 setting including its enable switch", () => {
  const fields = getDynamicCodexConfigFields({
    features: {
      multi_agent_v2: {
        enabled: true,
        tool_namespace: "collaboration"
      }
    }
  });
  const paths = new Set(fields.map((field) => field.keyPath));
  const expectedChildren = [
    "default_wait_timeout_ms",
    "enabled",
    "expose_spawn_agent_model_overrides",
    "hide_spawn_agent_metadata",
    "max_concurrent_threads_per_session",
    "max_wait_timeout_ms",
    "min_wait_timeout_ms",
    "multi_agent_mode_hint_text",
    "non_code_mode_only",
    "root_agent_usage_hint_text",
    "subagent_developer_instructions",
    "subagent_usage_hint_text",
    "tool_namespace",
    "usage_hint_enabled",
    "usage_hint_text",
    "wait_agent_enabled"
  ];

  expect(paths.has("features.multi_agent_v2")).toBe(true);
  for (const child of expectedChildren) {
    expect(paths.has(`features.multi_agent_v2.${child}`)).toBe(true);
  }
  expect(fields.find((field) => field.keyPath === "features.multi_agent_v2.enabled")?.kind).toBe("boolean");
  expect(fields.find((field) => field.keyPath === "features.multi_agent_v2.max_concurrent_threads_per_session")?.kind).toBe("number");
  expect(fields.find((field) => field.keyPath === "features.multi_agent_v2.tool_namespace")?.kind).toBe("text");
  expect(fields.find((field) => field.keyPath === "features.multi_agent_v2.tool_namespace")?.description).toContain(
    "Leave empty for ordinary function tools"
  );
});

test("expands context_management setting with experimental_mode boolean field", () => {
  const fields = getDynamicCodexConfigFields({
    features: {
      context_management: {
        experimental_mode: true
      }
    }
  });
  const paths = new Set(fields.map((field) => field.keyPath));
  expect(paths.has("features.context_management")).toBe(true);
  expect(paths.has("features.context_management.experimental_mode")).toBe(true);
  const experimentalField = fields.find((field) => field.keyPath === "features.context_management.experimental_mode");
  expect(experimentalField?.kind).toBe("boolean");
  expect(experimentalField?.description).toContain("Enables experimental context management");
});


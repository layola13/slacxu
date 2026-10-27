import { expect, test } from "bun:test";
import { describeAgentReadiness } from "../../apps/web/src/app/agents/agentReadiness.ts";

test("maps readiness codes and warnings to stable panel text", () => {
  expect(describeAgentReadiness(null)).toEqual({ status: "unchecked", title: "尚未检查 Agents 配置", detail: null });
  expect(describeAgentReadiness({
    ready: false,
    code: "AGENTS_MODEL_NOT_SYNCED",
    issues: [{ code: "AGENTS_MODEL_NOT_SYNCED", message: "当前模型不在 V2 模型目录中" }],
    warnings: [],
    checks: {},
    config: {},
    catalog: {}
  })).toEqual({
    status: "error",
    title: "配置错误 · AGENTS_MODEL_NOT_SYNCED",
    detail: "当前模型不在 V2 模型目录中 请重新选择一个已同步且支持 V2 的模型；模型偶尔下架时也可在模型目录中切换。"
  });
  expect(describeAgentReadiness({
    ready: true,
    code: "AGENTS_READY",
    issues: [],
    warnings: [{ code: "AGENTS_READY", message: "尚未配置角色编队；根 Agent 仍可直接调用 spawn_agent" }],
    checks: {},
    config: {},
    catalog: {}
  }).detail).toContain("仍可直接调用 spawn_agent");
});

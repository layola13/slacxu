import type { AgentReadinessResult } from "../../state/codexClient";

export type AgentReadinessDisplay = { status: "active" | "error" | "unchecked"; title: string; detail: string | null };

export function describeAgentReadiness(result: AgentReadinessResult | null): AgentReadinessDisplay {
  if (!result) return { status: "unchecked", title: "尚未检查 Agents 配置", detail: null };
  if (result.ready) return { status: "active", title: "Agents 已激活", detail: result.warnings[0]?.message ?? null };
  const issue = result.issues[0];
  const hint = result.code === "AGENTS_MODEL_NOT_SYNCED" || result.code === "AGENTS_MODEL_CATALOG_MISSING" || result.code === "AGENTS_MODEL_CATALOG_EMPTY"
    ? "请重新选择一个已同步且支持 V2 的模型；模型偶尔下架时也可在模型目录中切换。"
    : null;
  return { status: "error", title: `配置错误 · ${result.code}`, detail: [issue?.message ?? "Agents 配置检查失败", hint].filter(Boolean).join(" ") };
}

import { readFile } from "node:fs/promises";

export const AGENT_READINESS_CODES = [
  "AGENTS_DISABLED",
  "AGENTS_V2_CONFIG_MISSING",
  "AGENTS_V2_DISABLED",
  "AGENTS_CONFIG_NOT_LOADED",
  "AGENTS_APP_SERVER_UNAVAILABLE",
  "AGENTS_MODEL_EMPTY",
  "AGENTS_MODEL_CATALOG_MISSING",
  "AGENTS_MODEL_CATALOG_EMPTY",
  "AGENTS_MODEL_NOT_SYNCED",
  "AGENTS_MODEL_NOT_V2_COMPATIBLE",
  "AGENTS_REASONING_UNSUPPORTED",
  "AGENTS_CONCURRENCY_INVALID",
  "AGENTS_CONCURRENCY_EXCEEDED",
  "AGENTS_ROLE_MODEL_NOT_SYNCED",
  "AGENTS_ROLE_MODEL_NOT_V2_COMPATIBLE",
  "AGENTS_THREAD_RUNNING",
  "AGENTS_READY"
] as const;

export type AgentReadinessCode = typeof AGENT_READINESS_CODES[number];

export type AgentReadinessInput = {
  agentMode?: "inherit" | "enabled" | "disabled";
  config?: unknown;
  configError?: string | null;
  appServerReady?: boolean;
  model?: string | null;
  reasoningEffort?: string | null;
  childCount?: number | null;
  roles?: Array<{ enabled?: boolean; name?: string; model?: string | null; reasoningEffort?: string | null }>;
  threadRunning?: boolean;
  catalog?: unknown;
};

export type AgentReadinessIssue = {
  code: AgentReadinessCode;
  message: string;
  details?: Record<string, unknown>;
};

export type AgentReadinessResult = {
  ready: boolean;
  code: AgentReadinessCode;
  issues: AgentReadinessIssue[];
  warnings: AgentReadinessIssue[];
  checks: Record<string, unknown>;
  config: Record<string, unknown>;
  catalog: Record<string, unknown>;
};

type ModelEntry = { slug?: unknown; multi_agent_version?: unknown; supported_reasoning_levels?: unknown };

export async function readAgentModelCatalog(path: string): Promise<{ catalog: unknown; error: string | null }> {
  try {
    return { catalog: JSON.parse(await readFile(path, "utf8")), error: null };
  } catch (error) {
    return { catalog: null, error: error instanceof Error ? error.message : String(error) };
  }
}

export function diagnoseAgentReadiness(input: AgentReadinessInput): AgentReadinessResult {
  const config = asRecord(input.config);
  const features = asRecord(config.features);
  const v2Raw = features.multi_agent_v2;
  const v2 = asRecord(v2Raw);
  const agents = asRecord(config.agents);
  const issues: AgentReadinessIssue[] = [];
  const warnings: AgentReadinessIssue[] = [];
  const add = (code: AgentReadinessCode, message: string, details?: Record<string, unknown>) => issues.push({ code, message, ...(details ? { details } : {}) });
  const addWarning = (code: AgentReadinessCode, message: string, details?: Record<string, unknown>) => warnings.push({ code, message, ...(details ? { details } : {}) });

  if (input.appServerReady === false) add("AGENTS_APP_SERVER_UNAVAILABLE", "Codex app-server 尚未就绪");
  if (input.configError) add("AGENTS_CONFIG_NOT_LOADED", "虚拟 config.toml 未能读取", { error: input.configError });
  const sessionEnabled = input.agentMode === "enabled";
  const sessionDisabled = input.agentMode === "disabled";
  const configuredV2Enabled = v2Raw !== undefined && v2Raw !== null && v2Raw !== false && v2.enabled !== false;
  const legacyEnabled = agents.enabled !== false;
  const effectiveV2Enabled = sessionEnabled || (!sessionDisabled && configuredV2Enabled);
  if (sessionDisabled || (!effectiveV2Enabled && !legacyEnabled)) add("AGENTS_DISABLED", sessionDisabled ? "当前对话已关闭 Agents" : "Agents 已在 [agents].enabled 中关闭");
  if (!sessionEnabled && !sessionDisabled && (v2Raw === undefined || v2Raw === null)) add("AGENTS_V2_CONFIG_MISSING", "features.multi_agent_v2 未配置");
  else if (!effectiveV2Enabled && !sessionDisabled) add("AGENTS_V2_DISABLED", "Multi Agent V2 未开启");

  const model = typeof input.model === "string" ? input.model.trim() : "";
  if (!model) add("AGENTS_MODEL_EMPTY", "当前聊天模型为空");
  const catalogRecord = asRecord(input.catalog);
  const entries = Array.isArray(catalogRecord.models) ? catalogRecord.models.filter((entry): entry is ModelEntry => Boolean(entry && typeof entry === "object")) : [];
  if (input.catalog === null || input.catalog === undefined) add("AGENTS_MODEL_CATALOG_MISSING", "V2 模型目录不存在或未加载");
  else if (entries.length === 0) add("AGENTS_MODEL_CATALOG_EMPTY", "V2 模型目录为空");
  const entryFor = (name: string) => entries.find((entry) => entry.slug === name);
  const modelEntry = model ? entryFor(model) : undefined;
  if (model && input.catalog !== null && input.catalog !== undefined && entries.length > 0 && !modelEntry) {
    add("AGENTS_MODEL_NOT_SYNCED", "当前模型不在 V2 模型目录中", { model });
  }
  if (modelEntry && modelEntry.multi_agent_version !== "v2") {
    add("AGENTS_MODEL_NOT_V2_COMPATIBLE", "当前模型不支持 Multi Agent V2", { model, multi_agent_version: modelEntry.multi_agent_version ?? null });
  }
  const requestedEffort = typeof input.reasoningEffort === "string" ? input.reasoningEffort.trim() : "";
  if (requestedEffort && modelEntry) {
    const supported = Array.isArray(modelEntry.supported_reasoning_levels)
      ? modelEntry.supported_reasoning_levels.map((level) => typeof level === "object" && level && typeof (level as Record<string, unknown>).effort === "string" ? (level as Record<string, unknown>).effort : null).filter((level): level is string => Boolean(level))
      : [];
    if (supported.length > 0 && !supported.includes(requestedEffort)) add("AGENTS_REASONING_UNSUPPORTED", "当前模型不支持所选子代理思考强度", { model, reasoningEffort: requestedEffort, supported });
  }

  const configuredConcurrency = v2.max_concurrent_threads_per_session ?? agents.max_concurrent_threads_per_session;
  const concurrency = input.childCount == null ? configuredConcurrency : (Number.isSafeInteger(input.childCount) && input.childCount >= 1 ? input.childCount + 1 : input.childCount);
  if (concurrency !== undefined && concurrency !== null && (!Number.isSafeInteger(concurrency) || Number(concurrency) < 1)) {
    add("AGENTS_CONCURRENCY_INVALID", "Agents 并发数量必须是正整数", { concurrency });
  } else if (input.childCount != null && Number.isSafeInteger(input.childCount) && input.childCount < 1) {
    add("AGENTS_CONCURRENCY_INVALID", "子代理数量必须至少为 1", { childCount: input.childCount });
  }
  if (input.threadRunning) add("AGENTS_THREAD_RUNNING", "当前线程正在运行；请等待完成后再应用 Agents 配置");

  const enabledRoles = (input.roles ?? []).filter((role) => role.enabled !== false);
  if (input.childCount != null && Number.isSafeInteger(input.childCount) && enabledRoles.length > input.childCount) {
    add("AGENTS_CONCURRENCY_EXCEEDED", "启用的角色数量超过子代理容量", { roles: enabledRoles.length, childCount: input.childCount, rootIncluded: true });
  }
  for (const role of enabledRoles) {
    const roleModel = typeof role.model === "string" && role.model.trim() ? role.model.trim() : model;
    if (!roleModel) continue;
    const roleEntry = entryFor(roleModel);
    if (entries.length > 0 && !roleEntry) add("AGENTS_ROLE_MODEL_NOT_SYNCED", `角色模型不在 V2 目录中: ${role.name || roleModel}`, { role: role.name || roleModel, model: roleModel });
    else if (roleEntry && roleEntry.multi_agent_version !== "v2") add("AGENTS_ROLE_MODEL_NOT_V2_COMPATIBLE", `角色模型不支持 V2: ${role.name || roleModel}`, { role: role.name || roleModel, model: roleModel });
  }
  if (enabledRoles.length === 0) addWarning("AGENTS_READY", "尚未配置角色编队；根 Agent 仍可直接调用 spawn_agent");

  const ready = issues.length === 0;
  const catalogSummary = {
    models: entries.map((entry) => ({
      slug: typeof entry.slug === "string" ? entry.slug : null,
      multi_agent_version: typeof entry.multi_agent_version === "string" ? entry.multi_agent_version : null,
      supported_reasoning_levels: Array.isArray(entry.supported_reasoning_levels) ? entry.supported_reasoning_levels : []
    }))
  };
  return {
    ready,
    code: ready ? "AGENTS_READY" : issues[0]?.code ?? "AGENTS_CONFIG_NOT_LOADED",
    issues,
    warnings,
    checks: {
      agentMode: input.agentMode ?? "inherit",
      agentsEnabled: sessionDisabled ? false : sessionEnabled || legacyEnabled,
      multiAgentV2Enabled: effectiveV2Enabled,
      model: model || null,
      modelCatalogPresent: input.catalog !== null && input.catalog !== undefined,
      modelCatalogEntry: Boolean(modelEntry),
      modelSupportsV2: modelEntry?.multi_agent_version === "v2",
      concurrency: concurrency ?? null,
      rootIncluded: true,
      roleCount: enabledRoles.length
    },
    config: {
      features: { multi_agent_v2: v2Raw ?? null },
      agents,
      threadOverride: {
        mode: input.agentMode ?? "inherit",
        childCount: input.childCount ?? null,
        model: model || null,
        reasoningEffort: requestedEffort || null,
        roles: input.roles ?? []
      }
    },
    catalog: catalogSummary
  };
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

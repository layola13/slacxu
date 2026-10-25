import type { CliBackend } from "@codex-ui/shared";

/**
 * Ultra 对外 /v1 转发的 model 命名与路由解析 (P1)。
 *
 * 语法: `{cli}-{provider}-{group}-{model...}`
 *  - 从左切: cli / provider / group 均为无歧义库存匹配, 余下全部归 model
 *    (model 本身可含 `-` 与 `/`, 例如 `opencode/muse-spark-1.3`)。
 *  - provider / group 必须能在库存中找到 (longest-match), 避免
 *    `codex-team` 这类含横杠 groupId 被 positional split 切错。
 *  - provider / group 自身含横杠时靠库存 longest-match 解决;
 *    纯 positional 回退仅用于报错信息, 不做执行路由。
 */

export const FORWARD_CLI_BACKENDS: readonly CliBackend[] = [
  "codex",
  "claude",
  "auggie",
  "agy",
  "grok",
  "pi",
  "opencode",
  "mini",
];

/** 对外暴露的活跃 CLI 列表 (当前仅开放 opencode 本地模型)。 */
export const FORWARD_ACTIVE_CLIS: readonly CliBackend[] = [
  "opencode",
  "muse",
];

/**
 * 本地转发中转站 id (开关自动生成, baseUrl 指回自身 /v1)。
 * 解析与枚举时特殊处理, 禁止再转一次 (无限回环)。
 */
export const FORWARD_RELAY_PROVIDER_ID = "ultra-forward";

export interface ForwardRoute {
  cliBackend: CliBackend;
  providerId: string;
  groupId: string;
  model: string;
}

export interface ForwardInventoryProvider {
  providerId: string;
  groups: { groupId: string }[];
}

export class ForwardModelError extends Error {
  readonly code: "unknown_cli" | "unknown_provider" | "unknown_group" | "missing_model" | "malformed" | "loopback";
  constructor(code: ForwardModelError["code"], message: string) {
    super(message);
    this.name = "ForwardModelError";
    this.code = code;
  }
}

function isCliBackend(value: string): value is CliBackend {
  return (FORWARD_CLI_BACKENDS as readonly string[]).includes(value);
}

/** 无库存时的 positional 切分 (仅用于生成提示, 不做路由)。 */
export function splitForwardModelPositional(id: string): { cli: string; provider: string; group: string; model: string } | null {
  const parts = id.split("-");
  if (parts.length < 4) return null;
  const cli = parts[0] ?? "";
  const provider = parts[1] ?? "";
  const group = parts[2] ?? "";
  const model = parts.slice(3).join("-");
  if (!cli || !provider || !group || !model) return null;
  return { cli, provider, group, model };
}

/**
 * 用库存 longest-match 解析 forward model id。
 * `inventory` 为当前可见 provider/group 清单 (顺序无关, 按长度降序匹配)。
 */
export function parseForwardModelId(id: string, inventory: ForwardInventoryProvider[]): ForwardRoute {
  const raw = (id ?? "").trim();
  if (!raw) {
    throw new ForwardModelError("malformed", "forward model id 为空, 期望格式 {cli}-{provider}-{group}-{model}, 例如 codex-deepkey-default-gpt-5.6-luna");
  }
  // 先判回环 (不依赖库存是否含 ultra-forward, 亦不论是否有 cli 前缀):
  // 出口站 (baseUrl 指回自身 /v1) 不可再转一次, 提前硬拦截防止自循环。
  if (
    raw === FORWARD_RELAY_PROVIDER_ID ||
    raw.startsWith(`${FORWARD_RELAY_PROVIDER_ID}-`) ||
    raw.startsWith(`${FORWARD_RELAY_PROVIDER_ID}/`) ||
    raw.includes(`-${FORWARD_RELAY_PROVIDER_ID}-`) ||
    raw.includes(`-${FORWARD_RELAY_PROVIDER_ID}/`) ||
    raw.includes(`-${FORWARD_RELAY_PROVIDER_ID}`) ||
    raw.includes(FORWARD_RELAY_PROVIDER_ID)
  ) {
    throw new ForwardModelError(
      "loopback",
      `回环拒绝: Ultra本地转发是出口中转站 (baseUrl 指回自身 /v1), 不可再转一次 (${raw})。请直接选用内层真实模型。`
    );
  }
  const firstDash = raw.indexOf("-");
  if (firstDash <= 0) {
    throw new ForwardModelError("malformed", `forward model id 非法: ${raw}, 期望格式 {cli}-{provider}-{group}-{model}`);
  }
  const cli = raw.slice(0, firstDash);
  if (!isCliBackend(cli)) {
    throw new ForwardModelError(
      "unknown_cli",
      `未知 cli 后端: ${cli} (来自 ${raw}), 可用: ${FORWARD_CLI_BACKENDS.join(", ")}`
    );
  }
  const rest = raw.slice(firstDash + 1);
  const providers = [...inventory].sort((a, b) => b.providerId.length - a.providerId.length);
  for (const provider of providers) {
    if (rest !== provider.providerId && !rest.startsWith(`${provider.providerId}-`)) continue;
    const afterProvider = rest === provider.providerId ? "" : rest.slice(provider.providerId.length + 1);
    const groups = [...provider.groups].sort((a, b) => b.groupId.length - a.groupId.length);
    for (const group of groups) {
      if (afterProvider !== group.groupId && !afterProvider.startsWith(`${group.groupId}-`)) continue;
      const model = afterProvider === group.groupId ? "" : afterProvider.slice(group.groupId.length + 1);
      if (!model) {
        throw new ForwardModelError("missing_model", `forward model 缺少模型部分: ${raw}, 期望 {cli}-{provider}-{group}-{model}`);
      }
      return { cliBackend: cli, providerId: provider.providerId, groupId: group.groupId, model };
    }
    const knownGroups = provider.groups.map((g) => g.groupId).join(", ") || "(无可用分组)";
    throw new ForwardModelError("unknown_group", `未知分组: ${afterProvider || "(空)"} (provider=${provider.providerId}), 可用: ${knownGroups}`);
  }
  const knownProviders = providers.map((p) => p.providerId).join(", ") || "(无可用中转)";
  throw new ForwardModelError("unknown_provider", `未知中转站: ${rest} (来自 ${raw}), 可用: ${knownProviders}`);
}

/** 生成标准 forward model id (model 部分原样保留 `-` 与 `/`)。 */
export function formatForwardModelId(route: ForwardRoute): string {
  return `${route.cliBackend}-${route.providerId}-${route.groupId}-${route.model}`;
}

export interface ForwardModelInventory {
  providerId: string;
  groupId: string;
  models: string[];
}

/** 由库存笛卡尔展开为 OpenAI /v1/models 条目 (cli × provider/group × model)。 */
export function buildForwardModelIds(
  clis: readonly CliBackend[],
  inventory: ForwardModelInventory[]
): string[] {
  const ids: string[] = [];
  for (const cliBackend of clis) {
    for (const entry of inventory) {
      for (const model of entry.models) {
        if (!model) continue;
        ids.push(formatForwardModelId({ cliBackend, providerId: entry.providerId, groupId: entry.groupId, model }));
      }
    }
  }
  return [...new Set(ids)];
}

/** 解析 inventory 供 parseForwardModelId 使用 (provider → groups)。 */
export function toParseInventory(inventory: ForwardModelInventory[]): ForwardInventoryProvider[] {
  const byProvider = new Map<string, Set<string>>();
  for (const entry of inventory) {
    if (!byProvider.has(entry.providerId)) byProvider.set(entry.providerId, new Set());
    byProvider.get(entry.providerId)!.add(entry.groupId);
  }
  return [...byProvider.entries()].map(([providerId, groups]) => ({
    providerId,
    groups: [...groups].map((groupId) => ({ groupId })),
  }));
}

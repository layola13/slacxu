import type { NormalizedTokenUsage, PricedTokenUsage, TokenUsageSource } from "@codex-ui/shared";
import type { RuntimeDatabase } from "./runtime/database.js";

export type RequestUsageRecord = {
  ownerId: string; threadId: string; turnId: string; requestId: string;
  source: TokenUsageSource | string; providerId?: string; groupId?: string; model?: string;
  usage: NormalizedTokenUsage | PricedTokenUsage; costUsd?: number; billingSnapshot?: unknown;
  createdAt: number; updatedAt: number; debitedAt?: number;
};

export type UsageTokenBucket = {
  input: number; output: number; cached: number; total: number; cost: number; count: number;
  /** 对标 axonhub 细分：读缓存 / 写缓存 / 推理（cached 保留=读+写兼容）。 */
  cachedRead?: number; cacheWrite?: number; reasoning?: number;
  /** 对标 axonhub costItems 子集：flat-rate 四项费用拆分（阶梯价暂无，按实际计费口径）。 */
  costBreakdown?: { input: number; cachedInput: number; cacheWrite: number; output: number };
};

export type UsageTokenDimension = "provider" | "group" | "model" | "owner";

export type UsageTokenDimensionRow = UsageTokenBucket & { name: string; providerId?: string };

export type UsageTokenDaily = UsageTokenBucket & { date: string };

/** 对标 axonhub AnalyticsFilter（子集）：起止日期 + provider/group/model/owner 四维 AND。本仓库无 apiKey/project 概念，调用方忽略该两维。 */
export type AnalyticsFilter = {
  startMs?: number;
  endMs?: number;
  providerId?: string;
  groupId?: string;
  modelContains?: string;
  ownerId?: string;
};

/** 解析 YYYY-MM-DD 起止（本地时区，end 含当天）；缺省近 30 天。返回毫秒时间戳。 */
export function parseAnalyticsRange(startDate?: string, endDate?: string): { startMs: number; endMs: number } {
  const dayMs = 24 * 60 * 60 * 1000;
  const now = Date.now();
  let endMs: number = now;
  let startMs: number = now - 29 * dayMs;
  const parseDay = (s: string, endOfDay: boolean): number | null => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    const t = new Date(`${s}T${endOfDay ? "23:59:59.999" : "00:00:00"}`);
    const ms = t.getTime();
    return Number.isFinite(ms) ? ms : null;
  };
  if (startDate) {
    const parsed = parseDay(startDate, false);
    if (parsed != null) startMs = parsed;
  }
  if (endDate) {
    const parsed = parseDay(endDate, true);
    if (parsed != null) endMs = parsed;
  }
  if (startMs > endMs) [startMs, endMs] = [endMs, startMs];
  // 上限 366 天，防止全表误扫。
  if (endMs - startMs > 366 * dayMs) startMs = endMs - 366 * dayMs;
  return { startMs, endMs };
}

type UsageRow = {
  owner_id: string; thread_id: string; turn_id: string; request_id: string; source: string;
  provider_id: string | null; group_id: string | null; model: string | null; usage_json: string;
  cost_usd: number | null; billing_json: string | null; created_at: number; updated_at: number; debited_at: number | null;
};

export class RequestUsageStore {
  public constructor(private readonly db: RuntimeDatabase) {
    this.db.exec([
      "CREATE TABLE IF NOT EXISTS request_usage_ledger (",
      "owner_id TEXT NOT NULL, thread_id TEXT NOT NULL, turn_id TEXT NOT NULL, request_id TEXT NOT NULL,",
      "source TEXT NOT NULL, provider_id TEXT, group_id TEXT, model TEXT, usage_json TEXT NOT NULL,",
      "cost_usd REAL, billing_json TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, debited_at INTEGER,",
      "PRIMARY KEY (owner_id, thread_id, request_id)",
      ");",
      "CREATE INDEX IF NOT EXISTS request_usage_thread_idx ON request_usage_ledger(owner_id, thread_id, created_at);",
      "CREATE INDEX IF NOT EXISTS request_usage_turn_idx ON request_usage_ledger(owner_id, thread_id, turn_id, created_at);"
    ].join("\n"));
  }

  public record(input: Omit<RequestUsageRecord, "createdAt" | "updatedAt" | "debitedAt">): { record: RequestUsageRecord; inserted: boolean } {
    const now = Date.now();
    const existing = this.db.prepare("SELECT * FROM request_usage_ledger WHERE owner_id = ? AND thread_id = ? AND request_id = ? LIMIT 1").get(input.ownerId, input.threadId, input.requestId) as UsageRow | undefined;
    const usageJson = JSON.stringify(input.usage);
    const billingJson = input.billingSnapshot == null
      ? (existing?.billing_json ?? null)
      : JSON.stringify(input.billingSnapshot);
    const costUsd = input.costUsd ?? (existing?.cost_usd == null ? null : Number(existing.cost_usd));
    if (existing) {
      this.db.prepare("UPDATE request_usage_ledger SET turn_id = ?, source = ?, provider_id = ?, group_id = ?, model = ?, usage_json = ?, cost_usd = ?, billing_json = ?, updated_at = ? WHERE owner_id = ? AND thread_id = ? AND request_id = ?")
        .run(input.turnId, input.source, input.providerId ?? existing.provider_id, input.groupId ?? existing.group_id, input.model ?? existing.model, usageJson, costUsd, billingJson, now, input.ownerId, input.threadId, input.requestId);
      return { record: this.map({ ...existing, turn_id: input.turnId, source: input.source, provider_id: input.providerId ?? existing.provider_id, group_id: input.groupId ?? existing.group_id, model: input.model ?? existing.model, usage_json: usageJson, cost_usd: costUsd, billing_json: billingJson, updated_at: now }), inserted: false };
    }
    this.db.prepare("INSERT INTO request_usage_ledger (owner_id, thread_id, turn_id, request_id, source, provider_id, group_id, model, usage_json, cost_usd, billing_json, created_at, updated_at, debited_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)")
      .run(input.ownerId, input.threadId, input.turnId, input.requestId, input.source, input.providerId ?? null, input.groupId ?? null, input.model ?? null, usageJson, input.costUsd ?? null, billingJson, now, now);
    return { record: { ...input, createdAt: now, updatedAt: now }, inserted: true };
  }

  public markDebited(ownerId: string, threadId: string, requestId: string, at = Date.now()): void {
    this.db.prepare("UPDATE request_usage_ledger SET debited_at = ?, updated_at = ? WHERE owner_id = ? AND thread_id = ? AND request_id = ? AND debited_at IS NULL").run(at, at, ownerId, threadId, requestId);
  }

  public list(ownerId: string, threadId: string): RequestUsageRecord[] {
    return (this.db.prepare("SELECT * FROM request_usage_ledger WHERE owner_id = ? AND thread_id = ? ORDER BY created_at ASC, request_id ASC").all(ownerId, threadId) as UsageRow[]).map((row) => this.map(row));
  }

  // Token/费用聚合层（对标 axonhub tokenStats/costStats）：usage_json 经
  // SQLite json_extract 就地求和，避免全表 JSON 解析常驻内存。
  // input 取逐行有效值 MAX(input, cachedRead + cacheWrite)：2026-10-04 之前的历史行
  // 按非包含式写入（input 仅为未命中部分），直接求和会导致 cached > input、
  // 命中率被 min(100, ·) 截成 100%。逐行取 MAX 即 normalize 的 inclusive 还原，
  // 对已是包含式的新行是 no-op（input 本就 >= cached + write）。
  private static readonly TOKEN_SELECT = [
    "COALESCE(SUM(MAX(COALESCE(CAST(json_extract(usage_json, '$.inputTokens') AS INTEGER), 0), COALESCE(CAST(json_extract(usage_json, '$.cachedInputTokens') AS INTEGER), 0) + COALESCE(CAST(json_extract(usage_json, '$.cacheWriteInputTokens') AS INTEGER), 0))), 0) AS input",
    "COALESCE(SUM(CAST(json_extract(usage_json, '$.outputTokens') AS INTEGER)), 0) AS output",
    "COALESCE(SUM(CAST(json_extract(usage_json, '$.cachedInputTokens') AS INTEGER) + CAST(json_extract(usage_json, '$.cacheWriteInputTokens') AS INTEGER)), 0) AS cached",
    "COALESCE(SUM(CAST(json_extract(usage_json, '$.cachedInputTokens') AS INTEGER)), 0) AS cached_read",
    "COALESCE(SUM(CAST(json_extract(usage_json, '$.cacheWriteInputTokens') AS INTEGER)), 0) AS cache_write",
    "COALESCE(SUM(CAST(json_extract(usage_json, '$.reasoningOutputTokens') AS INTEGER)), 0) AS reasoning",
    "COALESCE(SUM(CAST(json_extract(usage_json, '$.totalTokens') AS INTEGER)), 0) AS total",
    "COALESCE(SUM(cost_usd), 0) AS cost",
    "COALESCE(SUM(CAST(json_extract(usage_json, '$.costBreakdownUsd.input') AS REAL)), 0) AS cost_input",
    "COALESCE(SUM(CAST(json_extract(usage_json, '$.costBreakdownUsd.cachedInput') AS REAL)), 0) AS cost_cached",
    "COALESCE(SUM(CAST(json_extract(usage_json, '$.costBreakdownUsd.cacheWrite') AS REAL)), 0) AS cost_write",
    "COALESCE(SUM(CAST(json_extract(usage_json, '$.costBreakdownUsd.output') AS REAL)), 0) AS cost_output",
    "COUNT(*) AS count",
  ].join(", ");

  private ownerClause(ownerId: string | null): { clause: string; args: string[] } {
    if (ownerId == null || ownerId === "") return { clause: "1 = 1", args: [] };
    return { clause: "owner_id = ?", args: [ownerId] };
  }

  private static toBucket(row: Record<string, number | string | null>): UsageTokenBucket {
    return {
      input: Number(row.input ?? 0), output: Number(row.output ?? 0), cached: Number(row.cached ?? 0),
      total: Number(row.total ?? 0), cost: Number(row.cost ?? 0), count: Number(row.count ?? 0),
      cachedRead: Number(row.cached_read ?? 0), cacheWrite: Number(row.cache_write ?? 0),
      reasoning: Number(row.reasoning ?? 0),
      costBreakdown: {
        input: Number(row.cost_input ?? 0), cachedInput: Number(row.cost_cached ?? 0),
        cacheWrite: Number(row.cost_write ?? 0), output: Number(row.cost_output ?? 0),
      },
    };
  }

  /**
   * 网关富化：按 threadId+turnId 批量汇总用量（JEV最弱环节p2的性能守卫：
   * 单次 IN 查询 ≤100 组，避免 N+1；无 turnId 时按 threadId 回退）。
   */
  public sumForThreadTurns(ownerId: string | null, keys: { threadId?: string; turnId?: string }[]): Map<string, UsageTokenBucket & { costItems?: number }> {
    const out = new Map<string, UsageTokenBucket & { costItems?: number }>();
    const valid = keys.filter((k) => k.threadId);
    if (valid.length === 0) return out;
    const sliced = valid.slice(0, 100);
    try {
      const { clause, args } = this.ownerClause(ownerId);
      // 按 (thread,turn) 分组一次查出；turn 为空时按 thread 聚合由调用方合并。
      const turnKeys = sliced.filter((k) => k.turnId);
      if (turnKeys.length > 0) {
        const orClauses = turnKeys.map(() => "(thread_id = ? AND turn_id = ?)").join(" OR ");
        const turnArgs: string[] = [];
        for (const k of turnKeys) { turnArgs.push(k.threadId!, k.turnId!); }
        const rows = this.db.prepare(
          `SELECT thread_id AS thread_id, turn_id AS turn_id, ${RequestUsageStore.TOKEN_SELECT} FROM request_usage_ledger WHERE ${clause} AND (${orClauses}) GROUP BY thread_id, turn_id`
        ).all(...args, ...turnArgs) as ({ thread_id: string; turn_id: string } & Record<string, number>)[];
        for (const row of rows) {
          out.set(`${row.thread_id}\u0000${row.turn_id}`, RequestUsageStore.toBucket(row));
        }
      }
      const threadOnly = sliced.filter((k) => !k.turnId && k.threadId);
      if (threadOnly.length > 0) {
        const uniq = [...new Set(threadOnly.map((k) => k.threadId!))].slice(0, 100);
        const placeholders = uniq.map(() => "?").join(", ");
        const rows = this.db.prepare(
          `SELECT thread_id AS thread_id, '' AS turn_id, ${RequestUsageStore.TOKEN_SELECT} FROM request_usage_ledger WHERE ${clause} AND thread_id IN (${placeholders}) GROUP BY thread_id`
        ).all(...args, ...uniq) as ({ thread_id: string; turn_id: string } & Record<string, number>)[];
        for (const row of rows) {
          out.set(`${row.thread_id}\u0000`, RequestUsageStore.toBucket(row));
        }
      }
    } catch (error) {
      console.warn("[request-usage] sumForThreadTurns failed", { error: error instanceof Error ? error.message : String(error) });
    }
    return out;
  }

  /** 全部/月/周/日四档词元汇总，对标看板词元统计卡。 */
  public tokenSummary(ownerId: string | null): { all: UsageTokenBucket; month: UsageTokenBucket; week: UsageTokenBucket; day: UsageTokenBucket } {
    const now = new Date();
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const weekStart = dayStart - ((now.getDay() + 6) % 7) * 24 * 60 * 60 * 1000;
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    // 注意：SQLite 按文本顺序绑定，SELECT 列表的 CASE 先于 WHERE，时间参数在前。
    const { clause, args } = this.ownerClause(ownerId);
    // 四档均返回与 TOKEN_SELECT 同口径的细分列（cached_read/cache_write/reasoning/
    // costInput/cached/write/output），避免“总费用有值、拆分全零”。
    const periodSelect = (prefix: string, bound: string): string => [
      `COALESCE(SUM(CASE WHEN created_at >= ${bound} THEN MAX(COALESCE(CAST(json_extract(usage_json, '$.inputTokens') AS INTEGER), 0), COALESCE(CAST(json_extract(usage_json, '$.cachedInputTokens') AS INTEGER), 0) + COALESCE(CAST(json_extract(usage_json, '$.cacheWriteInputTokens') AS INTEGER), 0)) ELSE 0 END), 0) AS ${prefix}input`,
      `COALESCE(SUM(CASE WHEN created_at >= ${bound} THEN CAST(json_extract(usage_json, '$.outputTokens') AS INTEGER) ELSE 0 END), 0) AS ${prefix}output`,
      `COALESCE(SUM(CASE WHEN created_at >= ${bound} THEN CAST(json_extract(usage_json, '$.cachedInputTokens') AS INTEGER) + CAST(json_extract(usage_json, '$.cacheWriteInputTokens') AS INTEGER) ELSE 0 END), 0) AS ${prefix}cached`,
      `COALESCE(SUM(CASE WHEN created_at >= ${bound} THEN CAST(json_extract(usage_json, '$.cachedInputTokens') AS INTEGER) ELSE 0 END), 0) AS ${prefix}cached_read`,
      `COALESCE(SUM(CASE WHEN created_at >= ${bound} THEN CAST(json_extract(usage_json, '$.cacheWriteInputTokens') AS INTEGER) ELSE 0 END), 0) AS ${prefix}cache_write`,
      `COALESCE(SUM(CASE WHEN created_at >= ${bound} THEN CAST(json_extract(usage_json, '$.reasoningOutputTokens') AS INTEGER) ELSE 0 END), 0) AS ${prefix}reasoning`,
      `COALESCE(SUM(CASE WHEN created_at >= ${bound} THEN CAST(json_extract(usage_json, '$.totalTokens') AS INTEGER) ELSE 0 END), 0) AS ${prefix}total`,
      `COALESCE(SUM(CASE WHEN created_at >= ${bound} THEN cost_usd ELSE 0 END), 0) AS ${prefix}cost`,
      `COALESCE(SUM(CASE WHEN created_at >= ${bound} THEN CAST(json_extract(usage_json, '$.costBreakdownUsd.input') AS REAL) ELSE 0 END), 0) AS ${prefix}cost_input`,
      `COALESCE(SUM(CASE WHEN created_at >= ${bound} THEN CAST(json_extract(usage_json, '$.costBreakdownUsd.cachedInput') AS REAL) ELSE 0 END), 0) AS ${prefix}cost_cached`,
      `COALESCE(SUM(CASE WHEN created_at >= ${bound} THEN CAST(json_extract(usage_json, '$.costBreakdownUsd.cacheWrite') AS REAL) ELSE 0 END), 0) AS ${prefix}cost_write`,
      `COALESCE(SUM(CASE WHEN created_at >= ${bound} THEN CAST(json_extract(usage_json, '$.costBreakdownUsd.output') AS REAL) ELSE 0 END), 0) AS ${prefix}cost_output`,
      `COALESCE(SUM(CASE WHEN created_at >= ${bound} THEN 1 ELSE 0 END), 0) AS ${prefix}count`,
    ].join(", ");
    const row = this.db.prepare(
      `SELECT ${RequestUsageStore.TOKEN_SELECT}, ` +
      `${periodSelect("month_", "?")}, ` +
      `${periodSelect("week_", "?")}, ` +
      `${periodSelect("day_", "?")} ` +
      `FROM request_usage_ledger WHERE ${clause}`
    ).get(
      monthStart, monthStart, monthStart, monthStart, monthStart, monthStart, monthStart, monthStart, monthStart, monthStart, monthStart, monthStart, monthStart,
      weekStart, weekStart, weekStart, weekStart, weekStart, weekStart, weekStart, weekStart, weekStart, weekStart, weekStart, weekStart, weekStart,
      dayStart, dayStart, dayStart, dayStart, dayStart, dayStart, dayStart, dayStart, dayStart, dayStart, dayStart, dayStart, dayStart,
      ...args
    ) as Record<string, number>;
    const bucket = (prefix: "" | "month_" | "week_" | "day_"): UsageTokenBucket => ({
      input: Number(row[`${prefix}input`] ?? 0),
      output: Number(row[`${prefix}output`] ?? 0),
      cached: Number(row[`${prefix}cached`] ?? 0),
      total: Number(row[`${prefix}total`] ?? 0),
      cost: Number(row[`${prefix}cost`] ?? 0),
      count: Number(row[`${prefix}count`] ?? 0),
      cachedRead: Number(row[`${prefix}cached_read`] ?? 0),
      cacheWrite: Number(row[`${prefix}cache_write`] ?? 0),
      reasoning: Number(row[`${prefix}reasoning`] ?? 0),
      costBreakdown: {
        input: Number(row[`${prefix}cost_input`] ?? 0),
        cachedInput: Number(row[`${prefix}cost_cached`] ?? 0),
        cacheWrite: Number(row[`${prefix}cost_write`] ?? 0),
        output: Number(row[`${prefix}cost_output`] ?? 0),
      },
    });
    return { all: bucket(""), month: bucket("month_"), week: bucket("week_"), day: bucket("day_") };
  }

  /** 按天词元/费用，对标 axonhub analyticsDailyStats 的 token/cost 层。 */
  public tokenDaily(ownerId: string | null, days: number): (UsageTokenBucket & { date: string })[] {
    const clamped = Math.min(Math.max(Math.floor(days), 1), 366);
    const { clause, args } = this.ownerClause(ownerId);
    const rows = this.db.prepare(
      `SELECT strftime('%Y-%m-%d', datetime(created_at / 1000, 'unixepoch', 'localtime')) AS date, ${RequestUsageStore.TOKEN_SELECT} ` +
      `FROM request_usage_ledger WHERE ${clause} AND created_at >= ? GROUP BY date ORDER BY date ASC`
    ).all(...args, Date.now() - clamped * 24 * 60 * 60 * 1000) as ({ date: string } & Record<string, number>)[];
    return rows.map((row) => ({ date: row.date, ...RequestUsageStore.toBucket(row) }));
  }

  /** 按维度词元/费用 TopN，对标 axonhub tokenStatsByChannel/Model + costStatsBy*。 */
  public tokenByDimension(ownerId: string | null, dimension: UsageTokenDimension, days: number, limit = 10): UsageTokenDimensionRow[] {
    const column = dimension === "provider" ? "provider_id" : dimension === "group" ? "group_id" : dimension === "model" ? "model" : "owner_id";
    const clampedLimit = Math.min(Math.max(Math.floor(limit), 1), 50);
    const clampedDays = Math.min(Math.max(Math.floor(days), 1), 366);
    const { clause, args } = this.ownerClause(ownerId);
    const selectProvider = dimension === "group" ? "MIN(provider_id) AS provider_id, " : "";
    const rows = this.db.prepare(
      `SELECT ${selectProvider}${column} AS name, ${RequestUsageStore.TOKEN_SELECT} ` +
      `FROM request_usage_ledger WHERE ${clause} AND created_at >= ? AND ${column} IS NOT NULL ` +
      `GROUP BY ${column} ORDER BY total DESC LIMIT ?`
    ).all(...args, Date.now() - clampedDays * 24 * 60 * 60 * 1000, clampedLimit) as ({
      name: string; provider_id?: string;
    } & Record<string, number>)[];
    return rows.map((row) => ({
      name: row.name,
      ...(row.provider_id ? { providerId: row.provider_id } : {}),
      ...RequestUsageStore.toBucket(row),
    }));
  }

  /** Analytics 通用 WHERE（作用域 owner + 日期范围 + 四维 AND）。 */
  private analyticsClause(scopeOwnerId: string | null, filter: AnalyticsFilter): { clause: string; args: (string | number)[] } {
    const conditions: string[] = [];
    const args: (string | number)[] = [];
    if (scopeOwnerId != null && scopeOwnerId !== "") { conditions.push("owner_id = ?"); args.push(scopeOwnerId); }
    else if (filter.ownerId) { conditions.push("owner_id = ?"); args.push(filter.ownerId); }
    if (filter.startMs != null) { conditions.push("created_at >= ?"); args.push(filter.startMs); }
    if (filter.endMs != null) { conditions.push("created_at <= ?"); args.push(filter.endMs); }
    if (filter.providerId) { conditions.push("provider_id = ?"); args.push(filter.providerId); }
    if (filter.groupId) { conditions.push("group_id = ?"); args.push(filter.groupId); }
    if (filter.modelContains) { conditions.push("model LIKE ? ESCAPE '\\'"); args.push(`%${filter.modelContains.replace(/[\\%_]/g, (c) => `\\${c}`)}%`); }
    return { clause: conditions.length > 0 ? conditions.join(" AND ") : "1 = 1", args };
  }

  /** Analytics 概览：请求数 + 输入/缓存读/缓存写/未命中/输出/推理/总量 + 费用 + 缓存命中率。 */
  public analyticsOverview(scopeOwnerId: string | null, filter: AnalyticsFilter): UsageTokenBucket & { uncachedInput: number; cacheHitRate: number } {
    const { clause, args } = this.analyticsClause(scopeOwnerId, filter);
    const row = this.db.prepare(
      `SELECT ${RequestUsageStore.TOKEN_SELECT} FROM request_usage_ledger WHERE ${clause}`
    ).get(...args) as Record<string, number>;
    const bucket = RequestUsageStore.toBucket(row);
    // requests 按 turn 去重：账本每个模型轮次一行，COUNT(*) 会把同一请求的多轮重复计数。
    const turnRow = this.db.prepare(
      `SELECT COUNT(DISTINCT thread_id || '|' || turn_id) AS n FROM request_usage_ledger WHERE ${clause}`
    ).get(...args) as { n: number } | undefined;
    bucket.count = Number(turnRow?.n ?? 0);
    const cachedRead = bucket.cachedRead ?? 0;
    // 未命中输入 = 输入 - 读缓存；命中率 = 读缓存 / 输入（写缓存不计入命中）。
    const uncachedInput = Math.max(0, bucket.input - cachedRead);
    const cacheHitRate = bucket.input > 0 ? Math.min(100, (cachedRead / bucket.input) * 100) : 0;
    return { ...bucket, uncachedInput, cacheHitRate: Math.round(cacheHitRate * 10) / 10 };
  }

  /** Analytics 日趋势：缺失日期补 0（对标 axonhub 缺失补 0 语义）。 */
  public analyticsDaily(scopeOwnerId: string | null, filter: AnalyticsFilter): (UsageTokenBucket & { date: string; uncachedInput: number })[] {
    const { clause, args } = this.analyticsClause(scopeOwnerId, filter);
    const rows = this.db.prepare(
      `SELECT strftime('%Y-%m-%d', datetime(created_at / 1000, 'unixepoch', 'localtime')) AS date, ${RequestUsageStore.TOKEN_SELECT} ` +
      `FROM request_usage_ledger WHERE ${clause} GROUP BY date ORDER BY date ASC`
    ).all(...args) as ({ date: string } & Record<string, number>)[];
    // requests 按 turn 去重（与 analyticsOverview 同口径）。
    const turnRows = this.db.prepare(
      `SELECT strftime('%Y-%m-%d', datetime(created_at / 1000, 'unixepoch', 'localtime')) AS date, COUNT(DISTINCT thread_id || '|' || turn_id) AS n ` +
      `FROM request_usage_ledger WHERE ${clause} GROUP BY date`
    ).all(...args) as { date: string; n: number }[];
    const turnsByDate = new Map(turnRows.map((row) => [row.date, Number(row.n)]));
    const byDate = new Map(rows.map((row) => {
      const bucket = RequestUsageStore.toBucket(row);
      const uncached = Math.max(0, bucket.input - (bucket.cachedRead ?? 0));
      return [row.date, { date: row.date, ...bucket, count: turnsByDate.get(row.date) ?? 0, uncachedInput: uncached }];
    }));
    // 回填起止区间内缺失日期。
    const startMs = filter.startMs ?? Date.now() - 29 * 24 * 60 * 60 * 1000;
    const endMs = filter.endMs ?? Date.now();
    const startDay = new Date(startMs); startDay.setHours(0, 0, 0, 0);
    const endDay = new Date(endMs); endDay.setHours(0, 0, 0, 0);
    const out: (UsageTokenBucket & { date: string; uncachedInput: number })[] = [];
    const fmt = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    for (let cursor = new Date(startDay); cursor.getTime() <= endDay.getTime() && out.length < 367; cursor.setDate(cursor.getDate() + 1)) {
      const key = fmt(cursor);
      const hit = byDate.get(key);
      if (hit) out.push(hit);
      else out.push({ date: key, input: 0, output: 0, cached: 0, total: 0, cost: 0, count: 0, cachedRead: 0, cacheWrite: 0, reasoning: 0, uncachedInput: 0 });
    }
    return out;
  }

  /** Analytics 维度明细：按 dimension 分发（对标 axonhub analyticsDimensionStats）。 */
  public analyticsDimension(scopeOwnerId: string | null, filter: AnalyticsFilter, dimension: UsageTokenDimension, limit = 50): (UsageTokenDimensionRow & { uncachedInput: number })[] {
    const column = dimension === "provider" ? "provider_id" : dimension === "group" ? "group_id" : dimension === "model" ? "model" : "owner_id";
    const clampedLimit = Math.min(Math.max(Math.floor(limit), 1), 100);
    const { clause, args } = this.analyticsClause(scopeOwnerId, filter);
    const selectProvider = dimension === "group" ? "MIN(provider_id) AS provider_id, " : "";
    const rows = this.db.prepare(
      `SELECT ${selectProvider}${column} AS name, ${RequestUsageStore.TOKEN_SELECT} ` +
      `FROM request_usage_ledger WHERE ${clause} AND ${column} IS NOT NULL ` +
      `GROUP BY ${column} ORDER BY total DESC LIMIT ?`
    ).all(...args, clampedLimit) as ({ name: string; provider_id?: string } & Record<string, number>)[];
    // requests 按 turn 去重（与 analyticsOverview 同口径）。
    const turnRows = this.db.prepare(
      `SELECT ${column} AS name, COUNT(DISTINCT thread_id || '|' || turn_id) AS n ` +
      `FROM request_usage_ledger WHERE ${clause} AND ${column} IS NOT NULL GROUP BY ${column}`
    ).all(...args) as { name: string; n: number }[];
    const turnsByName = new Map(turnRows.map((row) => [row.name, Number(row.n)]));
    return rows.map((row) => {
      const bucket = RequestUsageStore.toBucket(row);
      const uncached = Math.max(0, bucket.input - (bucket.cachedRead ?? 0));
      return {
        name: row.name,
        ...(row.provider_id ? { providerId: row.provider_id } : {}),
        ...bucket,
        count: turnsByName.get(row.name) ?? 0,
        uncachedInput: uncached,
      };
    });
  }

  public deleteThread(ownerId: string, threadId: string): void { this.db.prepare("DELETE FROM request_usage_ledger WHERE owner_id = ? AND thread_id = ?").run(ownerId, threadId); }

  private map(row: UsageRow): RequestUsageRecord {
    return {
      ownerId: row.owner_id, threadId: row.thread_id, turnId: row.turn_id, requestId: row.request_id, source: row.source,
      ...(row.provider_id ? { providerId: row.provider_id } : {}), ...(row.group_id ? { groupId: row.group_id } : {}), ...(row.model ? { model: row.model } : {}),
      usage: JSON.parse(row.usage_json) as NormalizedTokenUsage, ...(row.cost_usd != null ? { costUsd: Number(row.cost_usd) } : {}),
      ...(row.billing_json ? { billingSnapshot: JSON.parse(row.billing_json) } : {}), createdAt: row.created_at, updatedAt: row.updated_at,
      ...(row.debited_at != null ? { debitedAt: row.debited_at } : {})
    };
  }
}

/** Ring 信封解包：Mini/Opencode/Agy 只发 `thread/tokenUsage/updated`（`{total,last,...}`），取本轮 `last` 优先。 */
export function extractRingTokenUsage(params: Record<string, unknown>): unknown {
  const envelope = params.tokenUsage && typeof params.tokenUsage === "object" && !Array.isArray(params.tokenUsage)
    ? params.tokenUsage as Record<string, unknown>
    : {};
  return params.usage ?? envelope.last ?? envelope.total ?? params.tokenUsage ?? null;
}

/** 直连用量的合成 requestId（`direct-<turnId>-<seq>`，与网关 `codex-/claude-` 前缀无碰撞）。 */
export function nextDirectUsageRequestId(turnId: string, seq: number): string {
  return `direct-${turnId}-${Math.max(0, Math.floor(seq))}`;
}

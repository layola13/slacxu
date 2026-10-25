import { randomUUID } from "node:crypto";
import type { RuntimeDatabase } from "./runtime/database.js";

// P1 网关请求落库：对标 axonhub `requests` 表的元数据层（TS/SQLite 版）。
// 只存网关调用级元数据（endpoint/provider/group/model/状态/延迟），
// 不存 request/response body（流式 body 无法在不断流的情况下落库，
// 详情展开所需 body 在 P2 另行设计；用量 token/费用仍以
// request_usage_ledger（≈ usage_logs）为准，两表经 threadId/时间关联）。

export type GatewayRequestEndpoint =
  | "responses"
  | "responses/compact"
  | "messages"
  | "chat/completions"
  | "jev/evaluate"
  | `direct/${string}`;

export type GatewayRequestStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "canceled";

export type GatewayRequestSource =
  | "api"
  | "playground"
  | "test"
  | "direct"
  | "unknown";

export type GatewayRequestRecord = {
  id: string;
  ownerId: string;
  threadId?: string;
  turnId?: string;
  endpoint: GatewayRequestEndpoint;
  providerId: string;
  groupId: string;
  model?: string;
  stream: boolean;
  upstreamStatus?: number;
  ok?: boolean;
  /** 对标 axonhub RequestStatus 五态；ok 保留兼容（completed→true，failed/canceled→false，pending/processing→undefined）。 */
  status?: GatewayRequestStatus;
  /** 对标 axonhub Source：api/playground/test；直连旁路记 direct。 */
  source?: GatewayRequestSource;
  error?: string;
  startedAt: number;
  headersAt?: number;
  /** 首字耗时 TTFT = headersAt - startedAt（对标 axonhub metrics_first_token_latency_ms）。 */
  ttftMs?: number;
  latencyMs?: number;
  createdAt: number;
  updatedAt: number;
};

type GatewayRequestRow = {
  id: string;
  owner_id: string;
  thread_id: string | null;
  turn_id: string | null;
  endpoint: string;
  provider_id: string;
  group_id: string;
  model: string | null;
  stream: number;
  upstream_status: number | null;
  ok: number | null;
  status: string | null;
  source: string | null;
  error: string | null;
  started_at: number;
  headers_at: number | null;
  ttft_ms: number | null;
  latency_ms: number | null;
  created_at: number;
  updated_at: number;
};

export type GatewayDailyCount = { date: string; count: number; okCount: number; failCount: number };

export type GatewayOverview = {
  total: number; okCount: number; failCount: number; pendingCount: number;
  today: number; thisWeek: number; thisMonth: number;
  canceledCount?: number;
};

export type GatewayDimension = "provider" | "group" | "model" | "endpoint";

export type GatewayDimensionRow = {
  name: string;
  providerId?: string;
  count: number;
  okCount: number;
  failCount: number;
};

/** 对标 axonhub RequestExecution 状态统计：按上游状态码分布聚合；null 桶为未收到上游响应(pending/processing)。 */
export type GatewayStatusRow = {
  statusCode: number | null;
  count: number;
  okCount: number;
  failCount: number;
};

/** 通道健康摘要（只读，不做自动禁用）：healthy≥95% degraded≥50% down<50% unknown=无终态样本。 */
export type GatewayHealthRow = {
  name: string;
  requestCount: number;
  okCount: number;
  failCount: number;
  successRate: number;
  status: "healthy" | "degraded" | "down" | "unknown";
};

/** 对标 axonhub fastestChannels/fastestModels：延迟与吞吐聚合行。 */
export type GatewayPerformanceRow = {
  name: string;
  providerId?: string;
  requestCount: number;
  avgLatencyMs: number;
  avgTtftMs: number;
  totalLatencyMs: number;
  /** 有界样本分位（p50/p95，无样本为 0）。 */
  p50LatencyMs: number;
  p95LatencyMs: number;
  tokensTotal: number;
  throughput: number;
  /** 启发式置信度：requestCount>=30 high，>=10 medium，否则 low。 */
  confidence: "high" | "medium" | "low";
};

export type GatewayRequestFilter = {
  providerId?: string;
  groupId?: string;
  modelContains?: string;
  ok?: boolean;
  /** 五态过滤；与 ok 兼容（同时传时 status 优先于 ok 的隐式映射）。 */
  status?: GatewayRequestStatus;
  statusIn?: GatewayRequestStatus[];
  source?: GatewayRequestSource;
  sourceIn?: GatewayRequestSource[];
  threadId?: string;
  endpoint?: GatewayRequestEndpoint;
};

export type GatewayRequestPage = { entries: GatewayRequestRecord[]; nextCursor: string | null };

const GATEWAY_REQUEST_ENDPOINTS: readonly string[] = [
  "responses",
  "responses/compact",
  "messages",
  "chat/completions",
  "jev/evaluate",
];

export class GatewayRequestStore {
  public constructor(private readonly db: RuntimeDatabase) {
    this.db.exec([
      "CREATE TABLE IF NOT EXISTS gateway_requests (",
      "id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, thread_id TEXT, turn_id TEXT,",
      "endpoint TEXT NOT NULL, provider_id TEXT NOT NULL, group_id TEXT NOT NULL,",
      "model TEXT, stream INTEGER NOT NULL DEFAULT 0,",
      "upstream_status INTEGER, ok INTEGER, error TEXT,",
      "started_at INTEGER NOT NULL, headers_at INTEGER, latency_ms INTEGER,",
      "created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL",
      ");",
      "CREATE INDEX IF NOT EXISTS gateway_requests_owner_idx ON gateway_requests(owner_id, created_at);",
      "CREATE INDEX IF NOT EXISTS gateway_requests_thread_idx ON gateway_requests(owner_id, thread_id, created_at);",
      "CREATE INDEX IF NOT EXISTS gateway_requests_route_idx ON gateway_requests(provider_id, group_id, created_at);",
    ].join("\n"));
    // 向后兼容迁移：旧库无 status/source/ttft_ms 列时补列（失败仅 warn，绝不阻断启动）。
    for (const ddl of [
      "ALTER TABLE gateway_requests ADD COLUMN status TEXT",
      "ALTER TABLE gateway_requests ADD COLUMN source TEXT",
      "ALTER TABLE gateway_requests ADD COLUMN ttft_ms INTEGER",
    ]) {
      try {
        this.db.exec(ddl);
      } catch {
        // 列已存在时 SQLite 报错 duplicate column name，忽略即可。
      }
    }
    for (const idx of [
      "CREATE INDEX IF NOT EXISTS gateway_requests_status_idx ON gateway_requests(owner_id, status, created_at);",
      "CREATE INDEX IF NOT EXISTS gateway_requests_source_idx ON gateway_requests(owner_id, source, created_at);",
    ]) {
      try {
        this.db.exec(idx);
      } catch (error) {
        console.warn("[gateway-requests] ensure index failed", error instanceof Error ? error.message : String(error));
      }
    }
  }

  public begin(input: {
    ownerId: string;
    threadId?: string;
    turnId?: string;
    endpoint: GatewayRequestEndpoint;
    providerId: string;
    groupId: string;
    model?: string;
    stream?: boolean;
    startedAt?: number;
    status?: GatewayRequestStatus;
    source?: GatewayRequestSource;
  }): GatewayRequestRecord {
    const now = Date.now();
    const record: GatewayRequestRecord = {
      id: `gw-${randomUUID()}`,
      ownerId: input.ownerId,
      ...(input.threadId ? { threadId: input.threadId } : {}),
      ...(input.turnId ? { turnId: input.turnId } : {}),
      endpoint: input.endpoint,
      providerId: input.providerId,
      groupId: input.groupId,
      ...(input.model ? { model: input.model.slice(0, 256) } : {}),
      stream: input.stream === true,
      status: input.status ?? "pending",
      source: input.source ?? (input.endpoint.startsWith("direct/") ? "direct" : "api"),
      startedAt: input.startedAt ?? now,
      createdAt: now,
      updatedAt: now,
    };
    this.db.prepare(
      "INSERT INTO gateway_requests (id, owner_id, thread_id, turn_id, endpoint, provider_id, group_id, model, stream, upstream_status, ok, status, source, error, started_at, headers_at, ttft_ms, latency_ms, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, NULL, ?, NULL, NULL, NULL, ?, ?)"
    ).run(
      record.id, record.ownerId, record.threadId ?? null, record.turnId ?? null,
      record.endpoint, record.providerId, record.groupId, record.model ?? null,
      record.stream ? 1 : 0, record.status ?? "pending", record.source ?? "api",
      record.startedAt, record.createdAt, record.updatedAt
    );
    return record;
  }

  /** 首字标记（TTFT）：拿到响应头/首个 token 时调用一次；finish 不再覆盖 headers_at。 */
  public markFirstToken(id: string, at = Date.now()): void {
    try {
      const existing = this.db.prepare("SELECT started_at, headers_at FROM gateway_requests WHERE id = ? LIMIT 1").get(id) as { started_at: number; headers_at: number | null } | undefined;
      if (!existing || existing.headers_at != null) return;
      const ttftMs = Math.max(0, at - existing.started_at);
      this.db.prepare("UPDATE gateway_requests SET headers_at = ?, ttft_ms = ?, status = CASE WHEN status = 'pending' THEN 'processing' ELSE status END, updated_at = ? WHERE id = ?").run(at, ttftMs, at, id);
    } catch (error) {
      console.warn("[gateway-requests] markFirstToken failed", { error: error instanceof Error ? error.message : String(error) });
    }
  }

  public finish(id: string, patch: { upstreamStatus?: number; ok?: boolean; error?: string; status?: GatewayRequestStatus }): void {
    const now = Date.now();
    const existing = this.db.prepare("SELECT started_at, headers_at FROM gateway_requests WHERE id = ? LIMIT 1").get(id) as { started_at: number; headers_at: number | null } | undefined;
    if (!existing) return;
    const latencyMs = now - existing.started_at;
    // headers_at 为空说明从未收到首字：此时首字≈终态，避免 TTFT 为空。
    const headersAt = existing.headers_at ?? now;
    const ttftMs = Math.max(0, headersAt - existing.started_at);
    const status: GatewayRequestStatus = patch.status
      ?? (patch.ok === true ? "completed" : patch.ok === false ? "failed" : "processing");
    this.db.prepare(
      "UPDATE gateway_requests SET upstream_status = ?, ok = ?, status = ?, headers_at = ?, ttft_ms = ?, latency_ms = ?, error = ?, updated_at = ? WHERE id = ?"
    ).run(
      patch.upstreamStatus ?? null,
      patch.ok == null ? null : (patch.ok ? 1 : 0),
      status,
      headersAt,
      ttftMs,
      latencyMs,
      patch.error?.slice(0, 2000) ?? null,
      now,
      id
    );
  }

  /** 取消（对标 axonhub canceled）：turn 中断/客户端关闭时调用。 */
  public cancel(id: string, error?: string): void {
    const now = Date.now();
    try {
      const existing = this.db.prepare("SELECT started_at, headers_at FROM gateway_requests WHERE id = ? LIMIT 1").get(id) as { started_at: number; headers_at: number | null } | undefined;
      if (!existing) return;
      const headersAt = existing.headers_at ?? now;
      this.db.prepare("UPDATE gateway_requests SET ok = 0, status = 'canceled', headers_at = ?, ttft_ms = ?, latency_ms = ?, error = ?, updated_at = ? WHERE id = ?").run(
        headersAt, Math.max(0, headersAt - existing.started_at), Math.max(0, now - existing.started_at),
        error?.slice(0, 2000) ?? "canceled", now, id
      );
    } catch (err) {
      console.warn("[gateway-requests] cancel failed", { error: err instanceof Error ? err.message : String(err) });
    }
  }

  public list(ownerId: string, options?: { limit?: number; threadId?: string }): GatewayRequestRecord[] {
    const limit = Math.min(Math.max(options?.limit ?? 50, 1), 200);
    const rows = (options?.threadId
      ? this.db.prepare("SELECT * FROM gateway_requests WHERE owner_id = ? AND thread_id = ? ORDER BY created_at DESC, id DESC LIMIT ?").all(ownerId, options.threadId, limit)
      : this.db.prepare("SELECT * FROM gateway_requests WHERE owner_id = ? ORDER BY created_at DESC, id DESC LIMIT ?").all(ownerId, limit)) as GatewayRequestRow[];
    return rows.map((row) => this.map(row));
  }

  /** 某线程在 sinceMs 之后已有网关行数（直连旁路去重用：>0 说明本 turn 走过网关，不补 direct 行）。 */
  public countByThreadSince(ownerId: string, threadId: string, sinceMs: number): number {
    try {
      const row = this.db.prepare(
        "SELECT COUNT(*) AS c FROM gateway_requests WHERE owner_id = ? AND thread_id = ? AND created_at >= ?"
      ).get(ownerId, threadId, sinceMs) as { c?: number } | undefined;
      return Number(row?.c ?? 0);
    } catch (error) {
      console.warn("[gateway-requests] countByThreadSince failed", { error: error instanceof Error ? error.message : String(error) });
      return 1;
    }
  }

  /** 按 turn 精确判重（替代时间窗口）：同 thread+turn 已有网关行则不再补 direct。 */
  public existsByTurn(ownerId: string, threadId: string, turnId: string): boolean {
    try {
      const row = this.db.prepare(
        "SELECT 1 AS hit FROM gateway_requests WHERE owner_id = ? AND thread_id = ? AND turn_id = ? LIMIT 1"
      ).get(ownerId, threadId, turnId) as { hit?: number } | undefined;
      return row?.hit === 1;
    } catch (error) {
      console.warn("[gateway-requests] existsByTurn failed", { error: error instanceof Error ? error.message : String(error) });
      return true;
    }
  }

  /**
   * 直连旁路计数：未经过 relay-gateway 的 turn（opencode 官方/免费直连、Pi/Agy/Grok
   * 直连、Mini 回退直连）在 turn 终态时补一行 `endpoint=direct/<backend>`。
   * 只读统计，不触碰数据路径；tokens 为空（用量走 request_usage_ledger）。
   * 无法观测上游 HTTP/TTFT/重试：upstreamStatus/latency/ttft 保持 null（未知），
   * 禁止填 200/500/0；中断保持 canceled。direct 行不参与延迟/健康排行（调用方过滤）。
   */
  public recordDirect(input: {
    ownerId: string; threadId: string; turnId?: string; providerId?: string; groupId?: string;
    model?: string; backend?: string; ok?: boolean; status?: GatewayRequestStatus; error?: string;
  }): GatewayRequestRecord | null {
    try {
      const endpoint: GatewayRequestEndpoint = `direct/${input.backend?.trim() || "unknown"}`;
      const status: GatewayRequestStatus = input.status
        ?? (input.ok === true ? "completed" : input.ok === false ? "failed" : "processing");
      const ok = status === "completed" ? true : status === "failed" || status === "canceled" ? false : undefined;
      const record = this.begin({
        ownerId: input.ownerId,
        threadId: input.threadId,
        ...(input.turnId ? { turnId: input.turnId } : {}),
        endpoint,
        providerId: input.providerId?.trim() || "direct",
        groupId: input.groupId?.trim() || "direct",
        ...(input.model ? { model: input.model } : {}),
        status,
        source: "direct",
      });
      // 直连无实测延迟/上游状态：仅落终态，不写 headers_at/latency/upstream。
      const now = Date.now();
      this.db.prepare(
        "UPDATE gateway_requests SET ok = ?, status = ?, error = ?, updated_at = ? WHERE id = ?"
      ).run(
        ok == null ? null : (ok ? 1 : 0),
        status,
        input.error?.slice(0, 2000) ?? null,
        now,
        record.id
      );
      return { ...record, status, source: "direct", ...(ok != null ? { ok } : {}), ...(input.error ? { error: input.error } : {}), updatedAt: now };
    } catch (error) {
      console.warn("[gateway-requests] recordDirect failed", { error: error instanceof Error ? error.message : String(error) });
      return null;
    }
  }

  /** 按天聚合（服务器本地日期），对标 axonhub DailyRequestStats 的 count 层。token/cost 层仍读 request_usage_ledger。缺失日期补 0，保证周同比按日历周计算。 */
  public dailyCounts(ownerId: string | null, days: number): GatewayDailyCount[] {
    const clamped = Math.min(Math.max(Math.floor(days), 1), 366);
    const { clause, args } = this.ownerClause(ownerId);
    const rows = this.db.prepare(
      `SELECT strftime('%Y-%m-%d', datetime(created_at / 1000, 'unixepoch', 'localtime')) AS date, COUNT(*) AS count, COALESCE(SUM(CASE WHEN ok = 1 THEN 1 ELSE 0 END), 0) AS ok_count, COALESCE(SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END), 0) AS fail_count FROM gateway_requests WHERE ${clause} AND created_at >= ? GROUP BY date ORDER BY date ASC`
    ).all(...args, Date.now() - clamped * 24 * 60 * 60 * 1000) as { date: string; count: number; ok_count: number; fail_count: number }[];
    const byDate = new Map(rows.map((r) => [r.date, { date: r.date, count: Number(r.count), okCount: Number(r.ok_count), failCount: Number(r.fail_count) }]));
    const out: GatewayDailyCount[] = [];
    const now = new Date();
    for (let i = clamped - 1; i >= 0 && out.length < 367; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      out.push(byDate.get(key) ?? { date: key, count: 0, okCount: 0, failCount: 0 });
    }
    return out;
  }

  /** 总览计数，对标 axonhub DashboardOverview + RequestStats 的请求数层。canceled 单列，不计入成功率分母。 */
  public overview(ownerId: string | null): GatewayOverview {
    const now = new Date();
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const weekStart = dayStart - ((now.getDay() + 6) % 7) * 24 * 60 * 60 * 1000;
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const { clause, args } = this.ownerClause(ownerId);
    // 注意：SQLite 按文本顺序绑定占位符，SELECT 列表里的三个 CASE 先于 WHERE，
    // 所以时间参数必须排在 owner 参数之前。
    const row = this.db.prepare(
      `SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN ok = 1 THEN 1 ELSE 0 END), 0) AS ok_count, COALESCE(SUM(CASE WHEN ok = 0 AND status = 'failed' THEN 1 ELSE 0 END), 0) AS fail_count, COALESCE(SUM(CASE WHEN status = 'canceled' THEN 1 ELSE 0 END), 0) AS canceled_count, COALESCE(SUM(CASE WHEN ok IS NULL THEN 1 ELSE 0 END), 0) AS pending_count, COALESCE(SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END), 0) AS today, COALESCE(SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END), 0) AS week, COALESCE(SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END), 0) AS month FROM gateway_requests WHERE ${clause}`
    ).get(dayStart, weekStart, monthStart, ...args) as {
      total: number; ok_count: number; fail_count: number; canceled_count: number; pending_count: number; today: number; week: number; month: number;
    };
    return {
      total: Number(row.total), okCount: Number(row.ok_count), failCount: Number(row.fail_count),
      pendingCount: Number(row.pending_count), today: Number(row.today), thisWeek: Number(row.week), thisMonth: Number(row.month),
      ...(Number(row.canceled_count) > 0 ? { canceledCount: Number(row.canceled_count) } : {}),
    };
  }

  /** 按维度 TopN，对标 axonhub requestStatsByChannel/Model/APIKey（count 层）。 */
  public byDimension(ownerId: string | null, dimension: GatewayDimension, days: number, limit = 10): GatewayDimensionRow[] {
    const column = dimension === "provider" ? "provider_id" : dimension === "group" ? "group_id" : dimension === "model" ? "model" : "endpoint";
    const clampedLimit = Math.min(Math.max(Math.floor(limit), 1), 50);
    const clampedDays = Math.min(Math.max(Math.floor(days), 1), 366);
    const { clause, args } = this.ownerClause(ownerId);
    const selectProvider = dimension === "group" ? "MIN(provider_id) AS provider_id, " : "";
    const rows = this.db.prepare(
      `SELECT ${selectProvider}${column} AS name, COUNT(*) AS count, COALESCE(SUM(CASE WHEN ok = 1 THEN 1 ELSE 0 END), 0) AS ok_count, COALESCE(SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END), 0) AS fail_count FROM gateway_requests WHERE ${clause} AND created_at >= ? AND ${column} IS NOT NULL GROUP BY ${column} ORDER BY count DESC LIMIT ?`
    ).all(...args, Date.now() - clampedDays * 24 * 60 * 60 * 1000, clampedLimit) as {
      name: string; provider_id?: string; count: number; ok_count: number; fail_count: number;
    }[];
    return rows.map((row) => ({
      name: row.name,
      ...(row.provider_id ? { providerId: row.provider_id } : {}),
      count: Number(row.count), okCount: Number(row.ok_count), failCount: Number(row.fail_count),
    }));
  }

  /** 按上游状态码分布聚合（对标 axonhub RequestExecution 按 status/response_status_code 统计；只读，无迁移）。 */
  public byStatus(ownerId: string | null, days: number, limit = 20): GatewayStatusRow[] {
    const clampedLimit = Math.min(Math.max(Math.floor(limit), 1), 50);
    const clampedDays = Math.min(Math.max(Math.floor(days), 1), 366);
    const { clause, args } = this.ownerClause(ownerId);
    const rows = this.db.prepare(
      `SELECT upstream_status AS status_code, COUNT(*) AS count, COALESCE(SUM(CASE WHEN ok = 1 THEN 1 ELSE 0 END), 0) AS ok_count, COALESCE(SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END), 0) AS fail_count FROM gateway_requests WHERE ${clause} AND created_at >= ? GROUP BY upstream_status ORDER BY count DESC LIMIT ?`
    ).all(...args, Date.now() - clampedDays * 24 * 60 * 60 * 1000, clampedLimit) as {
      status_code: number | null; count: number; ok_count: number; fail_count: number;
    }[];
    return rows.map((row) => ({
      statusCode: row.status_code == null ? null : Number(row.status_code),
      count: Number(row.count), okCount: Number(row.ok_count), failCount: Number(row.fail_count),
    }));
  }

  /** 通道健康摘要（只读聚合，不触碰路由/禁用逻辑；自动禁用需 feature flag，另起任务）。direct 旁路行（未知延迟/状态）不参与健康排行。 */
  public healthByProvider(ownerId: string | null, days: number, limit = 50): GatewayHealthRow[] {
    const clampedLimit = Math.min(Math.max(Math.floor(limit), 1), 50);
    const clampedDays = Math.min(Math.max(Math.floor(days), 1), 366);
    const { clause, args } = this.ownerClause(ownerId);
    const rows = this.db.prepare(
      `SELECT provider_id AS name, COUNT(*) AS count, COALESCE(SUM(CASE WHEN ok = 1 THEN 1 ELSE 0 END), 0) AS ok_count, COALESCE(SUM(CASE WHEN ok = 0 AND status = 'failed' THEN 1 ELSE 0 END), 0) AS fail_count FROM gateway_requests WHERE ${clause} AND created_at >= ? AND provider_id IS NOT NULL AND endpoint NOT LIKE 'direct/%' GROUP BY provider_id ORDER BY count DESC LIMIT ?`
    ).all(...args, Date.now() - clampedDays * 24 * 60 * 60 * 1000, clampedLimit) as {
      name: string; count: number; ok_count: number; fail_count: number;
    }[];
    return rows.map((row) => {
      const okCount = Number(row.ok_count);
      const failCount = Number(row.fail_count);
      const done = okCount + failCount;
      const successRate = done === 0 ? 0 : (okCount / done) * 100;
      const status = done === 0 ? "unknown" as const
        : successRate >= 95 ? "healthy" as const
        : successRate >= 50 ? "degraded" as const
        : "down" as const;
      return {
        name: row.name,
        requestCount: Number(row.count),
        okCount,
        failCount,
        successRate: Math.round(successRate * 10) / 10,
        status,
      };
    });
  }

  /** 性能聚合（对标 axonhub fastest*）：按维度统计延迟/TTFT 均值与总量；tokens 经调用方 join 用量后回填。
   * p50/p95 为有界样本分位（TopN 名单内最近 ≤1000 行，TS 侧排序取 `ceil(p*n)-1`；无样本时为 0）。
   * direct 旁路行（latency 未知）不参与延迟/吞吐排行。只读，无迁移。 */
  public performanceByDimension(ownerId: string | null, dimension: GatewayDimension, days: number, limit = 10): {
    name: string; providerId?: string; requestCount: number; avgLatencyMs: number; avgTtftMs: number; totalLatencyMs: number;
    p50LatencyMs: number; p95LatencyMs: number;
  }[] {
    const column = dimension === "provider" ? "provider_id" : dimension === "group" ? "group_id" : dimension === "model" ? "model" : "endpoint";
    const clampedLimit = Math.min(Math.max(Math.floor(limit), 1), 50);
    const clampedDays = Math.min(Math.max(Math.floor(days), 1), 366);
    const { clause, args } = this.ownerClause(ownerId);
    const selectProvider = dimension === "group" ? "MIN(provider_id) AS provider_id, " : "";
    const rows = this.db.prepare(
      `SELECT ${selectProvider}${column} AS name, COUNT(*) AS count, ` +
      `COALESCE(AVG(CASE WHEN latency_ms IS NOT NULL THEN latency_ms END), 0) AS avg_latency, ` +
      `COALESCE(AVG(CASE WHEN ttft_ms IS NOT NULL THEN ttft_ms END), 0) AS avg_ttft, ` +
      `COALESCE(SUM(CASE WHEN latency_ms IS NOT NULL THEN latency_ms ELSE 0 END), 0) AS total_latency ` +
      `FROM gateway_requests WHERE ${clause} AND created_at >= ? AND ${column} IS NOT NULL AND endpoint NOT LIKE 'direct/%' AND latency_ms IS NOT NULL GROUP BY ${column} ORDER BY count DESC LIMIT ?`
    ).all(...args, Date.now() - clampedDays * 24 * 60 * 60 * 1000, clampedLimit) as {
      name: string; provider_id?: string; count: number; avg_latency: number; avg_ttft: number; total_latency: number;
    }[];
    // 有界分位样本：只查 TopN 名单的延迟列，避免全表扫描。
    const percentiles = new Map<string, { p50: number; p95: number }>();
    try {
      const names = rows.map((r) => r.name);
      if (names.length > 0) {
        const placeholders = names.map(() => "?").join(", ");
        const samples = this.db.prepare(
          `SELECT ${column} AS name, latency_ms AS latency FROM gateway_requests WHERE ${clause} AND created_at >= ? AND ${column} IN (${placeholders}) AND latency_ms IS NOT NULL AND endpoint NOT LIKE 'direct/%' ORDER BY created_at DESC LIMIT 1000`
        ).all(...args, Date.now() - clampedDays * 24 * 60 * 60 * 1000, ...names) as { name: string; latency: number }[];
        const grouped = new Map<string, number[]>();
        for (const s of samples) {
          const arr = grouped.get(s.name) ?? [];
          arr.push(Number(s.latency));
          grouped.set(s.name, arr);
        }
        for (const [name, arr] of grouped) {
          arr.sort((a, b) => a - b);
          const pick = (p: number): number => {
            if (arr.length === 0) return 0;
            return Math.round(arr[Math.min(arr.length - 1, Math.max(0, Math.ceil(p * arr.length) - 1))] ?? 0);
          };
          percentiles.set(name, { p50: pick(0.5), p95: pick(0.95) });
        }
      }
    } catch (error) {
      console.warn("[gateway-requests] performance percentiles failed", { error: error instanceof Error ? error.message : String(error) });
    }
    return rows.map((row) => ({
      name: row.name,
      ...(row.provider_id ? { providerId: row.provider_id } : {}),
      requestCount: Number(row.count),
      avgLatencyMs: Math.round(Number(row.avg_latency ?? 0)),
      avgTtftMs: Math.round(Number(row.avg_ttft ?? 0)),
      totalLatencyMs: Number(row.total_latency ?? 0),
      p50LatencyMs: percentiles.get(row.name)?.p50 ?? 0,
      p95LatencyMs: percentiles.get(row.name)?.p95 ?? 0,
    }));
  }

  /** 游标分页（created_at DESC, id DESC），对标 axonhub requests 连接查询的请求层。 */
  public listPage(ownerId: string | null, filter: GatewayRequestFilter, options?: { limit?: number; cursor?: string }): GatewayRequestPage {
    const limit = Math.min(Math.max(options?.limit ?? 20, 1), 100);
    const conditions: string[] = [];
    const args: (string | number)[] = [];
    const { clause, args: ownerArgs } = this.ownerClause(ownerId);
    conditions.push(clause);
    args.push(...ownerArgs);
    if (filter.providerId) { conditions.push("provider_id = ?"); args.push(filter.providerId); }
    if (filter.groupId) { conditions.push("group_id = ?"); args.push(filter.groupId); }
    if (filter.modelContains) { conditions.push("model LIKE ? ESCAPE '\\'"); args.push(`%${filter.modelContains.replace(/[\\%_]/g, (c) => `\\${c}`)}%`); }
    // status 优先；未传 status 但传 ok 时按旧语义映射（true→completed，false→failed），保持兼容。
    const statusList = filter.statusIn && filter.statusIn.length > 0
      ? filter.statusIn
      : filter.status ? [filter.status] : [];
    if (statusList.length > 0) {
      conditions.push(`status IN (${statusList.map(() => "?").join(", ")})`);
      args.push(...statusList);
    } else if (filter.ok === true) { conditions.push("(ok = 1 OR status = 'completed')"); }
    else if (filter.ok === false) { conditions.push("(ok = 0 OR status IN ('failed', 'canceled'))"); }
    const sourceList = filter.sourceIn && filter.sourceIn.length > 0
      ? filter.sourceIn
      : filter.source ? [filter.source] : [];
    if (sourceList.length > 0) {
      conditions.push(`source IN (${sourceList.map(() => "?").join(", ")})`);
      args.push(...sourceList);
    }
    if (filter.threadId) { conditions.push("thread_id = ?"); args.push(filter.threadId); }
    if (filter.endpoint) { conditions.push("endpoint = ?"); args.push(filter.endpoint); }
    const cursor = this.parseCursor(options?.cursor);
    if (cursor) {
      conditions.push("(created_at < ? OR (created_at = ? AND id < ?))");
      args.push(cursor.createdAt, cursor.createdAt, cursor.id);
    }
    const where = conditions.join(" AND ");
    const rows = this.db.prepare(
      `SELECT * FROM gateway_requests WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ?`
    ).all(...args, limit + 1) as GatewayRequestRow[];
    const entries = rows.slice(0, limit).map((row) => this.map(row));
    const nextCursor = rows.length > limit && entries.length > 0
      ? Buffer.from(`${entries[entries.length - 1]!.createdAt}:${entries[entries.length - 1]!.id}`, "utf8").toString("base64url")
      : null;
    return { entries, nextCursor };
  }

  private ownerClause(ownerId: string | null): { clause: string; args: string[] } {
    if (ownerId == null || ownerId === "") return { clause: "1 = 1", args: [] };
    return { clause: "owner_id = ?", args: [ownerId] };
  }

  private parseCursor(cursor?: string): { createdAt: number; id: string } | null {
    if (!cursor) return null;
    try {
      const decoded = Buffer.from(cursor, "base64url").toString("utf8");
      const sep = decoded.indexOf(":");
      if (sep < 0) return null;
      const createdAt = Number(decoded.slice(0, sep));
      const id = decoded.slice(sep + 1);
      if (!Number.isFinite(createdAt) || !id) return null;
      return { createdAt, id };
    } catch {
      return null;
    }
  }

  private map(row: GatewayRequestRow): GatewayRequestRecord {
    const known = GATEWAY_REQUEST_ENDPOINTS.includes(row.endpoint) || row.endpoint.startsWith("direct/");
    if (!known) {
      throw new Error(`Unknown gateway endpoint: ${row.endpoint}`);
    }
    return {
      id: row.id,
      ownerId: row.owner_id,
      ...(row.thread_id ? { threadId: row.thread_id } : {}),
      ...(row.turn_id ? { turnId: row.turn_id } : {}),
      endpoint: row.endpoint as GatewayRequestEndpoint,
      providerId: row.provider_id,
      groupId: row.group_id,
      ...(row.model ? { model: row.model } : {}),
      stream: row.stream === 1,
      ...(row.upstream_status != null ? { upstreamStatus: Number(row.upstream_status) } : {}),
      ...(row.ok != null ? { ok: row.ok === 1 } : {}),
      ...(row.status ? { status: row.status as GatewayRequestStatus } : {}),
      ...(row.source ? { source: row.source as GatewayRequestSource } : {}),
      ...(row.error ? { error: row.error } : {}),
      startedAt: row.started_at,
      ...(row.headers_at != null ? { headersAt: row.headers_at } : {}),
      ...(row.ttft_ms != null ? { ttftMs: Number(row.ttft_ms) } : {}),
      ...(row.latency_ms != null ? { latencyMs: row.latency_ms } : {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

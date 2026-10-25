/**
 * Claude CLI 启动分阶段状态（composer 状态栏展示）。
 *
 * Cold start on Windows takes 10s+ (cmd shim + JS bundle + MCP attach), so
 * the first `turn/start` can hit the 20s RPC timeout while the child is
 * still handshaking. These stages make the invisible visible:
 * `spawning`（正在启动 Claude）→ `handshake`（等待 CLI init 握手）
 * → `ready` / `failed`.
 */

export type ClaudeStartupStage = "spawning" | "handshake" | "ready" | "failed";

export type ClaudeStartupStatus = {
  stage: ClaudeStartupStage;
  at: number;
  error?: string;
};

const STAGES: ClaudeStartupStage[] = ["spawning", "handshake", "ready", "failed"];

export function isClaudeStartupStage(value: unknown): value is ClaudeStartupStage {
  return typeof value === "string" && (STAGES as string[]).includes(value);
}

export function parseClaudeStartupStatus(value: unknown): { threadId: string; status: ClaudeStartupStatus } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const threadId = typeof record.threadId === "string" ? record.threadId.trim()
    : typeof record.thread_id === "string" ? record.thread_id.trim() : "";
  const stage = record.stage;
  if (!threadId || !isClaudeStartupStage(stage)) return null;
  const at = typeof record.at === "number" && Number.isFinite(record.at) ? record.at : Date.now();
  const error = typeof record.error === "string" && record.error.trim() ? record.error.trim() : undefined;
  return { threadId, status: { stage, at, ...(error ? { error } : {}) } };
}

export function claudeStartupStageLocaleKey(stage: ClaudeStartupStage): string {
  return `composer.claudeStartup.${stage}`;
}

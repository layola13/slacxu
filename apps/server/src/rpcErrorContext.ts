import type { JsonRpcFailure, JsonValue } from '@codex-ui/shared';
export type RpcExecution = 'local' | 'ssh' | 'remote-bun';
export type RpcErrorContext = { execution: RpcExecution; method: string; stage?: string; threadId?: string; providerId?: string; groupId?: string; detail?: string };

function extractErrorCause(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    if (typeof record.message === 'string' && record.message.trim()) return record.message;
    if (typeof record.error === 'string' && record.error.trim()) return record.error;
    if (record.error && typeof record.error === 'object') {
      const nested = record.error as Record<string, unknown>;
      if (typeof nested.message === 'string' && nested.message.trim()) return nested.message;
    }
    try { return JSON.stringify(error); } catch { return String(error); }
  }
  return String(error);
}

function extractErrorCode(error: unknown): number | undefined {
  if (error && typeof error === 'object') {
    const raw = (error as Record<string, unknown>).code;
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  }
  return undefined;
}

export function detailedRpcError(error: unknown, context: RpcErrorContext): JsonRpcFailure['error'] {
  const existing = existingDetailedError(error);
  if (existing) return existing;
  const cause = extractErrorCause(error);
  const upstreamCode = extractErrorCode(error);
  const auth = /unauthorized|401|authentication|token expired|session expired/i.test(cause);
  const name = context.execution === 'remote-bun' ? 'REMOTE-BUN' : context.execution.toUpperCase();
  const stableCode = `CUX-RPC-${auth ? 'AUTH-' : ''}${name}-001`;
  const stage = context.stage ?? 'rpc';
  const data: Record<string, unknown> = { stableCode, execution: context.execution, stage, method: context.method, cause };
  if (context.detail) data.detail = context.detail;
  if (upstreamCode !== undefined) data.upstreamCode = upstreamCode;
  return { code: auth ? 401 : -32000, message: `${stableCode} execution=${context.execution} stage=${stage} method=${context.method}${context.threadId ? ` thread=${context.threadId}` : ''}${context.providerId ? ` provider=${context.providerId}` : ''}${context.groupId ? ` group=${context.groupId}` : ''}${context.detail ? ` detail=${context.detail}` : ''} cause=${cause}`, data: data as JsonValue };
}

function existingDetailedError(error: unknown): JsonRpcFailure['error'] | null {
  const message = extractErrorCause(error);
  if (!/^CUX-RPC-(?:AUTH-)?(?:LOCAL|SSH|REMOTE-BUN)-001\b/.test(message)) return null;
  return { code: message.includes('-AUTH-') ? 401 : -32000, message };
}

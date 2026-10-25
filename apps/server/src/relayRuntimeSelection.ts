import type { ThreadRuntimeMetadata } from "@codex-ui/shared";

export type RelayGatewayTarget = {
  providerId: string;
  groupId: string;
  threadId: string | null;
};

export function resolveRelayRuntimeOwnerId(
  threadId: string,
  membershipEnabled: boolean,
  threadOwnerId: (threadId: string) => string | null
): string | null {
  if (!membershipEnabled) {
    return "local";
  }
  // Threads created before membership was enabled have no owner row. Do not
  // apply legacy local metadata to them: the gateway URL already contains the
  // provider snapshot that was authorized when the thread was activated.
  return threadOwnerId(threadId);
}

export function resolveRelayGatewayTarget(
  headers: Headers,
  fallback: Pick<RelayGatewayTarget, "providerId" | "groupId">,
  runtimeSelectionForThread: (threadId: string) => ThreadRuntimeMetadata | null,
  resolveNativeThreadId?: (nativeSessionId: string) => string | null
): RelayGatewayTarget {
  const metadata = headers.get("x-codex-turn-metadata");
  let metadataThreadId: string | null = null;
  if (metadata) {
    try {
      const parsed = JSON.parse(metadata) as Record<string, unknown>;
      const candidate = parsed.thread_id ?? parsed.threadId ?? parsed.session_id ?? parsed.sessionId;
      metadataThreadId = typeof candidate === "string" && candidate.trim() ? candidate.trim() : null;
    } catch {
      metadataThreadId = null;
    }
  }
  // Ultra 线程头优先（x-ultra-thread-id / x-codex-thread-id / thread-id / session-id）；
  // OpenCode 原生 X-Session-Id（ses_*）经调用方映射为 Ultra thread，避免原生 ID
  // 直接作为线程归因导致网关行缺失关联、直连补计数误判。
  const ultraThreadId = headers.get("x-ultra-thread-id")?.trim()
    || headers.get("x-codex-thread-id")?.trim()
    || headers.get("thread-id")?.trim()
    || headers.get("x-thread-id")?.trim()
    || headers.get("session-id")?.trim()
    || metadataThreadId || null;
  const nativeSessionId = headers.get("x-session-id")?.trim() || null;
  let threadId = ultraThreadId;
  if (!threadId && nativeSessionId && resolveNativeThreadId) {
    try {
      threadId = resolveNativeThreadId(nativeSessionId);
    } catch {
      threadId = null;
    }
  }
  // 原生 ses_* 即使直接命中 Ultra 头含义不明：若 Ultra 头本身就是 ses_*，同样尝试映射。
  if (threadId && resolveNativeThreadId && /^ses_/i.test(threadId)) {
    try {
      threadId = resolveNativeThreadId(threadId) ?? threadId;
    } catch {
      // 保持原值，走 fallback。
    }
  }
  if (!threadId) {
    return { ...fallback, threadId };
  }
  const runtimeSelection = runtimeSelectionForThread(threadId);
  if (!runtimeSelection?.providerId || !runtimeSelection.groupId) {
    return { ...fallback, threadId };
  }
  return {
    providerId: runtimeSelection.providerId,
    groupId: runtimeSelection.groupId,
    threadId
  };
}

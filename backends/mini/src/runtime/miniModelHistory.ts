import { createHash } from "node:crypto";

type WireItem = Record<string, unknown>;

type CachedHistory = {
  compatibilityKey: string;
  messagesKey: string;
  items: WireItem[];
};

function messagesKey(messages: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(messages)).digest("hex");
}

/**
 * Bounded, live-session-only wire history from successfully completed turns.
 * Callers supply sanitized items: chat history excludes the system message;
 * Responses history includes the full input, not previous_response_id state.
 * A miss (including restored sessions or process restarts) uses the existing recap.
 */
export class MiniModelHistoryCache {
  private readonly histories = new WeakMap<object, CachedHistory>();

  get(session: object, compatibilityKey: string, messages: unknown[]): WireItem[] | null {
    const history = this.histories.get(session);
    if (!history) return null;
    try {
      if (history.compatibilityKey === compatibilityKey && history.messagesKey === messagesKey(messages)) {
        return JSON.parse(JSON.stringify(history.items)) as WireItem[];
      }
    } catch {
      // Non-JSON messages cannot safely identify a reusable wire prefix.
    }
    this.delete(session);
    return null;
  }

  set(
    session: object,
    compatibilityKey: string,
    messages: unknown[],
    items: WireItem[],
    maxChars: number,
  ): boolean {
    this.delete(session);
    if (!Number.isFinite(maxChars) || maxChars < 0) return false;
    try {
      const serialized = JSON.stringify(items);
      if (serialized.length > maxChars) return false;
      this.histories.set(session, {
        compatibilityKey,
        messagesKey: messagesKey(messages),
        items: JSON.parse(serialized) as WireItem[],
      });
      return true;
    } catch {
      // Serialization failures also discard the old prefix and fall back to recap.
      return false;
    }
  }

  delete(session: object): void {
    this.histories.delete(session);
  }
}

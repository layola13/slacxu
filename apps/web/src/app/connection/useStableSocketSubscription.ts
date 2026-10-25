import { useEffect, useRef } from "react";
import type { CodexSocketClient } from "../../state/codexClient";
import { stableEventProxy } from "./stableEventProxy";

export interface SocketEventHandlers {
  onConnected(event: Event): void;
  onConnectionStatus(event: Event): void;
  onMessage(event: Event): void;
}

/**
 * Keeps one listener set for the lifetime of a socket client. Pane-local state
 * may replace handler implementations without disturbing the global stream.
 */
export function useStableSocketSubscription(
  client: CodexSocketClient,
  handlers: SocketEventHandlers
): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const onConnected = stableEventProxy<Event>({
      current: (event) => handlersRef.current.onConnected(event)
    });
    const onConnectionStatus = stableEventProxy<Event>({
      current: (event) => handlersRef.current.onConnectionStatus(event)
    });
    const onMessage = stableEventProxy<Event>({
      current: (event) => handlersRef.current.onMessage(event)
    });

    client.addEventListener("connected", onConnected);
    client.addEventListener("connection-status", onConnectionStatus);
    client.addEventListener("server-message", onMessage);
    return () => {
      client.removeEventListener("connected", onConnected);
      client.removeEventListener("connection-status", onConnectionStatus);
      client.removeEventListener("server-message", onMessage);
    };
  }, [client]);
}

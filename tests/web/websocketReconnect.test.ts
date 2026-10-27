import { expect, test, beforeEach, afterEach } from "bun:test";
import {
  CodexSocketClient,
  computeReconnectDelay,
  isStaleHandshake,
} from "../../apps/web/src/state/codexClient.ts";

test("computeReconnectDelay applies exponential backoff with cap", () => {
  expect(computeReconnectDelay(0, 250, 5_000)).toBe(250);
  expect(computeReconnectDelay(1, 250, 5_000)).toBe(500);
  expect(computeReconnectDelay(2, 250, 5_000)).toBe(1_000);
  expect(computeReconnectDelay(6, 250, 5_000)).toBe(5_000);
  expect(computeReconnectDelay(10, 250, 5_000)).toBe(5_000);
});

test("computeReconnectDelay falls back on invalid input", () => {
  expect(computeReconnectDelay(0, NaN, 5_000)).toBe(250);
  expect(computeReconnectDelay(-1, 250, 5_000)).toBe(250);
  expect(computeReconnectDelay(1, 750, 30_000)).toBe(1_500);
});

test("isStaleHandshake detects throttled background handshakes", () => {
  expect(isStaleHandshake(null, 10_000, 5_000)).toBe(false);
  expect(isStaleHandshake(0, 3_000, 5_000)).toBe(false);
  expect(isStaleHandshake(0, 5_000, 5_000)).toBe(false);
  expect(isStaleHandshake(0, 6_001, 5_000)).toBe(true);
  expect(isStaleHandshake(0, 11_000, 10_000)).toBe(false);
  expect(isStaleHandshake(0, 11_001, 10_000)).toBe(true);
});

type MutableGlobal = Record<string, unknown>;

function installDomMocks() {
  const g = globalThis as unknown as MutableGlobal;
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const fakeWindow = {
    setTimeout: (fn: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) =>
      setTimeout(() => fn(...args), ms ?? 0),
    clearTimeout: (id: unknown) => clearTimeout(id as ReturnType<typeof setTimeout>),
    setInterval: (fn: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) =>
      setInterval(() => fn(...args), ms ?? 0),
    clearInterval: (id: unknown) => clearInterval(id as ReturnType<typeof setInterval>),
    addEventListener: (type: string, fn: (...args: unknown[]) => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)?.add(fn);
    },
    removeEventListener: (type: string, fn: (...args: unknown[]) => void) => {
      listeners.get(type)?.delete(fn);
    },
    location: { href: "http://127.0.0.1:43121/" },
  };
  g.window = fakeWindow;
  g.document = {
    visibilityState: "visible",
    addEventListener: fakeWindow.addEventListener,
    removeEventListener: fakeWindow.removeEventListener,
  };
  g.navigator = { onLine: true };
  class FakeWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    readyState = FakeWebSocket.CONNECTING;
    url: string;
    closedWith: Array<{ code?: number; reason?: string }> = [];
    constructor(url: string) {
      this.url = url;
    }
    close(code?: number, reason?: string) {
      this.closedWith.push({ code, reason });
      this.readyState = FakeWebSocket.CLOSED;
    }
    send() {}
    addEventListener() {}
    removeEventListener() {}
  }
  g.WebSocket = FakeWebSocket;
  return { fakeWindow, FakeWebSocket };
}

let prevWindow: unknown;
let prevDocument: unknown;
let prevNavigator: unknown;
let prevWebSocket: unknown;

beforeEach(() => {
  prevWindow = (globalThis as MutableGlobal).window;
  prevDocument = (globalThis as MutableGlobal).document;
  prevNavigator = (globalThis as MutableGlobal).navigator;
  prevWebSocket = (globalThis as MutableGlobal).WebSocket;
  installDomMocks();
});

afterEach(() => {
  const g = globalThis as unknown as MutableGlobal;
  g.window = prevWindow;
  g.document = prevDocument;
  g.navigator = prevNavigator;
  g.WebSocket = prevWebSocket;
});

test("updateToken syncs the socket token and schedules a reconnect when idle", () => {
  const client = new CodexSocketClient() as unknown as {
    updateToken(token: string): void;
    token: string | null;
    reconnectTimer: number | null;
    socket: unknown;
    connectPromise: unknown;
    closedByClient: boolean;
  };
  client.closedByClient = false;
  client.socket = null;
  client.connectPromise = null;
  client.updateToken("token-a");
  expect(client.token).toBe("token-a");
  expect(client.reconnectTimer).not.toBeNull();
  (globalThis as unknown as { window: { clearTimeout(id: unknown): void } }).window.clearTimeout(
    client.reconnectTimer as unknown as number,
  );
  client.reconnectTimer = null;
});

test("updateToken with the same token does not schedule duplicate reconnects", () => {
  const client = new CodexSocketClient() as unknown as {
    updateToken(token: string): void;
    token: string | null;
    reconnectTimer: number | null;
    socket: unknown;
    connectPromise: unknown;
    closedByClient: boolean;
  };
  client.closedByClient = false;
  client.socket = null;
  client.connectPromise = null;
  client.token = "same";
  client.updateToken("same");
  expect(client.reconnectTimer).toBeNull();
});

test("scheduleReconnect keeps polling while the browser reports offline", () => {
  (globalThis as unknown as MutableGlobal).navigator = { onLine: false };
  const client = new CodexSocketClient() as unknown as {
    token: string | null;
    reconnectTimer: number | null;
    closedByClient: boolean;
    scheduleReconnect(): void;
  };
  client.token = "token-a";
  client.closedByClient = false;
  client.scheduleReconnect();
  expect(client.reconnectTimer).not.toBeNull();
  (globalThis as unknown as { window: { clearTimeout(id: unknown): void } }).window.clearTimeout(
    client.reconnectTimer as unknown as number,
  );
  client.reconnectTimer = null;
});

test("stale CONNECTING socket is torn down on visibility resume", () => {
  const client = new CodexSocketClient() as unknown as {
    token: string | null;
    socket: { readyState: number; close(code?: number, reason?: string): void } | null;
    connectPromise: unknown;
    openStartedAt: number | null;
    closedByClient: boolean;
    reconnectTimer: number | null;
    handleVisibilityChange(): void;
  };
  let closed = false;
  client.token = "token-a";
  client.closedByClient = false;
  client.connectPromise = {};
  client.openStartedAt = 0;
  client.reconnectTimer = null;
  client.socket = {
    readyState: 0,
    close() {
      closed = true;
    },
  };
  const realNow = Date.now;
  Date.now = () => 30_000;
  try {
    client.handleVisibilityChange();
  } finally {
    Date.now = realNow;
  }
  expect(closed).toBe(true);
  expect(client.socket).toBeNull();
  if (client.reconnectTimer !== null) {
    (globalThis as unknown as { window: { clearTimeout(id: unknown): void } }).window.clearTimeout(
      client.reconnectTimer as unknown as number,
    );
    client.reconnectTimer = null;
  }
});

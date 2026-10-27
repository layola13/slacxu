import "../../apps/server/src/pluginHostServices.js"; // register PluginHostServices for the code under test
import { afterEach, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { AutoFallbackCodexRuntimeClient, createCodexRuntimeClient, CodexBridge, type CodexRuntimeClient } from "../../backends/codex/src/runtime/codexBridge.ts";
import { MiniBridge } from "../../backends/mini/src/runtime/miniBridge.ts";
import { spawnCodexCommand } from "../../apps/server/src/codexCommand.ts";
import { runtimeEnvMissingInProcessEnv } from "../../backends/codex/src/runtime/daemonCodexBridge.ts";

const originalMode = process.env.CODEX_UI_APP_SERVER_MODE;
const originalSocket = process.env.CODEX_APP_SERVER_SOCKET;
const originalCodexAvailable = process.env.CODEX_UI_CODEX_AVAILABLE;

afterEach(() => {
  if (originalMode === undefined) {
    delete process.env.CODEX_UI_APP_SERVER_MODE;
  } else {
    process.env.CODEX_UI_APP_SERVER_MODE = originalMode;
  }
  if (originalSocket === undefined) {
    delete process.env.CODEX_APP_SERVER_SOCKET;
  } else {
    process.env.CODEX_APP_SERVER_SOCKET = originalSocket;
  }
  if (originalCodexAvailable === undefined) {
    delete process.env.CODEX_UI_CODEX_AVAILABLE;
  } else {
    process.env.CODEX_UI_CODEX_AVAILABLE = originalCodexAvailable;
  }
});

test("createCodexRuntimeClient defaults to shared daemon transport on Unix", () => {
  delete process.env.CODEX_UI_APP_SERVER_MODE;
  delete process.env.CODEX_APP_SERVER_SOCKET;
  process.env.CODEX_UI_CODEX_AVAILABLE = "1";

  const client = createCodexRuntimeClient(() => ({}), "linux");

  expect(client.getStatus().transport).toBe("daemon-unix");
});

test("createCodexRuntimeClient defaults to stdio transport on Windows", () => {
  delete process.env.CODEX_UI_APP_SERVER_MODE;
  delete process.env.CODEX_APP_SERVER_SOCKET;
  process.env.CODEX_UI_CODEX_AVAILABLE = "1";

  const client = createCodexRuntimeClient(() => ({}), "win32");

  expect(client.getStatus().transport).toBe("stdio");
});

test("createCodexRuntimeClient falls back to built-in mini when codex is unavailable", () => {
  delete process.env.CODEX_UI_APP_SERVER_MODE;
  delete process.env.CODEX_APP_SERVER_SOCKET;
  process.env.CODEX_UI_CODEX_AVAILABLE = "0";

  const client = createCodexRuntimeClient(() => ({}), "win32");

  expect(client.getStatus().message).toMatch(/Mini ready/);
});

test("AutoFallbackCodexRuntimeClient falls back to mini when primary fails to start", async () => {
  const failingPrimary = Object.assign(new EventEmitter(), {
    getStatus: () => ({ phase: "idle" as const, transport: "daemon-unix" as const }),
    start: async () => {
      failingPrimary.emit("status", { phase: "error", transport: "daemon-unix", message: "Failed to start daemon" });
      throw new Error("Failed to start daemon");
    },
    stop: () => {},
    restart: async () => ({ phase: "idle" as const, transport: "daemon-unix" as const }),
    request: async () => ({}),
    notify: async () => {},
    respond: () => {},
  }) as unknown as CodexRuntimeClient;

  const miniFallback = new MiniBridge();
  const autoClient = new AutoFallbackCodexRuntimeClient(failingPrimary, miniFallback);

  expect(autoClient.getStatus().transport).toBe("daemon-unix");

  const status = await autoClient.start();
  expect(status.phase).toBe("ready");
  expect(autoClient.getStatus().phase).toBe("ready");
  expect(autoClient.getStatus().message).toMatch(/Mini ready/);
});

test("AutoFallbackCodexRuntimeClient exposes fallback state and recovers on restart", async () => {
  let shouldFail = true;
  const primary = Object.assign(new EventEmitter(), {
    getStatus: () => ({ phase: "idle" as const, transport: "daemon-unix" as const }),
    start: async () => {
      if (shouldFail) throw new Error("boom");
      return { phase: "ready" as const, transport: "daemon-unix" as const };
    },
    stop: () => {},
    restart: async () => ({ phase: "idle" as const, transport: "daemon-unix" as const }),
    request: async () => ({}),
    notify: async () => {},
    respond: () => {},
  }) as unknown as CodexRuntimeClient;

  const miniFallback = new MiniBridge();
  const autoClient = new AutoFallbackCodexRuntimeClient(primary, miniFallback);

  expect(autoClient.isFallbackActive()).toBe(false);
  await autoClient.start();
  expect(autoClient.isFallbackActive()).toBe(true);
  // Fallback must be visible (no more silent Mini): status names Mini and the fallback.
  expect(autoClient.getStatus().message).toMatch(/Mini ready/);
  expect(autoClient.getStatus().message).toMatch(/fallback to Mini active/);

  // Recovery: restart retries the primary instead of pinning Mini forever.
  shouldFail = false;
  const recovered = await autoClient.restart();
  expect(recovered.phase).toBe("ready");
  expect(autoClient.isFallbackActive()).toBe(false);
  expect(autoClient.getStatus().transport).toBe("daemon-unix");
});

test("createCodexRuntimeClient rejects Unix daemon transport on Windows", () => {
  process.env.CODEX_UI_APP_SERVER_MODE = "daemon";

  expect(() => createCodexRuntimeClient(() => ({}), "win32")).toThrow(/not supported on Windows/);
});

test("createCodexRuntimeClient keeps stdio as explicit legacy opt-out", () => {
  process.env.CODEX_UI_APP_SERVER_MODE = "stdio";

  const client = createCodexRuntimeClient();

  expect(client.getStatus().transport).toBe("stdio");
});

test("createCodexRuntimeClient rejects unknown runtime modes", () => {
  process.env.CODEX_UI_APP_SERVER_MODE = "private-history-only";

  expect(() => createCodexRuntimeClient()).toThrow(/Unsupported CODEX_UI_APP_SERVER_MODE/);
});

test("daemon runtime env refresh detection considers provider and relay gateway credentials", () => {
  expect(
    runtimeEnvMissingInProcessEnv(
      {
        CODEX_UI_PROVIDER_DEEPKEY_WEBDEV_API_KEY: "sk-new",
        IRRELEVANT_SECRET: "changed"
      },
      {
        CODEX_UI_PROVIDER_DEEPKEY_WEBDEV_API_KEY: "sk-old",
        IRRELEVANT_SECRET: "changed"
      }
    )
  ).toBe(true);

  expect(
    runtimeEnvMissingInProcessEnv(
      {
        CODEX_UI_RELAY_GATEWAY_TOKEN: "gateway-new",
        IRRELEVANT_SECRET: "same"
      },
      {
        CODEX_UI_RELAY_GATEWAY_TOKEN: "gateway-old",
        IRRELEVANT_SECRET: "same"
      }
    )
  ).toBe(true);

  expect(
    runtimeEnvMissingInProcessEnv(
      {
        CODEX_UI_PROVIDER_DEEPKEY_WEBDEV_API_KEY: "sk-new",
        CODEX_UI_RELAY_GATEWAY_TOKEN: "gateway-current",
        IRRELEVANT_SECRET: "changed"
      },
      {
        CODEX_UI_PROVIDER_DEEPKEY_WEBDEV_API_KEY: "sk-new",
        CODEX_UI_RELAY_GATEWAY_TOKEN: "gateway-current",
        IRRELEVANT_SECRET: "stale"
      }
    )
  ).toBe(false);
});

test("recovers once after a stdio app-server exit without replaying the interrupted request", async () => {
  const children: FakeCodexChild[] = [];
  const spawn = ((_command: string, args: string[]) => {
    if (args[0] === "--version") {
      return createVersionChild();
    }
    const child = createFakeCodexChild(children.length > 0);
    children.push(child);
    return child;
  }) as typeof spawnCodexCommand;
  const bridge = new CodexBridge(() => ({}), spawn, () => "codex");

  await bridge.start();
  const interrupted = bridge.request("turn/start", { threadId: "thread-1" });
  await new Promise((resolve) => setImmediate(resolve));
  children[0]!.emit("exit", 1, null);
  await expect(interrupted).rejects.toMatchObject({ message: expect.stringContaining("exited") });

  await Promise.all([
    bridge.request("thread/read", { threadId: "thread-1" }),
    bridge.request("account/read", {})
  ]);

  expect(children).toHaveLength(2);
  expect(children[0]!.methods).toContain("turn/start");
  expect(children[1]!.methods).not.toContain("turn/start");
  expect(children[1]!.methods).toEqual(expect.arrayContaining(["initialize", "thread/read", "account/read"]));
  bridge.stop();
});

test("initializes Codex app-server with the real Codex TUI identity", async () => {
  let initializeParams: Record<string, unknown> | undefined;
  const spawn = ((_command: string, args: string[]) => {
    if (args[0] === "--version") return createVersionChild();
    const child = createFakeCodexChild(true, (request) => {
      if (request.method === "initialize") initializeParams = request.params as Record<string, unknown>;
    });
    return child;
  }) as typeof spawnCodexCommand;
  const bridge = new CodexBridge(() => ({}), spawn, () => "codex");

  await bridge.start();
  expect(initializeParams?.clientInfo).toEqual({ name: "codex-tui", title: "Codex TUI", version: "0.1.0" });
  bridge.stop();
});

type FakeCodexChild = EventEmitter & {
  stdin: Writable;
  stdout: PassThrough;
  stderr: PassThrough;
  methods: string[];
  kill: () => boolean;
};

function createFakeCodexChild(respondToAllRequests = true, onRequest?: (request: { id?: string | number; method?: string; params?: unknown }) => void): FakeCodexChild {
  const child = new EventEmitter() as FakeCodexChild;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.methods = [];
  child.stdin = new Writable({
    write(chunk, _encoding, callback) {
      const request = JSON.parse(String(chunk).trim()) as { id?: string | number; method?: string };
      onRequest?.(request);
      if (request.method) {
        child.methods.push(request.method);
      }
      if (request.id !== undefined && (respondToAllRequests || request.method === "initialize")) {
        child.stdout.write(`${JSON.stringify({ id: request.id, result: {} })}\n`);
      }
      callback();
    }
  });
  child.kill = () => true;
  return child;
}

function createVersionChild(): FakeCodexChild {
  const child = createFakeCodexChild();
  queueMicrotask(() => child.emit("exit", 0, null));
  return child;
}

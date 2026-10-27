import { describe, expect, test } from "bun:test";
import { RemoteBunCodexBridge, type RemoteBunTransport } from "../../backends/codex/src/runtime/remoteBunCodexBridge";
import { buildRemoteBunNodeEnv, isAllowedRemoteBunNodePath, syncRelayToRemoteEndpoint } from "../../apps/server/src/remoteBunNode";

type Call = { method: string; path: string; body?: unknown; apiSession?: string };

/**
 * A remote node that hands out one journal batch and then blocks, so the poll
 * loop stays alive without spinning while a test inspects what was emitted.
 */
function fakeTransport(events: unknown[]): { transport: RemoteBunTransport; calls: Call[] } {
  const calls: Call[] = [];
  let served = false;
  const transport: RemoteBunTransport = {
    openTunnel: (async () => ({ tunnelId: "tunnel-1", localPort: 1, remotePort: 2, baseUrl: "http://127.0.0.1:1", token: "t" })) as RemoteBunTransport["openTunnel"],
    closeTunnel: (() => true) as RemoteBunTransport["closeTunnel"],
    request: (async (_tunnelId: string, method: string, path: string, body?: unknown, apiSession?: string) => {
      calls.push({ method, path, body, apiSession });
      if (path === "/api/codex/sessions") return { data: { sessionId: "api-session-1", cursor: 0 } };
      if (path.startsWith("/api/codex/events")) {
        if (served) return await new Promise(() => undefined);
        served = true;
        return { data: { events } };
      }
      return { data: {} };
    }) as RemoteBunTransport["request"],
  };
  return { transport, calls };
}

function journalEvent(id: number, kind: string, payload: unknown): Record<string, unknown> {
  return { id, kind, payload };
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 20));
}

describe("autonomous remote server requests", () => {
  test("delivers approval requests from the journal, not just notifications", async () => {
    const approval = { id: 7, method: "item/permissions/requestApproval", params: { threadId: "thread-1" } };
    const { transport } = fakeTransport([
      journalEvent(1, "notification", { method: "item/started", params: { threadId: "thread-1" } }),
      journalEvent(2, "serverRequest", approval),
      journalEvent(3, "engineStatus", { phase: "ready" }),
    ]);
    const bridge = new RemoteBunCodexBridge({ threadId: "thread-1", command: "ssh host", remotePort: 43130 }, transport);
    const messages: unknown[] = [];
    bridge.on("message", (message) => messages.push(message));

    await bridge.start();
    await flush();

    // A backgrounded turn blocks on the approval; dropping it hangs the thread.
    expect(messages).toContainEqual(approval);
    expect(messages).toHaveLength(2);
    bridge.stop();
  });

  test("answers a request through the remote response route", async () => {
    const { transport, calls } = fakeTransport([]);
    const bridge = new RemoteBunCodexBridge({ threadId: "thread-1", command: "ssh host", remotePort: 43130 }, transport);
    await bridge.start();

    bridge.respond(7, { decision: "approved" });
    await flush();

    const responded = calls.find((call) => call.path === "/api/codex/server-request/respond");
    expect(responded?.method).toBe("POST");
    expect(responded?.apiSession).toBe("api-session-1");
    expect(responded?.body).toEqual({ requestId: 7, result: { decision: "approved" } });
    bridge.stop();
  });

  test("forwards a rejection as an error instead of a result", async () => {
    const { transport, calls } = fakeTransport([]);
    const bridge = new RemoteBunCodexBridge({ threadId: "thread-1", command: "ssh host", remotePort: 43130 }, transport);
    await bridge.start();

    bridge.respond(9, undefined, { message: "Command blocked by policy" });
    await flush();

    const responded = calls.find((call) => call.path === "/api/codex/server-request/respond");
    expect(responded?.body).toEqual({ requestId: 9, error: { message: "Command blocked by policy" } });
    bridge.stop();
  });

  test("reports instead of throwing when the thread is already detached", async () => {
    const { transport, calls } = fakeTransport([]);
    const bridge = new RemoteBunCodexBridge({ threadId: "thread-1", command: "ssh host", remotePort: 43130 }, transport);
    const stderr: string[] = [];
    bridge.on("stderr", (message: string) => stderr.push(message));
    await bridge.start();
    bridge.stop();

    // respond() is synchronous by contract, so a detached bridge must not throw
    // into the caller that is answering an approval.
    expect(() => bridge.respond(11, {})).not.toThrow();
    await flush();
    expect(stderr.join("")).toContain("detached");
    expect(calls.some((call) => call.path === "/api/codex/server-request/respond")).toBe(false);
  });
});

describe("remote request path allowlist", () => {
  test("permits exactly the routes the bridge uses", () => {
    for (const path of [
      "/api/engine/start",
      "/api/codex/sessions",
      "/api/codex/sessions/api-session-1",
      "/api/codex/events?after=3&waitMs=30000&limit=512",
      "/api/codex/rpc",
      "/api/codex/plan/respond",
      "/api/codex/server-request/respond",
      "/api/thread/start",
    ]) {
      expect(isAllowedRemoteBunNodePath(path)).toBe(true);
    }
  });

  test("rejects paths that extend an allowed prefix", () => {
    // The path is concatenated into a fetch URL, which normalizes `..`
    // segments, so an unanchored prefix match would reach arbitrary routes.
    for (const path of [
      "/api/codex/rpc/../../install",
      "/api/codex/rpcEVIL",
      "/api/codex/events/../../../etc/passwd",
      "/api/install",
      "/api/codex/config",
      "/api/ssh/remote-node/install",
    ]) {
      expect(isAllowedRemoteBunNodePath(path)).toBe(false);
    }
  });
});

describe("remote relay synchronization", () => {
  const payload = { providerId: "deep/key", providerName: "DeepKey", baseUrl: "https://relay.example", groups: [{ groupId: "default" }] };

  test("creates a relay when the remote node does not have it", async () => {
    const requests: Array<{ url: string; method: string }> = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(input), method: init?.method ?? "GET" });
      return Response.json({ data: { providerId: "deep/key" } }, { status: 201 });
    }) as typeof fetch;

    await syncRelayToRemoteEndpoint("http://remote", "token", payload, fetchImpl);

    expect(requests).toEqual([{ url: "http://remote/api/codex/relay-settings", method: "POST" }]);
  });

  test("updates the existing relay when repeated background starts collide", async () => {
    const requests: Array<{ url: string; method: string }> = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(input), method: init?.method ?? "GET" });
      return requests.length === 1
        ? Response.json({ error: "Relay already exists: deep/key" }, { status: 409 })
        : Response.json({ data: { providerId: "deep/key" } });
    }) as typeof fetch;

    await syncRelayToRemoteEndpoint("http://remote", "token", payload, fetchImpl);

    expect(requests).toEqual([
      { url: "http://remote/api/codex/relay-settings", method: "POST" },
      { url: "http://remote/api/codex/relay-settings/deep%2Fkey", method: "PUT" }
    ]);
  });

  test("does not reinterpret unrelated conflicts as an existing relay", async () => {
    const fetchImpl = (async () => Response.json({ error: "Explicit confirmation is required" }, { status: 409 })) as typeof fetch;

    expect(syncRelayToRemoteEndpoint("http://remote", "token", payload, fetchImpl)).rejects.toThrow("Explicit confirmation is required");
  });
});

describe("journal scoping", () => {
  test("polls the journal for its own thread only", async () => {
    const { transport, calls } = fakeTransport([]);
    const bridge = new RemoteBunCodexBridge({ threadId: "thread-42", command: "ssh host", remotePort: 43130 }, transport);
    await bridge.start();
    await flush();

    // One remote node serves every autonomous thread from a single journal, so
    // an unfiltered poll delivers other threads' approvals to this bridge too.
    const poll = calls.find((call) => call.path.startsWith("/api/codex/events"));
    expect(poll?.path).toContain("threadId=thread-42");
    bridge.stop();
  });
});

describe("remote node Claude backend", () => {
  function env(overrides: Partial<Parameters<typeof buildRemoteBunNodeEnv>[0]> = {}): string {
    return buildRemoteBunNodeEnv({ releaseId: "abc123", port: 43130, token: "tok", home: "/home/vscode", claudeEnabled: false, ...overrides });
  }

  test("gates the Claude backend behind an explicit flag", () => {
    expect(env()).toContain("CODEX_UI_CLAUDE_COMPATIBLE_CLI_ENABLED=0");
    expect(env({ claudeEnabled: true })).toContain("CODEX_UI_CLAUDE_COMPATIBLE_CLI_ENABLED=1");
  });

  test("points the node at its own port so Claude reaches the relay without a reverse tunnel", () => {
    // CodeCliBridge builds ANTHROPIC_BASE_URL from CODEX_UI_PORT, so on the
    // remote node it resolves to that node's own relay gateway.
    const lines = env({ claudeEnabled: true }).trim().split("\n");
    expect(lines).toContain("CODEX_UI_PORT=43130");
    expect(lines).toContain("CODEX_UI_DATA_DIR=/home/vscode/.codex-ultra/remote/data");
  });

  test("allows toggling the backend at runtime without reinstalling", () => {
    expect(isAllowedRemoteBunNodePath("/api/codex/settings/claude-compatible-cli")).toBe(true);
  });
});

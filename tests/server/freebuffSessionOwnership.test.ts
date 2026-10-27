import { test, expect, beforeEach } from "bun:test";
import {
  getOrEnsureFreebuffSession,
  clearFreebuffSession,
  clearOwnedFreebuffInstances,
  recordOwnedFreebuffInstance,
  isOwnedFreebuffInstance,
  createFreebuffRunId,
  getFreebuffSessionStatus,
  releaseFreebuffSession,
  FREEBUFF_SESSION_URL,
  FREEBUFF_AGENT_RUNS_URL,
  FREEBUFF_BASE_URL
} from "../../backends/relay-config/src/relay/freebuffSession.js";

beforeEach(() => {
  clearFreebuffSession();
  clearOwnedFreebuffInstances();
});

test("FREEBUFF_BASE_URL targets www.codebuff.com to avoid 301 redirects", () => {
  expect(FREEBUFF_BASE_URL).toBe("https://www.codebuff.com/api/v1");
});

test("P0 Protection: does NOT delete external session when target model differs, throws protective error", async () => {
  const calls: Array<{ url: string; method: string }> = [];

  const fetchImpl = (async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method });

    if (method === "GET") {
      return Response.json({
        status: "active",
        instanceId: "external_cli_instance_999",
        model: "mimo/mimo-v2.5",
        expiresAt: new Date(Date.now() + 600_000).toISOString()
      });
    }

    if (method === "DELETE") {
      throw new Error("DELETE should NOT be called on external session!");
    }

    return new Response("Not found", { status: 404 });
  }) as typeof fetch;

  // Caller requests z-ai/glm-5.3-flash while external CLI holds mimo/mimo-v2.5
  await expect(
    getOrEnsureFreebuffSession("z-ai/glm-5.3-flash", "test-token", { fetchImpl })
  ).rejects.toThrow("Freebuff active session is currently owned by an external client");

  // Verify DELETE was never called!
  const deleteCalls = calls.filter((c) => c.method === "DELETE");
  expect(deleteCalls).toHaveLength(0);
});

test("P0 Protection: adopts and reuses external session when target model matches without deleting", async () => {
  const calls: Array<{ url: string; method: string }> = [];

  const fetchImpl = (async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method });

    if (method === "GET") {
      return Response.json({
        status: "active",
        instanceId: "external_cli_instance_888",
        model: "mimo/mimo-v2.5",
        expiresAt: new Date(Date.now() + 600_000).toISOString()
      });
    }

    return new Response("Not found", { status: 404 });
  }) as typeof fetch;

  const session = await getOrEnsureFreebuffSession("mimo/mimo-v2.5", "test-token", { fetchImpl });
  expect(session.instanceId).toBe("external_cli_instance_888");
  expect(session.model).toBe("mimo/mimo-v2.5");
  expect(session.isOwned).toBe(false);

  // Verify no DELETE or POST calls were made
  expect(calls.filter((c) => c.method === "DELETE")).toHaveLength(0);
  expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
});

test("P0 Protection: deletes own session when switching models", async () => {
  const calls: Array<{ url: string; method: string }> = [];

  // Simulate that Codex Ultra created instance_ultra_111 earlier
  recordOwnedFreebuffInstance("instance_ultra_111");
  expect(isOwnedFreebuffInstance("instance_ultra_111")).toBe(true);

  const fetchImpl = (async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method });

    if (method === "GET") {
      return Response.json({
        status: "active",
        instanceId: "instance_ultra_111",
        model: "mimo/mimo-v2.5",
        expiresAt: new Date(Date.now() + 600_000).toISOString()
      });
    }

    if (method === "DELETE") {
      return Response.json({ status: "none" });
    }

    if (method === "POST") {
      return Response.json({
        status: "active",
        instanceId: "instance_ultra_222",
        model: "z-ai/glm-5.3-flash",
        expiresAt: new Date(Date.now() + 600_000).toISOString()
      });
    }

    return new Response("Not found", { status: 404 });
  }) as typeof fetch;

  const session = await getOrEnsureFreebuffSession("z-ai/glm-5.3-flash", "test-token", { fetchImpl });
  expect(session.instanceId).toBe("instance_ultra_222");
  expect(session.model).toBe("z-ai/glm-5.3-flash");
  expect(session.isOwned).toBe(true);

  // Verify DELETE was called because it was our own instance
  const deleteCalls = calls.filter((c) => c.method === "DELETE");
  expect(deleteCalls).toHaveLength(1);

  // Verify old instance is no longer owned and new one is owned
  expect(isOwnedFreebuffInstance("instance_ultra_111")).toBe(false);
  expect(isOwnedFreebuffInstance("instance_ultra_222")).toBe(true);
});

test("createFreebuffRunId generates a fresh runId per turn", async () => {
  let counter = 0;
  const fetchImpl = (async () => {
    counter += 1;
    return Response.json({ runId: `run_turn_${counter}` });
  }) as typeof fetch;

  const run1 = await createFreebuffRunId("base3-free-mimo", "tok", { fetchImpl });
  const run2 = await createFreebuffRunId("base3-free-mimo", "tok", { fetchImpl });

  expect(run1).toBe("run_turn_1");
  expect(run2).toBe("run_turn_2");
  expect(run1).not.toBe(run2);
});

test("forceSwitch: deletes external session and admits target model when explicitly confirmed", async () => {
  const calls: Array<{ url: string; method: string }> = [];

  const fetchImpl = (async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method });

    if (method === "GET") {
      return Response.json({
        status: "active",
        instanceId: "external_cli_instance_777",
        model: "mimo/mimo-v2.5",
        expiresAt: new Date(Date.now() + 600_000).toISOString()
      });
    }

    if (method === "DELETE") {
      return Response.json({ status: "none" });
    }

    if (method === "POST") {
      return Response.json({
        status: "active",
        instanceId: "instance_switched_888",
        model: "z-ai/glm-5.3-flash",
        expiresAt: new Date(Date.now() + 600_000).toISOString()
      });
    }

    return new Response("Not found", { status: 404 });
  }) as typeof fetch;

  const session = await getOrEnsureFreebuffSession("z-ai/glm-5.3-flash", "test-token", {
    fetchImpl,
    forceSwitch: true
  });

  expect(session.instanceId).toBe("instance_switched_888");
  expect(session.model).toBe("z-ai/glm-5.3-flash");
  expect(session.isOwned).toBe(true);

  // DELETE must have been called on the external session because forceSwitch: true!
  const deleteCalls = calls.filter((c) => c.method === "DELETE");
  expect(deleteCalls).toHaveLength(1);
});

test("getFreebuffSessionStatus returns active session details from upstream", async () => {
  const fetchImpl = (async () => {
    return Response.json({
      status: "active",
      instanceId: "inst_live_123",
      model: "z-ai/glm-5.3-flash",
      expiresAt: new Date(Date.now() + 300_000).toISOString()
    });
  }) as typeof fetch;

  process.env.FREEBUFF_API_KEY = "test-token";
  try {
    const status = await getFreebuffSessionStatus({ fetchImpl });
    expect(status.configured).toBe(true);
    expect(status.active).toBe(true);
    expect(status.model).toBe("z-ai/glm-5.3-flash");
    expect(status.instanceId).toBe("inst_live_123");
    expect(status.remainingSeconds).toBeGreaterThan(200);
    expect(status.isOwned).toBe(false);
  } finally {
    delete process.env.FREEBUFF_API_KEY;
  }
});

test("releaseFreebuffSession sends DELETE and clears sessions", async () => {
  let deleteCalled = false;
  const fetchImpl = (async (_input, init) => {
    if (init?.method === "DELETE") {
      deleteCalled = true;
      return Response.json({ status: "none" });
    }
    return new Response("Not found", { status: 404 });
  }) as typeof fetch;

  process.env.FREEBUFF_API_KEY = "test-token";
  try {
    const res = await releaseFreebuffSession({ fetchImpl });
    expect(res.released).toBe(true);
    expect(deleteCalled).toBe(true);
  } finally {
    delete process.env.FREEBUFF_API_KEY;
  }
});

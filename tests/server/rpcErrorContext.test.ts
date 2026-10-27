import { describe, expect, test } from "bun:test";
import { detailedRpcError } from "../../apps/server/src/rpcErrorContext";

describe("detailedRpcError", () => {
  test("identifies SSH relay authentication failures", () => {
    const result = detailedRpcError(new Error("Unauthorized relay gateway request"), { execution: "ssh", method: "turn/start", stage: "start-turn", threadId: "thread-1", providerId: "relay-1", groupId: "group-1" });
    expect(result.code).toBe(401);
    expect(result.message).toContain("CUX-RPC-AUTH-SSH-001");
    expect(result.message).toContain("execution=ssh");
    expect(result.message).toContain("thread=thread-1");
    expect(result.message).toContain("provider=relay-1");
    expect(result.message).toContain("group=group-1");
  });

  test("identifies local authentication failures separately", () => {
    const result = detailedRpcError("401 Unauthorized", { execution: "local", method: "thread/start", stage: "create-thread" });
    expect(result.message).toContain("CUX-RPC-AUTH-LOCAL-001");
    expect(result.message).toContain("execution=local");
  });

  test("identifies remote Bun authentication failures separately", () => {
    const result = detailedRpcError("session token expired", { execution: "remote-bun", method: "thread/read" });
    expect(result.message).toContain("CUX-RPC-AUTH-REMOTE-BUN-001");
  });

  test("extracts readable cause from JSON-RPC error objects instead of [object Object]", () => {
    const rpcError = { code: -32001, message: "upstream relay returned 503" };
    const result = detailedRpcError(rpcError, { execution: "local", method: "thread/start", stage: "create-thread", providerId: "chain888", groupId: "default" });
    expect(result.message).toContain("provider=chain888");
    expect(result.message).toContain("group=default");
    expect(result.message).toContain("cause=upstream relay returned 503");
    expect(result.message).not.toContain("[object Object]");
    expect((result.data as Record<string, unknown>).upstreamCode).toBe(-32001);
  });

  test("extracts cause from nested error object shape", () => {
    const rpcError = { error: { message: "model provider unavailable" } };
    const result = detailedRpcError(rpcError, { execution: "local", method: "thread/start", stage: "create-thread", providerId: "chain888" });
    expect(result.message).toContain("cause=model provider unavailable");
    expect(result.message).not.toContain("[object Object]");
  });

  test("surfaces the offending cwd for create-thread path failures", () => {
    const result = detailedRpcError(new Error("Invalid request: AbsolutePathBuf deserialized without a base path"), { execution: "local", method: "thread/start", stage: "create-thread", providerId: "omniroute-free", detail: 'cwd="~/.opencode"' });
    expect(result.message).toContain('detail=cwd="~/.opencode"');
    expect((result.data as Record<string, unknown>).detail).toBe('cwd="~/.opencode"');
  });

  test("omits detail when not provided", () => {
    const result = detailedRpcError(new Error("boom"), { execution: "local", method: "thread/read" });
    expect(result.message).not.toContain("detail=");
    expect((result.data as Record<string, unknown>).detail).toBeUndefined();
  });
});

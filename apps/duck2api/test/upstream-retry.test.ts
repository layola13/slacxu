import { afterEach, describe, expect, test } from "bun:test";
import { postConversation, resetSession } from "../src/duckgo/upstream.js";
import type { DuckApiRequest } from "../src/duckgo/convert.js";

// Force native fetch so the global stub below is used (fetchImpl caches per
// process; no other duck2api test file touches the network).
process.env["DUCK_FETCH"] = "native";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const CHALLENGE = Buffer.from('({"client_hashes":["test"]})', "utf8").toString("base64");
const ERR_400 = '{"action":"error","status":400,"type":"ERR_BAD_REQUEST"}';

function duckReq(): DuckApiRequest {
  return {
    model: "gpt-6-luna",
    metadata: {},
    messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    canUseTools: true,
    reasoningEffort: "low",
    canUseApproxLocation: null,
    canDelegateImageGeneration: null,
    canShowGreeting: true,
    durableStream: {
      messageId: "m0",
      conversationId: "c0",
      publicKey: {
        alg: "RSA-OAEP-256",
        e: "AQAB",
        ext: true,
        key_ops: ["encrypt"],
        kty: "RSA",
        n: "test",
        use: "enc",
      },
    },
  };
}

function stubUpstream(chatImpl: (call: number, body: string) => Response) {
  let chatCalls = 0;
  const chatBodies: string[] = [];
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("/duckchat/v1/status")) {
      return new Response("", { status: 200, headers: { "x-vqd-hash-1": CHALLENGE } });
    }
    if (u.includes("/duckchat/v1/chat")) {
      chatCalls++;
      const body = typeof init?.body === "string" ? init.body : "";
      chatBodies.push(body);
      return chatImpl(chatCalls, body);
    }
    return new Response("<html></html>", { status: 200 });
  }) as typeof fetch;
  return {
    chatCount: () => chatCalls,
    chatBodies: () => chatBodies,
  };
}

describe("postConversation transient-400 retry", () => {
  test("400 then 200 recovers with fresh UUIDs", async () => {
    resetSession("retry-ok");
    const seen = stubUpstream((call) =>
      call === 1
        ? new Response(ERR_400, { status: 400 })
        : new Response("data: done", { status: 200 }),
    );
    const res = await postConversation(duckReq(), "", "retry-ok");
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    expect(seen.chatCount()).toBe(2);
    const first = JSON.parse(seen.chatBodies()[0]!) as { durableStream: { messageId: string; conversationId: string } };
    const second = JSON.parse(seen.chatBodies()[1]!) as { durableStream: { messageId: string; conversationId: string } };
    expect(second.durableStream.conversationId).not.toBe(first.durableStream.conversationId);
    expect(second.durableStream.messageId).not.toBe(first.durableStream.messageId);
    await res.body?.cancel().catch(() => undefined);
  }, 60_000);

  test("persistent 400 surfaces after exactly one retry", async () => {
    resetSession("retry-fail");
    const seen = stubUpstream(() => new Response(ERR_400, { status: 400 }));
    const res = await postConversation(duckReq(), "", "retry-fail");
    expect(res.ok).toBe(false);
    expect(res.status).toBe(400);
    expect(seen.chatCount()).toBe(2);
    expect(res.errorBody).toContain("ERR_BAD_REQUEST");
  }, 60_000);
});

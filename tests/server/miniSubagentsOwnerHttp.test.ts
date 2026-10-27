import { describe, expect, test } from "bun:test";
import { MiniBridge } from "../../backends/mini/src/runtime/miniBridge.ts";

async function startOwnerHttpFixture() {
  let snapshots: any[] = [];
  const bridge = new MiniBridge({
    onSnapshot: (snapshot) => {
      const index = snapshots.findIndex((entry) => entry.threadId === snapshot.threadId);
      if (index >= 0) snapshots[index] = snapshot;
      else snapshots.push(snapshot);
    },
    loadSnapshot: (threadId, ownerId) => snapshots.find((entry) => entry.threadId === threadId && entry.ownerId === ownerId) ?? null,
    loadMetadata: (threadId, ownerId) => snapshots.find((entry) => entry.threadId === threadId && entry.ownerId === ownerId) ?? null,
    deleteSnapshot: (threadId, ownerId) => {
      snapshots = snapshots.filter((entry) => !(entry.threadId === threadId && entry.ownerId === ownerId));
    },
    listSnapshots: (ownerId) => snapshots.filter((entry) => entry.ownerId === ownerId),
    startSubagentTurn: () => {},
  });
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      if (request.method !== "POST" || new URL(request.url).pathname !== "/rpc") return new Response("not found", { status: 404 });
      const body = await request.json() as { method?: string; params?: Record<string, unknown> };
      const ownerId = request.headers.get("x-owner-id") ?? "local";
      try {
        const result = await bridge.request(String(body.method ?? ""), { ...(body.params ?? {}), ownerId });
        return Response.json({ result });
      } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
      }
    },
  });
  return { bridge, server, url: `http://127.0.0.1:${server.port}` };
}

async function rpc(url: string, ownerId: string, method: string, params: Record<string, unknown> = {}) {
  const response = await fetch(`${url}/rpc`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-owner-id": ownerId },
    body: JSON.stringify({ method, params }),
  });
  const body = await response.json() as { result?: any; error?: string };
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
  return body.result;
}

async function expectHttpReject(url: string, ownerId: string, method: string, params: Record<string, unknown>, text: string) {
  try {
    await rpc(url, ownerId, method, params);
  } catch (error) {
    expect(String(error)).toContain(text);
    return;
  }
  throw new Error(`${method} unexpectedly succeeded for ${ownerId}`);
}

describe("mini subagent owner isolation over HTTP", () => {
  test("foreign owner cannot read/resume/direct-start an owned child", async () => {
    const fixture = await startOwnerHttpFixture();
    try {
      const ownerA = "owner-a";
      const ownerB = "owner-b";
      const started = await rpc(fixture.url, ownerA, "thread/start", { cwd: process.cwd(), model: "gpt-5-mini" });
      const parentId = started.threadId as string;
      const parent = (fixture.bridge as any).sessions.get(parentId);
      const spawned = JSON.parse(await fixture.bridge.handleMiniSubagentCall(parent, "spawn_agent", {
        task_name: "owned_child",
        message: "stay idle for owner-isolation test",
      }));
      const childId = spawned.agent_id as string;

      const ownerRead = await rpc(fixture.url, ownerA, "thread/read", { threadId: childId, includeTurns: false });
      expect(ownerRead.thread).toMatchObject({
        id: childId,
        parentThreadId: parentId,
        canAcceptDirectInput: false,
      });

      const foreignRead = await rpc(fixture.url, ownerB, "thread/read", { threadId: childId, includeTurns: false });
      expect(foreignRead.thread.id).toBe(childId);
      expect(foreignRead.thread.parentThreadId).not.toBe(parentId);
      expect(foreignRead.thread.canAcceptDirectInput).not.toBe(false);

      await expectHttpReject(fixture.url, ownerB, "thread/resume", { threadId: childId, includeTurns: false }, "thread not found");
      await expectHttpReject(fixture.url, ownerB, "turn/start", { threadId: childId, input: "foreign direct input" }, "thread not found");
      await expectHttpReject(fixture.url, ownerB, "thread/delete", { threadId: parentId }, "thread not found");
      await expectHttpReject(fixture.url, ownerA, "turn/start", { threadId: childId, input: "direct child input" }, "does not accept direct input");

      await rpc(fixture.url, ownerA, "thread/delete", { threadId: parentId });
      expect(snapshotsFor(fixture.bridge, childId)).toBe(false);
    } finally {
      fixture.server.stop(true);
    }
  });

  test("thread/delete is idempotent and late child events cannot recreate deleted state", async () => {
    const fixture = await startOwnerHttpFixture();
    try {
      const owner = "owner-delete-race";
      const started = await rpc(fixture.url, owner, "thread/start", { cwd: process.cwd(), model: "gpt-5-mini" });
      const parentId = started.threadId as string;
      const parent = (fixture.bridge as any).sessions.get(parentId);
      const spawned = JSON.parse(await fixture.bridge.handleMiniSubagentCall(parent, "spawn_agent", {
        task_name: "delete_once",
        message: "remain pending while the parent is deleted",
      }));
      const childId = spawned.agent_id as string;
      const child = (fixture.bridge as any).sessions.get(childId);
      const turnId = child.activeTurnId as string;

      await rpc(fixture.url, owner, "thread/delete", { threadId: parentId });
      await rpc(fixture.url, owner, "thread/delete", { threadId: parentId });
      expect((fixture.bridge as any).sessions.has(parentId)).toBe(false);
      expect((fixture.bridge as any).sessions.has(childId)).toBe(false);

      const internal = fixture.bridge as any;
      internal.completeTurn(child, turnId, "late completion after repeated delete");
      internal.finishMiniSubagent(child, "completed", "late report after repeated delete");
      expect((fixture.bridge as any).sessions.has(childId)).toBe(false);
      await expectHttpReject(fixture.url, owner, "thread/resume", { threadId: childId, includeTurns: false }, "thread not found");
      // Deleted threads must fail loudly (never masquerade as an empty history
      // that history restore would cache as a successful empty conversation).
      await expectHttpReject(fixture.url, owner, "thread/read", { threadId: childId, includeTurns: false }, "thread not found");
    } finally {
      fixture.server.stop(true);
    }
  });
});

function snapshotsFor(bridge: MiniBridge, threadId: string): boolean {
  const sessions = (bridge as any).sessions as Map<string, unknown>;
  return sessions.has(threadId);
}

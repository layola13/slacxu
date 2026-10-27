import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { MiniBridge, miniAnthropicBodyIssues } from "../../backends/mini/src/runtime/miniBridge.ts";
import { resolveWorkspaceMemoryFilePath } from "../../apps/server/src/saVmTool.ts";

// Upstream complaint: our messages "often change prefix", blowing up prompt-cache
// writes. Differential test: capture real /v1/responses bodies across two turns
// and diff the cache prefix (instructions + history head).
function anthropicSseAnswer(text: string): Response {
  const frames = [
    JSON.stringify({ type: "message_start", message: { id: "msg-1", usage: { input_tokens: 12, output_tokens: 0 } } }),
    JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "text" } }),
    JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } }),
    JSON.stringify({ type: "content_block_stop", index: 0 }),
    JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 6 } }),
    JSON.stringify({ type: "message_stop" }),
  ];
  return new Response(frames.map((f) => `data: ${f}\n\n`).join(""), {
    status: 200, headers: { "content-type": "text/event-stream" },
  });
}

async function setup(protocol: "responses" | "chat" | "anthropic" = "responses") {
  const cwd = mkdtempSync(join(tmpdir(), "mini-cache-prefix-"));
  const bodies: any[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    async fetch(request) {
      const body = await request.json();
      bodies.push(body);
      if (protocol === "chat") {
        return Response.json({ choices: [{ message: { content: "done" }, finish_reason: "stop" }] });
      }
      if (protocol === "anthropic") return anthropicSseAnswer("done");
      return Response.json({
        id: `resp-${bodies.length}`,
        output: [{ type: "message", content: [{ type: "output_text", text: "done" }] }],
      });
    },
  });
  const prevBoot = process.env.SA_VM_BOOTSTRAP_DISABLED;
  process.env.SA_VM_BOOTSTRAP_DISABLED = "1";
  const bridge = new MiniBridge({
    resolveRelayTarget: async () => ({
      baseUrl: `http://127.0.0.1:${server.port}/v1`, apiKey: "k",
      protocol, streamMaxRetries: 0,
    }),
  });
  const started = await bridge.request("thread/start", {
    cwd, providerId: "fixture", model: "deepseek-v3", sandbox: "read-only", approvalPolicy: "never",
  }) as { thread: { id: string } };
  const threadId = started.thread.id;
  const runTurn = (prompt: string) => new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("turn timeout")), 15_000);
    const handler = (n: any) => {
      if (n.method === "turn/completed") { clearTimeout(timer); bridge.off("notification", handler); resolve(); }
      if (n.method === "turn/failed") { clearTimeout(timer); bridge.off("notification", handler); reject(new Error(JSON.stringify(n.params))); }
    };
    bridge.on("notification", handler);
    void bridge.request("turn/start", { threadId, prompt }).catch(reject);
  });
  return {
    cwd, bodies, bridge, threadId, runTurn,
    done() {
      if (prevBoot === undefined) delete process.env.SA_VM_BOOTSTRAP_DISABLED; else process.env.SA_VM_BOOTSTRAP_DISABLED = prevBoot;
      bridge.stop(); server.stop(true); rmSync(cwd, { recursive: true, force: true });
    },
  };
}

function firstDiffOffset(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return n;
}

test("system instructions are byte-identical across turns when nothing changed", async () => {
  const t = await setup();
  try {
    await t.runTurn("hello");
    await t.runTurn("hello again");
    expect(t.bodies.length).toBeGreaterThanOrEqual(2);
    const firsts = t.bodies.filter((b) => !b.previous_response_id);
    expect(firsts.length).toBeGreaterThanOrEqual(2);
    expect(firsts[0].instructions).toBe(firsts[1].instructions);
    expect(JSON.stringify(firsts[0].tools)).toBe(JSON.stringify(firsts[1].tools));
  } finally {
    t.done();
  }
});

test("one auto-remembered memory note no longer rewrites the cached prefix", async () => {
  const t = await setup();
  try {
    await t.runTurn("hello");
    const beforeBody = t.bodies.filter((b) => !b.previous_response_id).at(-1);
    // Simulate appendServerAutoMemory firing during the turn.
    const memFile = resolveWorkspaceMemoryFilePath(t.cwd);
    mkdirSync(dirname(memFile), { recursive: true });
    writeFileSync(memFile, JSON.stringify({
      workspace: t.cwd, updated_at: Date.now(),
      notes: [{ key: "auto-1", content: "user prefers pnpm over npm for this workspace" }],
    }), "utf8");
    await t.runTurn("hello again");
    const afterBody = t.bodies.filter((b) => !b.previous_response_id).at(-1);
    // Instructions stay byte-identical: the digest moved to the input tail.
    expect(afterBody.instructions).toBe(beforeBody.instructions);
    expect(JSON.stringify(afterBody.tools)).toBe(JSON.stringify(beforeBody.tools));
    // The note still reaches the model, as the second-to-last input item.
    const items = afterBody.input as Array<{ role?: string; content?: Array<{ type?: string; text?: string }> }>;
    expect(items.length).toBeGreaterThanOrEqual(2);
    const digestItem = items[items.length - 2]!;
    expect(digestItem.role).toBe("user");
    expect(JSON.stringify(digestItem.content)).toContain("user prefers pnpm over npm");
    // Live task stays last.
    expect(JSON.stringify(items[items.length - 1]).length).toBeGreaterThan(0);
    // Full-body first difference sits past the shared history (tail only).
    const off = firstDiffOffset(JSON.stringify(beforeBody), JSON.stringify(afterBody));
    console.log(`[cache-prefix] body bytes=${JSON.stringify(beforeBody).length} first-diff-at=${off}`);
    expect(off).toBeGreaterThan((beforeBody.instructions as string).length);
  } finally {
    t.done();
  }
});

test("changed notes do not resurrect the stale digest via modelHistory replay", async () => {
  const t = await setup();
  const writeNotes = (content: string) => {
    const memFile = resolveWorkspaceMemoryFilePath(t.cwd);
    mkdirSync(dirname(memFile), { recursive: true });
    writeFileSync(memFile, JSON.stringify({
      workspace: t.cwd, updated_at: Date.now(),
      notes: [{ key: "auto-1", content }],
    }), "utf8");
  };
  try {
    writeNotes("note-alpha-prefer-pnpm");
    await t.runTurn("hello");
    writeNotes("note-beta-prefer-yarn");
    await t.runTurn("hello again");
    const bodies = t.bodies.filter((b) => !b.previous_response_id);
    expect(bodies.length).toBeGreaterThanOrEqual(2);
    const wire = JSON.stringify(bodies.at(-1));
    // Fresh note present exactly once (tail), stale note gone even though
    // the replay cache hit (system no longer contains the digest).
    expect(wire).toContain("note-beta-prefer-yarn");
    expect(wire).not.toContain("note-alpha-prefer-pnpm");
    expect(wire.split("note-beta-prefer-yarn").length - 1).toBe(1);
    expect(JSON.stringify((bodies.at(-1) as any).instructions)).not.toContain("note-beta-prefer-yarn");
  } finally {
    t.done();
  }
});

test("chat protocol: memory note keeps the system prefix stable, digest rides the tail", async () => {
  const t = await setup("chat");
  try {
    await t.runTurn("hello");
    const memFile = resolveWorkspaceMemoryFilePath(t.cwd);
    mkdirSync(dirname(memFile), { recursive: true });
    writeFileSync(memFile, JSON.stringify({
      workspace: t.cwd, updated_at: Date.now(),
      notes: [{ key: "auto-1", content: "user prefers pnpm over npm for this workspace" }],
    }), "utf8");
    await t.runTurn("hello again");
    expect(t.bodies.length).toBeGreaterThanOrEqual(2);
    const sysOf = (b: any) => String(b.messages.find((m: any) => m.role === "system")?.content ?? "");
    expect(sysOf(t.bodies[1])).toBe(sysOf(t.bodies[0]));
    expect(sysOf(t.bodies[1])).not.toContain("user prefers pnpm over npm");
    // Digest is a user message immediately before the live task message.
    const msgs = t.bodies[1].messages as Array<{ role?: string; content?: unknown }>;
    const users = msgs.map((m, i) => ({ ...m, i })).filter((m) => m.role === "user");
    const digestIdx = users.findIndex((m) => JSON.stringify(m.content).includes("user prefers pnpm over npm"));
    expect(digestIdx).toBeGreaterThanOrEqual(0);
    // Digest rides second-to-last; the live task stays last.
    expect(digestIdx).toBe(users.length - 2);
    expect(JSON.stringify(users[users.length - 1])).toContain("hello again");
  } finally {
    t.done();
  }
});

test("anthropic protocol: system stays stable, digest rides messages, wire stays valid", async () => {
  const t = await setup("anthropic");
  try {
    await t.runTurn("hello");
    const memFile = resolveWorkspaceMemoryFilePath(t.cwd);
    mkdirSync(dirname(memFile), { recursive: true });
    writeFileSync(memFile, JSON.stringify({
      workspace: t.cwd, updated_at: Date.now(),
      notes: [{ key: "auto-1", content: "user prefers pnpm over npm for this workspace" }],
    }), "utf8");
    await t.runTurn("hello again");
    expect(t.bodies.length).toBeGreaterThanOrEqual(2);
    // System prefix is byte-stable across the memory change (cache hit).
    expect(JSON.stringify(t.bodies[1].system)).toBe(JSON.stringify(t.bodies[0].system));
    expect(JSON.stringify(t.bodies[1].system)).not.toContain("user prefers pnpm over npm");
    expect(JSON.stringify(t.bodies[1].tools)).toBe(JSON.stringify(t.bodies[0].tools));
    // The note reaches the model inside messages; the live task ends the turn.
    const msgs = t.bodies[1].messages as Array<{ role?: string; content?: unknown }>;
    expect(JSON.stringify(msgs)).toContain("user prefers pnpm over npm");
    expect(msgs[msgs.length - 1]?.role).toBe("user");
    expect(JSON.stringify(msgs[msgs.length - 1])).toContain("hello again");
    expect(miniAnthropicBodyIssues(t.bodies[1])).toEqual([]);
  } finally {
    t.done();
  }
});

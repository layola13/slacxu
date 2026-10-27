import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MiniBridge } from "../../backends/mini/src/runtime/miniBridge.ts";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

function sseResponse(frames: string[]): Response {
  return new Response(frames.map((f) => `data: ${f}\n\n`).join(""), {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function textFrame(text: string): string {
  return JSON.stringify({ choices: [{ delta: { content: text } }] });
}

function toolFrame(index: number, id: string, name: string, args: Record<string, unknown>): string {
  return JSON.stringify({
    choices: [{ delta: { tool_calls: [{ index, id, function: { name, arguments: JSON.stringify(args) } }] } }],
  });
}

const DONE = "[DONE]";

function bridge(): MiniBridge {
  return new MiniBridge({
    resolveRelayTarget: async () => ({
      baseUrl: "https://relay.example/v1",
      apiKey: "k",
      protocol: "chat" as const,
      streamMaxRetries: 5,
    }),
    onSnapshot: () => {},
  });
}

async function startThread(b: MiniBridge, cwd: string): Promise<string> {
  const started = (await b.request("thread/start", { cwd, model: "test-model", providerId: "p", groupId: "g" })) as unknown as {
    thread: { id: string };
  };
  return started.thread.id;
}

interface Captured {
  method: string;
  params: Record<string, any>;
}

/**
 * Round 1: two independent sa_vm read-only calls in ONE round.
 * Round 2: final text answer.
 */
async function runTwoReadTurn(b: MiniBridge, threadId: string, fileA: string, fileB: string): Promise<{ terminal: string; notes: Captured[] }> {
  const notes: Captured[] = [];
  const onNote = (n: { method: string; params: Record<string, unknown> }) => {
    notes.push(n as Captured);
  };
  b.on("notification", onNote);
  try {
    let rounds = 0;
    globalThis.fetch = (async () => {
      rounds += 1;
      if (rounds === 1) {
        return sseResponse([
          textFrame("我来并行读取这两个文件。"),
          toolFrame(0, "call-a", "sa_vm", { action: "count_lines", path: fileA }),
          toolFrame(1, "call-b", "sa_vm", { action: "count_lines", path: fileB }),
          DONE,
        ]);
      }
      return sseResponse([textFrame("两个文件都已读取完毕。"), DONE]);
    }) as unknown as typeof fetch;
    const terminal = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timed out waiting for turn terminal event")), 15_000);
      const handler = (n: { method: string; params: Record<string, unknown> }) => {
        if (n.method === "turn/completed" || n.method === "turn/failed") {
          clearTimeout(timer);
          b.off("notification", handler);
          resolve(n.method);
        }
      };
      b.on("notification", handler);
      void b.request("turn/start", { threadId, prompt: "统计这两个文件的行数", providerId: "p", groupId: "g", model: "test-model" });
    });
    return { terminal, notes };
  } finally {
    b.off("notification", onNote);
  }
}

describe("mini parallel fan-out", () => {
  test("two read-only calls in one round announce both started before either completes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mini-fanout-"));
    try {
      const fileA = join(dir, "a.txt");
      const fileB = join(dir, "b.txt");
      writeFileSync(fileA, "one\ntwo\nthree\n", "utf8");
      writeFileSync(fileB, "alpha\nbeta\n", "utf8");

      const b = bridge();
      const threadId = await startThread(b, dir);
      const { terminal, notes } = await runTwoReadTurn(b, threadId, fileA, fileB);
      expect(terminal).toBe("turn/completed");

      const isToolStart = (n: Captured) =>
        n.method === "item/started" && (n.params?.item as Record<string, any>)?.type === "toolCall";
      const isToolDone = (n: Captured) =>
        n.method === "item/completed" && (n.params?.item as Record<string, any>)?.type === "toolCall";

      const starts = notes.filter(isToolStart);
      const dones = notes.filter(isToolDone);
      expect(starts.length).toBe(2);
      expect(dones.length).toBe(2);

      // No duplicate announcements per call.
      const startIds = starts.map((n) => String((n.params.item as Record<string, any>).id));
      expect(new Set(startIds).size).toBe(2);

      // True fan-out order: every started precedes every completed.
      const firstDoneIdx = notes.findIndex(isToolDone);
      const lastStartIdx = notes.map((n, i) => (isToolStart(n) ? i : -1)).reduce((m, i) => Math.max(m, i), -1);
      expect(lastStartIdx).toBeGreaterThanOrEqual(0);
      expect(firstDoneIdx).toBeGreaterThanOrEqual(0);
      expect(lastStartIdx).toBeLessThan(firstDoneIdx);

      // Ordered commit: completions converge in call order with real outputs.
      const doneIds = dones.map((n) => String((n.params.item as Record<string, any>).id));
      expect(doneIds[0]).toBe(startIds[0]);
      expect(doneIds[1]).toBe(startIds[1]);
      for (const n of dones) {
        expect(String((n.params.item as Record<string, any>).output ?? "")).not.toBe("");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a write still breaks the run: read+write stay sequential", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mini-fanout-seq-"));
    try {
      const fileA = join(dir, "a.txt");
      writeFileSync(fileA, "hello\n", "utf8");
      const target = join(dir, "out.txt");

      const b = bridge();
      const threadId = await startThread(b, dir);
      const notes: Captured[] = [];
      const onNote = (n: { method: string; params: Record<string, unknown> }) => {
        notes.push(n as Captured);
      };
      b.on("notification", onNote);
      try {
        let rounds = 0;
        globalThis.fetch = (async () => {
          rounds += 1;
          if (rounds === 1) {
            return sseResponse([
              textFrame("先读后写。"),
              toolFrame(0, "call-a", "sa_vm", { action: "read_file", path: fileA }),
              toolFrame(1, "call-b", "sa_vm", { action: "write_file", path: target, content: "written\n" }),
              DONE,
            ]);
          }
          return sseResponse([textFrame("读写完成。"), DONE]);
        }) as unknown as typeof fetch;
        const terminal = await new Promise<string>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("timed out waiting for turn terminal event")), 15_000);
          const handler = (n: { method: string; params: Record<string, unknown> }) => {
            if (n.method === "turn/completed" || n.method === "turn/failed") {
              clearTimeout(timer);
              b.off("notification", handler);
              resolve(n.method);
            }
          };
          b.on("notification", handler);
          void b.request("turn/start", { threadId, prompt: "读一个文件再写一个文件", providerId: "p", groupId: "g", model: "test-model" });
        });
        expect(terminal).toBe("turn/completed");
      } finally {
        b.off("notification", onNote);
      }

      const isToolStart = (n: Captured) =>
        n.method === "item/started" && (n.params?.item as Record<string, any>)?.type === "toolCall";
      const isToolDone = (n: Captured) =>
        n.method === "item/completed" && (n.params?.item as Record<string, any>)?.type === "toolCall";
      const starts = notes.filter(isToolStart);
      const dones = notes.filter(isToolDone);
      expect(starts.length).toBe(2);
      expect(dones.length).toBe(2);
      // Sequential: first call completes before the write is even announced.
      const firstDoneIdx = notes.findIndex(isToolDone);
      const startIdx = notes.map((n, i) => (isToolStart(n) ? i : -1)).filter((i) => i >= 0);
      expect(startIdx.length).toBe(2);
      expect(firstDoneIdx).toBeGreaterThan(startIdx[0]);
      expect(firstDoneIdx).toBeLessThan(startIdx[1]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

import { afterEach, describe, expect, test } from "bun:test";
import {
  MiniBridge,
  isMiniImageUnsupportedError,
  stripMiniThreadImages,
  type MiniSnapshot,
} from "../../backends/mini/src/runtime/miniBridge.ts";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

type Notice = { method: string; params: Record<string, unknown> };

function sseResponse(frames: string[]): Response {
  return new Response(frames.map((frame) => `data: ${frame}\n\n`).join(""), {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function imageRejected(): Response {
  return new Response(
    JSON.stringify({ error: { message: 'Cannot read "image" (this model does not support image input). Inform the user.' } }),
    { status: 400, headers: { "content-type": "application/json" } },
  );
}

function okAnswer(text: string): Response {
  return sseResponse([
    JSON.stringify({ choices: [{ delta: { content: text } }] }),
    JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] }),
    "[DONE]",
  ]);
}

describe("isMiniImageUnsupportedError", () => {
  test("matches the reported upstream rejection and its relay variants", () => {
    expect(isMiniImageUnsupportedError(new Error('Cannot read "image" (this model does not support image input). Inform the user.'))).toBe(true);
    expect(isMiniImageUnsupportedError(new Error("responses 400: this model does not support image input"))).toBe(true);
    expect(isMiniImageUnsupportedError(new Error("chat 400: unsupported content part: image"))).toBe(true);
    expect(isMiniImageUnsupportedError(new Error("image_url is not supported for this model"))).toBe(true);
    expect(isMiniImageUnsupportedError(new Error("vision input is not supported"))).toBe(true);
    expect(isMiniImageUnsupportedError(new Error("该模型不支持图片输入"))).toBe(true);
    expect(isMiniImageUnsupportedError("plain string: does not support images")).toBe(true);
  });

  test("leaves unrelated failures alone", () => {
    expect(isMiniImageUnsupportedError(new Error("chat 401: invalid api key"))).toBe(false);
    expect(isMiniImageUnsupportedError(new Error("relay unavailable (503)"))).toBe(false);
    expect(isMiniImageUnsupportedError(new Error("terminated: socket hang up"))).toBe(false);
    expect(isMiniImageUnsupportedError(new Error("images: 2 generated"))).toBe(false);
    expect(isMiniImageUnsupportedError(undefined)).toBe(false);
  });
});

describe("stripMiniThreadImages", () => {
  test("removes image parts, keeps text, and drops image-only messages", () => {
    const thread = [
      { role: "system", content: "rules" },
      { role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64,AAA" } }] },
      {
        role: "user",
        content: [
          { type: "text", text: "what is this?" },
          { type: "input_image", image_url: "data:image/png;base64,BBB", detail: "auto" },
        ],
      },
      { role: "assistant", content: [{ type: "output_text", text: "ok" }] },
    ];
    const dropped = stripMiniThreadImages(thread);
    expect(dropped).toBe(2);
    expect(thread).toHaveLength(3);
    expect(thread[1]).toEqual({ role: "user", content: [{ type: "text", text: "what is this?" }] });
    expect(thread[2]).toEqual({ role: "assistant", content: [{ type: "output_text", text: "ok" }] });
  });

  test("returns 0 for a thread that carries no images", () => {
    const thread = [{ role: "user", content: [{ type: "text", text: "hi" }] }];
    expect(stripMiniThreadImages(thread)).toBe(0);
    expect(thread).toHaveLength(1);
  });
});

describe("mini turn with an image the model cannot read", () => {
  function harness(): {
    bridge: MiniBridge;
    bodies: string[];
    notifications: Notice[];
    snapshot: () => MiniSnapshot | null;
    threadId: () => string;
    runTurn: (input: Array<Record<string, unknown>>) => Promise<Record<string, unknown>>;
  } {
    const bodies: string[] = [];
    const notifications: Notice[] = [];
    let saved: MiniSnapshot | null = null;
    const bridge = new MiniBridge({
      resolveRelayTarget: async () => ({
        baseUrl: "https://relay.example/v1",
        apiKey: "k",
        protocol: "chat" as const,
        streamMaxRetries: 5,
      }),
      onSnapshot: (snap) => { saved = snap; },
    });
    bridge.on("notification", (notification: Notice) => notifications.push(notification));
    const ref: { id: string } = { id: "" };
    return {
      bridge,
      bodies,
      notifications,
      setThreadId: (id: string) => { ref.id = id; },
      threadId: () => ref.id,
      snapshot: () => saved,
      runTurn: async (input) => {
        const terminalPromise = new Promise<Record<string, unknown>>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("timed out waiting for turn terminal event")), 15_000);
          const handler = (notification: Notice) => {
            if ((notification.method === "turn/completed" || notification.method === "turn/failed") && notification.params.turnId) {
              clearTimeout(timer);
              bridge.off("notification", handler);
              resolve({ method: notification.method, params: notification.params });
            }
          };
          bridge.on("notification", handler);
        });
        await bridge.request("turn/start", { threadId: ref.id, input, providerId: "p", groupId: "g", model: "text-only-model" });
        return terminalPromise;
      },
    };
  }

  async function startThread(): Promise<ReturnType<typeof harness>> {
    const state = harness();
    const started = (await state.bridge.request("thread/start", {
      cwd: process.cwd(),
      model: "text-only-model",
      providerId: "p",
      groupId: "g",
    })) as unknown as { thread: { id: string } };
    state.setThreadId(started.thread.id);
    return state;
  }

  test("completes the turn, drops the image, and tells the user", async () => {
    const state = await startThread();
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      state.bodies.push(String(init?.body ?? ""));
      if (state.bodies.length === 1) return imageRejected();
      return okAnswer("answered without the image");
    }) as typeof fetch;

    const terminal = await state.runTurn([
      { type: "text", text: "what is in this picture?" },
      { type: "image", url: "data:image/png;base64,AAAA" },
    ]);

    expect(terminal.method).toBe("turn/completed");
    expect(state.bodies).toHaveLength(2);
    expect(state.bodies[0]).toContain("data:image/png;base64,AAAA");
    // The retry is text-only: no image part survives on the wire.
    expect(state.bodies[1]).not.toContain("data:image/png;base64,AAAA");
    expect(state.bodies[1]).toContain("what is in this picture?");

    const notice = state.notifications.find((notification) =>
      notification.method === "item/completed"
      && String((notification.params.item as Record<string, unknown>)?.id ?? "").startsWith("mini-image-note-"),
    );
    expect(notice).toBeDefined();
    const noticeItem = notice?.params.item as Record<string, unknown>;
    expect(noticeItem.title).toBe("Attached image skipped");
    expect(noticeItem.status).toBe("completed");
    expect(noticeItem.type).not.toBe("error");
    expect((noticeItem.payload as Record<string, unknown>).imageInputUnsupported).toBe(true);
    // A completed notice keeps the failed-turn recovery planner from reading
    // the still-running turn as dead.
    expect(String(noticeItem.text)).not.toMatch(/stream connection failed|error sending request|waiting to retry/i);

    // The stored transcript still carries the attachment for the UI.
    const sessions = (state.bridge as unknown as { sessions: Map<string, { messages: Array<Record<string, unknown>> }> }).sessions;
    const stored = sessions.get(state.threadId());
    expect(JSON.stringify(stored?.messages ?? [])).toContain("data:image/png;base64,AAAA");
    // The downgrade is persisted so a restart does not replay the attachment.
    expect(state.snapshot()?.imageInputUnsupported).toBe(true);
  }, 30_000);

  test("later turns stay text-only without another rejected request", async () => {
    const state = await startThread();
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      state.bodies.push(String(init?.body ?? ""));
      if (state.bodies.length === 1) return imageRejected();
      return okAnswer(`answer ${state.bodies.length}`);
    }) as typeof fetch;

    const first = await state.runTurn([
      { type: "text", text: "what is in this picture?" },
      { type: "image", url: "data:image/png;base64,AAAA" },
    ]);
    expect(first.method).toBe("turn/completed");
    expect(state.bodies).toHaveLength(2);

    const second = await state.runTurn([
      { type: "text", text: "and now summarize it" },
      { type: "image", url: "data:image/png;base64,BBBB" },
    ]);
    expect(second.method).toBe("turn/completed");
    // Exactly one request for the follow-up turn: no rejected attempt, because
    // the new attachment (and the replayed historical one) never left the server.
    expect(state.bodies).toHaveLength(3);
    expect(state.bodies[2]).not.toContain("data:image/png;base64");
    expect(state.bodies[2]).toContain("and now summarize it");
  }, 30_000);

  test("recovers on the Responses protocol too", async () => {
    const bodies: string[] = [];
    const notifications: Notice[] = [];
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      bodies.push(String(init?.body ?? ""));
      if (bodies.length === 1) return imageRejected();
      return sseResponse([
        JSON.stringify({ type: "response.output_text.delta", delta: "answered without the image" }),
        JSON.stringify({ type: "response.completed", response: { id: "response-1", output: [] } }),
      ]);
    }) as typeof fetch;

    const bridge = new MiniBridge({
      resolveRelayTarget: async () => ({
        baseUrl: "https://relay.example/v1",
        apiKey: "k",
        protocol: "responses" as const,
        streamMaxRetries: 5,
      }),
      onSnapshot: () => {},
    });
    bridge.on("notification", (notification: Notice) => notifications.push(notification));
    const started = (await bridge.request("thread/start", {
      cwd: process.cwd(), model: "text-only-model", providerId: "p", groupId: "g",
    })) as unknown as { thread: { id: string } };
    const terminalPromise = new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timed out waiting for turn terminal event")), 15_000);
      const handler = (notification: Notice) => {
        if ((notification.method === "turn/completed" || notification.method === "turn/failed") && notification.params.turnId) {
          clearTimeout(timer);
          bridge.off("notification", handler);
          resolve({ method: notification.method, params: notification.params });
        }
      };
      bridge.on("notification", handler);
    });
    await bridge.request("turn/start", {
      threadId: started.thread.id,
      input: [
        { type: "text", text: "what is in this picture?" },
        { type: "image", url: "data:image/png;base64,AAAA" },
      ],
      providerId: "p",
      groupId: "g",
      model: "text-only-model",
    });
    const terminal = await terminalPromise;

    expect(terminal.method).toBe("turn/completed");
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toContain("data:image/png;base64,AAAA");
    expect(bodies[1]).not.toContain("data:image/png;base64,AAAA");
    // The rewritten input invalidates the stored response, so the retry is a
    // full send rather than a `previous_response_id` chain.
    expect(bodies[1]).not.toContain("previous_response_id");
    expect(notifications.some((notification) =>
      notification.method === "item/completed"
      && String((notification.params.item as Record<string, unknown>)?.id ?? "").startsWith("mini-image-note-"),
    )).toBe(true);
  }, 30_000);
});
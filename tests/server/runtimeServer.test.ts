import { expect, test } from "bun:test";
import { createServer, get } from "node:http";
import { writeNodeResponse } from "../../apps/server/src/runtime/server.ts";

test("contains an upstream stream failure and keeps the Node HTTP service alive", async () => {
  let requestCount = 0;
  const server = createServer((_, response) => {
    requestCount += 1;
    if (requestCount === 1) {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("data: partial\n\n"));
          setTimeout(() => controller.error(new TypeError("terminated")), 25);
        }
      });
      void writeNodeResponse(response, new Response(body, {
        headers: { "content-type": "text/event-stream" }
      }));
      return;
    }
    void writeNodeResponse(response, new Response("healthy"));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test server address");
    const interrupted = get(`http://127.0.0.1:${address.port}/stream`, { agent: false }, (response) => {
      response.resume();
      response.on("error", () => undefined);
    });
    interrupted.on("error", () => undefined);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const healthy = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const request = get(`http://127.0.0.1:${address.port}/health`, { agent: false }, (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.once("end", () => resolve({
          status: response.statusCode ?? 0,
          body: Buffer.concat(chunks).toString("utf8")
        }));
      });
      request.once("error", reject);
      request.setTimeout(2_000, () => request.destroy(new Error("Health request timed out")));
    });
    expect(healthy.status).toBe(200);
    expect(healthy.body).toBe("healthy");
    interrupted.destroy();
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test("cancels the upstream body when the client socket is already gone", async () => {
  const crashes: unknown[] = [];
  const collectCrash = (error: unknown) => crashes.push(error);
  process.on("uncaughtException", collectCrash);
  const warnings: unknown[] = [];
  const realWarn = console.warn;
  console.warn = (...args: unknown[]) => { warnings.push(args[0]); };
  let piped: Promise<void> | undefined;
  let cancelled: unknown;
  const server = createServer((_, response) => {
    // The client hung up before the relay produced a body, so `pipeline` would reject
    // before it ever owns the upstream stream.
    response.destroy();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        setTimeout(() => controller.error(new TypeError("terminated")), 25);
      },
      cancel(reason) {
        cancelled = reason ?? "client gone";
      }
    });
    piped = writeNodeResponse(response, new Response(body, {
      headers: { "content-type": "text/event-stream" }
    }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test server address");
    const aborted = get(`http://127.0.0.1:${address.port}/stream`, { agent: false }, (response) => response.resume());
    aborted.on("error", () => undefined);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(piped).toBeDefined();
    await expect(piped).resolves.toBeUndefined();
    expect(cancelled).toBeDefined();
    // No pipe is attempted at all, so the upstream body is never left dangling.
    expect(warnings).toEqual([]);
    expect(crashes).toEqual([]);
    aborted.destroy();
  } finally {
    console.warn = realWarn;
    process.off("uncaughtException", collectCrash);
    server.closeAllConnections();
    server.close();
  }
});

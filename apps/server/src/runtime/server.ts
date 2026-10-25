import { createServer as createNodeServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { WebSocketServer, type WebSocket } from "ws";
import { isBunRuntime } from "./index.js";

export type RuntimeSocket<T> = WebSocket & {
  data: T;
  remoteAddress: string;
  serverCloseReason?: string | null;
  getBufferedAmount?: () => number;
};

export type RuntimeServer<T> = {
  port: number;
  requestIP(request: Request): { address: string } | null;
  upgrade(request: Request, options: { data: T }): boolean;
  stop(): void;
};

type RuntimeServerOptions<T> = {
  hostname: string;
  port: number;
  /** Bun's idle timeout is in seconds and must cover long-poll API waits. */
  idleTimeoutSeconds?: number;
  maxPayloadLength: number;
  backpressureLimit: number;
  fetch(request: Request, server: RuntimeServer<T>): Promise<Response | undefined> | Response | undefined;
  websocket: {
    open(socket: RuntimeSocket<T>): void;
    message(socket: RuntimeSocket<T>, raw: string | Buffer | ArrayBuffer | Uint8Array): void | Promise<void>;
    close(socket: RuntimeSocket<T>, code: number, reason: string): void;
  };
};

export async function startRuntimeServer<T>(options: RuntimeServerOptions<T>): Promise<RuntimeServer<T>> {
  return isBunRuntime ? startBunServer(options) : startNodeServer(options);
}

function startBunServer<T>(options: RuntimeServerOptions<T>): RuntimeServer<T> {
  const bun = (globalThis as { Bun: typeof Bun }).Bun;
  let runtime!: RuntimeServer<T>;
  const server = bun.serve<T>({
    hostname: options.hostname,
    port: options.port,
    idleTimeout: options.idleTimeoutSeconds ?? 45,
    fetch: (request) => options.fetch(request, runtime),
    websocket: {
      maxPayloadLength: options.maxPayloadLength,
      backpressureLimit: options.backpressureLimit,
      closeOnBackpressureLimit: true,
      open: (socket) => options.websocket.open(socket as unknown as RuntimeSocket<T>),
      message: (socket, raw) => options.websocket.message(socket as unknown as RuntimeSocket<T>, raw),
      close: (socket, code, reason) => options.websocket.close(socket as unknown as RuntimeSocket<T>, code, reason)
    }
  });
  runtime = {
    port: server.port ?? options.port,
    requestIP: (request) => server.requestIP(request),
    upgrade: (request, upgradeOptions) => (server.upgrade as (request: Request, options: { data: T }) => boolean)(request, upgradeOptions),
    stop: () => server.stop()
  };
  return runtime;
}

async function startNodeServer<T>(options: RuntimeServerOptions<T>): Promise<RuntimeServer<T>> {
  const requestAddresses = new WeakMap<Request, string>();
  const pendingUpgrades = new WeakMap<Request, { request: IncomingMessage; socket: any; head: Buffer }>();
  const webSockets = new WebSocketServer({ noServer: true, maxPayload: options.maxPayloadLength });
  let port = options.port;

  let server: ReturnType<typeof createNodeServer>;
  const runtime: RuntimeServer<T> = {
    get port() { return port; },
    requestIP(request) {
      const address = requestAddresses.get(request);
      return address ? { address } : null;
    },
    upgrade(request, upgradeOptions) {
      const pending = pendingUpgrades.get(request);
      if (!pending) return false;
      pendingUpgrades.delete(request);
      webSockets.handleUpgrade(pending.request, pending.socket, pending.head, (nativeSocket) => {
        const socket = nativeSocket as RuntimeSocket<T>;
        socket.data = upgradeOptions.data;
        socket.remoteAddress = pending.request.socket.remoteAddress ?? "";
        socket.getBufferedAmount = () => socket.bufferedAmount;
        nativeSocket.on("message", (raw) => void options.websocket.message(socket, Array.isArray(raw) ? Buffer.concat(raw) : raw));
        nativeSocket.on("close", (code, reason) => options.websocket.close(socket, code, reason.toString()));
        options.websocket.open(socket);
      });
      return true;
    },
    stop() {
      webSockets.close();
      server.close();
    }
  };

  const processRequest = async (incoming: IncomingMessage, response?: ServerResponse, upgrade?: { socket: any; head: Buffer }) => {
    const request = nodeRequest(incoming, options.hostname, port, Boolean(upgrade));
    requestAddresses.set(request, incoming.socket.remoteAddress ?? "");
    if (upgrade) pendingUpgrades.set(request, { request: incoming, ...upgrade });
    const result = await Promise.resolve(options.fetch(request, runtime)).catch((error: unknown) => new Response(String(error), { status: 500 }));
    if (upgrade && !pendingUpgrades.has(request)) return;
    if (upgrade) pendingUpgrades.delete(request);
    const outgoing = result ?? new Response(null, { status: 204 });
    if (response) {
      await writeNodeResponse(response, outgoing);
    } else {
      const body = Buffer.from(await outgoing.arrayBuffer());
      const headers = Array.from(outgoing.headers.entries() as Iterable<[string, string]>).map(([key, value]) => `${key}: ${value}`).join("\r\n");
      upgrade?.socket.end(`HTTP/1.1 ${outgoing.status} ${outgoing.statusText}\r\n${headers}\r\nContent-Length: ${body.length}\r\n\r\n`, body);
    }
  };

  server = createNodeServer((request, response) => {
    void processRequest(request, response).catch((error: unknown) => finishFailedNodeRequest(response, error));
  });
  server.on("upgrade", (request, socket, head) => {
    void processRequest(request, undefined, { socket, head }).catch((error: unknown) => {
      console.warn("[runtime] WebSocket upgrade failed", error);
      if (!socket.destroyed) socket.destroy();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.hostname, () => {
      server.off("error", reject);
      const address = server.address();
      if (address && typeof address === "object") port = address.port;
      resolve();
    });
  });
  return runtime;
}

function nodeRequest(incoming: IncomingMessage, hostname: string, port: number, upgrade: boolean): Request {
  const headers = new Headers();
  for (const [key, value] of Object.entries(incoming.headers)) {
    if (Array.isArray(value)) value.forEach((entry) => headers.append(key, entry));
    else if (value !== undefined) headers.set(key, value);
  }
  const protocol = upgrade ? "http" : ((incoming.socket as { encrypted?: boolean }).encrypted ? "https" : "http");
  const url = `${protocol}://${headers.get("host") || `${hostname}:${port}`}${incoming.url || "/"}`;
  const method = incoming.method || "GET";
  const hasBody = method !== "GET" && method !== "HEAD";
  return new Request(url, {
    method,
    headers,
    ...(hasBody ? { body: Readable.toWeb(incoming) as unknown as ReadableStream, duplex: "half" } : {})
  } as RequestInit & { duplex?: "half" });
}

export async function writeNodeResponse(target: ServerResponse, response: Response): Promise<void> {
  target.statusCode = response.status;
  target.statusMessage = response.statusText;
  response.headers.forEach((value, key) => target.setHeader(key, value));
  if (!response.body) {
    target.end();
    return;
  }
  if (target.closed || target.destroyed || target.writableEnded) {
    // The client hung up while the relay was still producing this response.
    // `pipeline` rejects with ERR_STREAM_UNABLE_TO_PIPE before it owns the source
    // stream, which would leave the upstream body unread, unlocked from cancellation
    // and without an error listener: a later relay body timeout then surfaces as an
    // unhandled 'error' event and terminates the desktop service.
    await response.body.cancel().catch(() => undefined);
    return;
  }
  const source = Readable.fromWeb(response.body as unknown as import("node:stream/web").ReadableStream);
  // `pipeline` can also reject without ever owning the source, so keep a listener
  // on it: an unhandled 'error' on this stream would take the whole process down.
  source.on("error", () => undefined);
  try {
    await pipeline(source, target);
  } catch (error) {
    // A relay can close an SSE/TLS stream after headers were received. This is
    // a request-level failure, not a reason to reject the detached HTTP handler
    // promise and terminate the desktop service through unhandledRejection.
    if (!source.destroyed) source.destroy();
    await response.body.cancel(error).catch(() => undefined);
    if (!target.destroyed && !target.writableEnded) {
      if (!target.headersSent) {
        target.statusCode = 502;
        target.removeHeader("content-length");
        target.setHeader("content-type", "text/plain; charset=utf-8");
        target.end("Upstream response stream terminated");
      } else {
        target.destroy(error instanceof Error ? error : undefined);
      }
    }
    console.warn("[runtime] Response stream ended unexpectedly", error);
  }
}

function finishFailedNodeRequest(target: ServerResponse, error: unknown): void {
  console.warn("[runtime] HTTP request failed", error);
  if (target.destroyed || target.writableEnded) return;
  if (target.headersSent) {
    target.destroy(error instanceof Error ? error : undefined);
    return;
  }
  target.statusCode = 500;
  target.setHeader("content-type", "text/plain; charset=utf-8");
  target.end("Internal server error");
}

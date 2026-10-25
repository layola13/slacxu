import type http from "node:http";

export function isAgyGeminiEndpoint(path: string): boolean {
  return /^\/v1(?:beta)?\//.test(path) || path.startsWith("/models/");
}

export function formatAgyGeminiResponse(value: any, isGeminiEndpoint: boolean): any {
  const response = value?.response && typeof value.response === "object" ? value.response : value;
  return isGeminiEndpoint ? response : { response };
}

export async function forwardAgyGeminiStream(
  body: ReadableStream<Uint8Array>,
  res: http.ServerResponse,
  isGeminiEndpoint: boolean
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const writeEvent = (event: string): void => {
    const lines = event.split(/\r?\n/);
    const data = lines.filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
    if (!data || data === "[DONE]") {
      if (event) res.write(`${event}\n\n`);
      return;
    }
    const parsed = JSON.parse(data);
    const metadata = lines.filter((line) => !line.startsWith("data:")).join("\n");
    if (metadata) res.write(`${metadata}\n`);
    res.write(`data: ${JSON.stringify(formatAgyGeminiResponse(parsed, isGeminiEndpoint))}\n\n`);
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let boundary: RegExpExecArray | null;
      while ((boundary = /\r?\n\r?\n/.exec(buffer)) !== null) {
        writeEvent(buffer.slice(0, boundary.index));
        buffer = buffer.slice(boundary.index + boundary[0].length);
      }
      if (done) break;
    }
    if (buffer.trim()) writeEvent(buffer);
  } finally {
    reader.releaseLock();
  }
}

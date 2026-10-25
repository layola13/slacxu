import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface AgyLineCapture {
  push(line: string): void;
  lines(): string[];
  size(): number;
  clear(): void;
}

const DEFAULT_MAX_LINES = 400;
const MAX_LINE_CHARS = 64 * 1024;
const MAX_TOTAL_CHARS = 512 * 1024;

export function createAgyLineCapture(maxLines = DEFAULT_MAX_LINES): AgyLineCapture {
  const cap = Number.isFinite(maxLines) && maxLines > 0 ? Math.floor(maxLines) : DEFAULT_MAX_LINES;
  let buffer: string[] = [];
  let totalChars = 0;
  return {
    push(line: string): void {
      const text = typeof line === "string" ? line : String(line ?? "");
      const stored = text.length > MAX_LINE_CHARS ? text.slice(0, MAX_LINE_CHARS) : text;
      buffer.push(stored);
      totalChars += stored.length;
      while (buffer.length > cap || totalChars > MAX_TOTAL_CHARS) {
        const dropped = buffer.shift();
        totalChars -= dropped?.length ?? 0;
      }
    },
    lines(): string[] {
      return buffer.slice();
    },
    size(): number {
      return buffer.length;
    },
    clear(): void {
      buffer = [];
      totalChars = 0;
    },
  };
}

export function shouldDumpAgyCapture(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.AGY_DEBUG_CAPTURE === "1";
}

export function resolveAgyCaptureDir(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.AGY_CAPTURE_DIR?.trim();
  return configured ? configured : join(tmpdir(), "agy-captures");
}

export function sanitizeAgyCaptureName(value: string): string {
  const cleaned = String(value ?? "").replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 80);
  return cleaned || "unknown";
}

export async function dumpAgyCapture(
  threadId: string,
  turnId: string,
  lines: string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | null> {
  try {
    const dir = resolveAgyCaptureDir(env);
    await mkdir(dir, { recursive: true });
    const file = join(dir, `${sanitizeAgyCaptureName(threadId)}-${sanitizeAgyCaptureName(turnId)}.jsonl`);
    const body = lines.map((line) => JSON.stringify({ line })).join("\n") + "\n";
    await writeFile(file, body, "utf8");
    return file;
  } catch {
    return null;
  }
}

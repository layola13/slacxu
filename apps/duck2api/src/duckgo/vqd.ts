import { createHash } from "node:crypto";
import vm from "node:vm";
import { VQD_BROWSER_PRELUDE, VQD_RESULT_MUTATION_SCRIPT } from "./vqd-scripts.js";

// Port of E:\projects\duck2api\internal\duckgo\vqd.go.
// Go used goja; here the SAME challenge JS runs in a node:vm sandbox with the
// SAME browser prelude (extracted byte-identical), so challenge behavior is
// unchanged. Only the Go helper injections are reimplemented natively.

const DEFAULT_VQD_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";
const DEFAULT_VQD_STACK =
  "Error\nat l (https://duck.ai/dist/duckai-dist/entry.duckai.c0a8c794abcbc8ee2d3c.js:2:1446307)\nat async https://duck.ai/dist/duckai-dist/entry.duckai.c0a8c794abcbc8ee2d3c.js:2:1294181";
const DEFAULT_VQD_ORIGIN = "https://duck.ai";

function vqdUserAgent(): string {
  return process.env["X_USER_AGENT"] || DEFAULT_VQD_USER_AGENT;
}

function vqdStack(): string {
  return process.env["X_VQD_STACK"] || DEFAULT_VQD_STACK;
}

function vqdOrigin(): string {
  return process.env["X_VQD_ORIGIN"] || DEFAULT_VQD_ORIGIN;
}

export function goSha256Base64(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("base64");
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

/**
 * GenerateVQDHash: base64-decoded server challenge -> sandboxed JS execution
 * -> SHA-256/base64 per client_hash + meta -> base64 response header value.
 * Error fallback matches Go/JS c() format: btoa(js + "::" + msg + "::" + stack + "::" + origin).
 */
export async function generateVQDHash(vqdHashRequest: string): Promise<string> {
  if (!vqdHashRequest) throw new Error("empty vqd hash request");
  let jsCode: string;
  try {
    jsCode = Buffer.from(vqdHashRequest, "base64").toString("utf8");
  } catch (err) {
    throw new Error(`decode vqd hash request: ${String(err)}`);
  }

  try {
    const payload = await executeVQDHashScript(jsCode);
    return Buffer.from(payload, "utf8").toString("base64");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const fallback = `${jsCode}::${message}::${vqdStack()}::${vqdOrigin()}`;
    return Buffer.from(fallback, "utf8").toString("base64");
  }
}

async function executeVQDHashScript(jsCode: string): Promise<string> {
  const startMs = Date.now();
  const sandbox: Record<string, unknown> = {
    __goUserAgent: vqdUserAgent(),
    __goOrigin: vqdOrigin(),
    __goStack: vqdStack(),
    __goSha256Base64: (value: unknown) => goSha256Base64(String(value)),
    __goBtoa: (value: unknown) => Buffer.from(String(value), "utf8").toString("base64"),
    __goAtob: (value: unknown) => Buffer.from(String(value), "base64").toString("utf8"),
  };
  const context = vm.createContext(sandbox);

  try {
    vm.runInContext(VQD_BROWSER_PRELUDE, context, { timeout: 5000 });
  } catch (err) {
    throw new Error(`initialize vqd browser mock: ${jsErrorString(err)}`);
  }

  let value: unknown;
  try {
    value = vm.runInContext(jsCode, context, { timeout: 5000 });
  } catch (err) {
    throw new Error(`execute vqd hash script: ${jsErrorString(err)}`);
  }

  // Challenge may return a Promise (mocked timers resolve synchronously, but
  // crypto.subtle.digest is async by shape) — await the thenable outside with
  // its own timeout: vm timeouts do not cover an externally awaited promise
  // that never settles.
  if (value !== null && (typeof value === "object" || typeof value === "function")) {
    const then = (value as Record<string, unknown>)["then"];
    if (typeof then === "function") {
      try {
        value = await withTimeout(value as Promise<unknown>, 5000, "vqd hash script did not resolve");
      } catch (err) {
        throw new Error(`vqd hash script rejected: ${jsErrorString(err)}`);
      }
    }
  }

  const durationMs = Date.now() - startMs;
  // OmniRoute parity (#9866/#9733 418 fix): challenge solver must stamp
  // client_hashes[0] with the real UA before hashing. The auto-generated
  // mutation script hashes verbatim (Go behavior); without this the vector
  // differs from a real browser and upstream returns 418 ERR_CHALLENGE.
  // Keep vqd-scripts.ts byte-identical to Go; override here in host layer.
  try {
    const rec = value as Record<string, unknown> | null;
    if (rec && Array.isArray(rec["client_hashes"]) && rec["client_hashes"].length > 0) {
      (rec["client_hashes"] as unknown[])[0] = vqdUserAgent();
    }
  } catch {
    // Non-object challenge result: let mutation script throw the typed error.
  }
  // The sandbox object was contextified: plain assignments are visible as
  // globals inside the vm.
  sandbox["__vqd_result"] = value;
  return runMutation(context, durationMs);
}

function runMutation(context: vm.Context, durationMs: number): string {
  // The mutation script reads __vqd_result / __go* helpers / __vqdDurationMs
  // from its scope; expose the duration the same way.
  vm.runInContext(`var __vqdDurationMs = ${JSON.stringify(String(durationMs))};`, context);
  let payload: unknown;
  try {
    payload = vm.runInContext(VQD_RESULT_MUTATION_SCRIPT, context, { timeout: 5000 });
  } catch (err) {
    throw new Error(`encode vqd hash result: ${jsErrorString(err)}`);
  }
  if (payload === undefined || payload === null) {
    throw new Error("vqd hash script returned an empty result");
  }
  return String(payload);
}

function jsErrorString(err: unknown): string {
  if (err instanceof Error) {
    const withStack = err as Error & { stack?: unknown };
    if (typeof withStack.stack === "string" && withStack.stack) return withStack.stack;
    return err.message;
  }
  if (err !== null && typeof err === "object") {
    const rec = err as Record<string, unknown>;
    if (typeof rec["stack"] === "string" && rec["stack"]) return rec["stack"] as string;
    if (typeof rec["message"] === "string" && rec["message"]) return rec["message"] as string;
  }
  return "<empty>";
}

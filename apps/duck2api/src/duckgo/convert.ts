import { generateKeyPairSync } from "node:crypto";
import { randomUUID } from "node:crypto";
import type { ApiMessage, APIRequest } from "../types.js";

// Port of E:\projects\duck2api\conversion\requests\duckgo\convert.go and
// E:\projects\duck2api\typings\duckgo\request.go (JSON shapes use the Go tags).

export interface DuckContentPart {
  type: string; // "text" | "image" | "file"
  text?: string;
  image?: string;
  mimeType?: string;
  filename?: string;
}

export interface DuckMessage {
  role: string;
  content: string | DuckContentPart[];
}

export interface DuckApiRequest {
  model: string;
  // Real duck.ai frontend (gpt-6-luna captures) always sends "metadata":{},
  // even for search queries like "搜索广州天气". Search auto-triggers
  // server-side; explicit false flags would suppress it, so toolChoice is
  // only present when the caller explicitly requests web search.
  metadata: { toolChoice?: Record<string, boolean> };
  messages: DuckMessage[];
  canUseTools: boolean;
  reasoningEffort: string;
  canUseApproxLocation: boolean | null;
  canDelegateImageGeneration: boolean | null;
  /** Matches real duck.ai frontend (gpt-6-luna capture): always true. */
  canShowGreeting: boolean;
  durableStream: {
    messageId: string;
    conversationId: string;
    publicKey: Record<string, unknown>;
  };
  /** Local-only (json:"-"): playgame tool simulation active. */
  toolSimulation?: boolean;
}

export type FileLookup = (fileID: string) =>
  | { filename: string; mimeType: string; data: Uint8Array }
  | undefined;

export function capReasoningEffort(effort: string): string {
  switch (effort.toLowerCase().trim()) {
    case "":
      return "low"; // default thinking mode
    case "none":
      return "none";
    case "low":
    case "medium":
    case "high":
      return "low";
    default:
      return "low";
  }
}

function mapModel(inputModel: string): string {
  const lower = inputModel.toLowerCase();
  // Backward compat: old threads may still select the delisted flagship.
  if (lower === "gpt-5.6-luna" || lower === "gpt-5.6-luna-thinking") return "gpt-6-luna";
  if (lower.startsWith("gpt-3.5")) return "gpt-4o-mini";
  if (lower.startsWith("claude-3-haiku")) return "claude-3-haiku-20240307";
  if (lower.startsWith("llama-3.3-70b")) return "meta-llama/Llama-3.3-70B-Instruct-Turbo";
  if (lower.startsWith("mixtral-8x7b")) return "mistralai/Mixtral-8x7B-Instruct-v0.1";
  if (lower.startsWith("llama-4-scout")) return "meta-llama/Llama-4-Scout-17B-16E-Instruct";
  if (lower === "mistral-small") return "mistralai/Mistral-Small-24B-Instruct-2501";
  return inputModel;
}

export function newDurableStream(): DuckApiRequest["durableStream"] {
  const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = publicKey.export({ format: "jwk" }) as { e?: string; n?: string };
  return {
    messageId: randomUUID(),
    conversationId: randomUUID(),
    publicKey: {
      alg: "RSA-OAEP-256",
      e: jwk.e ?? "",
      ext: true,
      key_ops: ["encrypt"],
      kty: "RSA",
      n: jwk.n ?? "",
      use: "enc",
    },
  };
}

function extractContentParts(
  content: ApiMessage["content"],
  fileStore?: FileLookup,
): DuckContentPart[] {
  if (typeof content === "string") {
    return content === "" ? [] : [{ type: "text", text: content }];
  }
  if (!Array.isArray(content)) return [];
  const parts: DuckContentPart[] = [];
  for (const element of content) {
    const partType = (element as { type?: unknown }).type;
    if (partType === "text") {
      const text = (element as { text?: unknown }).text;
      if (typeof text === "string" && text !== "") parts.push({ type: "text", text });
    } else if (partType === "image_url") {
      const url = (element as { image_url?: { url?: unknown } }).image_url?.url;
      if (typeof url === "string" && url !== "") {
        let mimeType = "image/png";
        if (url.startsWith("data:")) {
          const semi = url.indexOf(";");
          if (semi > 0) mimeType = url.slice(5, semi);
        }
        parts.push({ type: "image", image: url, mimeType });
      }
    } else if (partType === "image") {
      const image = (element as { image?: unknown }).image;
      if (typeof image === "string" && image !== "") {
        const mime = (element as { mimeType?: unknown }).mimeType;
        parts.push({
          type: "image",
          image,
          mimeType: typeof mime === "string" && mime !== "" ? mime : "image/png",
        });
      }
    } else if (partType === "input_file") {
      const fileID = (element as { file_id?: unknown }).file_id;
      if (typeof fileID === "string" && fileID !== "") {
        const found = fileStore?.(fileID);
        if (found) {
          if (found.mimeType.startsWith("image/")) {
            // MVP: pass image bytes through as data URL without the Go
            // webp-resize pipeline (see convertToWebP port notes).
            const b64 = Buffer.from(found.data).toString("base64");
            parts.push({ type: "image", image: `data:${found.mimeType};base64,${b64}`, mimeType: found.mimeType });
          } else {
            let fileText = Buffer.from(found.data).toString("utf8").replaceAll("\0", "");
            if (fileText.length > 50000) fileText = fileText.slice(0, 50000) + "\n...(truncated)";
            parts.push({ type: "text", text: `[File: ${found.filename}]\n${fileText}` });
          }
          continue;
        }
        parts.push({ type: "text", text: `[file:${fileID}]` });
      }
    }
  }
  return parts;
}

export interface ConvertOptions {
  reasoningEffort?: string;
  webSearch?: boolean;
  /** Image generation (Go parity: toolChoice.GenerateImage). */
  generateImage?: boolean;
  fileStore?: FileLookup;
  // NOTE: pure-conversation channel. There is intentionally no `tools`
  // option: tool definitions are never projected upstream (no manifest
  // prompt, no playgame simulation markers).
}

export function convertAPIRequestWithOptions(api: APIRequest, opts: ConvertOptions = {}): DuckApiRequest {
  const realModel = mapModel(api.model);
  const req: DuckApiRequest = {
    model: realModel,
    metadata: {},
    messages: [],
    canUseTools: true,
    reasoningEffort: opts.reasoningEffort ? capReasoningEffort(opts.reasoningEffort) : "low",
    canUseApproxLocation: null,
    canDelegateImageGeneration: null,
    canShowGreeting: true,
    durableStream: newDurableStream(),
  };
  // Explicit flags are the only cases that send toolChoice, and then with
  // just the positive flags (no false flags that could suppress the
  // server-side auto behavior seen in the real captures).
  const toolChoice: Record<string, boolean> = {};
  if (opts.webSearch) toolChoice["WebSearch"] = true;
  if (opts.generateImage) toolChoice["GenerateImage"] = true;
  if (Object.keys(toolChoice).length > 0) {
    req.metadata = { toolChoice };
  }

  for (const message of api.messages) {
    let role = message.role;
    // Pure-conversation channel: system/developer prompts are intercepted
    // (dropped entirely, not demoted to user). No system prompts, no tools,
    // no MCP/skill content reaches upstream — only human dialogue.
    if (role === "system" || role === "developer") continue;
    // Pure conversation: tool messages are dropped entirely (no
    // [playgame_result] markers, no tool simulation).
    if (role === "tool") continue;
    if (role !== "user" && role !== "assistant") continue;
    const parts = extractContentParts(message.content, opts.fileStore);
    if (parts.length === 0) continue;
    if (role === "assistant") {
      // Duck.ai rejects assistant-role messages outright (bare 400
      // ERR_BAD_REQUEST, verified live: user-only shapes 200, any assistant
      // presence 400s). Fold them into the user stream with attribution
      // instead of dropping the content — otherwise every follow-up round
      // carrying prior assistant text fails deterministically.
      role = "user";
      const firstText = parts.find((p) => p.type === "text" && p.text);
      if (firstText?.text) firstText.text = `[assistant] ${firstText.text}`;
      else parts.unshift({ type: "text", text: "[assistant]" });
    }
    // Match real duck.ai frontend (gpt-6-luna capture): content is always an
    // array of parts, even for a single text part. Do NOT collapse to string.
    req.messages.push({ role, content: parts });
  }

  // Pure-conversation channel: opts.tools (if ever passed) is ignored.
  // No TOOL_SIMULATION_PROMPT manifest, no toolSimulation flag, and
  // canUseTools stays true like the real frontend.
  // Real captures: multimodal / image-generation requests carry
  // canUseApproxLocation:false (text-only sends null).
  const hasImagePart = req.messages.some((m) =>
    Array.isArray(m.content) && m.content.some((p) => p.type === "image")
  );
  if (opts.generateImage || hasImagePart) {
    req.canUseApproxLocation = false;
  }
  return req;
}

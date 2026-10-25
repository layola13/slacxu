import { z } from "zod";

// Port of E:\projects\duck2api\typings\official\request.go (subset needed for
// the chat vertical slice). Field names keep Go JSON tags (snake_case).

export const messageContentPartSchema = z.object({
  type: z.string(),
  text: z.string().optional(),
  image_url: z.object({ url: z.string() }).optional(),
}).passthrough();

export const apiMessageSchema = z.object({
  role: z.string(),
  // OpenAI clients send `content: null` on assistant tool-call messages.
  // Coerce to "" (same as the gateway's canonicalizer) so validation passes
  // and downstream convert code always sees string|array. Previously this
  // 400'd as "Request must be proper JSON", hiding the real shape issue.
  content: z.union([z.string(), z.array(messageContentPartSchema)]).nullish().transform((v) => v ?? ""),
});

export type ApiMessage = z.infer<typeof apiMessageSchema>;

export const apiRequestSchema = z.object({
  model: z.string().min(1),
  messages: z.array(apiMessageSchema),
  stream: z.boolean().optional().default(false),
  reasoning_effort: z.string().optional().default(""),
  reasoning: z.union([z.string(), z.object({ effort: z.string().optional() }).passthrough()]).optional(),
  web_search: z.boolean().optional(),
  file_ids: z.array(z.string()).optional(),
}).passthrough();

export type APIRequest = z.infer<typeof apiRequestSchema>;

// Port of E:\projects\duck2api\typings\official\image.go (ImageGenerationRequest).
export const imageGenerationSchema = z.object({
  prompt: z.string().optional().default(""),
  model: z.string().optional(),
  n: z.number().optional(),
  size: z.string().optional(),
  response_format: z.string().optional(),
  quality: z.string().optional(),
  style: z.string().optional(),
  reasoning_effort: z.string().optional().default(""),
  reasoning: z.union([z.string(), z.object({ effort: z.string().optional() }).passthrough()]).optional(),
}).passthrough();

export type ImageGenerationRequest = z.infer<typeof imageGenerationSchema>;

export interface ModelEntry {
  id: string;
  object: "model";
  created: number;
  owned_by: string;
}

// Port of Handler.engines model list (initialize/handlers.go:1056).
// Duck.ai delisted gpt-5.6-luna; current flagship is gpt-6-luna (see screenshot).
export const MODEL_IDS = [
  "gpt-6-luna",
  "gpt-5.4-mini",
  "gpt-5.4-nano",
  "tinfoil/gpt-oss-120b",
  "tinfoil/gemma4-31b",
  "claude-haiku-4-5",
  "mistral-small-2603",
] as const;

export function listModels(): { object: "list"; data: ModelEntry[] } {
  return {
    object: "list",
    data: MODEL_IDS.map((id) => ({ id, object: "model" as const, created: 1685474247, owned_by: "duckduckgo" })),
  };
}

export function messageText(content: ApiMessage["content"]): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((p) => p?.text ?? "").join("");
}

export function parseReasoningEffort(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object") {
    const effort = (raw as Record<string, unknown>)["effort"];
    if (typeof effort === "string") return effort;
  }
  return "";
}

/** OpenAI-compatible error envelope (port of the gin.H error shapes). */
export function apiError(message: string, type = "invalid_request_error", code?: string) {
  return { error: { message, type, param: null, code } };
}

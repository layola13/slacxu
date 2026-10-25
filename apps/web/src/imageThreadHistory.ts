import type { ChannelGroupConfig, JsonValue, ProviderConfig } from "@codex-ui/shared";
import { threadReadToTurns, type ClientState, type ComposerImageAttachment, type ImageApiResult } from "./state/codexClient";

type ImageThreadInput = {
  prompt: string;
  mode: "generate" | "edit";
  sourceImages: ComposerImageAttachment[];
  provider: ProviderConfig;
  group?: ChannelGroupConfig;
  requestId?: string;
};

export function buildImageThreadItems(input: ImageThreadInput & { result: ImageApiResult | null }): JsonValue[] {
  const items: JsonValue[] = [];
  const userContent: JsonValue[] = [{ type: "input_text", text: input.prompt }];
  // Source bitmaps belong to the image request only. The text thread receives
  // the prompt, while UI image history is persisted through its own protocol.
  items.push({ type: "message", role: "user", content: userContent });
  for (const image of input.result?.data ?? []) {
    const savedPath = image.savedPath;
    if (!savedPath) continue;
    const item: Record<string, JsonValue> = {
      type: "image_generation_call",
      id: `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      status: "completed",
      revised_prompt: image.revisedPrompt ?? input.prompt,
      provider_name: input.provider.name,
      provider_id: input.provider.id,
      group_id: input.group?.id ?? "",
      group_name: input.group?.name ?? "",
      image_mode: input.mode,
      request_id: input.requestId ?? "",
      model: input.result?.model ?? input.provider.image?.defaultModel ?? "gpt-image-2",
      // Codex requires `result` on image_generation_call. Keep it empty when
      // the actual bitmap is stored out-of-line in saved_path.
      result: ""
    };
    if (input.result?.estimatedCostUsd != null) item.estimated_cost_usd = input.result.estimatedCostUsd;
    if (input.result?.imageUnitPriceUsd != null) item.image_unit_price_usd = input.result.imageUnitPriceUsd;
    // Kept only for compatibility with older servers. New image APIs always
    // return savedPath, so normal history never retains a base64 image.
    if (savedPath) item.saved_path = savedPath;
    items.push(item);
  }
  return items;
}

export function buildPendingImageThreadItems(input: ImageThreadInput & { model: string }): JsonValue[] {
  return [
    ...buildImageThreadItems({ ...input, result: null }),
    {
      type: "image_generation_call",
      id: `img_pending_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      status: "running",
      revised_prompt: input.prompt,
      provider_name: input.provider.name,
      provider_id: input.provider.id,
      group_id: input.group?.id ?? "",
      group_name: input.group?.name ?? "",
      image_mode: input.mode,
      request_id: input.requestId ?? "",
      model: input.model,
      result: ""
    }
  ];
}

export function buildFailedImageThreadItems(input: ImageThreadInput & { model: string; message: string }): JsonValue[] {
  return [
    ...buildImageThreadItems({ ...input, result: null }),
    {
      type: "image_generation_call",
      id: `img_failed_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      status: "failed",
      revised_prompt: input.prompt,
      provider_name: input.provider.name,
      provider_id: input.provider.id,
      group_id: input.group?.id ?? "",
      group_name: input.group?.name ?? "",
      image_mode: input.mode,
      request_id: input.requestId ?? "",
      model: input.model,
      result: "",
      error_message: input.message
    }
  ];
}

export function buildLocalImageThreadTurns(input: ImageThreadInput & {
  threadId: string;
  turnId?: string;
  result: ImageApiResult | null;
  items: JsonValue[];
  status?: string;
}): ClientState["turns"] {
  const turnId = input.turnId ?? `image-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const now = Math.floor(Date.now() / 1000);
  const turn: Record<string, JsonValue> = { id: turnId, status: input.status ?? "completed", startedAt: now, items: input.items };
  if (input.status !== "running") turn.completedAt = now;
  return threadReadToTurns({ thread: { id: input.threadId, turns: [turn] } } as JsonValue).turns;
}

export async function composerImageAttachmentToFile(image: ComposerImageAttachment): Promise<File> {
  const response = await fetch(image.url);
  if (!response.ok) throw new Error(`Failed to read image attachment: ${image.name}`);
  const blob = await response.blob();
  const extension = blob.type.split("/")[1] || image.name.split(".").pop() || "png";
  return new File([blob], image.name || `image.${extension}`, { type: blob.type || "image/png" });
}

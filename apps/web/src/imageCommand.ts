import type { ImageGenerationProtocol } from "@codex-ui/shared";
import { editProviderImage, generateProviderImage, type ComposerImageAttachment, type ImageApiResult } from "./state/codexClient";
import { composerImageAttachmentToFile } from "./imageThreadHistory";

export type ImageCommandRequest = {
  token: string;
  mode: "generate" | "edit";
  providerId: string;
  groupId: string;
  prompt: string;
  model: string;
  requestId: string;
  protocol?: ImageGenerationProtocol;
  images: ComposerImageAttachment[];
  /** Test/embedding override. Production defaults remain 150s/180s. */
  timeoutMs?: number;
};

export async function executeImageCommandRequest(
  input: ImageCommandRequest,
  jobs: Map<string, AbortController>
): Promise<ImageApiResult> {
  const controller = new AbortController();
  jobs.set(input.requestId, controller);
  const timeoutMs = input.timeoutMs ?? (input.mode === "edit" ? 180_000 : 150_000);
  const timeout = globalThis.setTimeout(
    () => controller.abort(new DOMException("Image request timed out", "TimeoutError")),
    timeoutMs
  );
  try {
    return input.mode === "edit"
      ? await editProviderImage(input.token, {
          providerId: input.providerId, groupId: input.groupId, prompt: input.prompt, model: input.model,
          requestId: input.requestId, images: await Promise.all(input.images.map(composerImageAttachmentToFile))
        }, controller.signal)
      : await generateProviderImage(input.token, {
          providerId: input.providerId, groupId: input.groupId, prompt: input.prompt, model: input.model,
          requestId: input.requestId, protocol: input.protocol
        }, controller.signal);
  } finally {
    globalThis.clearTimeout(timeout);
    jobs.delete(input.requestId);
  }
}

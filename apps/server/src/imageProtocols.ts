import type { ImageGenerationProtocol, JsonValue, ProviderConfig } from "@codex-ui/shared";

export type ImageGenerationOptions = Record<string, string | number | boolean>;

export async function runImageGeneration(input: {
  provider: ProviderConfig;
  apiKey: string;
  prompt: string;
  model: string;
  options: ImageGenerationOptions;
  protocol?: ImageGenerationProtocol;
  signal?: AbortSignal;
}): Promise<{ body: JsonValue; status: number }> {
  const protocol = selectImageGenerationProtocol(input.provider, input.model, input.protocol);
  if (protocol === "deepkeyAsyncVideos") {
    return runAsyncVideoImageGeneration(input);
  }
  if (protocol === "geminiGenerateContent") {
    return runGeminiGenerateContent(input);
  }
  if (protocol === "geminiChatCompletions") {
    return runGeminiChatCompletions(input);
  }
  return runOpenAiImageGeneration(input);
}

export function selectImageGenerationProtocol(
  provider: ProviderConfig,
  model: string,
  requestedProtocol?: ImageGenerationProtocol
): Exclude<ImageGenerationProtocol, "openaiImageEdits"> {
  const configured = generationProtocols(provider.image?.protocols);
  const allowed = (protocol: ImageGenerationProtocol | undefined): protocol is Exclude<ImageGenerationProtocol, "openaiImageEdits"> =>
    Boolean(protocol && protocol !== "openaiImageEdits" && (configured.length === 0 || configured.includes(protocol)));
  if (allowed(requestedProtocol)) {
    return requestedProtocol;
  }
  const defaultProtocol = provider.image?.defaultProtocol;
  if (allowed(defaultProtocol)) {
    return defaultProtocol;
  }
  if (isAsyncGeminiImageModel(model) && allowed("deepkeyAsyncVideos")) {
    return "deepkeyAsyncVideos";
  }
  if (isGeminiImagePreviewModel(model)) {
    if (shouldUseGeminiGenerateContent(providerBaseUrl(provider)) && allowed("geminiGenerateContent")) {
      return "geminiGenerateContent";
    }
    if (allowed("geminiChatCompletions")) {
      return "geminiChatCompletions";
    }
    if (allowed("geminiGenerateContent")) {
      return "geminiGenerateContent";
    }
  }
  if (allowed("openaiImages")) {
    return "openaiImages";
  }
  if (configured.length > 0) {
    return configured[0]!;
  }
  if (isAsyncGeminiImageModel(model)) {
    return "deepkeyAsyncVideos";
  }
  if (isGeminiImagePreviewModel(model)) {
    return shouldUseGeminiGenerateContent(providerBaseUrl(provider)) ? "geminiGenerateContent" : "geminiChatCompletions";
  }
  return "openaiImages";
}

export function isAsyncGeminiImageModel(model: string): boolean {
  return /^nano_banana(?:_[\w-]+)?(?:-\dK)?$/i.test(model);
}

export function isGeminiImagePreviewModel(model: string): boolean {
  return /^gemini-[\w.-]+-image-preview$/i.test(model);
}

async function runOpenAiImageGeneration(input: {
  provider: ProviderConfig;
  apiKey: string;
  prompt: string;
  model: string;
  options: ImageGenerationOptions;
  signal?: AbortSignal;
}): Promise<{ body: JsonValue; status: number }> {
  const payload: Record<string, JsonValue> = {
    model: input.model,
    prompt: input.prompt,
    ...jsonOptions(input.options)
  };
  const response = await fetch(`${providerBaseUrl(input.provider)}/images/generations`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${input.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload),
    signal: input.signal
  });
  const body = await normalizeImageApiResponse(response, {
    provider: input.provider,
    model: input.model,
    prompt: input.prompt,
    endpoint: "images/generations"
  });
  return { body: await hydrateNormalizedImageResult(body), status: response.ok ? 200 : response.status };
}

async function runGeminiChatCompletions(input: {
  provider: ProviderConfig;
  apiKey: string;
  prompt: string;
  model: string;
  options: ImageGenerationOptions;
  signal?: AbortSignal;
}): Promise<{ body: JsonValue; status: number }> {
  const baseUrl = providerBaseUrl(input.provider);
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${input.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: input.model,
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: input.prompt }]
        }
      ],
      modalities: ["text", "image"]
    }),
    signal: input.signal
  });
  const body = await normalizeGeminiChatResponse(response, {
    provider: input.provider,
    model: input.model,
    prompt: input.prompt,
    endpoint: "chat/completions"
  });
  return { body: await hydrateNormalizedImageResult(body), status: response.ok ? 200 : response.status };
}

async function runGeminiGenerateContent(input: {
  provider: ProviderConfig;
  apiKey: string;
  prompt: string;
  model: string;
  options: ImageGenerationOptions;
  signal?: AbortSignal;
}): Promise<{ body: JsonValue; status: number }> {
  const endpoint = `${geminiNativeBaseUrl(input.provider)}/models/${encodeURIComponent(input.model)}:generateContent`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${input.apiKey}`,
      "X-Goog-Api-Key": input.apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: input.prompt }] }],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"]
      }
    }),
    signal: input.signal
  });
  const body = await normalizeGeminiGenerateContentResponse(response, {
    provider: input.provider,
    model: input.model,
    prompt: input.prompt,
    endpoint: "generateContent"
  });
  return { body: await hydrateNormalizedImageResult(body), status: response.ok ? 200 : response.status };
}

async function runAsyncVideoImageGeneration(input: {
  provider: ProviderConfig;
  apiKey: string;
  prompt: string;
  model: string;
  options: ImageGenerationOptions;
  signal?: AbortSignal;
}): Promise<{ body: JsonValue; status: number }> {
  const endpoint = `${providerBaseUrl(input.provider)}/videos`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${input.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: input.model,
      prompt: input.prompt,
      size: stringOption(input.options.size) ?? "1024x1024",
      n: numberOption(input.options.n) ?? 1,
      response_format: stringOption(input.options.response_format) ?? "url"
    }),
    signal: input.signal
  });
  const submitted = await readJson(response);
  if (!response.ok) {
    return {
      body: imageErrorResponse(submitted, response.status, "videos"),
      status: response.status
    };
  }
  const task = asRecord(submitted);
  const taskId = stringValue(task.task_id) ?? stringValue(task.id);
  if (!taskId) {
    return {
      body: {
        error: "Async image API returned no task id",
        statusCode: response.status,
        endpoint: "videos",
        raw: submitted as JsonValue
      },
      status: 502
    };
  }
  const completed = await pollAsyncImageTask({
    provider: input.provider,
    apiKey: input.apiKey,
    taskId,
    signal: input.signal
  });
  const body = await hydrateNormalizedImageResult(normalizeAsyncImageTask(completed, {
    provider: input.provider,
    model: input.model,
    prompt: input.prompt,
    endpoint: "videos",
    submitted
  }));
  return { body, status: 200 };
}

async function pollAsyncImageTask(input: { provider: ProviderConfig; apiKey: string; taskId: string; signal?: AbortSignal }): Promise<unknown> {
  const deadline = Date.now() + 300_000;
  let lastBody: unknown = {};
  while (Date.now() < deadline) {
    await sleep(2_000, input.signal);
    const response = await fetch(`${providerBaseUrl(input.provider)}/videos/${encodeURIComponent(input.taskId)}`, {
      headers: {
        "Authorization": `Bearer ${input.apiKey}`
      },
      signal: input.signal
    });
    lastBody = await readJson(response);
    if (!response.ok) {
      throw new Error(errorText(lastBody) || `Async image task query failed (${response.status})`);
    }
    const status = String(asRecord(lastBody).status ?? "").toLowerCase();
    if (status === "completed" || status === "succeeded" || status === "success") {
      return lastBody;
    }
    if (status === "failed" || status === "error" || status === "cancelled" || status === "canceled") {
      throw new Error(errorText(lastBody) || `Async image task failed: ${status}`);
    }
  }
  throw new Error(errorText(lastBody) || "Async image task timed out");
}

export async function normalizeImageApiResponse(
  response: Response,
  context: { provider: ProviderConfig; model: string; prompt: string; endpoint: string }
): Promise<JsonValue> {
  const body = await readJson(response);
  const record = asRecord(body);
  if (!response.ok) {
    return imageErrorResponse(body, response.status, context.endpoint);
  }
  const data = Array.isArray(record.data) ? record.data.map((entry) => normalizeImageData(asRecord(entry))).filter(Boolean) : [];
  return normalizedImageResult({ ...context, raw: body, data, created: numberValue(record.created) });
}

async function normalizeGeminiChatResponse(
  response: Response,
  context: { provider: ProviderConfig; model: string; prompt: string; endpoint: string }
): Promise<JsonValue> {
  const body = await readJson(response);
  if (!response.ok) {
    return imageErrorResponse(body, response.status, context.endpoint);
  }
  const data: JsonValue[] = [];
  const choices = asArray(asRecord(body).choices);
  for (const choice of choices) {
    const message = asRecord(asRecord(choice).message);
    data.push(...extractImagesFromUnknown(message));
  }
  data.push(...extractImagesFromUnknown(body));
  return normalizedImageResult({ ...context, raw: body, data: uniqueImageData(data) });
}

async function normalizeGeminiGenerateContentResponse(
  response: Response,
  context: { provider: ProviderConfig; model: string; prompt: string; endpoint: string }
): Promise<JsonValue> {
  const body = await readJson(response);
  if (!response.ok) {
    return imageErrorResponse(body, response.status, context.endpoint);
  }
  const data = extractImagesFromUnknown(body);
  return normalizedImageResult({ ...context, raw: body, data: uniqueImageData(data) });
}

function normalizeAsyncImageTask(
  body: unknown,
  context: { provider: ProviderConfig; model: string; prompt: string; endpoint: string; submitted: unknown }
): JsonValue {
  const record = asRecord(body);
  const data = uniqueImageData([
    ...extractImagesFromUnknown(body),
    ...extractUrlValue(stringValue(record.url))
  ]);
  return normalizedImageResult({
    provider: context.provider,
    model: context.model,
    prompt: context.prompt,
    endpoint: context.endpoint,
    raw: {
      submitted: context.submitted as JsonValue,
      completed: body as JsonValue
    },
    data,
    created: numberValue(record.created_at) ?? numberValue(record.created)
  });
}

function normalizedImageResult(context: {
  provider: ProviderConfig;
  model: string;
  prompt: string;
  endpoint: string;
  raw: unknown;
  data: JsonValue[];
  created?: number;
}): JsonValue {
  const normalized: Record<string, JsonValue> = {
    data: context.data,
    providerId: context.provider.id,
    providerName: context.provider.name,
    model: context.model,
    prompt: context.prompt,
    endpoint: context.endpoint,
    raw: context.raw as JsonValue
  };
  if (context.created != null) {
    normalized.created = context.created;
  }
  return normalized;
}

function normalizeImageData(entry: Record<string, unknown>): JsonValue | null {
  // Transient upstream shape only: b64Json survives exactly until
  // persistImageApiResult writes bytes to disk and returns {savedPath}.
  // Never synthesize a data: URL here — history must only see disk paths.
  const b64 = stringValue(entry.b64_json) ?? stringValue(entry.b64Json) ?? stringValue(entry.data);
  const rawUrl = stringValue(entry.url) ?? stringValue(entry.image_url);
  const url = rawUrl && !/^data:/i.test(rawUrl) ? rawUrl : undefined;
  if (!url && !b64) {
    return null;
  }
  const normalized: Record<string, JsonValue> = {};
  if (url) {
    normalized.url = url;
  }
  if (b64) {
    normalized.b64Json = b64;
  }
  const revisedPrompt = stringValue(entry.revised_prompt) ?? stringValue(entry.revisedPrompt);
  if (revisedPrompt) {
    normalized.revisedPrompt = revisedPrompt;
  }
  return normalized;
}

function extractImagesFromUnknown(value: unknown): JsonValue[] {
  const out: JsonValue[] = [];
  const visit = (entry: unknown): void => {
    if (typeof entry === "string") {
      out.push(...extractUrlValue(entry));
      return;
    }
    if (Array.isArray(entry)) {
      for (const item of entry) {
        visit(item);
      }
      return;
    }
    const record = asRecord(entry);
    if (Object.keys(record).length === 0) {
      return;
    }
    const normalized = normalizeImageData(record);
    if (normalized) {
      out.push(normalized);
    }
    const imageUrl = record.image_url;
    if (typeof imageUrl === "string") {
      out.push(...extractUrlValue(imageUrl));
    } else {
      const nestedUrl = stringValue(asRecord(imageUrl).url);
      if (nestedUrl) {
        out.push(...extractUrlValue(nestedUrl));
      }
    }
    const inlineData = asRecord(record.inlineData ?? record.inline_data);
    const inlineDataValue = stringValue(inlineData.data);
    if (inlineDataValue) {
      // Transient only: persistImageApiResult converts b64Json to a disk
      // file ({savedPath}); no data: URL is emitted for history.
      out.push({ b64Json: inlineDataValue, mediaType: stringValue(inlineData.mimeType) ?? stringValue(inlineData.mime_type) ?? "image/png" });
    }
    const fileUri = stringValue(asRecord(record.fileData ?? record.file_data).fileUri) ?? stringValue(asRecord(record.fileData ?? record.file_data).file_uri);
    if (fileUri) {
      out.push({ url: fileUri });
    }
    for (const key of ["content", "parts", "candidates", "message", "images", "output", "result"]) {
      if (key in record) {
        visit(record[key]);
      }
    }
  };
  visit(value);
  return out;
}

function extractUrlValue(value: string | undefined): JsonValue[] {
  if (!value) {
    return [];
  }
  const trimmed = value.trim();
  if (/^data:image\//i.test(trimmed) || /^https?:\/\//i.test(trimmed)) {
    return [{ url: trimmed }];
  }
  const urls = [...trimmed.matchAll(/(?:https?:\/\/[^\s'"<>)]+|data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+)/gi)].map((match) => ({ url: match[0] }));
  return urls;
}

function uniqueImageData(data: JsonValue[]): JsonValue[] {
  const seen = new Set<string>();
  return data.filter((entry) => {
    const url = stringValue(asRecord(entry).url);
    const b64 = stringValue(asRecord(entry).b64Json);
    const key = url ?? b64;
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

// No https->base64 hydration here: persistImageApiResult downloads remote
// URLs straight to disk ({savedPath}) so base64 never exists in memory or
// history. Transient base64 for a model call is produced only at read time
// from the saved path (readOpencodeLocalImage / readImageFromDisk /
// runMiniImageView).
async function hydrateNormalizedImageResult(body: JsonValue): Promise<JsonValue> {
  return body;
}

function imageErrorResponse(body: unknown, status: number, endpoint: string): JsonValue {
  return {
    error: errorText(body) || `Image API failed (${status})`,
    statusCode: status,
    endpoint,
    raw: body as JsonValue
  };
}

function errorText(value: unknown): string {
  const record = asRecord(value);
  const error = asRecord(record.error);
  return stringValue(error.message) ?? stringValue(record.error) ?? stringValue(record.message) ?? "";
}

function providerBaseUrl(provider: ProviderConfig): string {
  const baseUrl = provider.baseUrl?.trim();
  if (!baseUrl) {
    throw new Error("Provider is missing baseUrl");
  }
  return baseUrl.replace(/\/+$/, "");
}

function shouldUseGeminiGenerateContent(baseUrl: string): boolean {
  return /generativelanguage\.googleapis\.com/i.test(baseUrl) && !/\/openai$/i.test(baseUrl);
}

function geminiNativeBaseUrl(provider: ProviderConfig): string {
  const baseUrl = providerBaseUrl(provider).replace(/\/models\/?$/i, "").replace(/\/openai\/?$/i, "");
  if (/\/v1beta$/i.test(baseUrl)) {
    return baseUrl;
  }
  if (/\/v1$/i.test(baseUrl)) {
    return baseUrl.replace(/\/v1$/i, "/v1beta");
  }
  return `${baseUrl}/v1beta`;
}

function generationProtocols(protocols: ImageGenerationProtocol[] | undefined): Array<Exclude<ImageGenerationProtocol, "openaiImageEdits">> {
  return (protocols ?? []).filter((protocol): protocol is Exclude<ImageGenerationProtocol, "openaiImageEdits"> => protocol !== "openaiImageEdits");
}

function jsonOptions(options: ImageGenerationOptions): Record<string, JsonValue> {
  const out: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(options)) {
    out[key] = value;
  }
  return out;
}

function stringOption(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function numberOption(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { error: text || `Upstream returned ${response.status}` };
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
  });
}

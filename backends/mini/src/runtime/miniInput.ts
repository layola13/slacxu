import { runMiniImageView } from "./imageView.js";

export type MiniUserImage = { url: string; detail?: string; path?: string };
export type MiniResolvedUserInput = { text: string; images: MiniUserImage[]; content: Array<Record<string, unknown>> };

export async function resolveMiniUserInput(input: unknown, prompt?: unknown, cwd = process.cwd()): Promise<MiniResolvedUserInput> {
  const blocks = Array.isArray(input) ? input : [];
  const textParts: string[] = [];
  const images: MiniUserImage[] = [];
  const content: Array<Record<string, unknown>> = [];
  for (const raw of blocks) {
    if (!raw || typeof raw !== "object") continue;
    const block = raw as Record<string, unknown>;
    const type = String(block.type ?? "").toLowerCase();
    if ((type === "text" || type === "input_text") && typeof block.text === "string") {
      textParts.push(block.text); content.push({ type: "text", text: block.text }); continue;
    }
    if (type === "image" || type === "input_image" || type === "inputimage") {
      const url = typeof block.url === "string" ? block.url : typeof block.image_url === "string" ? block.image_url : block.image_url && typeof block.image_url === "object" ? String((block.image_url as Record<string, unknown>).url ?? "") : "";
      if (url) { const image = { url, detail: typeof block.detail === "string" ? block.detail : "auto" }; images.push(image); content.push({ type: "image", url, detail: image.detail }); }
      continue;
    }
    if (type === "localimage") {
      const path = typeof block.path === "string" ? block.path : typeof block.url === "string" ? block.url : "";
      if (path) { const viewed = await runMiniImageView({ path, size: "720p", color: "rgb" }, cwd); if (viewed.ok && viewed.dataUrl) { images.push({ url: viewed.dataUrl, detail: "auto", path }); content.push({ type: "image", url: viewed.dataUrl, detail: "auto", path }); } }
    }
  }
  if (!blocks.length && typeof prompt === "string") { textParts.push(prompt); content.push({ type: "text", text: prompt }); }
  return { text: textParts.join("\n").trim(), images, content };
}

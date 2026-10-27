import { expect, test } from "bun:test";
import { buildImageThreadItems } from "../../apps/web/src/imageThreadHistory.ts";

test("generated image history stores persisted paths without base64", () => {
  const items = buildImageThreadItems({
    prompt: "draw", mode: "generate", sourceImages: [],
    provider: { id: "p", kind: "responsesRelay", name: "Relay", defaultModel: "m", nativeModels: [], modelAliases: [], createdAt: 1, updatedAt: 1 },
    result: { data: [{ savedPath: String.raw`C:\data\attachments\image.png`, revisedPrompt: "draw better" }], model: "image-model" }
  });
  expect(JSON.stringify(items)).not.toContain("base64");
  expect(items[1]).toMatchObject({ saved_path: String.raw`C:\data\attachments\image.png`, model: "image-model" });
});

test("image commands never inject generated or edit-source bitmaps into text history", () => {
  const items = buildImageThreadItems({
    prompt: "edit this", mode: "edit",
    sourceImages: [{ id: "source", name: "source.png", url: "data:image/png;base64,c291cmNl" }],
    provider: { id: "p", kind: "responsesRelay", name: "Relay", defaultModel: "m", nativeModels: [], modelAliases: [], createdAt: 1, updatedAt: 1 },
    result: { data: [{ url: "data:image/png;base64,Z2VuZXJhdGVk", b64Json: "Z2VuZXJhdGVk" }], model: "image-model" }
  });
  expect(items).toHaveLength(1);
  expect(JSON.stringify(items)).toBe(JSON.stringify([{ type: "message", role: "user", content: [{ type: "input_text", text: "edit this" }] }]));
});

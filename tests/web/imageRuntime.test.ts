import { expect, test } from "bun:test";
import { imageRuntimeFromHistory, resolveImageRuntime } from "../../apps/web/src/imageRuntime.ts";

test("keeps mixed Azure text capability while routing image operations to its image model", () => {
  const provider = {
    id: "deepkey", kind: "responsesRelay" as const, name: "DeepKey", nativeModels: [], modelAliases: [], createdAt: 1, updatedAt: 1,
    groups: [{ id: "azure", name: "gpt-azure", kind: "text" as const, capabilities: { text: true, imageGeneration: true, imageEdits: true }, models: ["gpt-5.5", "gpt-image-2"], image: { generations: true, edits: true, defaultModel: "gpt-image-2" }, groupRatio: 1, keys: [] }]
  };
  expect(resolveImageRuntime([provider], { providerId: "deepkey", groupId: "azure", model: "gpt-image-2" }, "generate")).toMatchObject({ model: "gpt-image-2", group: { kind: "text" } });
});

test("restores an official image history onto an image runtime without changing text selection", () => {
  const provider = { id: "deepkey", kind: "responsesRelay" as const, name: "DeepKey", nativeModels: [], modelAliases: [], createdAt: 1, updatedAt: 1, groups: [{ id: "image", name: "gpt-image", kind: "image" as const, image: { generations: true, defaultModel: "gpt-image-2-count" }, groupRatio: 1, keys: [] }] };
  const turns = [{ id: "t", threadId: "thread", status: "completed", items: [{ id: "i", type: "imageGeneration", title: "Image", text: "draw", payload: { type: "image_generation_call", model: "gpt-image-2-count" } }] }];
  expect(imageRuntimeFromHistory(turns, [provider])).toEqual({ providerId: "deepkey", groupId: "image", model: "gpt-image-2-count" });
});

test("finds a DeepKey image relay without changing the preferred text provider", () => {
  const text = { id: "text", kind: "responsesRelay" as const, name: "Text", nativeModels: [], modelAliases: [], createdAt: 1, updatedAt: 1, groups: [] };
  const deepkey = { id: "deepkey", kind: "responsesRelay" as const, name: "DeepKey", nativeModels: [], modelAliases: [], createdAt: 1, updatedAt: 1, groups: [{ id: "image", name: "gpt-image", kind: "image" as const, image: { generations: true, defaultModel: "gpt-image-2-count" }, groupRatio: 1, keys: [] }] };
  expect(resolveImageRuntime([text, deepkey], { providerId: null, groupId: null, model: "" }, "generate", "text")).toMatchObject({ provider: { id: "deepkey" }, model: "gpt-image-2-count" });
});

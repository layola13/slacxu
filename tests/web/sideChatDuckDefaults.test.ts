import { expect, test } from "bun:test";
import {
  applySideChatDuckDefault,
  isSideChatDuckDefaultAvailable,
  resolveSideChatTabModel,
  shouldSendSideChatWebSearch,
  SIDE_CHAT_DUCK_GROUP_ID,
  SIDE_CHAT_DUCK_MODEL,
  SIDE_CHAT_DUCK_PROVIDER_ID,
  sideChatHeaderModel,
  sideChatModelOptions,
} from "../../apps/web/src/app/sidechat/sideChatDuckDefaults";

const duckProviders = [
  {
    id: SIDE_CHAT_DUCK_PROVIDER_ID,
    groups: [
      { id: "default", kind: "text", models: ["other-model"] },
      { id: SIDE_CHAT_DUCK_GROUP_ID, kind: "text", models: [SIDE_CHAT_DUCK_MODEL, "gpt-5.4-mini"] },
    ],
  },
];

const baseSelection = {
  providerId: "opencode-local",
  groupId: "default",
  model: "opencode/big-pickle",
  cliBackend: "opencode",
  reasoningEffort: "medium",
};

test("fresh side chat selection routes to duck2api gpt-6-luna", () => {
  const next = applySideChatDuckDefault({ ...baseSelection }, duckProviders);
  expect(next.providerId).toBe(SIDE_CHAT_DUCK_PROVIDER_ID);
  expect(next.groupId).toBe(SIDE_CHAT_DUCK_GROUP_ID);
  expect(next.model).toBe(SIDE_CHAT_DUCK_MODEL);
  expect(next.cliBackend).toBe("mini");
  expect(next.reasoningEffort).toBe("medium");
});

test("unavailable route passes selection through untouched", () => {
  expect(applySideChatDuckDefault({ ...baseSelection }, [])).toEqual(baseSelection);
  expect(
    applySideChatDuckDefault({ ...baseSelection }, [{ id: "other", groups: [] }])
  ).toEqual(baseSelection);
  // d2api group without the model: do not partially override.
  expect(
    applySideChatDuckDefault({ ...baseSelection }, [
      { id: SIDE_CHAT_DUCK_PROVIDER_ID, groups: [{ id: SIDE_CHAT_DUCK_GROUP_ID, kind: "text", models: ["gpt-5.4-mini"] }] },
    ])
  ).toEqual(baseSelection);
  // image-kind d2api group does not count.
  expect(
    applySideChatDuckDefault({ ...baseSelection }, [
      { id: SIDE_CHAT_DUCK_PROVIDER_ID, groups: [{ id: SIDE_CHAT_DUCK_GROUP_ID, kind: "image", models: [SIDE_CHAT_DUCK_MODEL] }] },
    ])
  ).toEqual(baseSelection);
});

test("availability check matches override behavior", () => {
  expect(isSideChatDuckDefaultAvailable(duckProviders)).toBe(true);
  expect(isSideChatDuckDefaultAvailable([])).toBe(false);
  expect(isSideChatDuckDefaultAvailable(null)).toBe(false);
});

test("header shows duck default only for fresh tabs", () => {
  expect(sideChatHeaderModel("opencode/big-pickle", false, duckProviders)).toBe(SIDE_CHAT_DUCK_MODEL);
  expect(sideChatHeaderModel("opencode/big-pickle", true, duckProviders)).toBe("opencode/big-pickle");
  expect(sideChatHeaderModel("opencode/big-pickle", false, [])).toBe("opencode/big-pickle");
});

test("model options come from the d2api group", () => {
  expect(sideChatModelOptions(duckProviders)).toEqual([
    { value: SIDE_CHAT_DUCK_MODEL, label: SIDE_CHAT_DUCK_MODEL },
    { value: "gpt-5.4-mini", label: "gpt-5.4-mini" },
  ]);
  expect(sideChatModelOptions([])).toEqual([]);
});

test("tab model override wins over duck default and global", () => {
  expect(resolveSideChatTabModel("gpt-5.4-mini", "opencode/big-pickle", false, duckProviders)).toBe("gpt-5.4-mini");
  expect(resolveSideChatTabModel(null, "opencode/big-pickle", false, duckProviders)).toBe(SIDE_CHAT_DUCK_MODEL);
  expect(resolveSideChatTabModel("  ", "opencode/big-pickle", true, duckProviders)).toBe("opencode/big-pickle");
});

test("web_search only goes to the duck route", () => {
  const duck = { providerId: SIDE_CHAT_DUCK_PROVIDER_ID, groupId: SIDE_CHAT_DUCK_GROUP_ID };
  expect(shouldSendSideChatWebSearch(true, duck)).toBe(true);
  expect(shouldSendSideChatWebSearch(false, duck)).toBe(false);
  expect(shouldSendSideChatWebSearch(undefined, duck)).toBe(false);
  expect(shouldSendSideChatWebSearch(true, { providerId: "other", groupId: "default" })).toBe(false);
  expect(shouldSendSideChatWebSearch(true, null)).toBe(false);
});

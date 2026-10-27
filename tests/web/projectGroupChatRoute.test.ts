import { expect, test } from "bun:test";
import {
  projectRouteIsValid,
  providerHasProjectRoute,
  resolvedGroupId,
  resolveProjectRoute,
  selectableModels,
  type ProjectRouteDefaults
} from "../../apps/web/src/components/ProjectGroupChat";
import type { ProjectRelayProvider } from "../../apps/web/src/state/codexClient";

// A Nvidia-style relay station with one text group that declares its own model
// list (the case the user is testing: the conversation has switched to the
// nvidia channel/group) and a second text group whose model list is empty, so
// it has to fall back to the relay's native models.
const nvidiaProvider: ProjectRelayProvider = {
  providerId: "nvidia",
  providerName: "Nvidia NIM",
  providerKind: "openai",
  defaultModel: "nvidia/llama-3.1-nemotron-70b",
  models: ["nvidia/llama-3.1-nemotron-70b", "nvidia/llama-3.1-nemotron-49b"],
  groups: [
    { groupId: "nemotron", groupName: "Nemotron", kind: "text", enabled: true, groupRatio: 1, models: ["nvidia/llama-3.1-nemotron-70b", "nvidia/llama-3.1-nemotron-49b"], supportedEndpointTypes: [], responseProtocol: null, responseProtocolMode: null },
    { groupId: "unconfigured", groupName: "Unconfigured", kind: "text", enabled: true, groupRatio: 1, models: [], supportedEndpointTypes: [], responseProtocol: null, responseProtocolMode: null }
  ]
};

const otherProvider: ProjectRelayProvider = {
  providerId: "other",
  providerName: "Other",
  providerKind: "openai",
  defaultModel: "gpt-5.5",
  models: ["gpt-5.5"],
  groups: [{ groupId: "default", groupName: "Default", kind: "text", enabled: true, groupRatio: 1, models: ["gpt-5.5"], supportedEndpointTypes: [], responseProtocol: null, responseProtocolMode: null }]
};

const providers = [otherProvider, nvidiaProvider];

test("resolveProjectRoute keeps the current conversation's nvidia relay and group", () => {
  const preferred: ProjectRouteDefaults = { providerId: "nvidia", groupId: "nemotron", model: "nvidia/llama-3.1-nemotron-70b" };
  const route = resolveProjectRoute(providers, preferred);
  expect(route.providerId).toBe("nvidia");
  expect(route.groupId).toBe("nemotron");
  expect(route.model).toBe("nvidia/llama-3.1-nemotron-70b");
});

test("resolveProjectRoute does not swap away from the preferred relay even when the group is missing", () => {
  // Conversation sits on the nvidia relay but a group id that no longer exists.
  const preferred: ProjectRouteDefaults = { providerId: "nvidia", groupId: "gone", model: "nvidia/llama-3.1-nemotron-49b" };
  const route = resolveProjectRoute(providers, preferred);
  expect(route.providerId).toBe("nvidia");
  expect(route.groupId).toBe("nemotron");
  expect(route.model).toBe("nvidia/llama-3.1-nemotron-49b");
});

test("selectableModels scopes models to the chosen group, never a bare native list without a group", () => {
  expect(selectableModels(nvidiaProvider, null)).toEqual([]);
  expect(selectableModels(nvidiaProvider, "nemotron")).toEqual(["nvidia/llama-3.1-nemotron-70b", "nvidia/llama-3.1-nemotron-49b"]);
  // Empty group models fall back to the relay's native models but stay scoped
  // to THAT group, so the user always knows which group the models belong to.
  expect(selectableModels(nvidiaProvider, "unconfigured")).toEqual(["nvidia/llama-3.1-nemotron-70b", "nvidia/llama-3.1-nemotron-49b"]);
});

test("resolvedGroupId keeps an explicit enabled text group and otherwise finds the group owning the model", () => {
  expect(resolvedGroupId(nvidiaProvider, "nemotron", "nvidia/llama-3.1-nemotron-70b")).toBe("nemotron");
  expect(resolvedGroupId(nvidiaProvider, null, "nvidia/llama-3.1-nemotron-49b")).toBe("nemotron");
  expect(resolvedGroupId(nvidiaProvider, null, "")).toBe("nemotron");
});

test("projectRouteIsValid and providerHasProjectRoute reflect the group-scoped route", () => {
  expect(providerHasProjectRoute(nvidiaProvider)).toBe(true);
  expect(projectRouteIsValid(providers, { providerId: "nvidia", groupId: "nemotron", model: "nvidia/llama-3.1-nemotron-70b" })).toBe(true);
  // A model is only valid when it actually belongs to the chosen group.
  expect(projectRouteIsValid(providers, { providerId: "nvidia", groupId: "nemotron", model: "gpt-5.5" })).toBe(false);
});

test("resolveProjectRoute only falls back to another relay when the preferred relay has no text group", () => {
  const lonely: ProjectRelayProvider = { providerId: "image-only", providerName: "Image only", providerKind: "openai", defaultModel: null, models: [], groups: [{ groupId: "img", groupName: "Img", kind: "image", enabled: true, groupRatio: 1, models: [], supportedEndpointTypes: [], responseProtocol: null, responseProtocolMode: null }] };
  const route = resolveProjectRoute([lonely, otherProvider], { providerId: "image-only", groupId: "img", model: "" });
  expect(route.providerId).toBe("other");
});

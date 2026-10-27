import { expect, test } from "bun:test";
import { requiresExplicitNewChatWorkspace } from "../../apps/web/src/newChatWorkspacePolicy.ts";

test("only workspace chat reuses the current workspace without confirmation", () => {
  expect(requiresExplicitNewChatWorkspace("workspaceAsk")).toBe(false);
  expect(requiresExplicitNewChatWorkspace("readonlyAsk")).toBe(true);
  expect(requiresExplicitNewChatWorkspace("fullAsk")).toBe(true);
  expect(requiresExplicitNewChatWorkspace("dangerBypass")).toBe(true);
});

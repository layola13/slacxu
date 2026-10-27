import { expect, test } from "bun:test";
import { shouldShowWorkspaceSelectionPanel } from "../../apps/web/src/workspaceSelectionVisibility.ts";

const baseInput = {
  workspaceSelectionPending: true,
  activeThreadId: null,
  newChatSetupDialogOpen: false,
  dangerNewChatDialogOpen: false
};

test("shows workspace selection only when no new-chat dialog covers it", () => {
  expect(shouldShowWorkspaceSelectionPanel(baseInput)).toBe(true);
  expect(shouldShowWorkspaceSelectionPanel({ ...baseInput, newChatSetupDialogOpen: true })).toBe(false);
  expect(shouldShowWorkspaceSelectionPanel({ ...baseInput, dangerNewChatDialogOpen: true })).toBe(false);
});

test("does not show workspace selection behind an active conversation", () => {
  expect(shouldShowWorkspaceSelectionPanel({ ...baseInput, activeThreadId: "thread-1" })).toBe(false);
  expect(shouldShowWorkspaceSelectionPanel({ ...baseInput, workspaceSelectionPending: false })).toBe(false);
});

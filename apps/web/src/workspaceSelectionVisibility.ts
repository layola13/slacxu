export type WorkspaceSelectionVisibilityInput = {
  workspaceSelectionPending: boolean;
  activeThreadId: string | null;
  newChatSetupDialogOpen: boolean;
  dangerNewChatDialogOpen: boolean;
};

export function shouldShowWorkspaceSelectionPanel(input: WorkspaceSelectionVisibilityInput): boolean {
  return input.workspaceSelectionPending
    && !input.activeThreadId
    && !input.newChatSetupDialogOpen
    && !input.dangerNewChatDialogOpen;
}

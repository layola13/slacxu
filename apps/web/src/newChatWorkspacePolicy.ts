import type { PermissionPresetId } from "@codex-ui/shared";

export function requiresExplicitNewChatWorkspace(permission: PermissionPresetId): boolean {
  return permission !== "workspaceAsk";
}

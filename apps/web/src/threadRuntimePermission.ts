import type { PermissionPresetId } from "@codex-ui/shared";

export const THREAD_RUNTIME_PERMISSION_SCHEMA_VERSION = 1;

export function restoreThreadRuntimePermission(input: {
  isNewConversation: boolean;
  permission: unknown;
  permissionSchemaVersion: unknown;
  dangerBypassConfirmed: unknown;
}): {
  permission: PermissionPresetId;
  permissionSchemaVersion: number;
  dangerBypassConfirmed: boolean;
} {
  const hasCurrentSchema = input.permissionSchemaVersion === THREAD_RUNTIME_PERMISSION_SCHEMA_VERSION;
  const storedPermission = hasCurrentSchema ? permissionPresetId(input.permission) : undefined;
  const permission = storedPermission ?? (input.isNewConversation ? "workspaceAsk" : "dangerBypass");
  return {
    permission,
    permissionSchemaVersion: THREAD_RUNTIME_PERMISSION_SCHEMA_VERSION,
    dangerBypassConfirmed:
      hasCurrentSchema && typeof input.dangerBypassConfirmed === "boolean"
        ? input.dangerBypassConfirmed
        : permission === "dangerBypass"
  };
}

function permissionPresetId(value: unknown): PermissionPresetId | undefined {
  return value === "readonlyAsk" || value === "workspaceAsk" || value === "fullAsk" || value === "dangerBypass"
    ? value
    : undefined;
}

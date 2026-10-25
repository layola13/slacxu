import type { PermissionPresetId } from "@codex-ui/shared";
import type { TranslateFn } from "./i18n";

export function permissionPresetDisplayLabel(permission: PermissionPresetId, t: TranslateFn): string {
  switch (permission) {
    case "readonlyAsk":
      return t("newChat.readOnly");
    case "workspaceAsk":
      return t("newChat.workspace");
    case "fullAsk":
      return t("newChat.fullAccess");
    case "dangerBypass":
      return t("newChat.danger");
  }
}

export function permissionPresetDisplayDescription(permission: PermissionPresetId, t: TranslateFn): string {
  switch (permission) {
    case "readonlyAsk":
      return t("newChat.readOnlyDescription");
    case "workspaceAsk":
      return t("newChat.workspaceDescription");
    case "fullAsk":
      return t("newChat.fullAccessDescription");
    case "dangerBypass":
      return t("newChat.dangerDescription");
  }
}

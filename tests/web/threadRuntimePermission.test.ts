import { expect, test } from "bun:test";
import {
  restoreThreadRuntimePermission,
  THREAD_RUNTIME_PERMISSION_SCHEMA_VERSION
} from "../../apps/web/src/threadRuntimePermission";

test("migrates an unversioned history permission to confirmed danger bypass", () => {
  expect(restoreThreadRuntimePermission({
    isNewConversation: false,
    permission: "workspaceAsk",
    permissionSchemaVersion: undefined,
    dangerBypassConfirmed: false
  })).toEqual({
    permission: "dangerBypass",
    permissionSchemaVersion: THREAD_RUNTIME_PERMISSION_SCHEMA_VERSION,
    dangerBypassConfirmed: true
  });
});

test("keeps the safe default for an unversioned new conversation", () => {
  expect(restoreThreadRuntimePermission({
    isNewConversation: true,
    permission: "dangerBypass",
    permissionSchemaVersion: undefined,
    dangerBypassConfirmed: true
  })).toEqual({
    permission: "workspaceAsk",
    permissionSchemaVersion: THREAD_RUNTIME_PERMISSION_SCHEMA_VERSION,
    dangerBypassConfirmed: false
  });
});

test("preserves an explicitly stored current permission", () => {
  expect(restoreThreadRuntimePermission({
    isNewConversation: false,
    permission: "fullAsk",
    permissionSchemaVersion: THREAD_RUNTIME_PERMISSION_SCHEMA_VERSION,
    dangerBypassConfirmed: false
  })).toEqual({
    permission: "fullAsk",
    permissionSchemaVersion: THREAD_RUNTIME_PERMISSION_SCHEMA_VERSION,
    dangerBypassConfirmed: false
  });
});

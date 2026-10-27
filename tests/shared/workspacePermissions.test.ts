import { expect, test } from "bun:test";
import { permissionToTurnOverrides } from "../../packages/shared/src/index.ts";

test("maps additional workspace roots into writable sandbox roots", () => {
  const overrides = permissionToTurnOverrides("workspaceAsk", "C:\\Work", ["D:\\Shared", "C:\\Work"]);
  expect(overrides.sandboxPolicy).toEqual({
    type: "workspaceWrite",
    writableRoots: ["C:\\Work", "D:\\Shared"],
    networkAccess: false,
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: false
  });
});


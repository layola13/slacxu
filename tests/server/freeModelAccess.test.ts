import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { FreeModelAccessManager, isDevelopmentMachine, resolveMachineHash } from "../../apps/server/src/freeModelAccess.ts";

const DEVELOPMENT_MACHINE_HASH = "260da01345ac81b7afd81db88267fd8f65363357c5499c433517c83a77f6a146";

test("hashes the Windows MachineGuid without exposing the raw identifier", async () => {
  const machineGuid = "8F3B9F2A-EXAMPLE-WINDOWS-GUID";
  const expected = createHash("sha256")
    .update(`codex-ultra/free-model-access/v1:${machineGuid.toLowerCase()}`)
    .digest("hex");

  const actual = await resolveMachineHash({ CODEX_ULTRA_MACHINE_GUID: machineGuid }, "win32");
  expect(actual).toBe(expected);
  expect(actual).not.toContain(machineGuid);
  expect(actual).toHaveLength(64);
});

test("recognizes only the registered Windows development machine hash", () => {
  expect(isDevelopmentMachine(DEVELOPMENT_MACHINE_HASH)).toBe(true);
  expect(isDevelopmentMachine("0".repeat(64))).toBe(false);
});

test("development machine bypasses keys, refresh gates, campaigns, and service configuration", async () => {
  const manager = new FreeModelAccessManager({}, DEVELOPMENT_MACHINE_HASH);

  await expect(manager.status()).resolves.toMatchObject({
    configured: true,
    developmentMachine: true,
    machineCode: "260DA01345AC",
    license: { valid: true, reason: "active", keyPreview: "开发机器免密" },
    refreshRequired: false,
    campaign: null,
    storage: "none"
  });
  await expect(manager.createRequirement()).resolves.toMatchObject({
    developmentMachine: true,
    license: { valid: true },
    refreshRequired: false
  });
  const authorization = await manager.prepareRefresh();
  expect(authorization).toMatchObject({
    allowed: true,
    authorizationId: "development-machine",
    developmentMachine: true,
    refreshRequired: false
  });
  await expect(manager.completeRefresh(authorization.authorizationId, true, 10)).resolves.toBeUndefined();
});

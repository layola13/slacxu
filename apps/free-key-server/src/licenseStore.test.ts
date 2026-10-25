import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import type { FreeKeyServerConfig } from "./config.js";
import { LicenseStore } from "./licenseStore.js";

const cleanup: string[] = [];

afterEach(() => {
  for (const path of cleanup.splice(0)) rmSync(path, { recursive: true, force: true });
});

test("issues 52-character machine-bound keys with a 24-hour default lifetime", () => {
  const store = createStore();
  const now = 1_000_000;
  const machineHash = "a".repeat(64);
  const requirement = store.createRequirement(machineHash, now);
  const license = store.issueLicense(requirement.requiredCode, "discord-user-1", now + 1_000);

  assert.match(license.key, /^cxu-[A-Za-z0-9]{48}$/);
  assert.equal(license.key.length, 52);
  assert.equal(license.expiresAt - license.issuedAt, 24 * 60 * 60_000);
  assert.equal(store.status(machineHash, license.key, now + 2_000).license.valid, true);
  assert.equal(store.status("b".repeat(64), license.key, now + 2_000).license.reason, "machine_mismatch");
  assert.equal(store.status(machineHash, license.key, license.expiresAt).license.reason, "expired");
  store.close();
});

test("requires a successful refresh every five hours without limiting refresh count", () => {
  const store = createStore();
  const now = 2_000_000;
  const machineHash = "c".repeat(64);
  const requirement = store.createRequirement(machineHash, now);
  const license = store.issueLicense(requirement.requiredCode, "discord-user-2", now + 1);

  const first = store.prepareRefresh(machineHash, license.key, now + 2);
  assert.equal(first.allowed, true);
  assert.equal(first.refreshRequired, true);
  store.completeRefresh(machineHash, first.authorizationId!, true, 6, now + 3);
  assert.equal(store.status(machineHash, license.key, now + 4).refreshRequired, false);
  assert.equal(store.status(machineHash, license.key, now + 3 + 5 * 60 * 60_000).refreshRequired, true);

  const second = store.prepareRefresh(machineHash, license.key, now + 4);
  assert.equal(second.allowed, true);
  store.completeRefresh(machineHash, second.authorizationId!, true, 7, now + 5);
  assert.equal(store.status(machineHash, license.key, now + 6).refreshRequired, false);
  store.close();
});

test("administrator settings change future key validity and campaign payload", () => {
  const store = createStore();
  store.updateSettings({
    defaultValidityDays: 3,
    campaign: { id: "ad-1", title: "公告", message: "刷新提示内容", targetUrl: "https://example.com" }
  });
  const now = 3_000_000;
  const machineHash = "d".repeat(64);
  const requirement = store.createRequirement(machineHash, now);
  const license = store.issueLicense(requirement.requiredCode, "discord-admin-test", now + 1);
  const status = store.status(machineHash, license.key, now + 2);

  assert.equal(license.expiresAt - license.issuedAt, 3 * 24 * 60 * 60_000);
  assert.deepEqual(status.campaign, {
    id: "ad-1",
    title: "公告",
    message: "刷新提示内容",
    targetUrl: "https://example.com/"
  });
  store.close();
});

test("administrator can search, issue, and revoke a machine license", () => {
  const store = createStore();
  const machineHash = "e".repeat(64);
  const issued = store.issueAdminLicense(machineHash, "discord-user-admin", 2, 4_000_000);
  const rows = store.listLicenses(machineHash.slice(0, 12));
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.machineHash, machineHash);
  assert.equal(issued.expiresAt - issued.issuedAt, 2 * 24 * 60 * 60_000);
  assert.equal(store.status(machineHash, issued.key, 4_000_001).license.valid, true);
  assert.equal(store.revokeLicense(rows[0]!.id, "test-admin", 4_000_002), true);
  assert.equal(store.status(machineHash, issued.key, 4_000_003).license.reason, "revoked");
  store.close();
});
function createStore(): LicenseStore {
  const dir = mkdtempSync(join(tmpdir(), "codex-free-key-test-"));
  cleanup.push(dir);
  const config: FreeKeyServerConfig = {
    host: "127.0.0.1",
    port: 43_210,
    databasePath: join(dir, "free-keys.sqlite3"),
    hashPepper: "test-pepper-that-is-long-enough-123456",
    clientSecret: null,
    adminSecret: "test-admin-secret-123456",
    defaultValidityDays: 1,
    refreshIntervalHours: 5,
    requiredTtlMinutes: 15,
    discordInviteUrl: "https://discord.example/invite",
    discordPublicKey: null,
    discordChannelId: null
  };
  return new LicenseStore(config);
}

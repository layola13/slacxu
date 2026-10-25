import assert from "node:assert/strict";
import { scryptSync } from "node:crypto";
import { test } from "node:test";
import { createAdminSession, readAdminSession, verifyAdminPasswordHash } from "./adminAuth.js";

test("verifies scrypt password hashes", () => {
  const salt = "fixed-test-salt";
  const hash = scryptSync("correct-password", salt, 64).toString("hex");
  assert.equal(verifyAdminPasswordHash("correct-password", `scrypt:${salt}:${hash}`), true);
  assert.equal(verifyAdminPasswordHash("wrong-password", `scrypt:${salt}:${hash}`), false);
});

test("signs, expires and rejects tampered administrator sessions", () => {
  const secret = "session-secret-that-is-long-enough";
  const token = createAdminSession("admin", secret, 1_000);
  assert.deepEqual(readAdminSession(token, secret, 2_000), { username: "admin" });
  assert.equal(readAdminSession(`${token}x`, secret, 2_000), null);
  assert.equal(readAdminSession(token, secret, 1_000 + 8 * 60 * 60_000), null);
});

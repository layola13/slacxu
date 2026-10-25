import assert from "node:assert/strict";
import { test } from "node:test";
import { decryptTotpSecret, encryptTotpSecret, generateTotpSecret, totpCode, totpUri, verifyTotp } from "./adminTotp.js";

test("generates and verifies standard six-digit TOTP codes", () => {
  const secret = generateTotpSecret();
  const now = 1_786_173_222_000;
  const code = totpCode(secret, now);
  assert.match(code, /^\d{6}$/);
  assert.equal(verifyTotp(secret, code, now), true);
  assert.equal(verifyTotp(secret, code, now + 60_000), false);
  assert.match(totpUri(secret, "admin"), /^otpauth:\/\/totp\//);
});

test("encrypts TOTP secrets at rest with authenticated encryption", () => {
  const secret = generateTotpSecret();
  const encrypted = encryptTotpSecret(secret, "session-secret-that-is-long-enough");
  assert.notEqual(encrypted.includes(secret), true);
  assert.equal(decryptTotpSecret(encrypted, "session-secret-that-is-long-enough"), secret);
  assert.throws(() => decryptTotpSecret(`${encrypted}x`, "session-secret-that-is-long-enough"));
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { AdminCaptchaStore } from "./adminCaptcha.js";

test("captcha is bound to IP, expires, and is consumed once", () => {
  const store = new AdminCaptchaStore();
  const challenge = store.create("127.0.0.1", 1_000);
  assert.match(challenge.imageDataUrl, /^data:image\/png;base64,/);
  assert.equal(store.consume(challenge.captchaId, "WRONG", "127.0.0.1", 2_000), false);
  assert.equal(store.consume(challenge.captchaId, "WRONG", "127.0.0.1", 2_001), false);

  const other = store.create("127.0.0.1", 3_000);
  assert.equal(store.consume(other.captchaId, "WRONG", "10.0.0.1", 3_001), false);
  const expired = store.create("127.0.0.1", 4_000);
  assert.equal(store.consume(expired.captchaId, "WRONG", "127.0.0.1", 4_000 + 5 * 60_000), false);
});

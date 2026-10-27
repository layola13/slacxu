import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { SecurityStore } from "../../apps/server/src/securityStore.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    if (dir) {
      await removeTempDirWithRetry(dir);
    }
  }
});

async function removeTempDirWithRetry(dir: string) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try { rmSync(dir, { recursive: true, force: true }); return; }
    catch (error) {
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
      if (code !== "EBUSY") throw error;
      if (attempt === 5) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}

function createTempSecurityStore(): { db: Database; store: SecurityStore } {
  const dir = mkdtempSync(join(tmpdir(), "codex-ui-captcha-"));
  tempDirs.push(dir);
  const db = new Database(join(dir, "security.sqlite3"));
  db.exec("PRAGMA foreign_keys = ON");
  const store = new SecurityStore({ connection: db });
  store.initialize();
  return { db, store };
}

test("createCaptcha emits an animated readable inline SVG captcha", () => {
  const { db, store } = createTempSecurityStore();
  const challenge = store.createCaptcha();

  expect(challenge.id).toMatch(/^[a-f0-9]{32}$/);
  expect(challenge.expiresAt).toBeGreaterThan(Date.now());
  expect(challenge.prompt).toMatch(/^\d+ \+ \d+ = \?$/);
  // Inline HTML SVG must not start with an XML declaration (blank/black box risk).
  expect(challenge.svg.trimStart().startsWith("<svg")).toBe(true);
  expect(challenge.svg).not.toContain("<?xml");
  expect(challenge.svg).toContain("<animate");
  expect(challenge.svg).toContain("<text");
  expect(challenge.svg).not.toContain("rgba(");
  expect(challenge.svg).toContain('fill="#f8fafc"');
  expect(challenge.svg).toContain('stroke="#020617"');
  expect(challenge.svg).toContain(challenge.prompt);
  expect(challenge.svg).toMatch(/\d+ \+ \d+ = \?/);

  const expression = challenge.prompt.match(/(\d+) \+ (\d+) = \?/);
  expect(expression).not.toBeNull();
  const answer = Number(expression?.[1]) + Number(expression?.[2]);
  expect(store.consumeCaptcha(challenge.id, String(answer))).toBe(true);
  expect(store.consumeCaptcha(challenge.id, String(answer))).toBe(false);

  db.close();
});

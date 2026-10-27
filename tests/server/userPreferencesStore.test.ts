import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { UserPreferencesStore } from "../../apps/server/src/userPreferencesStore";

const dirs: string[] = [];

afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      try { rmSync(dir, { recursive: true, force: true }); break; }
      catch (error) {
        const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
        if (code !== "EBUSY") throw error;
        if (attempt === 5) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
  }
});

test("persists and merges preferences independently for each user", () => {
  const dir = mkdtempSync(join(tmpdir(), "codex-ui-preferences-"));
  dirs.push(dir);
  const database = new Database(join(dir, "preferences.sqlite3"));
  const store = new UserPreferencesStore({ connection: database });

  expect(store.get("user-a")).toEqual({});
  expect(store.patch("user-a", { locale: "zh", workspace: { mode: "local", cwd: "~/projects" } })).toEqual({
    locale: "zh",
    workspace: { mode: "local", cwd: "~/projects" }
  });
  expect(store.patch("user-a", { themeMode: "official-black" })).toEqual({
    locale: "zh",
    workspace: { mode: "local", cwd: "~/projects" },
    themeMode: "official-black"
  });
  expect(store.get("user-b")).toEqual({});

  const reopened = new UserPreferencesStore({ connection: database });
  expect(reopened.get("user-a")).toEqual({
    locale: "zh",
    workspace: { mode: "local", cwd: "~/projects" },
    themeMode: "official-black"
  });
  database.close();
});

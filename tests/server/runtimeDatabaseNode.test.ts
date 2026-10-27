import { afterEach, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openNodeRuntimeDatabase, openRuntimeDatabase } from "../../apps/server/src/runtime/database.ts";

const files: string[] = [];

function tempFile(): string {
  const file = join(tmpdir(), `runtime-db-node-${Date.now()}-${Math.floor(Math.random() * 1e6)}.sqlite3`);
  files.push(file);
  return file;
}

afterEach(() => {
  while (files.length > 0) {
    const file = files.pop()!;
    for (const suffix of ["", "-wal", "-shm", "-journal"]) {
      try {
        if (existsSync(`${file}${suffix}`)) rmSync(`${file}${suffix}`);
      } catch {
        // Best-effort cleanup.
      }
    }
  }
});

test("openNodeRuntimeDatabase runs migration-style multi-statement exec and CRUD", () => {
  const db = openNodeRuntimeDatabase(tempFile());
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec(`
    CREATE TABLE IF NOT EXISTS providers (
      id TEXT PRIMARY KEY,
      payload TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS user_preferences (
      owner_id TEXT PRIMARY KEY,
      payload TEXT NOT NULL DEFAULT '{}'
    );
  `);
  db.prepare("INSERT INTO providers (id, payload) VALUES (?, ?)").run("relay-a", "{}");
  expect(db.prepare("SELECT * FROM providers WHERE id = ?").get("relay-a")).toMatchObject({
    id: "relay-a",
  });
  expect(db.prepare("SELECT * FROM providers").all()).toHaveLength(1);
  expect(db.prepare("SELECT changes() AS c").get()).toMatchObject({ c: 1 });
  db.close();
});

test("openNodeRuntimeDatabase maps readonly to node:sqlite readOnly", () => {
  const file = tempFile();
  const db = openNodeRuntimeDatabase(file);
  db.exec("CREATE TABLE a (id TEXT PRIMARY KEY, v TEXT)");
  db.prepare("INSERT INTO a (id, v) VALUES (?, ?)").run("k1", "hello");
  db.close();

  const ro = openNodeRuntimeDatabase(file, { readonly: true });
  expect(ro.prepare("SELECT * FROM a WHERE id = ?").get("k1")).toMatchObject({ v: "hello" });
  expect(() => ro.prepare("INSERT INTO a (id, v) VALUES (?, ?)").run("k2", "x")).toThrow();
  ro.close();
});

test("openRuntimeDatabase still opens on the current (bun) runtime", () => {
  const db = openRuntimeDatabase(tempFile());
  db.exec("CREATE TABLE t (id TEXT PRIMARY KEY)");
  db.prepare("INSERT INTO t (id) VALUES (?)").run("x");
  expect(db.prepare("SELECT * FROM t").all()).toHaveLength(1);
  db.close();
});

import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "bun:test";
import { openRuntimeDatabase, type RuntimeDatabase } from "../../apps/server/src/runtime/database.ts";
import { ThreadWriterLeaseStore } from "../../apps/server/src/threadWriterLeaseStore.ts";

const directories: string[] = [];
const databases: RuntimeDatabase[] = [];
const stores: ThreadWriterLeaseStore[] = [];

afterEach(async () => {
  for (const store of stores.splice(0)) store.close();
  for (const database of databases.splice(0)) database.close();
  for (const directory of directories.splice(0)) {
    try {
      await rm(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
      if (process.platform !== "win32" || (code !== "EBUSY" && code !== "EPERM")) throw error;
    }
  }
});

async function createPair(ttlMs = 30_000) {
  const directory = await mkdtemp(join(tmpdir(), `codex-writer-lease-${randomUUID()}-`));
  directories.push(directory);
  const file = join(directory, "leases.sqlite3");
  const dbA = openRuntimeDatabase(file);
  const dbB = openRuntimeDatabase(file);
  databases.push(dbA, dbB);
  const a = new ThreadWriterLeaseStore(dbA, "instance-a", ttlMs, 60_000);
  const b = new ThreadWriterLeaseStore(dbB, "instance-b", ttlMs, 60_000);
  stores.push(a, b);
  return { a, b };
}

test("writer lease is reentrant for its owner and exclusive across instances", async () => {
  const { a, b } = await createPair();
  expect(a.acquire("thread-1", 1_000)).toBe(true);
  expect(a.acquire("thread-1", 1_001)).toBe(true);
  expect(a.owns("thread-1")).toBe(true);
  expect(b.acquire("thread-1", 1_002)).toBe(false);

  a.release("thread-1");
  expect(b.acquire("thread-1", 1_003)).toBe(true);
});

test("expired writer lease can be claimed after an unclean exit", async () => {
  const { a, b } = await createPair(100);
  expect(a.acquire("thread-expired", 5_000)).toBe(true);
  expect(b.acquire("thread-expired", 5_099)).toBe(false);
  expect(b.acquire("thread-expired", 5_100)).toBe(true);
});

test("closing a writer lease store releases every thread it owns", async () => {
  const { a, b } = await createPair();
  expect(a.acquire("thread-a", 10_000)).toBe(true);
  expect(a.acquire("thread-b", 10_000)).toBe(true);
  a.close();
  a.close();

  expect(b.acquire("thread-a", 10_001)).toBe(true);
  expect(b.acquire("thread-b", 10_001)).toBe(true);
});

test("a new process reclaims leases left by a dead process without waiting for TTL", async () => {
  const directory = await mkdtemp(join(tmpdir(), `codex-writer-lease-${randomUUID()}-`));
  directories.push(directory);
  const file = join(directory, "leases.sqlite3");
  const dbA = openRuntimeDatabase(file);
  const dbB = openRuntimeDatabase(file);
  databases.push(dbA, dbB);
  const a = new ThreadWriterLeaseStore(dbA, "dead-instance", 30_000, 60_000, () => true, 111);
  stores.push(a);
  expect(a.acquire("thread-dead", 20_000)).toBe(true);

  const b = new ThreadWriterLeaseStore(
    dbB,
    "new-instance",
    30_000,
    60_000,
    (processId) => processId !== 111,
    222
  );
  stores.push(b);
  expect(b.acquire("thread-dead", 20_001)).toBe(true);
});

test("a new process preserves leases owned by a live process", async () => {
  const directory = await mkdtemp(join(tmpdir(), `codex-writer-lease-${randomUUID()}-`));
  directories.push(directory);
  const file = join(directory, "leases.sqlite3");
  const dbA = openRuntimeDatabase(file);
  const dbB = openRuntimeDatabase(file);
  databases.push(dbA, dbB);
  const a = new ThreadWriterLeaseStore(dbA, "live-instance", 30_000, 60_000, () => true, 111);
  stores.push(a);
  expect(a.acquire("thread-live", 30_000)).toBe(true);

  const b = new ThreadWriterLeaseStore(dbB, "other-instance", 30_000, 60_000, () => true, 222);
  stores.push(b);
  expect(b.acquire("thread-live", 30_001)).toBe(false);
});

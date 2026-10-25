import { createRequire } from "node:module";
import { isBunRuntime } from "./runtimeDetect.js";

const require = createRequire(import.meta.url);

export type RuntimeDatabase = {
  exec(sql: string): void;
  prepare(sql: string): any;
  close(): void;
};

export function openRuntimeDatabase(file: string): RuntimeDatabase {
  if (isBunRuntime) {
    const { Database } = require("bun:sqlite") as { Database: new (path: string) => RuntimeDatabase };
    return new Database(file);
  }
  return openNodeRuntimeDatabase(file);
}

type NodeSqliteOptions = { readonly?: boolean };

/**
 * Node.js track SQLite driver. Built-in `node:sqlite` is the only supported
 * driver: it needs no install and no native compilation, which keeps fresh
 * machines (e.g. FreeBSD with only `pkg install node`) working out of the box.
 * `better-sqlite3` is never installed or built by us; it is only reused
 * passively when already present (e.g. an existing desktop install).
 */
export function openNodeRuntimeDatabase(file: string, opts?: NodeSqliteOptions): RuntimeDatabase {
  const sqlite = loadNodeSqlite();
  if (sqlite) {
    const { readonly, ...rest } = opts ?? {};
    return new sqlite.DatabaseSync(file, {
      ...rest,
      ...(readonly === undefined ? {} : { readOnly: readonly }),
    }) as unknown as RuntimeDatabase;
  }
  try {
    const Database = require("better-sqlite3") as new (
      path: string,
      opts?: NodeSqliteOptions,
    ) => RuntimeDatabase;
    return new Database(file, opts);
  } catch {
    throw new Error(
      "No SQLite driver available on the Node.js track: built-in node:sqlite requires Node.js >= 22.13. " +
        "Upgrade Node instead of installing better-sqlite3 (native builds are not required).",
    );
  }
}

function loadNodeSqlite(): {
  DatabaseSync: new (path: string, opts?: Record<string, unknown>) => unknown;
} | null {
  try {
    return require("node:sqlite") as {
      DatabaseSync: new (path: string, opts?: Record<string, unknown>) => unknown;
    };
  } catch {
    return null;
  }
}


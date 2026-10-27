import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  listNativeMuseThreads,
  readNativeMusePreview,
  resolveNativeMuseSessionsRoots,
} from "../../backends/muse/src/runtime/museHistoryProjection.js";

describe("museHistoryProjection", () => {
  test("lists native session.jsonl bounded by recency without touching internal store", () => {
    const root = mkdtempSync(join(tmpdir(), "muse-hist-"));
    const sessions = join(root, "muse", "sessions", "2026-10-19");
    const sidA = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
    const sidB = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
    for (const sid of [sidA, sidB]) {
      const dir = join(sessions, sid);
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, "session.jsonl"),
        `{"payload_type":"session.started","prompt":"hello ${sid.slice(0, 4)}"}\n`,
        "utf8",
      );
    }
    process.env.MUSE_TEST_HOME = root;
    try {
      expect(resolveNativeMuseSessionsRoots().length).toBeGreaterThan(0);
      const listed = listNativeMuseThreads(200);
      const ids = listed.map((e) => String((e as Record<string, unknown>).id));
      expect(ids).toContain(sidA);
      expect(ids).toContain(sidB);
      expect(listed.every((e) => String((e as Record<string, unknown>).cliBackend) === "muse")).toBe(true);
      const preview = readNativeMusePreview(join(sessions, sidA, "session.jsonl"));
      expect(preview ?? "").toContain("hello");
    } finally {
      delete process.env.MUSE_TEST_HOME;
    }
  });

  test("empty roots yield empty list (fresh machine)", () => {
    const root = mkdtempSync(join(tmpdir(), "muse-hist-empty-"));
    process.env.MUSE_TEST_HOME = root;
    try {
      expect(listNativeMuseThreads(200)).toEqual([]);
    } finally {
      delete process.env.MUSE_TEST_HOME;
    }
  });
});

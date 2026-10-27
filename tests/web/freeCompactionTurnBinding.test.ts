import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

test("free compaction binds its waiter to the RPC turn ID", () => {
  const source = readFileSync(join(import.meta.dir, "../../apps/web/src/App.tsx"), "utf8")
    + readFileSync(join(import.meta.dir, "../../apps/web/src/free/useFreeCompaction.ts"), "utf8");

  expect(source).toContain('const compactResult = asRecord(await client.rpc("thread/compact/start", { threadId }))');
  expect(source).toContain("const compactTurnId = stringValue(asRecord(compactResult.turn).id) ?? stringValue(compactResult.turnId)");
  expect(source).toContain("Free compaction turn mismatch");
  expect(source.indexOf("waiter.turnId = compactTurnId")).toBeLessThan(source.indexOf("await completion;"));
});
